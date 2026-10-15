-- =============================================================================
-- Loop belajar autopilot, deteksi viral, dan notifikasi (PRD-AI-AUTOPILOT-MULTIUSER.md, Fase 3).
--
-- ADITIF dan idempoten. Jalankan MANUAL di SQL Editor Supabase oleh pemilik.
-- Prasyarat: sql/005_autopilot.sql dan sql/006_autopilot_radar.sql sudah dijalankan.
--
-- Keamanan sama dengan fungsi dash_* lain: SECURITY DEFINER, search_path dikunci, EXECUTE hanya untuk
-- service_role. Tabel baru ber-RLS tanpa policy dan dicabut dari anon/authenticated.
--
-- Sumber hasil: ThreadsPostStat (diisi pengumpul insight auto-suka). Posting autopilot dicocokkan lewat
-- PostDispatch.platformPostId = ThreadsPostStat.mediaId. Metrik diperbarui pengumpul kira-kira tiap
-- 20 jam untuk posting berumur <= 3 hari, jadi hasil di sini selalu tertinggal sampai satu hari.
-- =============================================================================

-- ------------------------------------------------------------------ tabel

CREATE TABLE IF NOT EXISTS "ContentOutcome" (
  "postId"        text PRIMARY KEY,                       -- ScheduledPost.id
  "slotId"        text NOT NULL,
  "workspaceId"   text NOT NULL,
  "accountId"     text NOT NULL,
  -- Fitur posting (apa yang dicoba).
  "formulaHook"   text,
  pilar           text,
  "jamLokal"      smallint NOT NULL,
  "jenisSlot"     text NOT NULL,
  "pakaiIde"      boolean NOT NULL DEFAULT false,
  promo           boolean NOT NULL DEFAULT false,
  -- Hasil (apa yang terjadi).
  "postedAt"      timestamp(3) NOT NULL,
  views           integer NOT NULL DEFAULT 0,
  likes           integer NOT NULL DEFAULT 0,
  replies         integer NOT NULL DEFAULT 0,
  reposts         integer NOT NULL DEFAULT 0,
  -- Median views 30 hari akun saat diukur, dan skor = ln((views+1)/(baseline+1)) dibatasi -2..2.
  baseline        real NOT NULL DEFAULT 0,
  score           real NOT NULL DEFAULT 0,
  "isViral"       boolean NOT NULL DEFAULT false,
  "diukurPada"    timestamp(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "ContentOutcome_akun_waktu_idx" ON "ContentOutcome" ("accountId", "postedAt" DESC);
CREATE INDEX IF NOT EXISTS "ContentOutcome_ws_viral_idx" ON "ContentOutcome" ("workspaceId", "postedAt" DESC) WHERE "isViral";

CREATE TABLE IF NOT EXISTS "DashboardNotification" (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspaceId" text NOT NULL,
  -- VIRAL | AKUN_DIJEDA | MODE_DITURUNKAN | PENERBIT_TELAT | PENJADWAL
  jenis         text NOT NULL,
  judul         text NOT NULL,
  isi           text,
  tautan        text,
  "accountId"   text,
  -- Kunci anti-ganda: kejadian yang sama tidak diberitahukan dua kali.
  "dedupeKey"   text NOT NULL,
  "dibacaOleh"  text[] NOT NULL DEFAULT '{}',
  "createdAt"   timestamp(3) NOT NULL,
  CONSTRAINT "DashboardNotification_dedupe_key" UNIQUE ("dedupeKey")
);
CREATE INDEX IF NOT EXISTS "DashboardNotification_ws_waktu_idx" ON "DashboardNotification" ("workspaceId", "createdAt" DESC, id DESC);

ALTER TABLE "ContentOutcome"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DashboardNotification" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ContentOutcome", "DashboardNotification" FROM anon, authenticated;

-- ------------------------------------------------------------------ belajar

-- Catat/perbarui hasil posting autopilot 14 hari terakhir dari statistik Threads, dan kembalikan
-- posting yang BARU saja memenuhi syarat viral (untuk notifikasi dan ide lanjutan).
-- Viral: views >= max(3x median 30 hari akun, 1.000), dinilai selama posting berumur <= 4 hari.
CREATE OR REPLACE FUNCTION dash_learn_sync(p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  WITH med AS (
    SELECT s."threadsAccountId" AS aid,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY s.views) AS m
    FROM "ThreadsPostStat" s
    WHERE s."postedAt" >= p_now - interval '30 days' AND s."postedAt" < p_now - interval '1 day'
      AND s."isQuote" = false
    GROUP BY s."threadsAccountId"
    HAVING COUNT(*) >= 5
  ), src AS (
    SELECT sl."postId", sl.id AS "slotId", sl."workspaceId", sl."accountId", sl.hour, sl.kind,
           i."formulaHook", COALESCE(sl.draft->>'pillar', i.pilar) AS pilar,
           (sl."ideaId" IS NOT NULL) AS "pakaiIde", COALESCE((sl.draft->>'promo')::boolean, false) AS promo,
           st."postedAt", st.views, st.likes, st.replies, st.reposts, st.text, st.permalink,
           COALESCE(med.m, 0)::real AS baseline,
           ta.username
    FROM "AutopilotSlot" sl
    JOIN "PostDispatch" d ON d."postId" = sl."postId" AND d.publisher = 'THREADS' AND d.status = 'TERBIT'
    JOIN "ThreadsPostStat" st ON st."mediaId" = d."platformPostId"
    JOIN "ThreadsAccount" ta ON ta.id = sl."accountId"
    LEFT JOIN "ContentIdea" i ON i.id = sl."ideaId"
    LEFT JOIN med ON med.aid = sl."accountId"
    WHERE sl.status = 'TERBIT' AND sl."postId" IS NOT NULL AND sl."slotAt" >= p_now - interval '14 days'
  ), prev AS (
    SELECT o."postId" FROM "ContentOutcome" o WHERE o."isViral" AND o."postId" IN (SELECT "postId" FROM src)
  ), up AS (
    INSERT INTO "ContentOutcome" ("postId", "slotId", "workspaceId", "accountId", "formulaHook", pilar, "jamLokal",
                                  "jenisSlot", "pakaiIde", promo, "postedAt", views, likes, replies, reposts,
                                  baseline, score, "isViral", "diukurPada")
    SELECT s."postId", s."slotId", s."workspaceId", s."accountId", s."formulaHook", s.pilar, s.hour, s.kind,
           s."pakaiIde", s.promo, s."postedAt", s.views, s.likes, s.replies, s.reposts, s.baseline,
           GREATEST(-2, LEAST(2, ln((s.views + 1)::float8 / (s.baseline + 1))))::real,
           (s.baseline > 0 AND s.views >= GREATEST(3 * s.baseline, 1000) AND s."postedAt" >= p_now - interval '4 days'),
           p_now
    FROM src s
    ON CONFLICT ("postId") DO UPDATE SET
      views = EXCLUDED.views, likes = EXCLUDED.likes, replies = EXCLUDED.replies, reposts = EXCLUDED.reposts,
      baseline = EXCLUDED.baseline, score = EXCLUDED.score,
      -- Sekali viral tetap viral (tidak dicabut saat posting menua).
      "isViral" = "ContentOutcome"."isViral" OR EXCLUDED."isViral",
      "diukurPada" = EXCLUDED."diukurPada"
    RETURNING "postId", "isViral"
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'postId', s."postId", 'slotId', s."slotId", 'workspaceId', s."workspaceId", 'accountId', s."accountId",
           'username', s.username, 'views', s.views, 'baseline', ROUND(s.baseline::numeric),
           'text', LEFT(regexp_replace(s.text, '\s+', ' ', 'g'), 200), 'permalink', s.permalink,
           'formulaHook', s."formulaHook", 'pilar', s.pilar)), '[]'::jsonb)
  INTO v
  FROM up
  JOIN src s ON s."postId" = up."postId"
  WHERE up."isViral" AND up."postId" NOT IN (SELECT "postId" FROM prev);
  RETURN v;
END
$$;

-- Rata-rata skor per akun per dimensi (60 hari), beserta rata-rata jaringan sebagai pembanding.
-- Baris: {aid (NULL = jaringan), dim, val, n, avg}. Dimensi: formulaHook, pilar, jam, jenisSlot.
CREATE OR REPLACE FUNCTION dash_learn_stats(p_ids text[], p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH base AS (
    SELECT o."accountId" AS aid, o.score, o."formulaHook", o.pilar, o."jamLokal", o."jenisSlot"
    FROM "ContentOutcome" o
    WHERE o."postedAt" >= p_now - interval '60 days' AND o."postedAt" < p_now - interval '1 day'
      AND o."workspaceId" IN (SELECT DISTINCT c."workspaceId" FROM "AutopilotConfig" c WHERE c."accountId" = ANY(p_ids))
  ), long AS (
    SELECT aid, 'formulaHook' AS dim, "formulaHook" AS val, score FROM base WHERE "formulaHook" IS NOT NULL
    UNION ALL SELECT aid, 'pilar', pilar, score FROM base WHERE pilar IS NOT NULL
    UNION ALL SELECT aid, 'jam', "jamLokal"::text, score FROM base
    UNION ALL SELECT aid, 'jenisSlot', "jenisSlot", score FROM base
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT aid, dim, val, COUNT(*)::int AS n, AVG(score)::real AS avg
    FROM long WHERE aid = ANY(p_ids) GROUP BY aid, dim, val
    UNION ALL
    SELECT NULL, dim, val, COUNT(*)::int, AVG(score)::real FROM long GROUP BY dim, val
  ) t
$$;

-- Akun mode OTOMATIS yang median views 7 hari terakhirnya turun lebih dari separuh dibanding 7 hari
-- sebelumnya (minimal 5 posting terukur di tiap pekan).
CREATE OR REPLACE FUNCTION dash_learn_drops(p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(t."accountId"), '[]'::jsonb) FROM (
    SELECT o."accountId",
           percentile_cont(0.5) WITHIN GROUP (ORDER BY o.views)
             FILTER (WHERE o."postedAt" >= p_now - interval '8 days') AS now_m,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY o.views)
             FILTER (WHERE o."postedAt" < p_now - interval '8 days') AS prev_m,
           COUNT(*) FILTER (WHERE o."postedAt" >= p_now - interval '8 days') AS now_n,
           COUNT(*) FILTER (WHERE o."postedAt" < p_now - interval '8 days') AS prev_n
    FROM "ContentOutcome" o
    JOIN "AutopilotConfig" c ON c."accountId" = o."accountId" AND c.mode = 'OTOMATIS' AND c."pausedReason" IS NULL
    -- Sehari terakhir dilewati: metriknya belum matang.
    WHERE o."postedAt" >= p_now - interval '15 days' AND o."postedAt" < p_now - interval '1 day'
      AND o."postedAt" >= c."updatedAt"
    GROUP BY o."accountId"
  ) t
  WHERE t.now_n >= 5 AND t.prev_n >= 5 AND t.prev_m > 0 AND t.now_m < 0.5 * t.prev_m
$$;

-- Turunkan akun ke mode TINJAU (penjaga kinerja). Mengembalikan akun yang benar-benar berubah.
CREATE OR REPLACE FUNCTION dash_ap_demote(p_ids text[], p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  WITH upd AS (
    UPDATE "AutopilotConfig" c SET mode = 'TINJAU', "updatedBy" = 'system:autopilot', "updatedAt" = p_now
    WHERE c."accountId" = ANY(p_ids) AND c.mode = 'OTOMATIS'
    RETURNING c."accountId", c."workspaceId"
  ), log AS (
    INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
    SELECT upd."workspaceId", 'system:autopilot', 'AUTOPILOT_TURUN_MODE', upd."accountId",
           jsonb_build_object('alasan', 'KINERJA_TURUN'), p_now FROM upd
    RETURNING id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('accountId', upd."accountId", 'workspaceId', upd."workspaceId")), '[]'::jsonb)
  INTO v FROM upd;
  RETURN v;
END
$$;

-- Ringkasan performa untuk UI: tabel per dimensi, autopilot dibanding posting lain, dan posting viral terakhir.
CREATE OR REPLACE FUNCTION dash_learn_summary(p_workspace text, p_account_ids text[], p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH base AS (
    SELECT o.* FROM "ContentOutcome" o
    WHERE o."postedAt" >= p_now - interval '60 days'
      AND (p_workspace IS NULL OR o."workspaceId" = p_workspace)
      AND (p_account_ids IS NULL OR o."accountId" = ANY(p_account_ids))
  ), mature AS (
    SELECT * FROM base WHERE "postedAt" < p_now - interval '1 day'
  ), long AS (
    SELECT 'formulaHook' AS dim, "formulaHook" AS val, score, views FROM mature WHERE "formulaHook" IS NOT NULL
    UNION ALL SELECT 'pilar', pilar, score, views FROM mature WHERE pilar IS NOT NULL
    UNION ALL SELECT 'jam', "jamLokal"::text, score, views FROM mature
    UNION ALL SELECT 'jenisSlot', "jenisSlot", score, views FROM mature
  )
  SELECT jsonb_build_object(
    'dims', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.dim, t.avg DESC), '[]'::jsonb) FROM (
        SELECT dim, val, COUNT(*)::int AS n, AVG(score)::real AS avg, ROUND(AVG(views))::int AS "avgViews"
        FROM long GROUP BY dim, val
      ) t),
    'autopilot', (
      SELECT jsonb_build_object('n', COUNT(*)::int, 'avgViews', COALESCE(ROUND(AVG(views)), 0)::int,
                                'medianViews', COALESCE(ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY views)::numeric), 0)::int)
      FROM mature WHERE "postedAt" >= p_now - interval '30 days'),
    'lainnya', (
      SELECT jsonb_build_object('n', COUNT(*)::int, 'avgViews', COALESCE(ROUND(AVG(s.views)), 0)::int,
                                'medianViews', COALESCE(ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY s.views)::numeric), 0)::int)
      FROM "ThreadsPostStat" s
      JOIN "ThreadsAccount" ta ON ta.id = s."threadsAccountId"
      WHERE s."postedAt" >= p_now - interval '30 days' AND s."postedAt" < p_now - interval '1 day' AND s."isQuote" = false
        AND (p_workspace IS NULL OR dash_ap_tenant_of(ta."workspaceId") = p_workspace)
        AND (p_account_ids IS NULL OR s."threadsAccountId" = ANY(p_account_ids))
        AND s."threadsAccountId" IN (SELECT DISTINCT "accountId" FROM base)
        AND NOT EXISTS (
          SELECT 1 FROM "PostDispatch" d JOIN "ContentOutcome" o ON o."postId" = d."postId"
          WHERE d."platformPostId" = s."mediaId")),
    'viral', (
      SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v."postedAt" DESC), '[]'::jsonb) FROM (
        SELECT b."postId", b."accountId", b.views, ROUND(b.baseline::numeric)::int AS baseline, b."postedAt",
               b."formulaHook", b.pilar
        FROM base b WHERE b."isViral" ORDER BY b."postedAt" DESC LIMIT 10
      ) v)
  )
$$;

-- ------------------------------------------------------------------ notifikasi

-- p_items: [{workspaceId, jenis, judul, isi?, tautan?, accountId?, dedupeKey}]. Kejadian dengan kunci
-- yang sama diabaikan. Notifikasi lebih dari 90 hari dibuang.
CREATE OR REPLACE FUNCTION dash_notif_add(p_items jsonb, p_now timestamp) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'items tidak valid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO "DashboardNotification" ("workspaceId", jenis, judul, isi, tautan, "accountId", "dedupeKey", "createdAt")
  SELECT it->>'workspaceId', it->>'jenis', LEFT(it->>'judul', 160), LEFT(it->>'isi', 400), LEFT(it->>'tautan', 300),
         NULLIF(it->>'accountId', ''), it->>'dedupeKey', p_now
  FROM jsonb_array_elements(p_items) it
  ON CONFLICT ("dedupeKey") DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM "DashboardNotification" WHERE "createdAt" < p_now - interval '90 days';
  RETURN n;
END
$$;

-- Notifikasi dalam lingkup pengguna (notifikasi akun hanya untuk yang boleh melihat akun itu),
-- terbaru dulu, beserta jumlah yang belum dibaca.
CREATE OR REPLACE FUNCTION dash_notif_list(
  p_workspace text, p_account_ids text[], p_user text, p_cursor_at timestamp, p_cursor_id text, p_limit int
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'items', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
        SELECT n.id, n.jenis, n.judul, n.isi, n.tautan, n."accountId", n."createdAt",
               (p_user = ANY(n."dibacaOleh")) AS dibaca
        FROM "DashboardNotification" n
        WHERE (p_workspace IS NULL OR n."workspaceId" = p_workspace)
          AND (p_account_ids IS NULL OR n."accountId" IS NULL OR n."accountId" = ANY(p_account_ids))
          AND (p_cursor_at IS NULL OR (n."createdAt", n.id) < (p_cursor_at, p_cursor_id))
        ORDER BY n."createdAt" DESC, n.id DESC
        LIMIT LEAST(GREATEST(p_limit, 1), 50) + 1
      ) t),
    'unread', (
      SELECT COUNT(*)::int FROM "DashboardNotification" n
      WHERE (p_workspace IS NULL OR n."workspaceId" = p_workspace)
        AND (p_account_ids IS NULL OR n."accountId" IS NULL OR n."accountId" = ANY(p_account_ids))
        AND n."createdAt" >= (now() AT TIME ZONE 'UTC') - interval '30 days'
        AND NOT (p_user = ANY(n."dibacaOleh")))
  )
$$;

-- Tandai dibaca: id tertentu, atau semua (p_ids NULL) dalam lingkup pengguna.
CREATE OR REPLACE FUNCTION dash_notif_read(p_ids text[], p_workspace text, p_account_ids text[], p_user text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE "DashboardNotification" x SET "dibacaOleh" = array_append(x."dibacaOleh", p_user)
  WHERE (p_ids IS NULL OR x.id = ANY(p_ids))
    AND (p_workspace IS NULL OR x."workspaceId" = p_workspace)
    AND (p_account_ids IS NULL OR x."accountId" IS NULL OR x."accountId" = ANY(p_account_ids))
    AND NOT (p_user = ANY(x."dibacaOleh"));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- ------------------------------------------------------------------ hak akses

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'dash\_learn\_%' OR p.proname LIKE 'dash\_notif\_%' OR p.proname = 'dash_ap_demote')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
