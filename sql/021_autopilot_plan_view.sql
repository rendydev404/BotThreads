-- =============================================================================
-- Rencana posting autopilot (tab Autopilot > Rencana) dan konteks tren untuk penulis.
--
-- Tiga fungsi BACA saja (STABLE), tanpa tabel atau kolom baru:
--   dash_ap_plan_drafts       draf slot satu hari, hanya kolom yang ditampilkan (tanpa hasil gerbang)
--   dash_radar_signal_briefs  ringkasan sinyal tren menurut id (rujukan ide)
--   dash_idea_details         rincian ide menurut id, termasuk potensi viral dan alasan dari scoreDetail
--
-- ADITIF dan idempoten. Prasyarat: sql/005_autopilot.sql dan sql/006_autopilot_radar.sql.
-- Jalankan MANUAL di SQL Editor Supabase oleh pemilik.
--
-- Indeks yang dipakai (sudah ada): AutopilotSlot_hari_idx ("dayKey", "workspaceId", "accountId"),
-- primary key TrendSignal dan ContentIdea. Masukan id dibatasi 400 per panggilan.
-- =============================================================================

CREATE OR REPLACE FUNCTION dash_ap_plan_drafts(p_workspace text, p_day date, p_account_ids text[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.id,
           'ideaId', s."ideaId",
           'text', s.draft->>'text',
           'angle', s.draft->>'angle',
           'pillar', s.draft->>'pillar',
           'promo', COALESCE(s.draft->'promo' = 'true'::jsonb, false),
           'topik', s.draft->'idea'->>'topik',
           'topicKey', s.draft->>'topicKey',
           'affiliate', s.draft->'affiliate'->>'nama')), '[]'::jsonb)
  FROM "AutopilotSlot" s
  WHERE s."dayKey" = p_day
    AND (p_workspace IS NULL OR s."workspaceId" = p_workspace)
    AND s."accountId" = ANY(p_account_ids)
    AND s.draft IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION dash_radar_signal_briefs(p_ids text[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.id, 'source', s.source, 'title', s.title, 'summary', s.summary, 'url', s.url)), '[]'::jsonb)
  FROM "TrendSignal" s
  WHERE s.id = ANY(p_ids[1:400])
$$;

CREATE OR REPLACE FUNCTION dash_idea_details(p_ids text[], p_workspace text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', i.id,
           'topik', i.topik,
           'sudut', i.sudut,
           'formulaHook', i."formulaHook",
           'pilar', i.pilar,
           'signalIds', to_jsonb(i."signalIds"),
           'score', i.score,
           'viral', CASE WHEN jsonb_typeof(i."scoreDetail"->'viral') = 'number' THEN i."scoreDetail"->'viral' END,
           'alasan', i."scoreDetail"->>'alasan')), '[]'::jsonb)
  FROM "ContentIdea" i
  WHERE i.id = ANY(p_ids[1:400])
    AND (p_workspace IS NULL OR i."workspaceId" = p_workspace)
$$;

REVOKE ALL ON FUNCTION dash_ap_plan_drafts(text, date, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_ap_plan_drafts(text, date, text[]) TO service_role;
REVOKE ALL ON FUNCTION dash_radar_signal_briefs(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_radar_signal_briefs(text[]) TO service_role;
REVOKE ALL ON FUNCTION dash_idea_details(text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_idea_details(text[], text) TO service_role;

NOTIFY pgrst, 'reload schema';
