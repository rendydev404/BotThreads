-- =============================================================================
-- Moderasi balasan Threads (izin threads_manage_replies):
--   1. Atur siapa yang boleh membalas postingan ("ScheduledPost"."replyControl" -> parameter reply_control
--      Threads API saat container dibuat). NULL = bawaan Threads (everyone).
--   2. Sembunyikan / tampilkan lagi komentar ("ThreadsComment".hidden -> POST /{reply_id}/manage_reply).
--   3. Balas komentar secara manual dari dashboard ("ThreadsComment"."manualReply").
--
-- ADITIF dan idempoten. Prasyarat: sql/023, sql/025, sql/036, sql/040.
-- - dash_create_posts : sama dengan sql/036, ditambah "replyControl" per item (opsional).
-- - dash_pub_claim    : sama dengan sql/040, ditambah 'replyControl'.
-- - dash_reply_overview: sama dengan sql/025, ditambah hidden dan manualReply per komentar.
-- - dash_reply_hide_set / dash_reply_manual_lock: fungsi baru untuk tab Komentar.
-- =============================================================================

ALTER TABLE "ScheduledPost" ADD COLUMN IF NOT EXISTS "replyControl" text;
ALTER TABLE "ThreadsComment" ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
ALTER TABLE "ThreadsComment" ADD COLUMN IF NOT EXISTS "manualReply" boolean NOT NULL DEFAULT false;

-- ------------------------------------------------------------------ antrean: tulis

CREATE OR REPLACE FUNCTION dash_create_posts(p_items jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE it jsonb; n integer := 0; nowu timestamp := (now() AT TIME ZONE 'UTC'); v_type text; v_rc text;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'items tidak valid' USING ERRCODE = '22023';
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_type := COALESCE(NULLIF(it->>'mediaType', ''), 'TEXT');
    IF v_type NOT IN ('TEXT', 'IMAGE', 'CAROUSEL') THEN
      RAISE EXCEPTION 'mediaType tidak valid' USING ERRCODE = '22023';
    END IF;
    v_rc := NULLIF(it->>'replyControl', '');
    IF v_rc IS NOT NULL AND v_rc NOT IN ('everyone', 'accounts_you_follow', 'mentioned_only', 'parent_post_author_only', 'followers_only') THEN
      RAISE EXCEPTION 'replyControl tidak valid' USING ERRCODE = '22023';
    END IF;
    INSERT INTO "ScheduledPost" (id, "workspaceId", judul, caption, hashtags, "mediaType", placement, "videoUrl",
                                 "mediaUrls", "mediaPaths", "targetType", "tayangPada", status, source, "draftGroupId",
                                 "replyControl", "updatedAt")
    VALUES (it->>'postId', it->>'workspaceId', it->>'judul', it->>'caption',
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(it->'hashtags', '[]'::jsonb))),
            v_type, 'FEED', '',
            CASE WHEN v_type = 'TEXT' THEN ARRAY[]::text[]
                 ELSE ARRAY(SELECT jsonb_array_elements_text(COALESCE(NULLIF(it->'mediaUrls', 'null'::jsonb), '[]'::jsonb))) END,
            CASE WHEN v_type = 'TEXT' THEN ARRAY[]::text[]
                 ELSE ARRAY(SELECT jsonb_array_elements_text(COALESCE(NULLIF(it->'mediaPaths', 'null'::jsonb), '[]'::jsonb))) END,
            'SATU_OUTLET',
            (it->>'tayangPada')::timestamp, 'MENUNGGU', 'DASHBOARD_AI', it->>'batchId', v_rc, nowu);
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

-- ------------------------------------------------------------------ penerbit: klaim

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
           'replyControl', p."replyControl",
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

-- ------------------------------------------------------------------ tab Komentar

CREATE OR REPLACE FUNCTION dash_reply_overview(p_account_ids text[], p_limit integer, p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'settings', COALESCE((SELECT jsonb_object_agg(a, dash_reply_on(a)) FROM unnest(p_account_ids) a), '{}'::jsonb),
    'counts', (SELECT jsonb_build_object(
                 'dibalas7', count(*) FILTER (WHERE status = 'DIBALAS' AND "repliedAt" >= p_now - interval '7 days'),
                 'menunggu', count(*) FILTER (WHERE status IN ('BARU', 'MENULIS')),
                 'dilewati7', count(*) FILTER (WHERE status = 'DILEWATI' AND "updatedAt" >= p_now - interval '7 days'),
                 'gagal7', count(*) FILTER (WHERE status = 'GAGAL' AND "updatedAt" >= p_now - interval '7 days'))
               FROM "ThreadsComment" WHERE "accountId" = ANY(p_account_ids) AND "createdAt" >= p_now - interval '30 days'),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t."createdAt" DESC, t.id DESC) FROM (
               SELECT c.id, c."accountId", c.username, c.text, c."commentedAt", c.status, c."replyText", c.error,
                      c."repliedAt", c."createdAt", c."parentId", c.depth, c.hidden, c."manualReply", d."releaseUrl"
               FROM "ThreadsComment" c LEFT JOIN "PostDispatch" d ON d.id = c."dispatchId"
               WHERE c."accountId" = ANY(p_account_ids)
               ORDER BY c."createdAt" DESC, c.id DESC
               LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)) t), '[]'::jsonb))
$$;

-- Komentar milik salah satu akun yang boleh dilihat pengguna (akun divalidasi di server) + token akunnya.
-- Dipakai sebelum memanggil Threads API untuk hide/unhide.
CREATE OR REPLACE FUNCTION dash_reply_target(p_id text, p_account_ids text[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
           'id', c.id, 'commentId', c."commentId", 'status', c.status, 'hidden', c.hidden,
           'account', jsonb_build_object('id', ta.id, 'threadsUserId', ta."threadsUserId", 'accessToken', ta."accessToken",
             'accessExpiresAt', ta."accessExpiresAt", 'needsReconnect', ta."needsReconnect", 'updatedAt', ta."updatedAt"))
  FROM "ThreadsComment" c JOIN "ThreadsAccount" ta ON ta.id = c."accountId"
  WHERE c.id = p_id AND c."accountId" = ANY(p_account_ids)
$$;

-- Simpan status tersembunyi setelah Threads API berhasil. Komentar yang belum dibalas dan disembunyikan
-- tidak dibalas otomatis (BARU -> DILEWATI).
CREATE OR REPLACE FUNCTION dash_reply_hide_set(p_id text, p_hidden boolean, p_now timestamp) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE "ThreadsComment" SET
    hidden = p_hidden,
    status = CASE WHEN p_hidden AND status = 'BARU' THEN 'DILEWATI' ELSE status END,
    error = CASE WHEN p_hidden AND status = 'BARU' THEN 'Komentar disembunyikan.' ELSE error END,
    "updatedAt" = p_now
  WHERE id = p_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END
$$;

-- Kunci komentar untuk dibalas manual: hanya bila tidak sedang ditulis AI. Mengembalikan target (sama dengan
-- dash_reply_target) atau NULL. Hasilnya ditutup dengan dash_reply_manual_done.
CREATE OR REPLACE FUNCTION dash_reply_manual_lock(p_id text, p_account_ids text[], p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_prev text;
BEGIN
  SELECT status INTO v_prev FROM "ThreadsComment"
  WHERE id = p_id AND "accountId" = ANY(p_account_ids) AND status <> 'MENULIS'
  FOR UPDATE;
  IF v_prev IS NULL THEN RETURN NULL; END IF;
  UPDATE "ThreadsComment" SET status = 'MENULIS', "lockedAt" = p_now, "updatedAt" = p_now WHERE id = p_id;
  RETURN dash_reply_target(p_id, p_account_ids) || jsonb_build_object('prevStatus', v_prev);
END
$$;

-- Tutup balasan manual: berhasil = DIBALAS + teks/ID balasan; gagal = kembali ke status semula + pesan galat.
CREATE OR REPLACE FUNCTION dash_reply_manual_done(p_id text, p_ok boolean, p_prev text, p_reply_text text, p_reply_id text,
                                                  p_error text, p_now timestamp) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF p_prev NOT IN ('BARU', 'DIBALAS', 'DILEWATI', 'GAGAL') THEN
    RAISE EXCEPTION 'status tidak valid' USING ERRCODE = '22023';
  END IF;
  UPDATE "ThreadsComment" SET
    status = CASE WHEN p_ok THEN 'DIBALAS' ELSE p_prev END,
    "replyText" = CASE WHEN p_ok THEN LEFT(p_reply_text, 500) ELSE "replyText" END,
    "replyId" = CASE WHEN p_ok THEN p_reply_id ELSE "replyId" END,
    "manualReply" = CASE WHEN p_ok THEN true ELSE "manualReply" END,
    "repliedAt" = CASE WHEN p_ok THEN p_now ELSE "repliedAt" END,
    error = CASE WHEN p_ok THEN NULL ELSE LEFT(p_error, 300) END,
    "lockedAt" = NULL,
    "updatedAt" = p_now
  WHERE id = p_id AND status = 'MENULIS';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END
$$;

REVOKE ALL ON FUNCTION dash_create_posts(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_create_posts(jsonb) TO service_role;
REVOKE ALL ON FUNCTION dash_pub_claim(timestamp, timestamp, timestamp, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_pub_claim(timestamp, timestamp, timestamp, integer) TO service_role;
REVOKE ALL ON FUNCTION dash_reply_overview(text[], integer, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_reply_overview(text[], integer, timestamp) TO service_role;
REVOKE ALL ON FUNCTION dash_reply_target(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_reply_target(text, text[]) TO service_role;
REVOKE ALL ON FUNCTION dash_reply_hide_set(text, boolean, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_reply_hide_set(text, boolean, timestamp) TO service_role;
REVOKE ALL ON FUNCTION dash_reply_manual_lock(text, text[], timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_reply_manual_lock(text, text[], timestamp) TO service_role;

REVOKE ALL ON FUNCTION dash_reply_manual_done(text, boolean, text, text, text, text, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_reply_manual_done(text, boolean, text, text, text, text, timestamp) TO service_role;

NOTIFY pgrst, 'reload schema';
