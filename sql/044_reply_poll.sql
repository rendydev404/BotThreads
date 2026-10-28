-- Polling cadangan balas komentar (src/lib/threads-reply-poll.ts).
-- Webhook Threads untuk tech provider baru terkirim setelah izin lolos App Review (Advanced Access), jadi
-- sementara itu komentar diambil sendiri. Fungsi ini hanya membaca: postingan BotThreads yang sudah terbit
-- sejak p_since di akun yang balas komentar otomatisnya aktif. Komentar yang ditemukan disimpan lewat
-- dash_reply_webhook_ingest (sql/025), jadi aturannya sama persis dengan webhook.

CREATE OR REPLACE FUNCTION dash_reply_poll_targets(p_since timestamp, p_limit integer)
RETURNS TABLE ("mediaId" text, "accountId" text, "postedAt" timestamp)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT d."platformPostId", ta.id, p."tayangPada"
  FROM "ScheduledPost" p
  JOIN "PostDispatch" d
    ON d."postId" = p.id AND d.publisher = 'THREADS' AND d.status = 'TERBIT' AND d."platformPostId" IS NOT NULL
  JOIN "SocialAccount" sa ON sa.id = d."socialAccountId"
  JOIN "ThreadsAccount" ta ON ta.id = sa."threadsAccountId" AND NOT ta."needsReconnect"
  WHERE p.source = 'DASHBOARD_AI'
    AND p."tayangPada" >= p_since
    AND dash_reply_on(ta.id)
  ORDER BY p."tayangPada" DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 500);
$$;

REVOKE ALL ON FUNCTION dash_reply_poll_targets(timestamp, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_reply_poll_targets(timestamp, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
