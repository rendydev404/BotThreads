-- =============================================================================
-- Postingan bergambar TANPA menyimpan berkas gambar: yang disimpan hanya tautan gambar asal
-- (PostMediaItem.sourceUrl, src/lib/post-media.ts). Penerbit (src/lib/threads-publisher.ts) mengunduh +
-- mengolah gambar saat posting, mengunggahnya SEMENTARA ke bucket "threads-media" di path
-- "tmp/<postId>/<n>.jpg" (Threads butuh URL publik), lalu menghapusnya begitu postingan terbit.
--
-- ADITIF dan idempoten. Prasyarat: sql/022_threads_publisher.sql, sql/036_threads_media.sql,
-- sql/038_idea_media.sql, sql/039_media_policy.sql. Jalankan MANUAL di SQL Editor Supabase.
--
-- 1. dash_pub_media_tmp: catat path berkas sementara di "ScheduledPost"."mediaPaths" SEBELUM diunggah,
--    supaya proses yang mati di tengah jalan tidak meninggalkan berkas tanpa jejak.
-- 2. dash_pub_claim: sama dengan sql/036, ditambah 'mediaPaths' (path sementara yang harus dihapus di tahap 2).
-- 3. dash_pub_result: sama dengan sql/022, ditambah
--    - outcome TUNDA: kunci dilepas tanpa menambah attempts (sisa waktu putaran tidak cukup untuk gambar);
--    - TERBIT: "mediaUrls" dan "mediaPaths" dikosongkan (data gambar tidak disimpan; "mediaType" tetap
--      supaya riwayat tahu posting itu bergambar dan mengambil gambarnya dari Threads);
--    - GAGAL: "mediaPaths" dikosongkan, "mediaUrls" (tautan sumber) tetap supaya "Coba lagi" bisa
--      mengunduh ulang. Berkasnya dihapus penerbit setelah fungsi ini mengembalikan OK.
-- 4. dash_media_tmp_orphans: berkas "tmp/..." di bucket threads-media yang lebih tua dari p_before dan tidak
--    dipegang posting yang masih diterbitkan (dispatch MENUNGGU dengan path itu di "mediaPaths"), untuk
--    pembersih tiap putaran penerbit (src/lib/media-cleanup.ts). Hanya membaca storage.objects bila skema
--    "storage" ada (uji PGlite tanpa skema itu mendapat array kosong).
-- 5. dash_idea_list: cadangan gambar posting dari "mediaUrls" kini membentuk item {'sourceUrl': u}.
--    Setelah terbit "mediaUrls" kosong, jadi cadangan ini bisa kosong (riwayat mengambil gambar dari Threads).
-- 6. Pembersihan lama sql/039 (dash_media_cleanup_claim/_done, dash_media_path_free) dan indeksnya dibuang:
--    preview ide tidak lagi punya berkas, dan berkas posting dihapus saat terbit.
--
-- Indeks: dash_media_tmp_orphans memakai indeks bawaan storage.objects (bucket_id, name) dengan awalan
-- 'tmp/' (hanya berkas yang sedang/baru diterbitkan, jumlahnya kecil), lalu primary key ScheduledPost
-- (postId diambil dari path) dan indeks PostDispatch per postId. Tidak ada indeks baru.
-- =============================================================================

-- ------------------------------------------------------------------ buang pembersihan lama (sql/039)

DROP FUNCTION IF EXISTS dash_media_cleanup_claim(timestamp, timestamp, integer);
DROP FUNCTION IF EXISTS dash_media_cleanup_done(text[], text[], timestamp);
DROP FUNCTION IF EXISTS dash_media_path_free(text, text, timestamp);
DROP INDEX IF EXISTS "ContentIdea_media_idx";
DROP INDEX IF EXISTS "ScheduledPost_dash_media_idx";

-- ------------------------------------------------------------------ catat berkas sementara

-- Path harus berbentuk "tmp/<p_post>/<n>.jpg" (maks 20). Hanya posting dashboard yang dispatch Threads-nya
-- masih MENUNGGU (sedang diterbitkan). Balasan: true bila tercatat, null bila posting tidak memenuhi syarat.
CREATE OR REPLACE FUNCTION dash_pub_media_tmp(p_post text, p_paths text[]) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ok boolean;
BEGIN
  IF p_paths IS NULL OR cardinality(p_paths) > 20 OR EXISTS (
       SELECT 1 FROM unnest(p_paths) x
       WHERE x IS NULL OR left(x, length('tmp/' || p_post || '/')) <> 'tmp/' || p_post || '/'
          OR substr(x, length('tmp/' || p_post || '/') + 1) !~ '^[0-9]{1,2}\.jpg$') THEN
    RAISE EXCEPTION 'path gambar sementara tidak valid' USING ERRCODE = '22023';
  END IF;
  UPDATE "ScheduledPost" p SET "mediaPaths" = p_paths
  WHERE p.id = p_post AND p.source = 'DASHBOARD_AI'
    AND EXISTS (SELECT 1 FROM "PostDispatch" d
                WHERE d."postId" = p.id AND d.publisher = 'THREADS' AND d.status = 'MENUNGGU')
  RETURNING true INTO v_ok;
  RETURN v_ok;
END
$$;

-- ------------------------------------------------------------------ penerbit: klaim

-- Sama dengan sql/036, ditambah 'mediaPaths'.
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
           'mediaPaths', to_jsonb(COALESCE(p."mediaPaths", ARRAY[]::text[])),
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

-- ------------------------------------------------------------------ penerbit: hasil

-- Sama dengan sql/022, ditambah outcome TUNDA dan pengosongan kolom gambar (lihat kepala berkas).
--   CONTAINER  {containerId}       container dibuat; posting jadi DIPROSES
--   TERBIT     {mediaId, url}      sudah tayang di Threads
--   GAGAL      {error}             gagal permanen
--   ULANG      {error?}            coba lagi di putaran berikutnya (attempts + 1)
--   TUNDA      {}                  belum dikerjakan; kunci dilepas, attempts tetap
CREATE OR REPLACE FUNCTION dash_pub_result(p_id text, p_outcome text, p_patch jsonb, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_post text;
BEGIN
  IF p_outcome NOT IN ('CONTAINER', 'TERBIT', 'GAGAL', 'ULANG', 'TUNDA') THEN
    RAISE EXCEPTION 'outcome tidak valid' USING ERRCODE = '22023';
  END IF;

  UPDATE "PostDispatch" d SET
    status = (CASE p_outcome WHEN 'TERBIT' THEN 'TERBIT' WHEN 'GAGAL' THEN 'GAGAL' ELSE 'MENUNGGU' END)::"DispatchStatus",
    "platformContainerId" = COALESCE(p_patch->>'containerId', d."platformContainerId"),
    "platformPostId" = CASE WHEN p_outcome = 'TERBIT' THEN COALESCE(p_patch->>'mediaId', d."platformPostId") ELSE d."platformPostId" END,
    "platformKind" = CASE WHEN p_outcome = 'TERBIT' THEN 'THREADS_MEDIA' ELSE d."platformKind" END,
    "releaseUrl" = CASE WHEN p_outcome = 'TERBIT' THEN COALESCE(p_patch->>'url', d."releaseUrl") ELSE d."releaseUrl" END,
    attempts = CASE p_outcome WHEN 'CONTAINER' THEN 0 WHEN 'ULANG' THEN d.attempts + 1 ELSE d.attempts END,
    "pesanError" = CASE p_outcome
                     WHEN 'TERBIT' THEN NULL WHEN 'CONTAINER' THEN NULL WHEN 'TUNDA' THEN d."pesanError"
                     ELSE LEFT(COALESCE(p_patch->>'error', d."pesanError"), 500) END,
    "lockedAt" = NULL,
    "updatedAt" = p_now
  WHERE d.id = p_id AND d.publisher = 'THREADS' AND d.status = 'MENUNGGU'
  RETURNING d."postId" INTO v_post;
  IF v_post IS NULL THEN RETURN 'STALE'; END IF;

  IF p_outcome = 'CONTAINER' THEN
    UPDATE "ScheduledPost" SET status = 'DIPROSES', "updatedAt" = p_now WHERE id = v_post AND status = 'MENUNGGU';
  ELSIF p_outcome IN ('TERBIT', 'GAGAL') THEN
    PERFORM dash_pub_finalize(v_post, p_now);
    -- Data gambar tidak disimpan: tautan sumber dibuang setelah terbit, path sementara selalu dibuang.
    UPDATE "ScheduledPost" p SET
      "mediaUrls" = CASE WHEN p_outcome = 'TERBIT' THEN ARRAY[]::text[] ELSE p."mediaUrls" END,
      "mediaPaths" = ARRAY[]::text[]
    WHERE p.id = v_post AND p.source = 'DASHBOARD_AI'
      AND (COALESCE(cardinality(p."mediaPaths"), 0) > 0
           OR (p_outcome = 'TERBIT' AND COALESCE(cardinality(p."mediaUrls"), 0) > 0));
  END IF;
  RETURN 'OK';
END
$$;

-- ------------------------------------------------------------------ berkas sementara yatim

-- Path berkas "tmp/<postId>/<n>.jpg" di bucket threads-media yang dibuat sebelum p_before dan tidak lagi
-- dipegang posting yang masih diterbitkan. Paling banyak p_limit (1-50), yang tertua dulu.
CREATE OR REPLACE FUNCTION dash_media_tmp_orphans(p_before timestamp, p_limit integer) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_out text[];
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;
  SELECT COALESCE(array_agg(t.name ORDER BY t.created_at, t.name), ARRAY[]::text[]) INTO v_out
  FROM (
    SELECT o.name, o.created_at
    FROM storage.objects o
    WHERE o.bucket_id = 'threads-media' AND o.name LIKE 'tmp/%'
      AND o.created_at < (p_before AT TIME ZONE 'UTC')
      AND NOT EXISTS (
        SELECT 1 FROM "ScheduledPost" p
        JOIN "PostDispatch" d ON d."postId" = p.id
        WHERE p.id = split_part(o.name, '/', 2)
          AND d.publisher = 'THREADS' AND d.status = 'MENUNGGU'
          AND o.name = ANY(p."mediaPaths"))
    ORDER BY o.created_at, o.name
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50)
  ) t;
  RETURN v_out;
END
$$;

-- ------------------------------------------------------------------ daftar ide: sama dengan sql/038, item 'sourceUrl'

CREATE OR REPLACE FUNCTION dash_idea_list(
  p_workspace text, p_account_ids text[], p_statuses text[], p_cursor_at timestamp, p_cursor_id text, p_limit int
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT i.id, i."accountId", i.topik, i.sudut, i."formulaHook", i.pilar, i.score, i."scoreDetail", i.status,
           (i."pinnedBy" IS NOT NULL) AS pinned, i."usedBySlot", i."expiresAt", i."createdAt",
           (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'source', s.source, 'title', LEFT(s.title, 120))), '[]'::jsonb)
            FROM "TrendSignal" s WHERE s.id = ANY(i."signalIds")) AS signals,
           -- Ide terpakai: teks posting sebenarnya. Selain itu: preview yang pernah ditulis AI.
           COALESCE(sl.draft->>'text', i.preview->>'text') AS "previewText",
           CASE WHEN sl.draft->>'text' IS NOT NULL THEN 'POSTING' WHEN i.preview IS NOT NULL THEN 'PREVIEW' END AS "previewKind",
           sl."slotAt" AS "postAt",
           CASE
             -- Ide terpakai, posting belum/tidak ada di antrean (mis. menunggu tinjauan): gambar di draf slot.
             WHEN sl.draft->>'text' IS NOT NULL AND p.id IS NULL THEN NULLIF(sl.draft->'media', 'null'::jsonb)
             -- Posting di antrean bergambar: media draf (lengkap dengan kredit), atau minimal tautan sumbernya
             -- (kosong setelah terbit: riwayat mengambil gambarnya dari Threads).
             WHEN sl.draft->>'text' IS NOT NULL AND p."mediaType"::text IN ('IMAGE', 'CAROUSEL') THEN
               COALESCE(
                 NULLIF(sl.draft->'media', 'null'::jsonb),
                 CASE WHEN cardinality(p."mediaUrls") > 0 THEN
                   jsonb_build_object('type', p."mediaType"::text,
                                      'items', (SELECT jsonb_agg(jsonb_build_object('sourceUrl', u) ORDER BY o)
                                                FROM unnest(p."mediaUrls") WITH ORDINALITY AS m(u, o)))
                 END)
             -- Posting di antrean tanpa gambar.
             WHEN sl.draft->>'text' IS NOT NULL THEN NULL
             ELSE NULLIF(i.preview->'media', 'null'::jsonb)
           END AS "previewMedia"
    FROM "ContentIdea" i
    LEFT JOIN "AutopilotSlot" sl ON sl.id = i."usedBySlot"
    LEFT JOIN "ScheduledPost" p ON p.id = sl."postId"
    WHERE (p_workspace IS NULL OR i."workspaceId" = p_workspace)
      AND (p_account_ids IS NULL OR i."accountId" = ANY(p_account_ids))
      AND i.status = ANY(p_statuses)
      AND (p_cursor_at IS NULL OR (i."createdAt", i.id) < (p_cursor_at, p_cursor_id))
    ORDER BY i."createdAt" DESC, i.id DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 50) + 1
  ) t
$$;

-- ------------------------------------------------------------------ hak akses

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('dash_pub_media_tmp', 'dash_pub_claim', 'dash_pub_result', 'dash_media_tmp_orphans', 'dash_idea_list')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
