-- =============================================================================
-- Lanjutan obrolan: komentar yang membalas balasan AI ikut dibalas, dengan riwayat obrolan sebagai konteks.
--
-- Webhook Threads mengirim `replied_to.id`. Bila itu balasan AI kita (ThreadsComment."replyId"), komentar
-- disimpan sebagai lanjutan ("parentId" = baris komentar sebelumnya, depth = depth induk + 1). Balasan untuk
-- komentar orang lain tetap diabaikan. Obrolan dibatasi MAX_DEPTH putaran supaya tidak tanpa ujung (mis. dua
-- bot saling membalas); lewat batas disimpan DILEWATI supaya terlihat di dashboard.
--
-- ADITIF dan idempoten. Prasyarat: sql/023 dan sql/024. Jalankan MANUAL di SQL Editor Supabase.
-- =============================================================================

ALTER TABLE "ThreadsComment" ADD COLUMN IF NOT EXISTS "parentId" text;
ALTER TABLE "ThreadsComment" ADD COLUMN IF NOT EXISTS depth smallint NOT NULL DEFAULT 0;
-- Mencocokkan `replied_to.id` webhook ke balasan AI yang sudah terkirim.
CREATE INDEX IF NOT EXISTS "ThreadsComment_replyId_idx" ON "ThreadsComment" ("replyId") WHERE "replyId" IS NOT NULL;

-- p_item: {mediaId, commentId, repliedTo?, username, text, commentedAt}.
-- Hasil: { status: OK | DUPLIKAT | BUKAN_POSTINGAN | BUKAN_BALASAN_KITA | SENDIRI | MATI, accountId? }
--   BUKAN_BALASAN_KITA  balasan bersarang untuk komentar selain balasan AI kita: tidak disimpan
CREATE OR REPLACE FUNCTION dash_reply_webhook_ingest(p_item jsonb, p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  max_depth CONSTANT smallint := 4;  -- AI membalas paling banyak 5 kali dalam satu obrolan
  r record;
  parent record;
  v_depth smallint := 0;
  v_parent text;
  v_status text;
  v_error text;
  v_replied text := NULLIF(p_item->>'repliedTo', '');
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

  IF v_replied IS NOT NULL AND v_replied <> p_item->>'mediaId' THEN
    SELECT c.id, c.depth INTO parent
    FROM "ThreadsComment" c
    WHERE c."replyId" = v_replied AND c."accountId" = r."accountId"
    LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'BUKAN_BALASAN_KITA', 'accountId', r."accountId"); END IF;
    v_parent := parent.id;
    v_depth := parent.depth + 1;
  END IF;
  IF NOT dash_reply_on(r."accountId") THEN RETURN jsonb_build_object('status', 'MATI', 'accountId', r."accountId"); END IF;

  IF btrim(COALESCE(p_item->>'text', '')) = '' THEN
    v_status := 'DILEWATI'; v_error := 'Komentar tanpa teks.';
  ELSIF v_depth > max_depth THEN
    v_status := 'DILEWATI'; v_error := 'Obrolan sudah panjang, tidak dibalas lagi.';
  ELSE
    v_status := 'BARU';
  END IF;

  INSERT INTO "ThreadsComment" ("workspaceId", "accountId", "dispatchId", "postId", "mediaId", "commentId", "parentId", depth,
                                username, text, "commentedAt", status, error, "createdAt", "updatedAt")
  VALUES (r."workspaceId", r."accountId", r."dispatchId", r."postId", p_item->>'mediaId', p_item->>'commentId', v_parent, v_depth,
          NULLIF(p_item->>'username', ''), LEFT(COALESCE(p_item->>'text', ''), 1000),
          COALESCE((p_item->>'commentedAt')::timestamp, p_now), v_status, v_error, p_now, p_now)
  ON CONFLICT ("commentId") DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('status', CASE WHEN n = 1 THEN 'OK' ELSE 'DUPLIKAT' END, 'accountId', r."accountId");
END
$$;

-- Sama dengan sql/023, ditambah `history`: obrolan sebelumnya (komentar + balasan AI), terlama dulu.
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
           'brief', ac.brief, 'voiceStyle', ac."voiceStyle", 'history', COALESCE(h.items, '[]'::jsonb),
           'account', jsonb_build_object('id', ta.id, 'username', ta.username, 'displayName', ta."displayName",
             'threadsUserId', ta."threadsUserId", 'accessToken', ta."accessToken", 'accessExpiresAt', ta."accessExpiresAt",
             'needsReconnect', ta."needsReconnect", 'updatedAt', ta."updatedAt"))), '[]'::jsonb)
  INTO v_out
  FROM u
  JOIN "ThreadsAccount" ta ON ta.id = u."accountId"
  LEFT JOIN "ScheduledPost" p ON p.id = u."postId"
  LEFT JOIN "AutopilotConfig" ac ON ac."accountId" = u."accountId"
  LEFT JOIN LATERAL (
    WITH RECURSIVE chain AS (
      SELECT c.id, c."parentId", c.username, c.text, c."replyText", c.depth
      FROM "ThreadsComment" c WHERE c.id = u."parentId"
      UNION ALL
      SELECT c.id, c."parentId", c.username, c.text, c."replyText", c.depth
      FROM "ThreadsComment" c JOIN chain ON c.id = chain."parentId"
      WHERE chain.depth > 0
    )
    SELECT jsonb_agg(jsonb_build_object('username', chain.username, 'text', chain.text, 'replyText', chain."replyText")
                     ORDER BY chain.depth) AS items
    FROM chain
  ) h ON true;
  RETURN v_out;
END
$$;

-- Sama dengan sql/023, ditambah depth per komentar (lanjutan obrolan ditandai di dashboard).
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
                      c."repliedAt", c."createdAt", c.depth, d."releaseUrl"
               FROM "ThreadsComment" c LEFT JOIN "PostDispatch" d ON d.id = c."dispatchId"
               WHERE c."accountId" = ANY(p_account_ids)
               ORDER BY c."createdAt" DESC, c.id DESC
               LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)) t), '[]'::jsonb))
$$;

REVOKE ALL ON FUNCTION dash_reply_webhook_ingest(jsonb, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_reply_webhook_ingest(jsonb, timestamp) TO service_role;
REVOKE ALL ON FUNCTION dash_reply_claim(timestamp, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_reply_claim(timestamp, integer, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION dash_reply_overview(text[], integer, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_reply_overview(text[], integer, timestamp) TO service_role;

NOTIFY pgrst, 'reload schema';
