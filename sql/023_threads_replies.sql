-- =============================================================================
-- Balas komentar otomatis (src/lib/threads-replies.ts, dijalankan di putaran penerbit tiap menit).
--
-- Komentar di postingan yang diterbitkan dashboard diambil berkala (webhook komentar Threads baru tersedia
-- setelah App Review), dibalas AI dengan jeda per akun dan batas harian. Satu komentar dibalas paling
-- banyak sekali (commentId unik + status bersyarat).
--
--   ThreadsReplySetting  saklar per akun; tanpa baris = menyala bila mode autopilot akun OTOMATIS
--   ThreadsReplyWatch    jadwal ambil komentar per postingan (dispatch)
--   ThreadsComment       komentar masuk + balasannya
--
-- ADITIF dan idempoten. Prasyarat: sql/005_autopilot.sql dan sql/022_threads_publisher.sql.
-- Jalankan MANUAL di SQL Editor Supabase.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "ThreadsReplySetting" (
  "accountId"   text PRIMARY KEY,
  "workspaceId" text NOT NULL,
  aktif         boolean NOT NULL,
  "updatedBy"   text,
  "updatedAt"   timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS "ThreadsReplyWatch" (
  "dispatchId"  text PRIMARY KEY,
  "nextAt"      timestamp(3) NOT NULL,
  "lastAt"      timestamp(3),
  "lockedAt"    timestamp(3),
  "createdAt"   timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS "ThreadsComment" (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspaceId" text NOT NULL,
  "accountId"   text NOT NULL,
  "dispatchId"  text NOT NULL,
  "postId"      text NOT NULL,
  "mediaId"     text NOT NULL,
  "commentId"   text NOT NULL UNIQUE,
  username      text,
  text          text NOT NULL DEFAULT '',
  "commentedAt" timestamp(3) NOT NULL,
  status        text NOT NULL DEFAULT 'BARU' CHECK (status IN ('BARU', 'MENULIS', 'DIBALAS', 'DILEWATI', 'GAGAL')),
  "replyText"   text,
  "replyId"     text,
  error         text,
  attempts      smallint NOT NULL DEFAULT 0,
  "lockedAt"    timestamp(3),
  "repliedAt"   timestamp(3),
  "createdAt"   timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updatedAt"   timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
-- Antrean balas (kecil): hanya baris yang masih menunggu.
CREATE INDEX IF NOT EXISTS "ThreadsComment_antre_idx" ON "ThreadsComment" ("commentedAt") WHERE status IN ('BARU', 'MENULIS');
-- Jeda per akun dan batas harian.
CREATE INDEX IF NOT EXISTS "ThreadsComment_balas_idx" ON "ThreadsComment" ("accountId", "repliedAt") WHERE status = 'DIBALAS';
-- Daftar di dashboard: terbaru per workspace.
CREATE INDEX IF NOT EXISTS "ThreadsComment_ws_idx" ON "ThreadsComment" ("workspaceId", "createdAt" DESC, id DESC);

ALTER TABLE "ThreadsReplySetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ThreadsReplyWatch"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ThreadsComment"      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ThreadsReplySetting", "ThreadsReplyWatch", "ThreadsComment" FROM anon, authenticated;

-- Balas otomatis menyala untuk akun ini? Baris saklar menang; tanpa baris = mode autopilot OTOMATIS.
CREATE OR REPLACE FUNCTION dash_reply_on(p_account text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    (SELECT s.aktif FROM "ThreadsReplySetting" s WHERE s."accountId" = p_account),
    (SELECT c.mode = 'OTOMATIS' FROM "AutopilotConfig" c WHERE c."accountId" = p_account),
    false)
$$;

-- Postingan yang waktunya diambil komentarnya (7 hari terakhir, akun dengan balas otomatis menyala), lalu dikunci.
CREATE OR REPLACE FUNCTION dash_reply_watch_due(p_now timestamp, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_out jsonb;
BEGIN
  WITH due AS (
    SELECT d.id AS "dispatchId", d."postId", d."platformPostId" AS "mediaId", p."tayangPada", p.caption,
           ta.id AS "accountId", ta."workspaceId", ta.username, ta."threadsUserId", ta."accessToken",
           ta."accessExpiresAt", ta."needsReconnect", ta."updatedAt" AS "accountUpdatedAt"
    FROM "PostDispatch" d
    JOIN "ScheduledPost" p ON p.id = d."postId" AND p.source = 'DASHBOARD_AI'
    JOIN "SocialAccount" sa ON sa.id = d."socialAccountId"
    JOIN "ThreadsAccount" ta ON ta.id = sa."threadsAccountId" AND NOT ta."needsReconnect"
    LEFT JOIN "ThreadsReplyWatch" w ON w."dispatchId" = d.id
    WHERE d.publisher = 'THREADS' AND d.status = 'TERBIT' AND d."platformPostId" IS NOT NULL
      AND p."tayangPada" >= p_now - interval '7 days'
      AND (w."dispatchId" IS NULL OR (w."nextAt" <= p_now AND (w."lockedAt" IS NULL OR w."lockedAt" < p_now - interval '5 minutes')))
      AND dash_reply_on(ta.id)
    ORDER BY COALESCE(w."nextAt", p."tayangPada"), d.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50)
  ), locked AS (
    INSERT INTO "ThreadsReplyWatch" ("dispatchId", "nextAt", "lockedAt", "createdAt")
    SELECT "dispatchId", p_now, p_now, p_now FROM due
    ON CONFLICT ("dispatchId") DO UPDATE SET "lockedAt" = p_now
      WHERE "ThreadsReplyWatch"."lockedAt" IS NULL OR "ThreadsReplyWatch"."lockedAt" < p_now - interval '5 minutes'
    RETURNING "dispatchId", "createdAt"
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'dispatchId', due."dispatchId", 'postId', due."postId", 'mediaId', due."mediaId", 'tayangPada', due."tayangPada",
           'watchSince', l."createdAt", 'caption', due.caption, 'accountId', due."accountId", 'workspaceId', due."workspaceId",
           'account', jsonb_build_object('id', due."accountId", 'username', due.username, 'threadsUserId', due."threadsUserId",
             'accessToken', due."accessToken", 'accessExpiresAt', due."accessExpiresAt", 'needsReconnect', due."needsReconnect",
             'updatedAt', due."accountUpdatedAt"))), '[]'::jsonb)
  INTO v_out
  FROM due JOIN locked l ON l."dispatchId" = due."dispatchId";
  RETURN v_out;
END
$$;

CREATE OR REPLACE FUNCTION dash_reply_watch_done(p_dispatch text, p_next timestamp, p_now timestamp) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE "ThreadsReplyWatch" SET "nextAt" = p_next, "lastAt" = p_now, "lockedAt" = NULL WHERE "dispatchId" = p_dispatch
$$;

-- Simpan komentar baru (yang sudah ada diabaikan). p_items: [{workspaceId, accountId, dispatchId, postId, mediaId,
-- commentId, username, text, commentedAt, status?, error?}]. Hasil: jumlah komentar baru.
CREATE OR REPLACE FUNCTION dash_reply_ingest(p_items jsonb, p_now timestamp) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n integer;
BEGIN
  INSERT INTO "ThreadsComment" ("workspaceId", "accountId", "dispatchId", "postId", "mediaId", "commentId", username, text,
                                "commentedAt", status, error, "createdAt", "updatedAt")
  SELECT it->>'workspaceId', it->>'accountId', it->>'dispatchId', it->>'postId', it->>'mediaId', it->>'commentId',
         NULLIF(it->>'username', ''), LEFT(COALESCE(it->>'text', ''), 1000), (it->>'commentedAt')::timestamp,
         COALESCE(it->>'status', 'BARU'), it->>'error', p_now, p_now
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) it
  ON CONFLICT ("commentId") DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$$;

-- Ambil komentar yang siap dibalas: paling banyak satu per akun per panggilan, akun yang sudah lewat jeda
-- p_gap_sec sejak balasan terakhir dan belum mencapai p_cap balasan hari ini (WIB). Komentar MENULIS yang
-- kuncinya basi dikembalikan ke antrean lebih dulu.
CREATE OR REPLACE FUNCTION dash_reply_claim(p_now timestamp, p_limit integer, p_gap_sec integer, p_cap integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_out jsonb;
  v_day timestamp := date_trunc('day', p_now + interval '7 hours') - interval '7 hours';
BEGIN
  UPDATE "ThreadsComment" SET status = 'BARU', "lockedAt" = NULL, "updatedAt" = p_now
  WHERE status = 'MENULIS' AND "lockedAt" < p_now - interval '10 minutes';

  WITH ready AS (
    SELECT DISTINCT ON (c."accountId") c.id
    FROM "ThreadsComment" c
    WHERE c.status = 'BARU'
      AND dash_reply_on(c."accountId")
      AND NOT EXISTS (SELECT 1 FROM "ThreadsComment" x
                      WHERE x."accountId" = c."accountId" AND x.status = 'DIBALAS'
                        AND x."repliedAt" > p_now - make_interval(secs => p_gap_sec))
      AND (SELECT count(*) FROM "ThreadsComment" x
           WHERE x."accountId" = c."accountId" AND x.status = 'DIBALAS' AND x."repliedAt" >= v_day) < p_cap
    ORDER BY c."accountId", c."commentedAt", c.id
  ), pick AS (
    SELECT c.id FROM "ThreadsComment" c JOIN ready r ON r.id = c.id
    ORDER BY c."commentedAt", c.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 30)
    FOR UPDATE OF c SKIP LOCKED
  ), u AS (
    UPDATE "ThreadsComment" c SET status = 'MENULIS', "lockedAt" = p_now, attempts = c.attempts + 1, "updatedAt" = p_now
    FROM pick WHERE c.id = pick.id AND c.status = 'BARU'
    RETURNING c.*
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', u.id, 'workspaceId', u."workspaceId", 'accountId', u."accountId", 'commentId', u."commentId",
           'username', u.username, 'text', u.text, 'attempts', u.attempts, 'postText', p.caption,
           'brief', ac.brief, 'voiceStyle', ac."voiceStyle",
           'account', jsonb_build_object('id', ta.id, 'username', ta.username, 'displayName', ta."displayName",
             'threadsUserId', ta."threadsUserId", 'accessToken', ta."accessToken", 'accessExpiresAt', ta."accessExpiresAt",
             'needsReconnect', ta."needsReconnect", 'updatedAt', ta."updatedAt"))), '[]'::jsonb)
  INTO v_out
  FROM u
  JOIN "ThreadsAccount" ta ON ta.id = u."accountId"
  LEFT JOIN "ScheduledPost" p ON p.id = u."postId"
  LEFT JOIN "AutopilotConfig" ac ON ac."accountId" = u."accountId";
  RETURN v_out;
END
$$;

-- Hasil satu komentar yang sedang ditulis: DIBALAS {replyText, replyId}, DILEWATI {error}, GAGAL {error},
-- atau BARU (coba lagi nanti). Hanya berlaku dari status MENULIS.
CREATE OR REPLACE FUNCTION dash_reply_done(p_id text, p_status text, p_reply_text text, p_reply_id text, p_error text, p_now timestamp)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF p_status NOT IN ('BARU', 'DIBALAS', 'DILEWATI', 'GAGAL') THEN
    RAISE EXCEPTION 'status tidak valid' USING ERRCODE = '22023';
  END IF;
  UPDATE "ThreadsComment" SET
    status = p_status,
    "replyText" = COALESCE(LEFT(p_reply_text, 500), "replyText"),
    "replyId" = COALESCE(p_reply_id, "replyId"),
    error = LEFT(p_error, 300),
    "repliedAt" = CASE WHEN p_status = 'DIBALAS' THEN p_now ELSE "repliedAt" END,
    "lockedAt" = NULL,
    "updatedAt" = p_now
  WHERE id = p_id AND status = 'MENULIS';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END
$$;

-- Saklar balas otomatis per akun (akun sudah divalidasi milik workspace di server).
CREATE OR REPLACE FUNCTION dash_reply_setting_set(p_workspace text, p_account text, p_aktif boolean, p_user text, p_now timestamp)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO "ThreadsReplySetting" ("accountId", "workspaceId", aktif, "updatedBy", "updatedAt")
  VALUES (p_account, p_workspace, p_aktif, p_user, p_now)
  ON CONFLICT ("accountId") DO UPDATE SET "workspaceId" = EXCLUDED."workspaceId", aktif = EXCLUDED.aktif,
    "updatedBy" = p_user, "updatedAt" = p_now;
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (p_workspace, p_user, CASE WHEN p_aktif THEN 'BALAS_KOMEN_NYALA' ELSE 'BALAS_KOMEN_MATI' END, p_account, '{}'::jsonb, p_now);
  RETURN p_aktif;
END
$$;

-- Ringkasan untuk dashboard: saklar efektif per akun + komentar terbaru (akun dibatasi p_account_ids).
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
                      c."repliedAt", c."createdAt", d."releaseUrl"
               FROM "ThreadsComment" c LEFT JOIN "PostDispatch" d ON d.id = c."dispatchId"
               WHERE c."accountId" = ANY(p_account_ids)
               ORDER BY c."createdAt" DESC, c.id DESC
               LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)) t), '[]'::jsonb))
$$;

REVOKE ALL ON FUNCTION dash_reply_on(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_reply_on(text) TO service_role;
REVOKE ALL ON FUNCTION dash_reply_watch_due(timestamp, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_reply_watch_due(timestamp, integer) TO service_role;
REVOKE ALL ON FUNCTION dash_reply_watch_done(text, timestamp, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_reply_watch_done(text, timestamp, timestamp) TO service_role;
REVOKE ALL ON FUNCTION dash_reply_ingest(jsonb, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_reply_ingest(jsonb, timestamp) TO service_role;
REVOKE ALL ON FUNCTION dash_reply_claim(timestamp, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_reply_claim(timestamp, integer, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION dash_reply_done(text, text, text, text, text, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_reply_done(text, text, text, text, text, timestamp) TO service_role;
REVOKE ALL ON FUNCTION dash_reply_setting_set(text, text, boolean, text, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_reply_setting_set(text, text, boolean, text, timestamp) TO service_role;
REVOKE ALL ON FUNCTION dash_reply_overview(text[], integer, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_reply_overview(text[], integer, timestamp) TO service_role;

NOTIFY pgrst, 'reload schema';
