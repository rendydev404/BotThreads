-- =============================================================================
-- Bank ide: ide lama yang tidak menumpang tren niche diganti begitu ide tren niche baru masuk.
--
--   dash_idea_retire_stale  tandai KEDALUWARSA ide BARU satu akun yang dibuat sebelum p_before, tidak
--                           disematkan pengguna, dan tidak merujuk sinyal NICHE. Dipanggil autopilot
--                           setelah ide tren niche baru tersimpan, supaya bank ide tidak dipenuhi ide
--                           lama yang generik atau tren umum yang sudah basi.
--
-- ADITIF dan idempoten. Prasyarat: sql/006_autopilot_radar.sql dan sql/027_radar_niche_trends.sql.
-- Jalankan MANUAL di SQL Editor Supabase oleh pemilik. Tanpa berkas ini ide lama tetap ada sampai masa
-- berlakunya habis (ide tren tetap didahulukan saat memilih topik).
--
-- Indeks yang dipakai (sudah ada): ContentIdea_pilih_idx ("accountId", status, ...), primary key TrendSignal.
-- =============================================================================

CREATE OR REPLACE FUNCTION dash_idea_retire_stale(p_account_id text, p_before timestamp, p_now timestamp) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE "ContentIdea" i SET status = 'KEDALUWARSA', "updatedAt" = p_now
  WHERE i."accountId" = p_account_id
    AND i.status = 'BARU'
    AND i."pinnedBy" IS NULL
    AND i."createdAt" < p_before
    AND NOT EXISTS (
      SELECT 1 FROM "TrendSignal" s WHERE s.id = ANY(i."signalIds") AND s.source = 'NICHE'
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

REVOKE ALL ON FUNCTION dash_idea_retire_stale(text, timestamp, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_idea_retire_stale(text, timestamp, timestamp) TO service_role;
