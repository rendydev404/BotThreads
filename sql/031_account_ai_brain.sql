-- =============================================================================
-- Otak AI per akun: memori gaya (belajar dari koreksi pemilik akun) dan status onboarding agen.
--
-- 1. "AccountStyleLesson": pelajaran gaya singkat per akun ("jangan pakai emoji", "pakai gue, bukan aku").
--    Diisi dari selisih draf AI vs teks yang akhirnya disimpan pemilik akun (src/lib/account-memory.ts).
--    Pelajaran yang sama (lessonKey) tidak diduplikasi; hits naik setiap kali muncul lagi, jadi pelajaran
--    yang paling sering terbukti dipakai lebih dulu di prompt semua fitur AI (src/lib/account-brain.ts).
-- 2. "AccountOnboarding": progres agen yang langsung bekerja saat akun Threads dihubungkan (baca postingan,
--    kenali peran akun, riset tren niche, isi bank ide). Satu baris per akun; UI membacanya untuk animasi.
--
-- ADITIF dan idempoten. Prasyarat: tabel "ThreadsAccount".
-- =============================================================================

CREATE TABLE IF NOT EXISTS "AccountStyleLesson" (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "accountId"   text NOT NULL REFERENCES "ThreadsAccount"(id) ON UPDATE CASCADE ON DELETE CASCADE,
  "workspaceId" text,
  lesson        text NOT NULL CHECK (char_length(lesson) BETWEEN 3 AND 200),
  "lessonKey"   text NOT NULL,
  source        text NOT NULL CHECK (source IN ('EDIT', 'AI_EDIT', 'REVIEW', 'MANUAL')),
  hits          integer NOT NULL DEFAULT 1,
  "lastSeenAt"  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("accountId", "lessonKey")
);
-- Prompt mengambil pelajaran teratas per akun: urut hits lalu yang terbaru.
CREATE INDEX IF NOT EXISTS "AccountStyleLesson_rank_idx"
  ON "AccountStyleLesson" ("accountId", hits DESC, "lastSeenAt" DESC);

ALTER TABLE "AccountStyleLesson" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, DELETE ON "AccountStyleLesson" TO service_role;

-- Tambah pelajaran; yang sudah ada (lessonKey sama) cukup dinaikkan hits-nya.
CREATE OR REPLACE FUNCTION dash_style_lesson_add(p_items jsonb, p_now timestamp)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ins AS (
    INSERT INTO "AccountStyleLesson" ("accountId", "workspaceId", lesson, "lessonKey", source, "lastSeenAt", "createdAt")
    SELECT i->>'accountId', i->>'workspaceId', left(i->>'lesson', 200), i->>'lessonKey', i->>'source', p_now, p_now
    FROM jsonb_array_elements(p_items) i
    WHERE EXISTS (SELECT 1 FROM "ThreadsAccount" a WHERE a.id = i->>'accountId')
    ON CONFLICT ("accountId", "lessonKey")
    DO UPDATE SET hits = "AccountStyleLesson".hits + 1, "lastSeenAt" = EXCLUDED."lastSeenAt", lesson = EXCLUDED.lesson
    RETURNING 1
  )
  SELECT count(*)::int FROM ins
$$;

REVOKE ALL ON FUNCTION dash_style_lesson_add(jsonb, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_style_lesson_add(jsonb, timestamp) TO service_role;

CREATE TABLE IF NOT EXISTS "AccountOnboarding" (
  "accountId"   text PRIMARY KEY REFERENCES "ThreadsAccount"(id) ON UPDATE CASCADE ON DELETE CASCADE,
  "workspaceId" text,
  status        text NOT NULL CHECK (status IN ('BERJALAN', 'SELESAI', 'GAGAL')),
  steps         jsonb NOT NULL DEFAULT '[]'::jsonb,
  "startedAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"  timestamp(3),
  "updatedAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "AccountOnboarding" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON "AccountOnboarding" TO service_role;

-- Klaim slot untuk satu akun (dipakai langkah ke-5 agen onboarding: langsung tulis draf pertama hari ini).
CREATE OR REPLACE FUNCTION dash_ap_claim_account(
  p_account_id text, p_now timestamp, p_min_at timestamp, p_until timestamp,
  p_lease_until timestamp, p_limit int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  PERFORM dash_ap_heal(p_now);

  WITH pick AS (
    SELECT s.id
    FROM "AutopilotSlot" s
    JOIN "AutopilotConfig" c ON c."accountId" = s."accountId"
    LEFT JOIN "WorkspaceSettings" w ON w."workspaceId" = s."workspaceId"
    WHERE s."accountId" = p_account_id
      AND (s.status = 'DIRENCANAKAN' OR (s.status = 'MENULIS' AND s."leaseUntil" < p_now))
      AND s."slotAt" >= p_min_at
      AND s."slotAt" <= p_until
      AND c.mode IN ('TINJAU', 'OTOMATIS') AND c."pausedReason" IS NULL
      AND COALESCE(w."autopilotAktif", true)
    ORDER BY s."slotAt" ASC, s.id ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 20)
    FOR UPDATE OF s SKIP LOCKED
  ), upd AS (
    UPDATE "AutopilotSlot" s SET status = 'MENULIS', attempt = s.attempt + 1,
           "leaseUntil" = p_lease_until, "updatedAt" = p_now
    FROM pick WHERE s.id = pick.id
    RETURNING s.id, s."workspaceId", s."accountId", s."dayKey", s."slotIndex", s."slotAt", s.hour, s.kind,
              s.reason, s.attempt, s."ideaId", s.draft->>'text' AS "prevText"
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(u) || jsonb_build_object('mode', c.mode) ORDER BY u."slotAt", u.id), '[]'::jsonb)
  INTO v
  FROM upd u JOIN "AutopilotConfig" c ON c."accountId" = u."accountId";
  RETURN v;
END
$$;

REVOKE ALL ON FUNCTION dash_ap_claim_account(text, timestamp, timestamp, timestamp, timestamp, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_ap_claim_account(text, timestamp, timestamp, timestamp, timestamp, int) TO service_role;

NOTIFY pgrst, 'reload schema';
