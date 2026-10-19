-- =============================================================================
-- Radar: tren yang lagi naik di niche tiap akun (sumber sinyal NICHE).
--
-- AI mencari lewat Google Search apa yang sedang naik di niche akun (dari Tema akun dan pilar di
-- pengaturan Autopilot, atau disimpulkan dari postingan akun bila tema kosong). Hasilnya disimpan
-- sebagai sinyal milik workspace dengan "accountId" = akun tujuan, lalu dipakai bank ide akun itu.
--
--   - sumber 'NICHE' diizinkan pada TrendSignal.source
--   - indeks parsial untuk membaca sinyal NICHE per akun
--   - dash_radar_niche: N sinyal NICHE terbaru yang masih berlaku per akun
--   - dash_radar_state ikut mengembalikan "nicheAt" (riset niche terakhir per akun), supaya tick yang
--     sepi tidak butuh query tambahan untuk menentukan akun mana yang perlu diriset
--
-- ADITIF dan idempoten. Prasyarat: sql/006_autopilot_radar.sql.
-- Jalankan MANUAL di SQL Editor Supabase oleh pemilik. Tanpa berkas ini riset niche dilewati dan ide
-- tetap disusun dari tren umum seperti sebelumnya.
-- =============================================================================

ALTER TABLE "TrendSignal" DROP CONSTRAINT IF EXISTS "TrendSignal_source_check";
ALTER TABLE "TrendSignal" ADD CONSTRAINT "TrendSignal_source_check"
  CHECK (source IN ('JARINGAN', 'GTRENDS', 'WEB', 'THREADS_SEARCH', 'MOMEN', 'MANUAL', 'NICHE'));

CREATE INDEX IF NOT EXISTS "TrendSignal_niche_idx" ON "TrendSignal" ("accountId", "capturedAt" DESC)
  WHERE source = 'NICHE';

-- Sinyal NICHE yang masih berlaku untuk akun-akun tertentu, paling baru dulu, maks p_per per akun.
CREATE OR REPLACE FUNCTION dash_radar_niche(p_account_ids text[], p_now timestamp, p_per int) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t) - 'rn' ORDER BY t."accountId", t.rn), '[]'::jsonb) FROM (
    SELECT s.id, s."workspaceId", s.source, s.title, s.summary, s.url, s.rank, s.score, s."accountId",
           s."capturedAt", s."expiresAt", s."createdBy",
           ROW_NUMBER() OVER (PARTITION BY s."accountId" ORDER BY s."capturedAt" DESC, s.score DESC, s.id) AS rn
    FROM "TrendSignal" s
    WHERE s.source = 'NICHE' AND s."accountId" = ANY(p_account_ids[1:200]) AND s."expiresAt" > p_now
  ) t WHERE t.rn <= LEAST(GREATEST(p_per, 1), 30)
$$;

-- Sama dengan versi sql/006, ditambah "nicheAt": {accountId: capturedAt terbaru} dari sinyal NICHE yang berlaku.
CREATE OR REPLACE FUNCTION dash_radar_state(p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'lastCapture', (
      SELECT COALESCE(jsonb_object_agg(t.source, t.at), '{}'::jsonb) FROM (
        SELECT source, MAX("capturedAt") AS at FROM "TrendSignal" GROUP BY source
      ) t),
    'ideaCounts', (
      SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) FROM (
        SELECT "accountId", COUNT(*)::int AS baru
        FROM "ContentIdea" WHERE status = 'BARU' AND "expiresAt" > p_now
        GROUP BY "accountId"
      ) c),
    'nicheAt', (
      SELECT COALESCE(jsonb_object_agg(n."accountId", n.at), '{}'::jsonb) FROM (
        SELECT "accountId", MAX("capturedAt") AS at FROM "TrendSignal"
        WHERE source = 'NICHE' AND "accountId" IS NOT NULL AND "expiresAt" > p_now
        GROUP BY "accountId"
      ) n)
  )
$$;

REVOKE ALL ON FUNCTION dash_radar_niche(text[], timestamp, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_radar_niche(text[], timestamp, int) TO service_role;
REVOKE ALL ON FUNCTION dash_radar_state(timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_radar_state(timestamp) TO service_role;
