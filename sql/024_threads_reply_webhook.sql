-- =============================================================================
-- Komentar masuk lewat webhook Threads (topik "replies"), menggantikan polling.
--
-- Meta mengirim satu notifikasi per komentar ke /api/webhooks/threads; fungsi di bawah mencocokkan komentar
-- ke postingan yang diterbitkan dashboard lalu menyimpannya untuk dibalas. Tidak ada panggilan API ke Threads
-- untuk mencari komentar.
--
-- ADITIF dan idempoten. Prasyarat: sql/023_threads_replies.sql. Membersihkan objek polling dari versi awal
-- sql/023 bila sempat dipasang. Jalankan MANUAL di SQL Editor Supabase.
-- =============================================================================

DROP FUNCTION IF EXISTS dash_reply_watch_due(timestamp, integer);
DROP FUNCTION IF EXISTS dash_reply_watch_done(text, timestamp, timestamp);
DROP FUNCTION IF EXISTS dash_reply_ingest(jsonb, timestamp);
DROP TABLE IF EXISTS "ThreadsReplyWatch";

-- Pencocokan komentar ke postingan: satu baris per media Threads yang sudah terbit.
CREATE INDEX IF NOT EXISTS "PostDispatch_platformPostId_idx" ON "PostDispatch" ("platformPostId") WHERE "platformPostId" IS NOT NULL;

-- Simpan satu komentar dari webhook. p_item: {mediaId, commentId, username, text, commentedAt}.
-- Hasil: { status: OK | DUPLIKAT | BUKAN_POSTINGAN | SENDIRI | MATI, accountId? }
--   BUKAN_POSTINGAN  media bukan postingan yang diterbitkan dashboard
--   SENDIRI          komentar dari akun pemilik postingan (balasan kita sendiri)
--   MATI             balas otomatis akun ini mati: tidak disimpan
CREATE OR REPLACE FUNCTION dash_reply_webhook_ingest(p_item jsonb, p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r record;
  n integer;
BEGIN
  SELECT d.id AS "dispatchId", d."postId", ta.id AS "accountId", ta."workspaceId", ta.username
    INTO r
  FROM "PostDispatch" d
  JOIN "ScheduledPost" p ON p.id = d."postId" AND p.source = 'DASHBOARD_AI'
  JOIN "SocialAccount" sa ON sa.id = d."socialAccountId"
  JOIN "ThreadsAccount" ta ON ta.id = sa."threadsAccountId"
  WHERE d."platformPostId" = p_item->>'mediaId' AND d.publisher = 'THREADS' AND d.status = 'TERBIT'
  LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'BUKAN_POSTINGAN'); END IF;
  IF lower(COALESCE(p_item->>'username', '')) = lower(COALESCE(r.username, '')) THEN
    RETURN jsonb_build_object('status', 'SENDIRI', 'accountId', r."accountId");
  END IF;
  IF NOT dash_reply_on(r."accountId") THEN RETURN jsonb_build_object('status', 'MATI', 'accountId', r."accountId"); END IF;

  INSERT INTO "ThreadsComment" ("workspaceId", "accountId", "dispatchId", "postId", "mediaId", "commentId", username, text,
                                "commentedAt", status, error, "createdAt", "updatedAt")
  VALUES (r."workspaceId", r."accountId", r."dispatchId", r."postId", p_item->>'mediaId', p_item->>'commentId',
          NULLIF(p_item->>'username', ''), LEFT(COALESCE(p_item->>'text', ''), 1000),
          COALESCE((p_item->>'commentedAt')::timestamp, p_now),
          CASE WHEN btrim(COALESCE(p_item->>'text', '')) = '' THEN 'DILEWATI' ELSE 'BARU' END,
          CASE WHEN btrim(COALESCE(p_item->>'text', '')) = '' THEN 'Komentar tanpa teks.' END, p_now, p_now)
  ON CONFLICT ("commentId") DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('status', CASE WHEN n = 1 THEN 'OK' ELSE 'DUPLIKAT' END, 'accountId', r."accountId");
END
$$;

REVOKE ALL ON FUNCTION dash_reply_webhook_ingest(jsonb, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_reply_webhook_ingest(jsonb, timestamp) TO service_role;

NOTIFY pgrst, 'reload schema';
