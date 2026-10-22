-- =============================================================================
-- Gambar pada preview ide (tab Ide di Radar) dan pada postingan autopilot dari ide itu.
--
-- ADITIF dan idempoten. Prasyarat: sql/033_idea_preview.sql.
-- - Gambar preview disimpan di "ContentIdea".preview->'media' (PostMedia: {type, items[]}, lihat
--   src/lib/post-media.ts); tidak ada kolom baru. Kunci 'media' bernilai null = sengaja tanpa gambar.
-- - dash_idea_list ikut mengembalikan "previewMedia": ide terpakai menampilkan gambar posting yang
--   sebenarnya (media di draf slot, atau URL gambar ScheduledPost bila draf tidak menyimpannya), selain itu
--   gambar preview. dash_idea_candidates (033) sudah mengembalikan preview utuh, jadi penulis autopilot
--   ikut menerima medianya tanpa perubahan.
-- - dash_idea_preview_source ikut mengembalikan workspaceId (pencari gambar butuh lingkup workspace).
-- - dash_idea_media_set: ganti/hapus gambar preview ide BARU; mengembalikan media lama supaya berkasnya
--   bisa dihapus dari storage tanpa salah sasaran saat dua permintaan berbarengan.
-- =============================================================================

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
             -- Posting di antrean bergambar: media draf (lengkap dengan kredit), atau minimal URL-nya.
             WHEN sl.draft->>'text' IS NOT NULL AND p."mediaType"::text IN ('IMAGE', 'CAROUSEL') THEN
               COALESCE(
                 NULLIF(sl.draft->'media', 'null'::jsonb),
                 CASE WHEN cardinality(p."mediaUrls") > 0 THEN
                   jsonb_build_object('type', p."mediaType"::text,
                                      'items', (SELECT jsonb_agg(jsonb_build_object('url', u) ORDER BY o)
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

-- Bahan menulis preview satu ide (dalam lingkup pengguna), kini dengan workspaceId.
CREATE OR REPLACE FUNCTION dash_idea_preview_source(p_id text, p_workspace text, p_account_ids text[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('id', i.id, 'workspaceId', i."workspaceId", 'accountId', i."accountId", 'topik', i.topik,
                            'sudut', i.sudut, 'status', i.status, 'preview', i.preview)
  FROM "ContentIdea" i
  WHERE i.id = p_id
    AND (p_workspace IS NULL OR i."workspaceId" = p_workspace)
    AND (p_account_ids IS NULL OR i."accountId" = ANY(p_account_ids))
$$;

-- Ganti (p_media berisi) atau hapus (p_media NULL) gambar preview ide yang masih siap dipakai.
-- Balasan: {ok:false} bila ide tidak BARU / belum punya preview; {ok:true, old:<media lama|null>}.
CREATE OR REPLACE FUNCTION dash_idea_media_set(p_id text, p_media jsonb, p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old jsonb;
BEGIN
  SELECT NULLIF(preview->'media', 'null'::jsonb) INTO v_old
  FROM "ContentIdea" WHERE id = p_id AND status = 'BARU' AND preview IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  UPDATE "ContentIdea"
  SET preview = jsonb_set(preview, '{media}', COALESCE(p_media, 'null'::jsonb), true), "updatedAt" = p_now
  WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'old', v_old);
END
$$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('dash_idea_list', 'dash_idea_preview_source', 'dash_idea_media_set')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
