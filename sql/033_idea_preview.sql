-- =============================================================================
-- Preview postingan per ide (tab Ide di Radar).
--
-- ADITIF dan idempoten. Prasyarat: sql/006_autopilot_radar.sql.
-- - "ContentIdea".preview: draf yang ditulis AI dari ide ini ({text, topicTag, model, at}). Ditulis sekali
--   saat pertama kali dilihat, lalu dipakai ulang; autopilot memakai teks ini lebih dulu saat menulis slot
--   dengan ide yang sama, jadi yang dilihat di preview = yang diposting (bila lolos pemeriksaan).
-- - dash_idea_list / dash_idea_candidates ikut mengembalikan preview. Ide yang sudah DIPAKAI menampilkan
--   teks posting yang sebenarnya (draf slot), bukan preview.
-- =============================================================================

ALTER TABLE "ContentIdea" ADD COLUMN IF NOT EXISTS preview jsonb;

CREATE OR REPLACE FUNCTION dash_idea_candidates(p_ids text[], p_now timestamp, p_per int) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t) - 'rn' ORDER BY t."accountId", t.rn), '[]'::jsonb) FROM (
    SELECT i.id, i."accountId", i.topik, i."topicKey", i.sudut, i."formulaHook", i.pilar, i."signalIds", i.score,
           (i."pinnedBy" IS NOT NULL) AS pinned, i.preview,
           ROW_NUMBER() OVER (PARTITION BY i."accountId"
                              ORDER BY (i."pinnedBy" IS NOT NULL) DESC, i.score DESC, i.id) AS rn
    FROM "ContentIdea" i
    WHERE i."accountId" = ANY(p_ids) AND i.status = 'BARU' AND i."expiresAt" > p_now
  ) t WHERE t.rn <= LEAST(GREATEST(p_per, 1), 20)
$$;

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
           sl."slotAt" AS "postAt"
    FROM "ContentIdea" i
    LEFT JOIN "AutopilotSlot" sl ON sl.id = i."usedBySlot"
    WHERE (p_workspace IS NULL OR i."workspaceId" = p_workspace)
      AND (p_account_ids IS NULL OR i."accountId" = ANY(p_account_ids))
      AND i.status = ANY(p_statuses)
      AND (p_cursor_at IS NULL OR (i."createdAt", i.id) < (p_cursor_at, p_cursor_id))
    ORDER BY i."createdAt" DESC, i.id DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 50) + 1
  ) t
$$;

-- Bahan menulis preview satu ide (dalam lingkup pengguna).
CREATE OR REPLACE FUNCTION dash_idea_preview_source(p_id text, p_workspace text, p_account_ids text[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('id', i.id, 'accountId', i."accountId", 'topik', i.topik, 'sudut', i.sudut,
                            'status', i.status, 'preview', i.preview)
  FROM "ContentIdea" i
  WHERE i.id = p_id
    AND (p_workspace IS NULL OR i."workspaceId" = p_workspace)
    AND (p_account_ids IS NULL OR i."accountId" = ANY(p_account_ids))
$$;

-- Simpan preview (hanya ide yang masih siap dipakai).
CREATE OR REPLACE FUNCTION dash_idea_preview_set(p_id text, p_preview jsonb, p_now timestamp) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH x AS (
    UPDATE "ContentIdea" SET preview = p_preview, "updatedAt" = p_now
    WHERE id = p_id AND status = 'BARU'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM x)
$$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('dash_idea_candidates', 'dash_idea_list', 'dash_idea_preview_source', 'dash_idea_preview_set')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
