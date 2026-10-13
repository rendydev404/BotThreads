-- Tabel audit posting dashboard. ADITIF: tidak menyentuh tabel milik auto-suka.
-- Jalankan MANUAL setelah disetujui pemilik (jangan lewat `prisma db push`).
-- Aman dijalankan berulang (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS "DashboardPostLog" (
  "id"        TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "postId"    TEXT         NOT NULL,
  "userId"    TEXT         NOT NULL,
  -- CREATE_NOW | CREATE_SCHEDULED | EDIT | CANCEL | RETRY
  "action"    TEXT         NOT NULL,
  -- model yang menghasilkan draf (null bila ditulis manual)
  "aiModel"   TEXT,
  -- teks diubah manusia sebelum dikirim
  "aiEdited"  BOOLEAN,
  -- idempotencyKey, batchId, jadwal, dll.
  "detail"    JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DashboardPostLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DashboardPostLog_postId_idx"    ON "DashboardPostLog" ("postId");
CREATE INDEX IF NOT EXISTS "DashboardPostLog_createdAt_idx" ON "DashboardPostLog" ("createdAt");

-- Supabase membuka tabel lewat API publik (PostgREST). RLS tanpa policy
-- memblokir akses anon/authenticated; Prisma (role postgres) tetap bisa.
ALTER TABLE "DashboardPostLog" ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- OPSIONAL - JANGAN dijalankan kecuali EXPLAIN (ANALYZE, BUFFERS) pada query
-- daftar antrean (src/lib/threads-publish.ts: listPosts) membuktikan index yang
-- ada (ScheduledPost_source_status_idx) tidak cukup. Ini index pada tabel milik
-- auto-suka; perubahannya harus disetujui pemilik.
--
-- Daftar antrean dashboard: filter source + urut tayangPada.
-- CREATE INDEX IF NOT EXISTS "ScheduledPost_source_tayangPada_idx"
--   ON "ScheduledPost" ("source", "tayangPada" DESC);
--
-- Cek anti-spam / duplikat per akun (join dari SocialAccount -> PostDispatch):
-- CREATE INDEX IF NOT EXISTS "PostDispatch_socialAccountId_idx"
--   ON "PostDispatch" ("socialAccountId");
-- =============================================================================

-- =============================================================================
-- Fungsi RPC dashboard (dipanggil lewat supabase-js `supabase.rpc(...)`).
--
-- ADITIF dan idempoten (CREATE OR REPLACE). Tidak mengubah/menghapus tabel milik auto-suka.
-- Jalankan MANUAL di SQL Editor Supabase (project nhpatcbdylkhpsifyhjb) oleh pemilik.
-- Prasyarat: sql/002_dashboard_post_log.sql sudah dijalankan.
--
-- Keamanan:
--  * SECURITY DEFINER + search_path dikunci. Fungsi berjalan sebagai pemilik tabel, jadi service_role
--    TIDAK perlu GRANT langsung ke tabel antrean (Outlet, SocialAccount, ScheduledPost, PostDispatch).
--  * EXECUTE dicabut dari PUBLIC/anon/authenticated dan hanya diberikan ke service_role. Kunci
--    service_role hanya ada di server dashboard (tidak pernah dikirim ke browser).
--  * Kolom ThreadsAccount.accessToken tidak pernah dibaca oleh fungsi mana pun.
--  * Tidak ada SQL dinamis: semua nilai berupa parameter.
--
-- Waktu: kolom Prisma bertipe timestamp(3) tanpa zona, berisi UTC. Parameter waktu juga `timestamp`
-- (UTC); string ISO berakhiran Z diterima (zona diabaikan karena tipe tanpa zona).
-- =============================================================================

-- ------------------------------------------------------------------ pembantu

CREATE OR REPLACE FUNCTION dash_utc_now() RETURNS timestamp
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'UTC') $$;

-- Cermin src/lib/post-status.ts + threads-publish.ts statusCondition.
CREATE OR REPLACE FUNCTION dash_status_match(
  p_status text, d_status text, d_container text, d_locked timestamp,
  p_post_status text, p_tayang timestamp, p_now timestamp
) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_status IS NULL THEN TRUE
    WHEN p_status = 'PUBLISHED' THEN d_status = 'TERBIT'
    WHEN p_status = 'FAILED' THEN d_status = 'GAGAL'
    WHEN p_status = 'PROCESSING' THEN d_status = 'MENUNGGU'
      AND (d_container IS NOT NULL OR d_locked IS NOT NULL OR p_post_status = 'DIPROSES')
    WHEN p_status = 'QUEUED' THEN d_status = 'MENUNGGU'
      AND NOT (d_container IS NOT NULL OR d_locked IS NOT NULL OR p_post_status = 'DIPROSES')
      AND p_tayang <= p_now
    WHEN p_status = 'SCHEDULED' THEN d_status = 'MENUNGGU'
      AND NOT (d_container IS NOT NULL OR d_locked IS NOT NULL OR p_post_status = 'DIPROSES')
      AND p_tayang > p_now
    ELSE FALSE
  END
$$;

-- ------------------------------------------------------------------ akun & kesiapan

CREATE OR REPLACE FUNCTION dash_publish_accounts() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT ta.id, ta.username, ta."displayName", ta."avatarUrl", ta."needsReconnect",
           ta."accessExpiresAt", ta.scopes,
           sa.id AS "socialAccountId", o.id AS "outletId", o.nama AS "outletNama",
           o."isActive" AS "outletActive", o."workspaceId"
    FROM "ThreadsAccount" ta
    LEFT JOIN "SocialAccount" sa ON sa."threadsAccountId" = ta.id
    LEFT JOIN "Outlet" o ON o.id = sa."outletId"
    ORDER BY ta."displayName" ASC, ta.id ASC
  ) t
$$;

-- ------------------------------------------------------------------ konteks AI & jam terbaik

CREATE OR REPLACE FUNCTION dash_hour_rows(p_ids text[], p_now timestamp, p_half_life float8)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH p AS (
    SELECT s."threadsAccountId" AS aid,
           EXTRACT(HOUR FROM s."postedAt" + interval '7 hours')::int AS hour,
           s.views,
           POWER(0.5, EXTRACT(EPOCH FROM (p_now - s."postedAt")) / 86400.0 / p_half_life) AS w
    FROM "ThreadsPostStat" s
    WHERE (p_ids IS NULL OR s."threadsAccountId" = ANY(p_ids))
      AND s."postedAt" >= p_now - interval '60 days'
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) FROM (
    SELECT CASE WHEN p_ids IS NULL THEN NULL ELSE aid END AS aid, hour, COUNT(*)::int AS n,
           ROUND(SUM(views * w) / NULLIF(SUM(w), 0))::int AS avg, SUM(w)::float8 AS w
    FROM p
    GROUP BY CASE WHEN p_ids IS NULL THEN NULL ELSE aid END, hour
  ) r
$$;

CREATE OR REPLACE FUNCTION dash_ai_context(p_ids text[], p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'style', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.aid, x.rn), '[]'::jsonb) FROM (
        SELECT aid, text, views, rn FROM (
          SELECT s."threadsAccountId" AS aid, s.text, s.views,
                 ROW_NUMBER() OVER (
                   PARTITION BY s."threadsAccountId"
                   ORDER BY (s."postedAt" >= p_now - interval '60 days') DESC, s.views DESC
                 ) AS rn
          FROM "ThreadsPostStat" s
          WHERE s."threadsAccountId" = ANY(p_ids) AND s."isQuote" = false
            AND char_length(s.text) >= 40 AND s."postedAt" >= p_now - interval '365 days'
        ) y WHERE rn <= 6
      ) x),
    'weakest', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.aid, x.rn), '[]'::jsonb) FROM (
        SELECT aid, text, views, rn FROM (
          SELECT s."threadsAccountId" AS aid, s.text, s.views,
                 ROW_NUMBER() OVER (PARTITION BY s."threadsAccountId" ORDER BY s.views ASC) AS rn
          FROM "ThreadsPostStat" s
          WHERE s."threadsAccountId" = ANY(p_ids) AND s."isQuote" = false
            AND char_length(s.text) >= 20
            AND s."postedAt" >= p_now - interval '60 days' AND s."postedAt" < p_now - interval '3 days'
        ) y WHERE rn <= 3
      ) x),
    'recents', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.aid, x.rn), '[]'::jsonb) FROM (
        SELECT aid, text, views, rn FROM (
          SELECT s."threadsAccountId" AS aid, s.text, s.views,
                 ROW_NUMBER() OVER (PARTITION BY s."threadsAccountId" ORDER BY s."postedAt" DESC) AS rn
          FROM "ThreadsPostStat" s
          WHERE s."threadsAccountId" = ANY(p_ids) AND char_length(s.text) >= 10
            AND s."postedAt" >= p_now - interval '14 days'
        ) y WHERE rn <= 15
      ) x),
    'formats', (
      SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f."avgViews" DESC), '[]'::jsonb) FROM (
        SELECT s."threadsAccountId" AS aid, s."mediaType",
               COUNT(*)::int AS n,
               ROUND(AVG(s.views))::int AS "avgViews",
               COALESCE(ROUND(100.0 * SUM(s.likes + s.replies + s.reposts + s.quotes) / NULLIF(SUM(s.views), 0), 1), 0)::float8 AS er
        FROM "ThreadsPostStat" s
        WHERE s."threadsAccountId" = ANY(p_ids) AND s."postedAt" >= p_now - interval '60 days'
        GROUP BY s."threadsAccountId", s."mediaType"
      ) f)
  )
$$;

CREATE OR REPLACE FUNCTION dash_network_top(p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT s.text, s.views FROM "ThreadsPostStat" s
    WHERE s."postedAt" >= p_now - interval '14 days' AND s."isQuote" = false AND char_length(s.text) >= 40
    ORDER BY s.views DESC LIMIT 5
  ) t
$$;

CREATE OR REPLACE FUNCTION dash_recent_views(p_ids text[], p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT s."threadsAccountId" AS aid, COALESCE(SUM(s.views), 0)::float8 AS views
    FROM "ThreadsPostStat" s
    WHERE s."threadsAccountId" = ANY(p_ids) AND s."postedAt" >= p_now - interval '14 days'
    GROUP BY s."threadsAccountId"
  ) t
$$;

-- ------------------------------------------------------------------ antrean: baca

CREATE OR REPLACE FUNCTION dash_schedule(p_ids text[], p_from timestamp, p_to timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT sa."threadsAccountId" AS aid, p.id AS "postId", p."tayangPada" AS "at", p.source, p.caption
    FROM "SocialAccount" sa
    JOIN "PostDispatch" d ON d."socialAccountId" = sa.id AND d.publisher = 'THREADS'
                         AND d.status IN ('MENUNGGU', 'TERBIT')
    JOIN "ScheduledPost" p ON p.id = d."postId"
    WHERE sa."threadsAccountId" = ANY(p_ids)
      AND p."tayangPada" >= p_from AND p."tayangPada" <= p_to
  ) t
$$;

CREATE OR REPLACE FUNCTION dash_recent_texts(p_ids text[], p_since timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT s."threadsAccountId" AS aid, s.text
    FROM "ThreadsPostStat" s
    WHERE s."threadsAccountId" = ANY(p_ids) AND s."postedAt" >= p_since
  ) t
$$;

CREATE OR REPLACE FUNCTION dash_replay(p_key text, p_since timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT l."postId", l.detail->>'threadsAccountId' AS "threadsAccountId",
           p."tayangPada", p.status::text AS status
    FROM "DashboardPostLog" l
    LEFT JOIN "ScheduledPost" p ON p.id = l."postId"
    WHERE l."createdAt" >= p_since
      AND l.action IN ('CREATE_NOW', 'CREATE_SCHEDULED')
      AND l.detail->>'idempotencyKey' = p_key
    ORDER BY l."createdAt" ASC, l.id ASC
  ) t
$$;

CREATE OR REPLACE FUNCTION dash_post_list(
  p_scope text, p_username text, p_status text,
  p_cursor_at timestamp, p_cursor_id text,
  p_include_all boolean, p_limit int, p_now timestamp
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  IF p_scope = 'upcoming' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v FROM (
      SELECT p.id, d.id AS "dispatchId", p.caption, p.hashtags, p."tayangPada", p.source,
             p.status::text AS "postStatus", d.status::text AS "dispatchStatus", d."pesanError", d."releaseUrl",
             d."platformContainerId", d."lockedAt",
             ta.id AS "threadsAccountId", ta.username, ta."displayName", ta."avatarUrl", o.nama AS "outletNama"
      FROM "ScheduledPost" p
      JOIN "PostDispatch" d ON d."postId" = p.id AND d.publisher = 'THREADS'
      LEFT JOIN "SocialAccount" sa ON sa.id = d."socialAccountId"
      LEFT JOIN "ThreadsAccount" ta ON ta.id = sa."threadsAccountId"
      LEFT JOIN "Outlet" o ON o.id = d."outletId"
      WHERE (p_include_all OR p.source = 'DASHBOARD_AI')
        AND d.status = 'MENUNGGU'
        AND (p_username IS NULL OR lower(ta.username) = lower(p_username))
        AND dash_status_match(p_status, d.status::text, d."platformContainerId", d."lockedAt", p.status::text, p."tayangPada", p_now)
        AND (p_cursor_at IS NULL OR (p."tayangPada", d.id) > (p_cursor_at, p_cursor_id))
      ORDER BY p."tayangPada" ASC, d.id ASC
      LIMIT p_limit + 1
    ) t;
  ELSE
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v FROM (
      SELECT p.id, d.id AS "dispatchId", p.caption, p.hashtags, p."tayangPada", p.source,
             p.status::text AS "postStatus", d.status::text AS "dispatchStatus", d."pesanError", d."releaseUrl",
             d."platformContainerId", d."lockedAt",
             ta.id AS "threadsAccountId", ta.username, ta."displayName", ta."avatarUrl", o.nama AS "outletNama"
      FROM "ScheduledPost" p
      JOIN "PostDispatch" d ON d."postId" = p.id AND d.publisher = 'THREADS'
      LEFT JOIN "SocialAccount" sa ON sa.id = d."socialAccountId"
      LEFT JOIN "ThreadsAccount" ta ON ta.id = sa."threadsAccountId"
      LEFT JOIN "Outlet" o ON o.id = d."outletId"
      WHERE (p_include_all OR p.source = 'DASHBOARD_AI')
        AND d.status IN ('TERBIT', 'GAGAL')
        AND (p_username IS NULL OR lower(ta.username) = lower(p_username))
        AND dash_status_match(p_status, d.status::text, d."platformContainerId", d."lockedAt", p.status::text, p."tayangPada", p_now)
        AND (p_cursor_at IS NULL OR (p."tayangPada", d.id) < (p_cursor_at, p_cursor_id))
      ORDER BY p."tayangPada" DESC, d.id DESC
      LIMIT p_limit + 1
    ) t;
  END IF;
  RETURN v;
END
$$;

CREATE OR REPLACE FUNCTION dash_posts_by_ids(p_ids text[], p_include_all boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT p.id, d.id AS "dispatchId", p.caption, p.hashtags, p."tayangPada", p.source,
           p.status::text AS "postStatus", d.status::text AS "dispatchStatus", d."pesanError", d."releaseUrl",
           d."platformContainerId", d."lockedAt",
           ta.id AS "threadsAccountId", ta.username, ta."displayName", ta."avatarUrl", o.nama AS "outletNama"
    FROM "ScheduledPost" p
    JOIN "PostDispatch" d ON d."postId" = p.id AND d.publisher = 'THREADS'
    LEFT JOIN "SocialAccount" sa ON sa.id = d."socialAccountId"
    LEFT JOIN "ThreadsAccount" ta ON ta.id = sa."threadsAccountId"
    LEFT JOIN "Outlet" o ON o.id = d."outletId"
    WHERE p.id = ANY(p_ids) AND (p_include_all OR p.source = 'DASHBOARD_AI')
    ORDER BY p."tayangPada" ASC, d.id ASC
    LIMIT 100
  ) t
$$;

CREATE OR REPLACE FUNCTION dash_post_summary(
  p_include_all boolean, p_day_start timestamp, p_day_end timestamp,
  p_week_ago timestamp, p_late_before timestamp
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'scheduledToday', COUNT(*) FILTER (WHERE d.status = 'MENUNGGU' AND p."tayangPada" >= p_day_start AND p."tayangPada" < p_day_end),
    'published7d', COUNT(*) FILTER (WHERE d.status = 'TERBIT'),
    'failed7d', COUNT(*) FILTER (WHERE d.status = 'GAGAL'),
    'queuedLate', COUNT(*) FILTER (WHERE d.status = 'MENUNGGU' AND d."platformContainerId" IS NULL AND d."lockedAt" IS NULL
                                   AND p.status = 'MENUNGGU' AND p."tayangPada" < p_late_before)
  )
  FROM "PostDispatch" d
  JOIN "ScheduledPost" p ON p.id = d."postId"
  WHERE d.publisher = 'THREADS' AND (p_include_all OR p.source = 'DASHBOARD_AI')
    AND (p."tayangPada" >= p_week_ago OR d.status = 'MENUNGGU')
$$;

CREATE OR REPLACE FUNCTION dash_load_post(p_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT to_jsonb(t) FROM (
    SELECT p.id, p.source, p.status::text AS status, p.caption, p.hashtags, p."tayangPada",
           (SELECT jsonb_build_object(
                     'status', d.status::text, 'lockedAt', d."lockedAt",
                     'platformContainerId', d."platformContainerId", 'pesanError', d."pesanError",
                     'outletNama', o.nama, 'threadsAccountId', sa."threadsAccountId")
            FROM "PostDispatch" d
            LEFT JOIN "Outlet" o ON o.id = d."outletId"
            LEFT JOIN "SocialAccount" sa ON sa.id = d."socialAccountId"
            WHERE d."postId" = p.id AND d.publisher = 'THREADS'
            ORDER BY d."createdAt" ASC, d.id ASC LIMIT 1) AS dispatch
    FROM "ScheduledPost" p WHERE p.id = p_id
  ) t
$$;

-- ------------------------------------------------------------------ antrean: tulis (transaksi atomik)

-- p_items: [{postId, workspaceId, judul, caption, hashtags[], tayangPada, batchId, outletId,
--            socialAccountId, userId, action, aiModel, aiEdited, detail}]
CREATE OR REPLACE FUNCTION dash_create_posts(p_items jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE it jsonb; n integer := 0; nowu timestamp := (now() AT TIME ZONE 'UTC');
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'items tidak valid' USING ERRCODE = '22023';
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO "ScheduledPost" (id, "workspaceId", judul, caption, hashtags, "mediaType", placement, "videoUrl",
                                 "mediaUrls", "mediaPaths", "targetType", "tayangPada", status, source, "draftGroupId", "updatedAt")
    VALUES (it->>'postId', it->>'workspaceId', it->>'judul', it->>'caption',
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(it->'hashtags', '[]'::jsonb))),
            'TEXT', 'FEED', '', ARRAY[]::text[], ARRAY[]::text[], 'SATU_OUTLET',
            (it->>'tayangPada')::timestamp, 'MENUNGGU', 'DASHBOARD_AI', it->>'batchId', nowu);
    INSERT INTO "PostDispatch" (id, "postId", "outletId", "socialAccountId", publisher, status, "updatedAt")
    VALUES (gen_random_uuid()::text, it->>'postId', it->>'outletId', it->>'socialAccountId', 'THREADS', 'MENUNGGU', nowu);
    INSERT INTO "DashboardPostLog" ("postId", "userId", action, "aiModel", "aiEdited", detail)
    VALUES (it->>'postId', it->>'userId', it->>'action', it->>'aiModel',
            (it->>'aiEdited')::boolean, COALESCE(it->'detail', '{}'::jsonb));
    n := n + 1;
  END LOOP;
  RETURN n;
END
$$;

CREATE OR REPLACE FUNCTION dash_edit_post(
  p_id text, p_user text,
  p_set_content boolean, p_caption text, p_judul text, p_hashtags text[],
  p_set_time boolean, p_tayang timestamp, p_min_time timestamp, p_detail jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE "ScheduledPost" p SET
    caption = CASE WHEN p_set_content THEN p_caption ELSE p.caption END,
    judul = CASE WHEN p_set_content THEN p_judul ELSE p.judul END,
    hashtags = CASE WHEN p_set_content THEN p_hashtags ELSE p.hashtags END,
    "tayangPada" = CASE WHEN p_set_time THEN p_tayang ELSE p."tayangPada" END,
    "updatedAt" = dash_utc_now()
  WHERE p.id = p_id AND p.source = 'DASHBOARD_AI' AND p.status = 'MENUNGGU'
    AND p."tayangPada" > p_min_time
    AND NOT EXISTS (
      SELECT 1 FROM "PostDispatch" d
      WHERE d."postId" = p.id
        AND NOT (d.status = 'MENUNGGU' AND d."lockedAt" IS NULL AND d."platformContainerId" IS NULL)
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RETURN FALSE; END IF;
  INSERT INTO "DashboardPostLog" ("postId", "userId", action, detail) VALUES (p_id, p_user, 'EDIT', COALESCE(p_detail, '{}'::jsonb));
  RETURN TRUE;
END
$$;

-- Hapus (cascade ke PostDispatch). Hanya bila belum disentuh worker.
CREATE OR REPLACE FUNCTION dash_cancel_post(p_id text, p_user text, p_detail jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  DELETE FROM "ScheduledPost" p
  WHERE p.id = p_id AND p.source = 'DASHBOARD_AI' AND p.status = 'MENUNGGU'
    AND NOT EXISTS (
      SELECT 1 FROM "PostDispatch" d
      WHERE d."postId" = p.id
        AND NOT (d.status = 'MENUNGGU' AND d."lockedAt" IS NULL AND d."platformContainerId" IS NULL)
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RETURN FALSE; END IF;
  INSERT INTO "DashboardPostLog" ("postId", "userId", action, detail) VALUES (p_id, p_user, 'CANCEL', COALESCE(p_detail, '{}'::jsonb));
  RETURN TRUE;
END
$$;

CREATE OR REPLACE FUNCTION dash_retry_post(p_id text, p_user text, p_now timestamp, p_detail jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE "PostDispatch" SET status = 'MENUNGGU', attempts = 0, "pesanError" = NULL, "lockedAt" = NULL,
         "platformContainerId" = NULL, "updatedAt" = dash_utc_now()
  WHERE "postId" = p_id AND publisher = 'THREADS' AND status = 'GAGAL';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RETURN FALSE; END IF;
  UPDATE "ScheduledPost" SET status = 'MENUNGGU', "tayangPada" = p_now, "updatedAt" = dash_utc_now()
  WHERE id = p_id AND source = 'DASHBOARD_AI' AND status = 'GAGAL';
  INSERT INTO "DashboardPostLog" ("postId", "userId", action, detail) VALUES (p_id, p_user, 'RETRY', COALESCE(p_detail, '{}'::jsonb));
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
    WHERE n.nspname = 'public' AND p.proname LIKE 'dash\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;

-- =============================================================================
-- Statistik postingan per akun untuk asisten AI (median, rata-rata, maksimum, post sepi).
--
-- ADITIF dan idempoten. Jalankan MANUAL di SQL Editor Supabase (project nhpatcbdylkhpsifyhjb).
-- Prasyarat: sql/003_dashboard_rpc.sql sudah dijalankan.
--
-- Tanpa fungsi ini asisten tetap jalan: aplikasi jatuh ke perhitungan di server (src/lib/chat-insights.ts)
-- dengan membaca baris ThreadsPostStat per halaman, jadi fungsi ini hanya soal hemat bandwidth.
-- Keamanan sama dengan fungsi dash_* lain: SECURITY DEFINER, search_path dikunci, hanya service_role.
-- =============================================================================

CREATE OR REPLACE FUNCTION dash_account_post_stats(p_ids text[], p_from timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT s."threadsAccountId" AS aid,
           COUNT(*)::int AS n,
           COALESCE(SUM(s.views), 0)::float8 AS views,
           ROUND(AVG(s.views))::int AS avg,
           ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY s.views))::int AS median,
           MAX(s.views)::int AS max,
           COUNT(*) FILTER (WHERE s.views <= 1)::int AS low
    FROM "ThreadsPostStat" s
    WHERE (p_ids IS NULL OR s."threadsAccountId" = ANY(p_ids))
      AND s."postedAt" >= p_from
    GROUP BY s."threadsAccountId"
  ) t
$;

REVOKE ALL ON FUNCTION dash_account_post_stats(text[], timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_account_post_stats(text[], timestamp) TO service_role;

NOTIFY pgrst, 'reload schema';
