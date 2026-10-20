-- =============================================================================
-- Pengerahan Buzzer Lintas-Niche (Konsol Super Admin: /admin/buzzer).
--
-- Memungkinkan Super Admin mengerahkan akun-akun dari Workspace Buzzer untuk meramaikan postingan
-- akun target secara on-demand lewat API resmi Meta Threads:
--   - KOMEN   : balasan komentar natural lintas-niche (SEJALUR, JEMBATAN, atau JAUH/bertanya)
--   - REPOST  : repost langsung ke beranda buzzer (POST /{mediaId}/repost)
--   - QUOTE   : bagikan kutipan postingan ke feed buzzer dengan kalimat natural sesuai niche buzzer
--
-- ADITIF dan idempoten. Tidak menghapus atau mengubah data lama.
-- Prasyarat: sql/010_superadmin.sql, sql/014_admin_rbac.sql, sql/022_threads_publisher.sql.
-- =============================================================================

-- ------------------------------------------------------------------ 1. Hak akses modul buzzer

CREATE OR REPLACE FUNCTION dash_sa_izin_valid() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'dashboard.lihat',
    'pengguna.lihat', 'pengguna.kelola',
    'workspace.lihat', 'workspace.kelola',
    'konten.lihat', 'konten.kelola',
    'buzzer.lihat', 'buzzer.kelola',
    'paket.lihat', 'paket.kelola',
    'tagihan.lihat', 'tagihan.kelola',
    'sumber.lihat', 'sumber.kelola',
    'integrasi.lihat', 'integrasi.kelola',
    'sistem.lihat', 'sistem.kelola',
    'audit.lihat'
  ]::text[]
$$;

UPDATE "PlatformRole"
SET izin = array_append(array_append(izin, 'buzzer.lihat'), 'buzzer.kelola')
WHERE id = 'ADMIN' AND NOT ('buzzer.lihat' = ANY(izin));

UPDATE "PlatformRole"
SET izin = array_append(izin, 'buzzer.lihat')
WHERE id = 'AUDITOR' AND NOT ('buzzer.lihat' = ANY(izin));

-- ------------------------------------------------------------------ 2. Tabel Buzzer

ALTER TABLE "ThreadsAccount" ADD COLUMN IF NOT EXISTS "threadsUserId" text;
ALTER TABLE "ThreadsAccount" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp(3) DEFAULT (now() AT TIME ZONE 'UTC');

CREATE TABLE IF NOT EXISTS "AutoCommentSetting" (
  id                 text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspaceId"      text NOT NULL,
  "threadsAccountId" text UNIQUE NOT NULL REFERENCES "ThreadsAccount"(id) ON DELETE CASCADE,
  enabled            boolean NOT NULL DEFAULT false,
  slots              text[] NOT NULL DEFAULT '{}',
  "keywordSource"    text NOT NULL DEFAULT 'POOL',
  "personaName"      text NOT NULL DEFAULT '',
  "personaStyle"     text NOT NULL DEFAULT '',
  "lastSlotKey"      text,
  "lastRunAt"        timestamp(3),
  "lastRunNote"      text,
  "createdAt"        timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updatedAt"        timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS "BuzzerProfile" (
  "accountId"     text PRIMARY KEY REFERENCES "ThreadsAccount"(id) ON DELETE CASCADE,
  "workspaceId"   text NOT NULL,
  aktif           boolean NOT NULL DEFAULT true,
  niche           text NOT NULL DEFAULT '',
  persona         text NOT NULL DEFAULT '',
  "voiceStyle"    text CHECK ("voiceStyle" IS NULL OR "voiceStyle" IN ('gue_lo', 'aku_kamu', 'saya_kamu', 'kita', 'santai', 'formal', 'humoris')),
  catatan         text,
  "inferredFrom"  text NOT NULL DEFAULT 'HISTORI' CHECK ("inferredFrom" IN ('MANUAL', 'AI', 'AUTO_COMMENT', 'HISTORI')),
  "updatedBy"     text,
  "updatedAt"     timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS "BuzzerProfile_ws_aktif_idx" ON "BuzzerProfile" ("workspaceId", aktif);

CREATE TABLE IF NOT EXISTS "BuzzerCampaign" (
  id                  text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "targetAccountId"   text,
  "targetUsername"    text NOT NULL,
  "targetDisplayName" text,
  "targetNiche"       text,
  "targetMediaId"     text NOT NULL,
  "targetText"        text NOT NULL DEFAULT '',
  "targetPermalink"   text,
  "targetPostedAt"    timestamp(3),
  actions             text[] NOT NULL DEFAULT '{KOMEN}',
  "catatanAdmin"      text,
  "jedaMinDetik"      integer NOT NULL DEFAULT 30 CHECK ("jedaMinDetik" BETWEEN 0 AND 3600),
  "jedaMaxDetik"      integer NOT NULL DEFAULT 180 CHECK ("jedaMaxDetik" >= "jedaMinDetik" AND "jedaMaxDetik" <= 7200),
  "totalTasks"        integer NOT NULL DEFAULT 0,
  "doneTasks"         integer NOT NULL DEFAULT 0,
  "failedTasks"       integer NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'BERJALAN'
                      CHECK (status IN ('BERJALAN', 'SELESAI', 'SEBAGIAN_GAGAL', 'DIBATALKAN')),
  "createdBy"         text NOT NULL,
  "createdAt"         timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updatedAt"         timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS "BuzzerCampaign_daftar_idx" ON "BuzzerCampaign" ("createdAt" DESC, id DESC);
CREATE INDEX IF NOT EXISTS "BuzzerCampaign_media_idx" ON "BuzzerCampaign" ("targetMediaId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "BuzzerTask" (
  id                text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "campaignId"      text NOT NULL REFERENCES "BuzzerCampaign"(id) ON DELETE CASCADE,
  "buzzerAccountId" text NOT NULL REFERENCES "ThreadsAccount"(id) ON DELETE CASCADE,
  "targetMediaId"   text NOT NULL,
  action            text NOT NULL CHECK (action IN ('KOMEN', 'REPOST', 'QUOTE')),
  "nicheRelation"   text CHECK ("nicheRelation" IS NULL OR "nicheRelation" IN ('SEJALUR', 'JEMBATAN', 'JAUH')),
  text              text,
  "containerId"     text,
  "resultMediaId"   text,
  "resultPermalink" text,
  status            text NOT NULL DEFAULT 'TERJADWAL'
                    CHECK (status IN ('TERJADWAL', 'DIPROSES', 'BERHASIL', 'GAGAL', 'DIBATALKAN')),
  attempts          smallint NOT NULL DEFAULT 0,
  "scheduledAt"     timestamp(3) NOT NULL,
  "lockedAt"        timestamp(3),
  "executedAt"      timestamp(3),
  "lastError"       text,
  "createdAt"       timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updatedAt"       timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "BuzzerTask_unik_key" UNIQUE ("campaignId", "buzzerAccountId", action)
);
CREATE INDEX IF NOT EXISTS "BuzzerTask_antrean_idx" ON "BuzzerTask" ("scheduledAt" ASC, id ASC)
  WHERE status IN ('TERJADWAL', 'DIPROSES');
CREATE INDEX IF NOT EXISTS "BuzzerTask_campaign_idx" ON "BuzzerTask" ("campaignId", "scheduledAt" ASC, id ASC);
CREATE INDEX IF NOT EXISTS "BuzzerTask_media_buzzer_idx" ON "BuzzerTask" ("targetMediaId", "buzzerAccountId", action)
  WHERE status = 'BERHASIL';
CREATE INDEX IF NOT EXISTS "BuzzerTask_buzzer_time_idx" ON "BuzzerTask" ("buzzerAccountId", "executedAt" DESC)
  WHERE status = 'BERHASIL';

ALTER TABLE "BuzzerProfile"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BuzzerCampaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BuzzerTask"     ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "BuzzerProfile", "BuzzerCampaign", "BuzzerTask" FROM anon, authenticated;

-- Seed awal otomatis dari workspace buzzer yang sudah ada (tanpa menimpa yang sudah diatur).
INSERT INTO "BuzzerProfile" ("accountId", "workspaceId", aktif, niche, persona, "voiceStyle", "inferredFrom")
SELECT
  ta.id,
  ta."workspaceId",
  true,
  COALESCE(NULLIF(TRIM(ac.brief), ''), ''),
  COALESCE(NULLIF(TRIM(acs."personaStyle"), ''), ''),
  CASE
    WHEN ac."voiceStyle" IN ('gue_lo', 'aku_kamu', 'saya_kamu', 'kita') THEN ac."voiceStyle"
    WHEN acs."personaStyle" ILIKE '%pakai "gue"%' OR acs."personaStyle" ILIKE '%pakai ''gue''%' THEN 'gue_lo'
    WHEN acs."personaStyle" ILIKE '%pakai "aku"%' OR acs."personaStyle" ILIKE '%pakai ''aku''%' THEN 'aku_kamu'
    ELSE 'aku_kamu'
  END,
  CASE
    WHEN NULLIF(TRIM(acs."personaStyle"), '') IS NOT NULL THEN 'AUTO_COMMENT'
    ELSE 'HISTORI'
  END
FROM "ThreadsAccount" ta
JOIN "Workspace" w ON w.id = ta."workspaceId"
LEFT JOIN "AutoCommentSetting" acs ON acs."threadsAccountId" = ta.id
LEFT JOIN "AutopilotConfig" ac ON ac."accountId" = ta.id
WHERE w.slug ILIKE '%buzzer%' OR w.nama ILIKE '%buzzer%'
ON CONFLICT ("accountId") DO NOTHING;

-- ------------------------------------------------------------------ 3. Pembantu Status Kampanye

CREATE OR REPLACE FUNCTION dash_buzzer_finalize(p_campaign text, p_now timestamp) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_total   int;
  v_done    int;
  v_failed  int;
  v_pending int;
  v_cancel  int;
  v_status  text;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE status <> 'DIBATALKAN')::int,
    COUNT(*) FILTER (WHERE status = 'BERHASIL')::int,
    COUNT(*) FILTER (WHERE status = 'GAGAL')::int,
    COUNT(*) FILTER (WHERE status IN ('TERJADWAL', 'DIPROSES'))::int,
    COUNT(*) FILTER (WHERE status = 'DIBATALKAN')::int
  INTO v_total, v_done, v_failed, v_pending, v_cancel
  FROM "BuzzerTask"
  WHERE "campaignId" = p_campaign;

  IF v_pending > 0 THEN
    v_status := 'BERJALAN';
  ELSIF v_total = 0 AND v_cancel > 0 THEN
    v_status := 'DIBATALKAN';
  ELSIF v_failed = 0 THEN
    v_status := 'SELESAI';
  ELSE
    v_status := 'SEBAGIAN_GAGAL';
  END IF;

  UPDATE "BuzzerCampaign"
  SET "totalTasks"  = GREATEST(v_total, 0),
      "doneTasks"   = COALESCE(v_done, 0),
      "failedTasks" = COALESCE(v_failed, 0),
      status        = v_status,
      "updatedAt"   = p_now
  WHERE id = p_campaign;
END
$$;

-- ------------------------------------------------------------------ 4. Pembacaan Konsol Super Admin

CREATE OR REPLACE FUNCTION dash_sa_buzzer_overview(p_user text, p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT dash_sa_is(p_user) THEN
    RAISE EXCEPTION 'BUKAN_SUPERADMIN' USING ERRCODE = '42501';
  END IF;

  RETURN (
    WITH bws AS (
      SELECT DISTINCT w.id, w.nama, w.slug
      FROM "Workspace" w
      LEFT JOIN "BuzzerProfile" bp ON bp."workspaceId" = w.id
      WHERE w.slug ILIKE '%buzzer%' OR w.nama ILIKE '%buzzer%' OR bp."accountId" IS NOT NULL
    ),
    b_accs AS (
      SELECT
        ta.id AS "accountId",
        ta."workspaceId",
        w.nama AS "workspaceNama",
        ta.username,
        ta."displayName",
        ta."avatarUrl",
        ta."needsReconnect",
        ta."accessExpiresAt",
        ta.scopes,
        o.nama AS "outletNama",
        COALESCE(bp.aktif, true) AS aktif,
        COALESCE(NULLIF(TRIM(bp.niche), ''), NULLIF(TRIM(ac.brief), ''), '') AS niche,
        COALESCE(NULLIF(TRIM(bp.persona), ''), NULLIF(TRIM(acs."personaStyle"), ''), '') AS persona,
        COALESCE(bp."voiceStyle", ac."voiceStyle", 'aku_kamu') AS "voiceStyle",
        bp.catatan,
        COALESCE(bp."inferredFrom", CASE WHEN NULLIF(TRIM(acs."personaStyle"), '') IS NOT NULL THEN 'AUTO_COMMENT' ELSE 'HISTORI' END) AS "inferredFrom",
        bp."updatedAt",
        acs."personaName" AS "autoCommentPersonaName",
        acs."personaStyle" AS "autoCommentPersonaStyle",
        ac.brief AS "autopilotBrief",
        COALESCE(ac.pillars, '[]'::jsonb) AS "autopilotPillars"
      FROM "ThreadsAccount" ta
      JOIN "Workspace" w ON w.id = ta."workspaceId"
      LEFT JOIN "BuzzerProfile" bp ON bp."accountId" = ta.id
      LEFT JOIN "AutoCommentSetting" acs ON acs."threadsAccountId" = ta.id
      LEFT JOIN "AutopilotConfig" ac ON ac."accountId" = ta.id
      LEFT JOIN "SocialAccount" sa ON sa."threadsAccountId" = ta.id
      LEFT JOIN "Outlet" o ON o.id = sa."outletId"
      WHERE ta."workspaceId" IN (SELECT id FROM bws) OR bp."accountId" IS NOT NULL
    ),
    samples AS (
      SELECT aid, COALESCE(jsonb_agg(text ORDER BY rn), '[]'::jsonb) AS posts
      FROM (
        SELECT s."threadsAccountId" AS aid, LEFT(s.text, 240) AS text,
               ROW_NUMBER() OVER (PARTITION BY s."threadsAccountId" ORDER BY s."postedAt" DESC, s.id DESC) AS rn
        FROM "ThreadsPostStat" s
        WHERE s."threadsAccountId" IN (SELECT "accountId" FROM b_accs)
          AND char_length(s.text) >= 15
      ) r
      WHERE rn <= 3
      GROUP BY aid
    ),
    task_counts AS (
      SELECT
        "buzzerAccountId" AS aid,
        COUNT(*) FILTER (WHERE status = 'BERHASIL' AND "executedAt" >= p_now - interval '24 hours')::int AS "tasksToday",
        COUNT(*) FILTER (WHERE status = 'BERHASIL')::int AS "tasksTotal"
      FROM "BuzzerTask"
      GROUP BY "buzzerAccountId"
    ),
    target_accs AS (
      SELECT
        ta.id AS "accountId",
        ta."workspaceId",
        w.nama AS "workspaceNama",
        COALESCE(dwg."groupId", ta."workspaceId") AS "tenantId",
        COALESCE(tw.nama, w.nama) AS "tenantNama",
        ta.username,
        ta."displayName",
        ta."avatarUrl",
        ta."needsReconnect",
        ta."accessExpiresAt",
        o.nama AS "outletNama",
        ac.brief,
        COALESCE(ac.pillars, '[]'::jsonb) AS pillars,
        (SELECT COUNT(*)::int FROM "ThreadsPostStat" ps WHERE ps."threadsAccountId" = ta.id) AS "postCount"
      FROM "ThreadsAccount" ta
      JOIN "Workspace" w ON w.id = ta."workspaceId"
      LEFT JOIN "DashboardWorkspaceGroup" dwg ON dwg."workspaceId" = ta."workspaceId"
      LEFT JOIN "Workspace" tw ON tw.id = dwg."groupId"
      LEFT JOIN "SocialAccount" sa ON sa."threadsAccountId" = ta.id
      LEFT JOIN "Outlet" o ON o.id = sa."outletId"
      LEFT JOIN "AutopilotConfig" ac ON ac."accountId" = ta.id
      WHERE ta.id NOT IN (SELECT "accountId" FROM b_accs)
      ORDER BY COALESCE(tw.nama, w.nama) ASC, ta."displayName" ASC, ta.id ASC
    )
    SELECT jsonb_build_object(
      'workspaces', COALESCE((SELECT jsonb_agg(to_jsonb(bws) ORDER BY bws.nama) FROM bws), '[]'::jsonb),
      'buzzers', COALESCE((
        SELECT jsonb_agg(
          to_jsonb(b) || jsonb_build_object(
            'samplePosts', COALESCE(sm.posts, '[]'::jsonb),
            'tasksToday', COALESCE(tc."tasksToday", 0),
            'tasksTotal', COALESCE(tc."tasksTotal", 0)
          )
          ORDER BY b.aktif DESC, (b.niche <> '' OR b.persona <> '') DESC, COALESCE(b.username, b."displayName") ASC, b."accountId" ASC
        )
        FROM b_accs b
        LEFT JOIN samples sm ON sm.aid = b."accountId"
        LEFT JOIN task_counts tc ON tc.aid = b."accountId"
      ), '[]'::jsonb),
      'targets', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM target_accs t), '[]'::jsonb),
      'stats', jsonb_build_object(
        'totalBuzzers', (SELECT COUNT(*)::int FROM b_accs),
        'readyBuzzers', (SELECT COUNT(*)::int FROM b_accs WHERE aktif AND NOT "needsReconnect" AND "accessExpiresAt" > p_now),
        'profiledBuzzers', (SELECT COUNT(*)::int FROM b_accs WHERE niche <> '' OR persona <> ''),
        'totalCampaigns', (SELECT COUNT(*)::int FROM "BuzzerCampaign"),
        'activeCampaigns', (SELECT COUNT(*)::int FROM "BuzzerCampaign" WHERE status = 'BERJALAN'),
        'queuedTasks', (SELECT COUNT(*)::int FROM "BuzzerTask" WHERE status IN ('TERJADWAL', 'DIPROSES')),
        'doneToday', (SELECT COUNT(*)::int FROM "BuzzerTask" WHERE status = 'BERHASIL' AND "executedAt" >= p_now - interval '24 hours'),
        'doneTotal', (SELECT COUNT(*)::int FROM "BuzzerTask" WHERE status = 'BERHASIL')
      )
    )
  );
END
$$;

-- Daftar postingan terbaru dari akun target (gabungan ThreadsPostStat + PostDispatch yang sudah TERBIT).
CREATE OR REPLACE FUNCTION dash_sa_buzzer_posts(p_user text, p_account_id text, p_limit int) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT dash_sa_is(p_user) THEN
    RAISE EXCEPTION 'BUKAN_SUPERADMIN' USING ERRCODE = '42501';
  END IF;

  RETURN (
    WITH raw_posts AS (
      SELECT
        ps."mediaId" AS "mediaId",
        ps."mediaType" AS "mediaType",
        LEFT(ps.text, 600) AS text,
        ps.permalink,
        ps."postedAt" AS "postedAt",
        ps.views,
        ps.likes,
        ps.replies,
        ps.reposts,
        ps.quotes
      FROM "ThreadsPostStat" ps
      WHERE ps."threadsAccountId" = p_account_id AND ps."isQuote" = false
      UNION ALL
      SELECT
        pd."platformPostId" AS "mediaId",
        COALESCE(sp."mediaType"::text, 'TEXT') AS "mediaType",
        LEFT(COALESCE(sp.caption, ''), 600) AS text,
        pd."releaseUrl" AS permalink,
        COALESCE(pd."updatedAt", sp."tayangPada") AS "postedAt",
        0 AS views, 0 AS likes, 0 AS replies, 0 AS reposts, 0 AS quotes
      FROM "PostDispatch" pd
      JOIN "ScheduledPost" sp ON sp.id = pd."postId"
      JOIN "SocialAccount" sa ON sa.id = pd."socialAccountId"
      WHERE sa."threadsAccountId" = p_account_id
        AND pd.status = 'TERBIT'
        AND pd."platformPostId" IS NOT NULL
    ),
    dedup AS (
      SELECT DISTINCT ON ("mediaId")
        "mediaId", "mediaType", text, permalink, "postedAt", views, likes, replies, reposts, quotes
      FROM raw_posts
      WHERE "mediaId" IS NOT NULL AND "mediaId" <> ''
      ORDER BY "mediaId", views DESC, "postedAt" DESC
    ),
    sorted AS (
      SELECT * FROM dedup
      ORDER BY "postedAt" DESC
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
    ),
    b_stats AS (
      SELECT
        "targetMediaId",
        COUNT(*) FILTER (WHERE status = 'BERHASIL' AND action = 'KOMEN')::int AS "buzzerKomen",
        COUNT(*) FILTER (WHERE status = 'BERHASIL' AND action = 'REPOST')::int AS "buzzerRepost",
        COUNT(*) FILTER (WHERE status = 'BERHASIL' AND action = 'QUOTE')::int AS "buzzerQuote",
        COUNT(*) FILTER (WHERE status IN ('TERJADWAL', 'DIPROSES'))::int AS "buzzerPending"
      FROM "BuzzerTask"
      WHERE "targetMediaId" IN (SELECT "mediaId" FROM sorted)
      GROUP BY "targetMediaId"
    )
    SELECT COALESCE(jsonb_agg(
      to_jsonb(s) || jsonb_build_object(
        'buzzerKomen', COALESCE(bs."buzzerKomen", 0),
        'buzzerRepost', COALESCE(bs."buzzerRepost", 0),
        'buzzerQuote', COALESCE(bs."buzzerQuote", 0),
        'buzzerPending', COALESCE(bs."buzzerPending", 0)
      )
      ORDER BY s."postedAt" DESC
    ), '[]'::jsonb)
    FROM sorted s
    LEFT JOIN b_stats bs ON bs."targetMediaId" = s."mediaId"
  );
END
$$;

-- Token baca postingan live untuk akun target (khusus Super Admin).
CREATE OR REPLACE FUNCTION dash_sa_buzzer_target_token(p_user text, p_account_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT dash_sa_is(p_user) THEN
    RAISE EXCEPTION 'BUKAN_SUPERADMIN' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT to_jsonb(t) FROM (
      SELECT id, "threadsUserId", "accessToken", "needsReconnect", "accessExpiresAt"
      FROM "ThreadsAccount"
      WHERE id = p_account_id
    ) t
  );
END
$$;

-- ------------------------------------------------------------------ 5. Mutasi Profil & Kampanye Buzzer

-- Simpan 1..100 profil niche/persona buzzer sekaligus.
CREATE OR REPLACE FUNCTION dash_sa_buzzer_profile_upsert(p_user text, p_items jsonb, p_now timestamp) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_count int := 0;
BEGIN
  IF NOT dash_sa_is(p_user) THEN
    RAISE EXCEPTION 'BUKAN_SUPERADMIN' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO "BuzzerProfile" ("accountId", "workspaceId", aktif, niche, persona, "voiceStyle", catatan, "inferredFrom", "updatedBy", "updatedAt")
  SELECT
    ta.id,
    ta."workspaceId",
    COALESCE((it->>'aktif')::boolean, true),
    LEFT(COALESCE(TRIM(it->>'niche'), ''), 160),
    LEFT(COALESCE(TRIM(it->>'persona'), ''), 300),
    CASE WHEN (it->>'voiceStyle') IN ('gue_lo', 'aku_kamu', 'saya_kamu', 'kita') THEN it->>'voiceStyle' ELSE 'aku_kamu' END,
    NULLIF(LEFT(COALESCE(TRIM(it->>'catatan'), ''), 300), ''),
    CASE WHEN (it->>'inferredFrom') IN ('MANUAL', 'AI', 'AUTO_COMMENT', 'HISTORI') THEN it->>'inferredFrom' ELSE 'MANUAL' END,
    p_user,
    p_now
  FROM jsonb_array_elements(p_items) it
  JOIN "ThreadsAccount" ta ON ta.id = (it->>'accountId')
  ON CONFLICT ("accountId") DO UPDATE SET
    aktif          = EXCLUDED.aktif,
    niche          = EXCLUDED.niche,
    persona        = EXCLUDED.persona,
    "voiceStyle"   = EXCLUDED."voiceStyle",
    catatan        = EXCLUDED.catatan,
    "inferredFrom" = EXCLUDED."inferredFrom",
    "updatedBy"    = EXCLUDED."updatedBy",
    "updatedAt"    = EXCLUDED."updatedAt";

  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO "PlatformAuditLog" (actor, action, "targetType", "targetId", detail, "createdAt")
  VALUES (
    p_user,
    'BUZZER_PROFIL_SIMPAN',
    'BUZZER',
    'batch',
    jsonb_build_object('jumlah', v_count, 'alasan', 'Memperbarui niche dan persona akun buzzer'),
    p_now
  );

  RETURN v_count;
END
$$;

-- Buat satu kampanye pengerahan buzzer beserta seluruh antrean tugasnya.
CREATE OR REPLACE FUNCTION dash_sa_buzzer_campaign_create(
  p_user text, p_campaign jsonb, p_tasks jsonb, p_now timestamp
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cid      text;
  v_media_id text := TRIM(COALESCE(p_campaign->>'targetMediaId', ''));
  v_inserted int := 0;
  v_total    int := 0;
BEGIN
  IF NOT dash_sa_is(p_user) THEN
    RAISE EXCEPTION 'BUKAN_SUPERADMIN' USING ERRCODE = '42501';
  END IF;
  IF v_media_id = '' OR jsonb_typeof(p_tasks) <> 'array' OR jsonb_array_length(p_tasks) = 0 OR jsonb_array_length(p_tasks) > 200 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO "BuzzerCampaign" (
    "targetAccountId", "targetUsername", "targetDisplayName", "targetNiche",
    "targetMediaId", "targetText", "targetPermalink", "targetPostedAt",
    actions, "catatanAdmin", "jedaMinDetik", "jedaMaxDetik",
    "totalTasks", status, "createdBy", "createdAt", "updatedAt"
  ) VALUES (
    NULLIF(p_campaign->>'targetAccountId', ''),
    LEFT(COALESCE(NULLIF(TRIM(p_campaign->>'targetUsername'), ''), 'threads'), 80),
    NULLIF(LEFT(COALESCE(TRIM(p_campaign->>'targetDisplayName'), ''), 120), ''),
    NULLIF(LEFT(COALESCE(TRIM(p_campaign->>'targetNiche'), ''), 160), ''),
    v_media_id,
    LEFT(COALESCE(p_campaign->>'targetText', ''), 1000),
    NULLIF(LEFT(COALESCE(TRIM(p_campaign->>'targetPermalink'), ''), 500), ''),
    NULLIF(p_campaign->>'targetPostedAt', '')::timestamp,
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_campaign->'actions', '["KOMEN"]'::jsonb))),
    NULLIF(LEFT(COALESCE(TRIM(p_campaign->>'catatanAdmin'), ''), 400), ''),
    LEAST(3600, GREATEST(0, COALESCE((p_campaign->>'jedaMinDetik')::int, 30))),
    LEAST(7200, GREATEST(0, COALESCE((p_campaign->>'jedaMaxDetik')::int, 180))),
    jsonb_array_length(p_tasks),
    'BERJALAN',
    p_user,
    p_now,
    p_now
  )
  RETURNING id INTO v_cid;

  v_total := jsonb_array_length(p_tasks);

  INSERT INTO "BuzzerTask" (
    "campaignId", "buzzerAccountId", "targetMediaId", action,
    "nicheRelation", text, status, "scheduledAt", "createdAt", "updatedAt"
  )
  SELECT
    v_cid,
    ta.id,
    v_media_id,
    t->>'action',
    CASE WHEN (t->>'nicheRelation') IN ('SEJALUR', 'JEMBATAN', 'JAUH') THEN t->>'nicheRelation' ELSE NULL END,
    NULLIF(LEFT(COALESCE(TRIM(t->>'text'), ''), 500), ''),
    'TERJADWAL',
    COALESCE(NULLIF(t->>'scheduledAt', '')::timestamp, p_now),
    p_now,
    p_now
  FROM jsonb_array_elements(p_tasks) t
  JOIN "ThreadsAccount" ta ON ta.id = (t->>'buzzerAccountId')
  WHERE (t->>'action') IN ('KOMEN', 'REPOST', 'QUOTE')
    -- Cegah repost ganda oleh akun buzzer yang sama di postingan yang sama
    AND NOT (
      (t->>'action') = 'REPOST' AND EXISTS (
        SELECT 1 FROM "BuzzerTask" prev
        WHERE prev."targetMediaId" = v_media_id
          AND prev."buzzerAccountId" = ta.id
          AND prev.action = 'REPOST'
          AND prev.status = 'BERHASIL'
      )
    )
  ON CONFLICT ("campaignId", "buzzerAccountId", action) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    RAISE EXCEPTION 'TIDAK_ADA_TUGAS_BARU' USING ERRCODE = '22023';
  END IF;

  PERFORM dash_buzzer_finalize(v_cid, p_now);

  INSERT INTO "PlatformAuditLog" (actor, action, "targetType", "targetId", detail, "createdAt")
  VALUES (
    p_user,
    'BUZZER_KERAHKAN',
    'BUZZER_CAMPAIGN',
    v_cid,
    jsonb_build_object(
      'targetMediaId', v_media_id,
      'targetUsername', p_campaign->>'targetUsername',
      'actions', p_campaign->'actions',
      'tugasDibuat', v_inserted
    ),
    p_now
  );

  RETURN jsonb_build_object('campaignId', v_cid, 'inserted', v_inserted, 'skipped', GREATEST(0, v_total - v_inserted));
END
$$;

-- Daftar riwayat kampanye buzzer beserta rincian tugas tiap akun.
CREATE OR REPLACE FUNCTION dash_sa_buzzer_campaigns(
  p_user text, p_status text, p_cursor_at timestamp, p_cursor_id text, p_limit int
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT dash_sa_is(p_user) THEN
    RAISE EXCEPTION 'BUKAN_SUPERADMIN' USING ERRCODE = '42501';
  END IF;

  RETURN (
    WITH page AS (
      SELECT c.*
      FROM "BuzzerCampaign" c
      WHERE (p_status IS NULL OR c.status = p_status)
        AND (p_cursor_at IS NULL OR (c."createdAt", c.id) < (p_cursor_at, p_cursor_id))
      ORDER BY c."createdAt" DESC, c.id DESC
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 15), 1), 30) + 1
    ),
    tasks AS (
      SELECT
        bt."campaignId",
        jsonb_agg(
          jsonb_build_object(
            'id', bt.id,
            'buzzerAccountId', bt."buzzerAccountId",
            'buzzerUsername', ta.username,
            'buzzerDisplayName', ta."displayName",
            'buzzerAvatarUrl', ta."avatarUrl",
            'buzzerNiche', COALESCE(NULLIF(bp.niche, ''), ''),
            'action', bt.action,
            'nicheRelation', bt."nicheRelation",
            'text', bt.text,
            'status', bt.status,
            'attempts', bt.attempts,
            'scheduledAt', bt."scheduledAt",
            'executedAt', bt."executedAt",
            'resultMediaId', bt."resultMediaId",
            'resultPermalink', bt."resultPermalink",
            'lastError', bt."lastError"
          )
          ORDER BY bt."scheduledAt" ASC, bt.id ASC
        ) AS items
      FROM "BuzzerTask" bt
      JOIN "ThreadsAccount" ta ON ta.id = bt."buzzerAccountId"
      LEFT JOIN "BuzzerProfile" bp ON bp."accountId" = bt."buzzerAccountId"
      WHERE bt."campaignId" IN (SELECT id FROM page)
      GROUP BY bt."campaignId"
    )
    SELECT COALESCE(jsonb_agg(
      to_jsonb(p) || jsonb_build_object('tasks', COALESCE(t.items, '[]'::jsonb))
      ORDER BY p."createdAt" DESC, p.id DESC
    ), '[]'::jsonb)
    FROM page p
    LEFT JOIN tasks t ON t."campaignId" = p.id
  );
END
$$;

-- Aksi pada kampanye: CANCEL (batalkan tugas TERJADWAL) atau RETRY_FAILED (jadwalkan ulang tugas GAGAL).
CREATE OR REPLACE FUNCTION dash_sa_buzzer_campaign_action(
  p_user text, p_campaign_id text, p_action text, p_now timestamp
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_affected int := 0;
BEGIN
  IF NOT dash_sa_is(p_user) THEN
    RAISE EXCEPTION 'BUKAN_SUPERADMIN' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'CANCEL' THEN
    UPDATE "BuzzerTask"
    SET status = 'DIBATALKAN', "lockedAt" = NULL, "updatedAt" = p_now
    WHERE "campaignId" = p_campaign_id AND status = 'TERJADWAL';
    GET DIAGNOSTICS v_affected = ROW_COUNT;
  ELSIF p_action = 'RETRY_FAILED' THEN
    WITH f AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY "scheduledAt" ASC, id ASC) - 1 AS idx
      FROM "BuzzerTask"
      WHERE "campaignId" = p_campaign_id AND status = 'GAGAL'
    )
    UPDATE "BuzzerTask" bt
    SET status = 'TERJADWAL',
        attempts = 0,
        "containerId" = NULL,
        "lastError" = NULL,
        "lockedAt" = NULL,
        "scheduledAt" = p_now + (f.idx * interval '15 seconds'),
        "updatedAt" = p_now
    FROM f
    WHERE bt.id = f.id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'AKSI_TIDAK_VALID' USING ERRCODE = '22023';
  END IF;

  PERFORM dash_buzzer_finalize(p_campaign_id, p_now);

  INSERT INTO "PlatformAuditLog" (actor, action, "targetType", "targetId", detail, "createdAt")
  VALUES (
    p_user,
    CASE WHEN p_action = 'CANCEL' THEN 'BUZZER_BATAL' ELSE 'BUZZER_COBA_ULANG' END,
    'BUZZER_CAMPAIGN',
    p_campaign_id,
    jsonb_build_object('affected', v_affected, 'action', p_action),
    p_now
  );

  RETURN jsonb_build_object('affected', v_affected);
END
$$;

-- ------------------------------------------------------------------ 6. Antrean Worker Buzzer (Tick & Eksekusi Langsung)

CREATE OR REPLACE FUNCTION dash_buzzer_claim(
  p_now timestamp, p_stale_before timestamp, p_limit integer, p_campaign_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_out jsonb;
BEGIN
  WITH c AS (
    SELECT bt.id
    FROM "BuzzerTask" bt
    WHERE (p_campaign_id IS NULL OR bt."campaignId" = p_campaign_id)
      AND (
        (bt.status = 'TERJADWAL' AND bt."scheduledAt" <= p_now)
        OR (bt.status = 'DIPROSES' AND (bt."lockedAt" IS NULL OR bt."lockedAt" < p_stale_before))
      )
    ORDER BY bt."scheduledAt" ASC, bt.id ASC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 30)
    FOR UPDATE OF bt SKIP LOCKED
  ), u AS (
    UPDATE "BuzzerTask" bt
    SET status = 'DIPROSES', "lockedAt" = p_now, "updatedAt" = p_now
    FROM c
    WHERE bt.id = c.id
    RETURNING bt.*
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', u.id,
      'campaignId', u."campaignId",
      'buzzerAccountId', u."buzzerAccountId",
      'targetMediaId', u."targetMediaId",
      'action', u.action,
      'nicheRelation', u."nicheRelation",
      'text', u.text,
      'containerId', u."containerId",
      'attempts', u.attempts,
      'account', CASE WHEN ta.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', ta.id,
        'threadsUserId', ta."threadsUserId",
        'accessToken', ta."accessToken",
        'accessExpiresAt', ta."accessExpiresAt",
        'needsReconnect', ta."needsReconnect",
        'updatedAt', ta."updatedAt"
      ) END
    )
    ORDER BY u."scheduledAt" ASC, u.id ASC
  ), '[]'::jsonb)
  INTO v_out
  FROM u
  LEFT JOIN "ThreadsAccount" ta ON ta.id = u."buzzerAccountId";

  RETURN v_out;
END
$$;

CREATE OR REPLACE FUNCTION dash_buzzer_result(p_id text, p_outcome text, p_patch jsonb, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cid text;
BEGIN
  IF p_outcome NOT IN ('CONTAINER', 'BERHASIL', 'GAGAL', 'ULANG') THEN
    RAISE EXCEPTION 'outcome tidak valid' USING ERRCODE = '22023';
  END IF;

  UPDATE "BuzzerTask" bt SET
    status            = CASE p_outcome
                          WHEN 'BERHASIL' THEN 'BERHASIL'
                          WHEN 'GAGAL'    THEN 'GAGAL'
                          WHEN 'CONTAINER' THEN 'DIPROSES'
                          ELSE 'TERJADWAL'
                        END,
    "containerId"     = COALESCE(p_patch->>'containerId', bt."containerId"),
    "resultMediaId"   = CASE WHEN p_outcome = 'BERHASIL' THEN COALESCE(p_patch->>'mediaId', bt."resultMediaId") ELSE bt."resultMediaId" END,
    "resultPermalink" = CASE WHEN p_outcome = 'BERHASIL' THEN COALESCE(p_patch->>'url', bt."resultPermalink") ELSE bt."resultPermalink" END,
    attempts          = CASE p_outcome WHEN 'CONTAINER' THEN 0 WHEN 'ULANG' THEN bt.attempts + 1 ELSE bt.attempts END,
    "lastError"       = CASE WHEN p_outcome IN ('BERHASIL', 'CONTAINER') THEN NULL ELSE LEFT(COALESCE(p_patch->>'error', bt."lastError"), 500) END,
    "executedAt"      = CASE WHEN p_outcome = 'BERHASIL' THEN p_now ELSE bt."executedAt" END,
    "scheduledAt"     = CASE WHEN p_outcome = 'ULANG' THEN p_now + interval '30 seconds' ELSE bt."scheduledAt" END,
    "lockedAt"        = NULL,
    "updatedAt"       = p_now
  WHERE bt.id = p_id AND bt.status IN ('DIPROSES', 'TERJADWAL')
  RETURNING bt."campaignId" INTO v_cid;

  IF v_cid IS NULL THEN RETURN 'STALE'; END IF;

  PERFORM dash_buzzer_finalize(v_cid, p_now);
  RETURN 'OK';
END
$$;

-- ------------------------------------------------------------------ 7. Hak Akses Eksekusi

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'dash\_sa\_buzzer\_%' OR p.proname LIKE 'dash\_buzzer\_%' OR p.proname = 'dash_sa_izin_valid')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
