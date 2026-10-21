-- =============================================================================
-- Ganti ide lama setelah agen menyusun ide baru (pengaturan akun diubah atau tombol "Cari ide lagi").
--
-- ADITIF dan idempoten. Prasyarat: sql/006_autopilot_radar.sql.
-- Ide BARU yang belum disematkan dan dibuat sebelum agen mulai berjalan dianggap dari pengaturan lama:
-- dipindah ke KEDALUWARSA (tab "Tidak dipakai"), supaya autopilot hanya memakai ide yang sesuai pengaturan
-- terbaru. Hanya dipanggil SETELAH ide baru berhasil masuk, jadi bank ide tidak pernah dikosongkan.
-- =============================================================================

CREATE OR REPLACE FUNCTION dash_idea_retire_before(p_account_id text, p_before timestamp, p_now timestamp) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE "ContentIdea" i SET status = 'KEDALUWARSA', "updatedAt" = p_now
  WHERE i."accountId" = p_account_id
    AND i.status = 'BARU'
    AND i."pinnedBy" IS NULL
    AND i."createdAt" < p_before;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
REVOKE ALL ON FUNCTION dash_idea_retire_before(text, timestamp, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_idea_retire_before(text, timestamp, timestamp) TO service_role;

NOTIFY pgrst, 'reload schema';
