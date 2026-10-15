-- =============================================================================
-- Autopilot konten (PRD-AI-AUTOPILOT-MULTIUSER.md, Fase 1): tabel dan fungsi RPC.
--
-- ADITIF dan idempoten (IF NOT EXISTS / CREATE OR REPLACE). Tidak mengubah atau menghapus tabel
-- milik auto-suka. Jalankan MANUAL di SQL Editor Supabase (project nhpatcbdylkhpsifyhjb) oleh pemilik.
-- Prasyarat: sql/002_dashboard_post_log.sql dan sql/003_dashboard_rpc.sql sudah dijalankan.
--
-- Keamanan sama dengan fungsi dash_* lain: SECURITY DEFINER, search_path dikunci, EXECUTE hanya untuk
-- service_role, tanpa SQL dinamis. Tabel baru ber-RLS tanpa policy dan dicabut dari anon/authenticated.
--
-- Tenant: beberapa workspace auto-suka milik organisasi yang sama dikelola sebagai SATU tenant di
-- dashboard (tabel DashboardWorkspaceGroup). Kolom "workspaceId" pada semua tabel dashboard berisi id
-- tenant, yaitu id workspace pemimpin kelompoknya; workspace yang tidak berkelompok adalah tenant sendiri.
-- Saat pertama dipasang, semua workspace yang sudah punya akun Threads dijadikan satu kelompok (data
-- yang sudah ada dianggap milik satu organisasi). Ubah isi tabel itu bila anggapan ini tidak tepat.
--
-- Waktu: semua kolom `timestamp` berisi UTC tanpa zona (sama seperti tabel Prisma auto-suka).
-- `dayKey` adalah tanggal menurut zona waktu workspace (saat ini WIB).
-- =============================================================================

-- ------------------------------------------------------------------ tabel

CREATE TABLE IF NOT EXISTS "DashboardWorkspaceGroup" (
  "workspaceId" text PRIMARY KEY,                         -- Workspace.id (auto-suka)
  "groupId"     text NOT NULL                             -- id tenant = id workspace pemimpin kelompok
);
CREATE INDEX IF NOT EXISTS "DashboardWorkspaceGroup_group_idx" ON "DashboardWorkspaceGroup" ("groupId");

-- Data awal, hanya saat tabel masih kosong: semua workspace berakun Threads menjadi satu kelompok,
-- dipimpin workspace dengan akun terbanyak.
INSERT INTO "DashboardWorkspaceGroup" ("workspaceId", "groupId")
SELECT w.id, lead.id
FROM (SELECT DISTINCT "workspaceId" AS id FROM "ThreadsAccount" WHERE "workspaceId" IS NOT NULL) w
CROSS JOIN (
  SELECT "workspaceId" AS id FROM "ThreadsAccount" WHERE "workspaceId" IS NOT NULL
  GROUP BY "workspaceId" ORDER BY COUNT(*) DESC, "workspaceId" ASC LIMIT 1
) lead
WHERE NOT EXISTS (SELECT 1 FROM "DashboardWorkspaceGroup")
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS "WorkspaceSettings" (
  "workspaceId"    text PRIMARY KEY,
  -- Saklar "jeda semua" tingkat workspace.
  "autopilotAktif" boolean NOT NULL DEFAULT true,
  "updatedBy"      text,
  "updatedAt"      timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS "AutopilotConfig" (
  "accountId"     text PRIMARY KEY,                       -- ThreadsAccount.id
  "workspaceId"   text NOT NULL,
  mode            text NOT NULL DEFAULT 'MATI' CHECK (mode IN ('MATI', 'TINJAU', 'OTOMATIS')),
  "postsPerDay"   smallint NOT NULL DEFAULT 3 CHECK ("postsPerDay" BETWEEN 3 AND 6),
  "slotStrategy"  text NOT NULL DEFAULT 'JAM_RAMAI' CHECK ("slotStrategy" IN ('JAM_RAMAI', 'JAM_TETAP')),
  "fixedHours"    smallint[] NOT NULL DEFAULT '{}',
  "minGapMinutes" smallint NOT NULL DEFAULT 150 CHECK ("minGapMinutes" BETWEEN 120 AND 480),
  "activeDays"    smallint[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  "exploreRate"   real NOT NULL DEFAULT 0.15 CHECK ("exploreRate" BETWEEN 0 AND 0.3),
  pillars         jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{key, bobot}]
  "promoRatio"    real NOT NULL DEFAULT 0 CHECK ("promoRatio" BETWEEN 0 AND 0.3),
  "voiceStyle"    text,                                   -- null = profil suara otomatis
  brief           text,                                   -- tema + deskripsi akun
  -- Diisi penjaga (AKUN_TIDAK_SIAP:<alasan> | GAGAL_BERUNTUN | KINERJA_TURUN); null = berjalan.
  "pausedReason"  text,
  "pausedAt"      timestamp(3),
  "updatedBy"     text,
  "updatedAt"     timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS "AutopilotConfig_ws_mode_idx" ON "AutopilotConfig" ("workspaceId", mode);

CREATE TABLE IF NOT EXISTS "AutopilotSlot" (
  id            text PRIMARY KEY,
  "workspaceId" text NOT NULL,
  "accountId"   text NOT NULL,
  "dayKey"      date NOT NULL,
  "slotIndex"   smallint NOT NULL,
  "slotAt"      timestamp(3) NOT NULL,
  hour          smallint NOT NULL,                        -- jam lokal slot (0-23)
  kind          text NOT NULL DEFAULT 'RAMAI'
                CHECK (kind IN ('RAMAI', 'EKSPLORASI', 'TETAP', 'CADANGAN', 'TREN')),
  status        text NOT NULL DEFAULT 'DIRENCANAKAN'
                CHECK (status IN ('DIRENCANAKAN', 'MENULIS', 'MENUNGGU_TINJAU', 'TERANTRE',
                                  'TERBIT', 'GAGAL', 'DILEWATI', 'DIBATALKAN')),
  reason        text,                                     -- alasan pemilihan jam (disusun server)
  "ideaId"      text,
  draft         jsonb,                                    -- {text, topicTag, angle, rationale, model, gate}
  "criticScore" real,
  "postId"      text,                                     -- ScheduledPost.id
  attempt       smallint NOT NULL DEFAULT 0,
  "leaseUntil"  timestamp(3),
  "skipReason"  text,
  "lastError"   text,
  "createdAt"   timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updatedAt"   timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "AutopilotSlot_akun_hari_urut_key" UNIQUE ("accountId", "dayKey", "slotIndex")
);
-- Antrean kerja tick: hanya slot yang masih butuh tindakan.
CREATE INDEX IF NOT EXISTS "AutopilotSlot_kerja_idx" ON "AutopilotSlot" ("slotAt")
  WHERE status IN ('DIRENCANAKAN', 'MENULIS', 'MENUNGGU_TINJAU', 'TERANTRE');
CREATE INDEX IF NOT EXISTS "AutopilotSlot_hari_idx" ON "AutopilotSlot" ("dayKey", "workspaceId", "accountId");
CREATE UNIQUE INDEX IF NOT EXISTS "AutopilotSlot_post_key" ON "AutopilotSlot" ("postId") WHERE "postId" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "AutopilotRun" (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "startedAt"  timestamp(3) NOT NULL,
  "finishedAt" timestamp(3) NOT NULL,
  "durasiMs"   integer NOT NULL,
  hitung       jsonb NOT NULL DEFAULT '{}'::jsonb,
  error        text
);
CREATE INDEX IF NOT EXISTS "AutopilotRun_startedAt_idx" ON "AutopilotRun" ("startedAt" DESC);

CREATE TABLE IF NOT EXISTS "AutopilotLease" (
  name   text PRIMARY KEY,
  holder text NOT NULL,
  until  timestamp(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "DashboardAuditLog" (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspaceId" text,
  actor         text NOT NULL,                            -- id pengguna atau 'system:autopilot'
  action        text NOT NULL,
  target        text,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"   timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS "DashboardAuditLog_ws_waktu_idx" ON "DashboardAuditLog" ("workspaceId", "createdAt" DESC, id);

-- Pencarian posting berdasarkan kunci idempotensi (pemulihan slot + dash_replay).
CREATE INDEX IF NOT EXISTS "DashboardPostLog_idem_idx" ON "DashboardPostLog" ((detail->>'idempotencyKey'));

ALTER TABLE "DashboardWorkspaceGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutopilotConfig"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutopilotSlot"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutopilotRun"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutopilotLease"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DashboardAuditLog" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "DashboardWorkspaceGroup", "WorkspaceSettings", "AutopilotConfig", "AutopilotSlot", "AutopilotRun",
                    "AutopilotLease", "DashboardAuditLog" FROM anon, authenticated;

-- ------------------------------------------------------------------ tenant

-- Id tenant untuk sebuah workspace auto-suka (pemimpin kelompoknya, atau dirinya sendiri).
CREATE OR REPLACE FUNCTION dash_ap_tenant_of(p_workspace text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT g."groupId" FROM "DashboardWorkspaceGroup" g WHERE g."workspaceId" = p_workspace), p_workspace)
$$;

-- Peta workspace -> tenant untuk server dashboard (hanya workspace yang berkelompok).
CREATE OR REPLACE FUNCTION dash_ap_tenant_map() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT "workspaceId", "groupId" FROM "DashboardWorkspaceGroup"
  ) t
$$;

-- ------------------------------------------------------------------ baca

-- Keadaan autopilot dalam satu perjalanan: saklar workspace, konfigurasi akun, slot ringan (tanpa
-- teks draf) untuk rentang hari, tick terakhir, dan kepatuhan 7 hari. p_workspace NULL = semua (tick).
CREATE OR REPLACE FUNCTION dash_ap_state(p_workspace text, p_from date, p_to date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'settings', (
      SELECT COALESCE(jsonb_agg(to_jsonb(w)), '[]'::jsonb) FROM (
        SELECT "workspaceId", "autopilotAktif" FROM "WorkspaceSettings"
        WHERE p_workspace IS NULL OR "workspaceId" = p_workspace
      ) w),
    'configs', (
      SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) FROM (
        SELECT "accountId", "workspaceId", mode, "postsPerDay", "slotStrategy", "fixedHours", "minGapMinutes",
               "activeDays", "exploreRate", pillars, "promoRatio", "voiceStyle", brief,
               "pausedReason", "pausedAt", "updatedAt"
        FROM "AutopilotConfig"
        WHERE p_workspace IS NULL OR "workspaceId" = p_workspace
      ) c),
    'slots', (
      SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s."slotAt", s.id), '[]'::jsonb) FROM (
        SELECT id, "workspaceId", "accountId", "dayKey", "slotIndex", "slotAt", hour, kind, status, reason,
               "skipReason", "lastError", "postId", attempt, "criticScore"
        FROM "AutopilotSlot"
        WHERE "dayKey" BETWEEN p_from AND p_to
          AND (p_workspace IS NULL OR "workspaceId" = p_workspace)
      ) s),
    'lastRun', (
      SELECT to_jsonb(r) FROM (
        SELECT "startedAt", "finishedAt", "durasiMs", hitung, error
        FROM "AutopilotRun" ORDER BY "startedAt" DESC LIMIT 1
      ) r),
    'stats7d', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
        SELECT "accountId",
               COUNT(*)::int AS hari,
               COUNT(*) FILTER (WHERE terbit >= 3)::int AS "hariPatuh",
               SUM(terbit)::int AS terbit, SUM(gagal)::int AS gagal, SUM(dilewati)::int AS dilewati
        FROM (
          SELECT "accountId", "dayKey",
                 COUNT(*) FILTER (WHERE status = 'TERBIT') AS terbit,
                 COUNT(*) FILTER (WHERE status = 'GAGAL') AS gagal,
                 COUNT(*) FILTER (WHERE status = 'DILEWATI') AS dilewati
          FROM "AutopilotSlot"
          WHERE "dayKey" >= p_from - 7 AND "dayKey" < p_from
            AND (p_workspace IS NULL OR "workspaceId" = p_workspace)
          GROUP BY "accountId", "dayKey"
        ) d
        GROUP BY "accountId"
      ) t)
  )
$$;

-- Slot lengkap dengan draf (kotak tinjau dan riwayat), paginasi kursor (slotAt, id).
CREATE OR REPLACE FUNCTION dash_ap_slot_list(
  p_workspace text, p_account_ids text[], p_statuses text[],
  p_cursor_at timestamp, p_cursor_id text, p_desc boolean, p_limit int
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT s.id, s."workspaceId", s."accountId", s."dayKey", s."slotIndex", s."slotAt", s.hour, s.kind, s.status,
           s.reason, s."skipReason", s."lastError", s."postId", s.attempt, s."criticScore", s.draft
    FROM "AutopilotSlot" s
    WHERE (p_workspace IS NULL OR s."workspaceId" = p_workspace)
      AND (p_account_ids IS NULL OR s."accountId" = ANY(p_account_ids))
      AND s.status = ANY(p_statuses)
      AND (p_cursor_at IS NULL OR
           CASE WHEN p_desc THEN (s."slotAt", s.id) < (p_cursor_at, p_cursor_id)
                ELSE (s."slotAt", s.id) > (p_cursor_at, p_cursor_id) END)
    ORDER BY CASE WHEN p_desc THEN s."slotAt" END DESC, CASE WHEN p_desc THEN s.id END DESC,
             CASE WHEN NOT p_desc THEN s."slotAt" END ASC, CASE WHEN NOT p_desc THEN s.id END ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 50) + 1
  ) t
$$;

CREATE OR REPLACE FUNCTION dash_ap_slot_get(p_id text, p_workspace text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT to_jsonb(t) FROM (
    SELECT s.id, s."workspaceId", s."accountId", s."dayKey", s."slotIndex", s."slotAt", s.hour, s.kind, s.status,
           s.reason, s."skipReason", s."lastError", s."postId", s.attempt, s."criticScore", s.draft
    FROM "AutopilotSlot" s
    WHERE s.id = p_id AND (p_workspace IS NULL OR s."workspaceId" = p_workspace)
  ) t
$$;

-- Teks draf autopilot pada rentang hari (pembanding supaya akun lain tidak menulis hal yang sama).
CREATE OR REPLACE FUNCTION dash_ap_peer_texts(p_workspace text, p_from date, p_to date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT s."accountId" AS aid, s.draft->>'text' AS text, s.draft->>'topicKey' AS "topicKey"
    FROM "AutopilotSlot" s
    WHERE s."dayKey" BETWEEN p_from AND p_to
      AND (p_workspace IS NULL OR s."workspaceId" = p_workspace)
      AND s.draft IS NOT NULL AND s.status IN ('MENUNGGU_TINJAU', 'TERANTRE', 'TERBIT')
    ORDER BY s."updatedAt" DESC
    LIMIT 120
  ) t
$$;

-- Id posting (dari daftar) yang dibuat autopilot, untuk label di halaman Jadwal.
CREATE OR REPLACE FUNCTION dash_ap_post_flags(p_ids text[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(s."postId"), '[]'::jsonb) FROM "AutopilotSlot" s WHERE s."postId" = ANY(p_ids)
$$;

CREATE OR REPLACE FUNCTION dash_ap_runs(p_limit int) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) FROM (
    SELECT id, "startedAt", "finishedAt", "durasiMs", hitung, error
    FROM "AutopilotRun" ORDER BY "startedAt" DESC LIMIT LEAST(GREATEST(p_limit, 1), 100)
  ) r
$$;

-- ------------------------------------------------------------------ tulis: konfigurasi

-- p_items: baris AutopilotConfig lengkap (server yang menggabungkan nilai bawaan dan memvalidasi).
-- Slot yang belum dikerjakan dibuang supaya direncanakan ulang dengan pengaturan baru.
CREATE OR REPLACE FUNCTION dash_ap_config_upsert(p_items jsonb, p_user text, p_now timestamp) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE it jsonb; n integer := 0;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'items tidak valid' USING ERRCODE = '22023';
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO "AutopilotConfig" ("accountId", "workspaceId", mode, "postsPerDay", "slotStrategy", "fixedHours",
                                   "minGapMinutes", "activeDays", "exploreRate", pillars, "promoRatio",
                                   "voiceStyle", brief, "pausedReason", "pausedAt", "updatedBy", "updatedAt")
    VALUES (it->>'accountId', it->>'workspaceId', it->>'mode', (it->>'postsPerDay')::smallint, it->>'slotStrategy',
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(it->'fixedHours', '[]'::jsonb))::smallint),
            (it->>'minGapMinutes')::smallint,
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(it->'activeDays', '[]'::jsonb))::smallint),
            (it->>'exploreRate')::real, COALESCE(it->'pillars', '[]'::jsonb), (it->>'promoRatio')::real,
            NULLIF(it->>'voiceStyle', ''), NULLIF(it->>'brief', ''), NULL, NULL, p_user, p_now)
    ON CONFLICT ("accountId") DO UPDATE SET
      "workspaceId" = EXCLUDED."workspaceId", mode = EXCLUDED.mode, "postsPerDay" = EXCLUDED."postsPerDay",
      "slotStrategy" = EXCLUDED."slotStrategy", "fixedHours" = EXCLUDED."fixedHours",
      "minGapMinutes" = EXCLUDED."minGapMinutes", "activeDays" = EXCLUDED."activeDays",
      "exploreRate" = EXCLUDED."exploreRate", pillars = EXCLUDED.pillars, "promoRatio" = EXCLUDED."promoRatio",
      "voiceStyle" = EXCLUDED."voiceStyle", brief = EXCLUDED.brief,
      "pausedReason" = NULL, "pausedAt" = NULL, "updatedBy" = p_user, "updatedAt" = p_now;
    DELETE FROM "AutopilotSlot"
    WHERE "accountId" = it->>'accountId' AND status = 'DIRENCANAKAN' AND "slotAt" > p_now;
    INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
    VALUES (it->>'workspaceId', p_user, 'AUTOPILOT_CONFIG', it->>'accountId',
            jsonb_build_object('mode', it->>'mode', 'postsPerDay', it->'postsPerDay',
                               'slotStrategy', it->>'slotStrategy'), p_now);
    n := n + 1;
  END LOOP;
  RETURN n;
END
$$;

CREATE OR REPLACE FUNCTION dash_ap_workspace_set(p_workspace text, p_aktif boolean, p_user text, p_now timestamp)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO "WorkspaceSettings" ("workspaceId", "autopilotAktif", "updatedBy", "updatedAt")
  VALUES (p_workspace, p_aktif, p_user, p_now)
  ON CONFLICT ("workspaceId") DO UPDATE SET
    "autopilotAktif" = EXCLUDED."autopilotAktif", "updatedBy" = p_user, "updatedAt" = p_now;
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (p_workspace, p_user, CASE WHEN p_aktif THEN 'AUTOPILOT_LANJUT_SEMUA' ELSE 'AUTOPILOT_JEDA_SEMUA' END,
          p_workspace, '{}'::jsonb, p_now);
  RETURN TRUE;
END
$$;

-- Jeda akun oleh penjaga. Slot tidak langsung dibuang: selama dijeda slot tidak diklaim, dan baru
-- dilewati bila jam tayangnya terlewat. Jadi jeda singkat (mis. token sedang diperbarui) tidak
-- menghanguskan slot hari itu.
CREATE OR REPLACE FUNCTION dash_ap_pause(p_ids text[], p_reason text, p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  WITH upd AS (
    UPDATE "AutopilotConfig" c SET "pausedReason" = p_reason, "pausedAt" = p_now
    WHERE c."accountId" = ANY(p_ids) AND c."pausedReason" IS NULL AND c.mode <> 'MATI'
    RETURNING c."accountId", c."workspaceId"
  ), log AS (
    INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
    SELECT upd."workspaceId", 'system:autopilot', 'AUTOPILOT_JEDA', upd."accountId",
           jsonb_build_object('alasan', p_reason), p_now FROM upd
    RETURNING id
  )
  SELECT COALESCE(jsonb_agg(upd."accountId"), '[]'::jsonb) INTO v FROM upd;
  RETURN v;
END
$$;

-- Lanjutkan akun yang dijeda penjaga dengan alasan berawalan p_prefix (mis. akun sudah siap lagi).
CREATE OR REPLACE FUNCTION dash_ap_resume(p_ids text[], p_prefix text, p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  WITH upd AS (
    UPDATE "AutopilotConfig" c SET "pausedReason" = NULL, "pausedAt" = NULL
    WHERE c."accountId" = ANY(p_ids) AND c."pausedReason" LIKE p_prefix || '%'
    RETURNING c."accountId", c."workspaceId"
  ), log AS (
    INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
    SELECT upd."workspaceId", 'system:autopilot', 'AUTOPILOT_LANJUT', upd."accountId", '{}'::jsonb, p_now FROM upd
    RETURNING id
  )
  SELECT COALESCE(jsonb_agg(upd."accountId"), '[]'::jsonb) INTO v FROM upd;
  RETURN v;
END
$$;

-- ------------------------------------------------------------------ tulis: slot

-- p_items: [{id, workspaceId, accountId, dayKey, slotIndex, slotAt, hour, kind, reason}].
-- Aman diulang: slot (akun, hari, urut) yang sudah ada tidak disentuh.
CREATE OR REPLACE FUNCTION dash_ap_plan_slots(p_items jsonb, p_now timestamp) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 2000 THEN
    RAISE EXCEPTION 'items tidak valid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO "AutopilotSlot" (id, "workspaceId", "accountId", "dayKey", "slotIndex", "slotAt", hour, kind, reason,
                               "createdAt", "updatedAt")
  SELECT it->>'id', it->>'workspaceId', it->>'accountId', (it->>'dayKey')::date, (it->>'slotIndex')::smallint,
         (it->>'slotAt')::timestamp, (it->>'hour')::smallint, it->>'kind', it->>'reason', p_now, p_now
  FROM jsonb_array_elements(p_items) it
  ON CONFLICT ("accountId", "dayKey", "slotIndex") DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- Pulihkan slot yang postingannya sudah masuk antrean tetapi statusnya belum sempat diperbarui
-- (proses terputus di antara keduanya). Dicocokkan lewat kunci idempotensi 'autopilot:<slotId>'.
CREATE OR REPLACE FUNCTION dash_ap_heal(p_now timestamp) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE "AutopilotSlot" s SET status = 'TERANTRE', "postId" = l."postId", "leaseUntil" = NULL, "updatedAt" = p_now
  FROM "DashboardPostLog" l
  WHERE s.status = 'MENULIS' AND s."leaseUntil" < p_now
    AND l.detail->>'idempotencyKey' = 'autopilot:' || s.id
    AND l.action IN ('CREATE_NOW', 'CREATE_SCHEDULED')
    AND EXISTS (SELECT 1 FROM "ScheduledPost" p WHERE p.id = l."postId");
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- Ambil slot yang sudah waktunya ditulis dan kunci dengan lease. Aman dipanggil serentak
-- (FOR UPDATE SKIP LOCKED). Slot yang terputus dipulihkan dulu (dash_ap_heal), supaya tidak ditulis
-- dan diantre dua kali.
CREATE OR REPLACE FUNCTION dash_ap_claim(
  p_now timestamp, p_min_at timestamp, p_until_auto timestamp, p_until_review timestamp,
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
    WHERE (s.status = 'DIRENCANAKAN' OR (s.status = 'MENULIS' AND s."leaseUntil" < p_now))
      AND s."slotAt" >= p_min_at
      AND s."slotAt" <= CASE WHEN c.mode = 'TINJAU' THEN p_until_review ELSE p_until_auto END
      AND c.mode IN ('TINJAU', 'OTOMATIS') AND c."pausedReason" IS NULL
      AND COALESCE(w."autopilotAktif", true)
    ORDER BY s."slotAt" ASC, s.id ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 200)
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

-- Transisi status bersyarat (atomik): hanya berhasil bila status sekarang ada di p_from.
-- p_patch boleh memuat: draft, criticScore, postId, ideaId, slotAt, skipReason, lastError, attemptDelta,
-- leaseUntil (kunci sementara saat manusia menyetujui), serta actor + auditAction untuk mencatat audit.
CREATE OR REPLACE FUNCTION dash_ap_slot_update(
  p_id text, p_workspace text, p_from text[], p_status text, p_patch jsonb, p_now timestamp
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pt jsonb := COALESCE(p_patch, '{}'::jsonb); v_ws text; v_account text;
BEGIN
  UPDATE "AutopilotSlot" s SET
    status = p_status,
    draft = CASE WHEN pt ? 'draft' THEN NULLIF(pt->'draft', 'null'::jsonb) ELSE s.draft END,
    attempt = CASE WHEN pt ? 'attemptDelta'
                   THEN GREATEST(0, s.attempt + (pt->>'attemptDelta')::int)::smallint ELSE s.attempt END,
    "criticScore" = CASE WHEN pt ? 'criticScore' THEN (pt->>'criticScore')::real ELSE s."criticScore" END,
    "postId" = CASE WHEN pt ? 'postId' THEN pt->>'postId' ELSE s."postId" END,
    "ideaId" = CASE WHEN pt ? 'ideaId' THEN pt->>'ideaId' ELSE s."ideaId" END,
    "slotAt" = CASE WHEN pt ? 'slotAt' THEN (pt->>'slotAt')::timestamp ELSE s."slotAt" END,
    "skipReason" = CASE WHEN pt ? 'skipReason' THEN pt->>'skipReason' ELSE s."skipReason" END,
    "lastError" = CASE WHEN pt ? 'lastError' THEN pt->>'lastError' ELSE s."lastError" END,
    "leaseUntil" = CASE WHEN pt ? 'leaseUntil' THEN (pt->>'leaseUntil')::timestamp ELSE NULL END,
    "updatedAt" = p_now
  WHERE s.id = p_id AND s.status = ANY(p_from)
    AND (p_workspace IS NULL OR s."workspaceId" = p_workspace)
  RETURNING s."workspaceId", s."accountId" INTO v_ws, v_account;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF pt ? 'auditAction' THEN
    INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
    VALUES (v_ws, COALESCE(pt->>'actor', 'system:autopilot'), pt->>'auditAction', p_id,
            jsonb_build_object('accountId', v_account, 'status', p_status), p_now);
  END IF;
  RETURN TRUE;
END
$$;

-- Selaraskan slot dengan antrean penerbit, lewati slot yang kehabisan waktu, dan laporkan kondisi
-- yang perlu ditindak penjaga (gagal beruntun, penerbit terlambat).
CREATE OR REPLACE FUNCTION dash_ap_reconcile(
  p_now timestamp, p_review_cutoff timestamp, p_stale_before timestamp, p_late_before timestamp
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n_terbit int; n_gagal int; n_batal int; n_ulang int; n_tinjau int; n_telat int; v_streak jsonb; n_late int;
BEGIN
  -- Selalu dijalankan (juga saat penulisan sedang ditahan), sebelum slot basi dinilai terlambat.
  PERFORM dash_ap_heal(p_now);

  -- Posting dibatalkan manusia di halaman Jadwal (baris antrean dihapus).
  UPDATE "AutopilotSlot" s SET status = 'DIBATALKAN', "updatedAt" = p_now
  WHERE s.status IN ('TERANTRE', 'GAGAL') AND s."postId" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "ScheduledPost" p WHERE p.id = s."postId");
  GET DIAGNOSTICS n_batal = ROW_COUNT;

  UPDATE "AutopilotSlot" s SET status = 'TERBIT', "lastError" = NULL, "slotAt" = p."tayangPada", "updatedAt" = p_now
  FROM "PostDispatch" d JOIN "ScheduledPost" p ON p.id = d."postId"
  WHERE s.status IN ('TERANTRE', 'GAGAL') AND d."postId" = s."postId"
    AND d.publisher = 'THREADS' AND d.status = 'TERBIT';
  GET DIAGNOSTICS n_terbit = ROW_COUNT;

  UPDATE "AutopilotSlot" s SET status = 'GAGAL', "lastError" = LEFT(COALESCE(d."pesanError", 'Gagal terbit'), 300),
         "updatedAt" = p_now
  FROM "PostDispatch" d
  WHERE s.status = 'TERANTRE' AND d."postId" = s."postId" AND d.publisher = 'THREADS' AND d.status = 'GAGAL';
  GET DIAGNOSTICS n_gagal = ROW_COUNT;

  -- Manusia menekan "kirim ulang": posting kembali menunggu.
  UPDATE "AutopilotSlot" s SET status = 'TERANTRE', "lastError" = NULL, "updatedAt" = p_now
  FROM "PostDispatch" d
  WHERE s.status = 'GAGAL' AND d."postId" = s."postId" AND d.publisher = 'THREADS' AND d.status = 'MENUNGGU';
  GET DIAGNOSTICS n_ulang = ROW_COUNT;

  UPDATE "AutopilotSlot" s SET status = 'DILEWATI', "skipReason" = 'Tidak disetujui sampai batas waktu.',
         "updatedAt" = p_now
  WHERE s.status = 'MENUNGGU_TINJAU' AND s."slotAt" <= p_review_cutoff;
  GET DIAGNOSTICS n_tinjau = ROW_COUNT;

  UPDATE "AutopilotSlot" s SET status = 'DILEWATI',
         "skipReason" = COALESCE(NULLIF(s."lastError", ''), 'Draf tidak siap sebelum jam tayang.'),
         "leaseUntil" = NULL, "updatedAt" = p_now
  WHERE (s.status = 'DIRENCANAKAN' OR (s.status = 'MENULIS' AND (s."leaseUntil" IS NULL OR s."leaseUntil" < p_now)))
    AND s."slotAt" < p_stale_before;
  GET DIAGNOSTICS n_telat = ROW_COUNT;

  -- Tiga slot terakhir akun (sejak pengaturan terakhir diubah) semuanya gagal terbit.
  SELECT COALESCE(jsonb_agg(t."accountId"), '[]'::jsonb) INTO v_streak FROM (
    SELECT x."accountId" FROM (
      SELECT s."accountId", s.status,
             ROW_NUMBER() OVER (PARTITION BY s."accountId" ORDER BY s."slotAt" DESC, s.id DESC) AS rn
      FROM "AutopilotSlot" s
      JOIN "AutopilotConfig" c ON c."accountId" = s."accountId"
      WHERE s.status IN ('TERBIT', 'GAGAL') AND s."slotAt" >= p_now - interval '7 days'
        AND s."slotAt" >= c."updatedAt" AND c."pausedReason" IS NULL AND c.mode <> 'MATI'
    ) x
    WHERE x.rn <= 3
    GROUP BY x."accountId"
    HAVING COUNT(*) = 3 AND bool_and(x.status = 'GAGAL')
  ) t;

  SELECT COUNT(*)::int INTO n_late
  FROM "AutopilotSlot" s
  JOIN "ScheduledPost" p ON p.id = s."postId"
  JOIN "PostDispatch" d ON d."postId" = p.id AND d.publisher = 'THREADS'
  WHERE s.status = 'TERANTRE' AND d.status = 'MENUNGGU'
    AND d."lockedAt" IS NULL AND d."platformContainerId" IS NULL
    AND p.status = 'MENUNGGU' AND p."tayangPada" < p_late_before;

  RETURN jsonb_build_object(
    'terbit', n_terbit, 'gagal', n_gagal, 'dibatalkan', n_batal, 'diulang', n_ulang,
    'tinjauLewat', n_tinjau, 'terlambat', n_telat, 'gagalBeruntun', v_streak, 'penerbitTelat', n_late
  );
END
$$;

-- ------------------------------------------------------------------ tulis: tick

-- Kunci tick tunggal. Berhasil bila belum ada pemegang, pemegang lama kedaluwarsa, atau pemegangnya sama.
CREATE OR REPLACE FUNCTION dash_ap_lease(p_name text, p_holder text, p_now timestamp, p_until timestamp)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  INSERT INTO "AutopilotLease" AS l (name, holder, until) VALUES (p_name, p_holder, p_until)
  ON CONFLICT (name) DO UPDATE SET holder = EXCLUDED.holder, until = EXCLUDED.until
  WHERE l.until < p_now OR l.holder = p_holder;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END
$$;

CREATE OR REPLACE FUNCTION dash_ap_release(p_name text, p_holder text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  DELETE FROM "AutopilotLease" WHERE name = p_name AND holder = p_holder;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END
$$;

-- Catat satu putaran tick; riwayat lebih dari 30 hari dibuang.
CREATE OR REPLACE FUNCTION dash_ap_run_log(p_run jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO "AutopilotRun" ("startedAt", "finishedAt", "durasiMs", hitung, error)
  VALUES ((p_run->>'startedAt')::timestamp, (p_run->>'finishedAt')::timestamp, (p_run->>'durasiMs')::int,
          COALESCE(p_run->'hitung', '{}'::jsonb), NULLIF(p_run->>'error', ''));
  DELETE FROM "AutopilotRun" WHERE "startedAt" < (p_run->>'startedAt')::timestamp - interval '30 days';
  RETURN TRUE;
END
$$;

-- ------------------------------------------------------------------ hak akses

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'dash\_ap\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
