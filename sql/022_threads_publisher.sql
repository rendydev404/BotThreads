-- =============================================================================
-- Penerbit Threads milik dashboard (src/lib/threads-publisher.ts, dipanggil tiap menit lewat
-- /api/internal/publisher/tick).
--
-- Sejak BotThreads punya database Supabase sendiri, worker auto-suka tidak lagi membaca antrean ini,
-- jadi dashboard menerbitkan sendiri antrean "PostDispatch" (publisher THREADS) miliknya. Alurnya sama
-- dengan worker auto-suka: (1) dispatch jatuh tempo -> buat container Threads, (2) container FINISHED ->
-- threads_publish -> TERBIT. Hanya postingan buatan dashboard (source DASHBOARD_AI) yang disentuh.
--
-- ADITIF dan idempoten. Prasyarat: sql/003_dashboard_rpc.sql. Jalankan MANUAL di SQL Editor Supabase.
-- Indeks yang dipakai: primary key PostDispatch/ScheduledPost/SocialAccount/ThreadsAccount; antrean
-- MENUNGGU kecil (puluhan baris), jadi pemindaian status tidak butuh indeks tambahan.
-- =============================================================================

-- Tutup status posting setelah semua dispatch-nya selesai (sama dengan finalizePostStatus di auto-suka).
CREATE OR REPLACE FUNCTION dash_pub_finalize(p_post text, p_now timestamp) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE "ScheduledPost" p
  SET status = (CASE WHEN EXISTS (SELECT 1 FROM "PostDispatch" d WHERE d."postId" = p.id AND d.status = 'TERBIT')
                     THEN 'SELESAI' ELSE 'GAGAL' END)::"PostStatus",
      "updatedAt" = p_now
  WHERE p.id = p_post
    AND NOT EXISTS (SELECT 1 FROM "PostDispatch" d WHERE d."postId" = p.id AND d.status IN ('DRAF', 'MENUNGGU'))
$$;

-- Klaim dispatch Threads yang siap dikerjakan (FOR UPDATE SKIP LOCKED + "lockedAt"; kunci yang lebih tua
-- dari p_stale_before diambil ulang). Tahap "create": belum punya container dan sudah jatuh tempo.
-- Tahap "publish": container sudah dibuat. Dispatch yang belum dibuat container-nya padahal jam tayangnya
-- sebelum p_expire_before ditandai GAGAL lebih dulu: postingan basi tidak diterbitkan.
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

-- Hasil satu langkah untuk dispatch yang sedang dikunci. p_outcome:
--   CONTAINER  {containerId}       container dibuat; posting jadi DIPROSES
--   TERBIT     {mediaId, url}      sudah tayang di Threads
--   GAGAL      {error}             gagal permanen
--   ULANG      {error?}            coba lagi di putaran berikutnya (attempts + 1)
-- "containerId" di p_patch selalu disimpan bila ada (container dibuat dan diterbitkan pada langkah yang sama).
-- Hasil: OK, atau STALE bila dispatch sudah tidak MENUNGGU (diubah proses lain).
CREATE OR REPLACE FUNCTION dash_pub_result(p_id text, p_outcome text, p_patch jsonb, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_post text;
BEGIN
  IF p_outcome NOT IN ('CONTAINER', 'TERBIT', 'GAGAL', 'ULANG') THEN
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
                     WHEN 'TERBIT' THEN NULL WHEN 'CONTAINER' THEN NULL
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
  END IF;
  RETURN 'OK';
END
$$;

-- Akun untuk balasan affiliate (id pengguna Threads + token terenkripsi).
CREATE OR REPLACE FUNCTION dash_pub_account(p_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('id', ta.id, 'threadsUserId', ta."threadsUserId", 'accessToken', ta."accessToken",
                            'accessExpiresAt', ta."accessExpiresAt", 'needsReconnect', ta."needsReconnect", 'updatedAt', ta."updatedAt")
  FROM "ThreadsAccount" ta WHERE ta.id = p_id
$$;

-- Token diperpanjang (p_token/p_expires terisi) dan/atau akun harus dihubungkan ulang (p_reconnect).
CREATE OR REPLACE FUNCTION dash_pub_token(p_id text, p_token text, p_expires timestamp, p_reconnect boolean, p_now timestamp)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE "ThreadsAccount" SET
    "accessToken" = COALESCE(p_token, "accessToken"),
    "accessExpiresAt" = COALESCE(p_expires, "accessExpiresAt"),
    "needsReconnect" = "needsReconnect" OR COALESCE(p_reconnect, false),
    "updatedAt" = p_now
  WHERE id = p_id
  RETURNING true
$$;

REVOKE ALL ON FUNCTION dash_pub_finalize(text, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_pub_finalize(text, timestamp) TO service_role;
REVOKE ALL ON FUNCTION dash_pub_claim(timestamp, timestamp, timestamp, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_pub_claim(timestamp, timestamp, timestamp, integer) TO service_role;
REVOKE ALL ON FUNCTION dash_pub_result(text, text, jsonb, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_pub_result(text, text, jsonb, timestamp) TO service_role;
REVOKE ALL ON FUNCTION dash_pub_account(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_pub_account(text) TO service_role;
REVOKE ALL ON FUNCTION dash_pub_token(text, text, timestamp, boolean, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_pub_token(text, text, timestamp, boolean, timestamp) TO service_role;

NOTIFY pgrst, 'reload schema';
