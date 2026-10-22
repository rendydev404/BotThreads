-- =============================================================================
-- Postingan bergambar (single IMAGE / CAROUSEL) dari dashboard: foto berita atau Wikimedia Commons yang
-- di-hosting ulang di bucket Supabase Storage publik "threads-media", dengan baris kredit sumber
-- ("📷 kompas.com") di akhir teks (src/lib/post-media.ts).
--
-- ADITIF dan idempoten. Prasyarat: sql/022_threads_publisher.sql (dan sql/003_dashboard_rpc.sql).
-- Jalankan MANUAL di SQL Editor Supabase.
-- - Bucket publik "threads-media" (maks 5 MB, JPEG/PNG): Threads mengunduh gambar dari URL publiknya.
--   Dilewati bila skema "storage" tidak ada (uji PGlite).
-- - dash_create_posts: tiap item boleh membawa "mediaType" (TEXT|IMAGE|CAROUSEL, bawaan TEXT),
--   "mediaUrls" dan "mediaPaths". Item tanpa kolom ini tersimpan persis seperti sebelumnya (TEXT, array kosong).
-- - dash_load_post: ikut mengembalikan "mediaType" (ubah teks postingan bergambar tetap menjaga baris kredit).
-- - dash_pub_claim: ikut mengembalikan "mediaUrls" (array kosong bila null) untuk penerbit dashboard.
-- Kolom "mediaType"/"mediaUrls"/"mediaPaths" sudah ada di "ScheduledPost" (milik auto-suka): tidak ada
-- perubahan tabel, dan postingan teks maupun non-dashboard tidak berubah perilakunya.
-- =============================================================================

-- ------------------------------------------------------------------ bucket gambar

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    EXECUTE $q$
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES ('threads-media', 'threads-media', true, 5242880, ARRAY['image/jpeg', 'image/png'])
      ON CONFLICT (id) DO NOTHING
    $q$;
  END IF;
END
$$;

-- ------------------------------------------------------------------ antrean: tulis

-- p_items: [{postId, workspaceId, judul, caption, hashtags[], tayangPada, batchId, outletId,
--            socialAccountId, userId, action, aiModel, aiEdited, detail,
--            mediaType?, mediaUrls?[], mediaPaths?[]}]
CREATE OR REPLACE FUNCTION dash_create_posts(p_items jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE it jsonb; n integer := 0; nowu timestamp := (now() AT TIME ZONE 'UTC'); v_type text;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'items tidak valid' USING ERRCODE = '22023';
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_type := COALESCE(NULLIF(it->>'mediaType', ''), 'TEXT');
    IF v_type NOT IN ('TEXT', 'IMAGE', 'CAROUSEL') THEN
      RAISE EXCEPTION 'mediaType tidak valid' USING ERRCODE = '22023';
    END IF;
    INSERT INTO "ScheduledPost" (id, "workspaceId", judul, caption, hashtags, "mediaType", placement, "videoUrl",
                                 "mediaUrls", "mediaPaths", "targetType", "tayangPada", status, source, "draftGroupId", "updatedAt")
    VALUES (it->>'postId', it->>'workspaceId', it->>'judul', it->>'caption',
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(it->'hashtags', '[]'::jsonb))),
            v_type, 'FEED', '',
            CASE WHEN v_type = 'TEXT' THEN ARRAY[]::text[]
                 ELSE ARRAY(SELECT jsonb_array_elements_text(COALESCE(NULLIF(it->'mediaUrls', 'null'::jsonb), '[]'::jsonb))) END,
            CASE WHEN v_type = 'TEXT' THEN ARRAY[]::text[]
                 ELSE ARRAY(SELECT jsonb_array_elements_text(COALESCE(NULLIF(it->'mediaPaths', 'null'::jsonb), '[]'::jsonb))) END,
            'SATU_OUTLET',
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

-- ------------------------------------------------------------------ antrean: baca satu posting

CREATE OR REPLACE FUNCTION dash_load_post(p_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT to_jsonb(t) FROM (
    SELECT p.id, p.source, p.status::text AS status, p.caption, p.hashtags, p."tayangPada", p."mediaType",
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

-- ------------------------------------------------------------------ penerbit: klaim

-- Sama dengan sql/022, ditambah 'mediaUrls'.
CREATE OR REPLACE FUNCTION dash_pub_claim(p_now timestamp, p_stale_before timestamp, p_expire_before timestamp, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_out jsonb;
  v_post text;
BEGIN
  FOR v_post IN
    UPDATE "PostDispatch" d
    SET status = 'GAGAL', "pesanError" = 'Lewat jam tayang terlalu lama, tidak diterbitkan.', "lockedAt" = NULL, "updatedAt" = p_now
    FROM "ScheduledPost" p
    WHERE p.id = d."postId" AND p.source = 'DASHBOARD_AI' AND p."tayangPada" < p_expire_before
      AND d.publisher = 'THREADS' AND d.status = 'MENUNGGU' AND d."platformContainerId" IS NULL
      AND (d."lockedAt" IS NULL OR d."lockedAt" < p_stale_before)
    RETURNING d."postId"
  LOOP
    PERFORM dash_pub_finalize(v_post, p_now);
  END LOOP;

  WITH c AS (
    SELECT d.id
    FROM "PostDispatch" d
    JOIN "ScheduledPost" p ON p.id = d."postId"
    WHERE d.publisher = 'THREADS' AND d.status = 'MENUNGGU' AND p.source = 'DASHBOARD_AI'
      AND (d."lockedAt" IS NULL OR d."lockedAt" < p_stale_before)
      AND (d."platformContainerId" IS NOT NULL OR p."tayangPada" <= p_now)
    ORDER BY p."tayangPada", d.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50)
    FOR UPDATE OF d SKIP LOCKED
  ), u AS (
    UPDATE "PostDispatch" d SET "lockedAt" = p_now FROM c WHERE d.id = c.id
    RETURNING d.id, d."postId", d."socialAccountId", d."outletId", d."platformContainerId", d.attempts
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', u.id,
           'postId', u."postId",
           'containerId', u."platformContainerId",
           'attempts', u.attempts,
           'caption', p.caption,
           'hashtags', to_jsonb(COALESCE(p.hashtags, ARRAY[]::text[])),
           'mediaType', p."mediaType",
           'mediaUrls', to_jsonb(COALESCE(p."mediaUrls", ARRAY[]::text[])),
           'outletNama', o.nama,
           'account', CASE WHEN ta.id IS NULL THEN NULL ELSE jsonb_build_object(
             'id', ta.id, 'threadsUserId', ta."threadsUserId", 'accessToken', ta."accessToken",
             'accessExpiresAt', ta."accessExpiresAt", 'needsReconnect', ta."needsReconnect", 'updatedAt', ta."updatedAt") END)
         ORDER BY p."tayangPada", u.id), '[]'::jsonb)
  INTO v_out
  FROM u
  JOIN "ScheduledPost" p ON p.id = u."postId"
  LEFT JOIN "Outlet" o ON o.id = u."outletId"
  LEFT JOIN "SocialAccount" sa ON sa.id = u."socialAccountId"
  LEFT JOIN "ThreadsAccount" ta ON ta.id = sa."threadsAccountId";
  RETURN v_out;
END
$$;

-- ------------------------------------------------------------------ hak akses

REVOKE ALL ON FUNCTION dash_create_posts(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_create_posts(jsonb) TO service_role;
REVOKE ALL ON FUNCTION dash_load_post(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_load_post(text) TO service_role;
REVOKE ALL ON FUNCTION dash_pub_claim(timestamp, timestamp, timestamp, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_pub_claim(timestamp, timestamp, timestamp, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
