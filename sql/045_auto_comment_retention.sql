-- Auto Komentar (sql/043): batas simpan data pihak ketiga dan penghapusan per akun.
-- Riwayat target memuat username penulis dan potongan postingan orang lain. Riwayat dipakai untuk cooldown
-- penulis dan "satu komentar per postingan", jadi disimpan paling lama 90 hari (cooldown maksimum ikut 90).

UPDATE "BtAutoCommentConfig" SET "cooldownDays" = 90 WHERE "cooldownDays" > 90;
ALTER TABLE "BtAutoCommentConfig" DROP CONSTRAINT IF EXISTS "BtAutoCommentConfig_cooldownDays_check";
ALTER TABLE "BtAutoCommentConfig" ADD CONSTRAINT "BtAutoCommentConfig_cooldownDays_check" CHECK ("cooldownDays" BETWEEN 14 AND 90);

CREATE INDEX IF NOT EXISTS "BtAutoCommentTarget_umur_idx" ON "BtAutoCommentTarget" ("createdAt");

-- Hapus semua data Auto Komentar satu akun (akun dihapus dari dashboard / permintaan hapus data dari Meta).
CREATE OR REPLACE FUNCTION dash_acmt_forget_account(p_account text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  DELETE FROM "BtAutoCommentTarget" WHERE "accountId" = p_account;
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM "BtAutoCommentRun" WHERE "accountId" = p_account;
  DELETE FROM "BtAutoCommentSetting" WHERE "accountId" = p_account;
  RETURN n;
END
$$;

-- Buang riwayat target yang lebih tua dari 90 hari (dipanggil mesin Auto Komentar, paling sering tiap 6 jam).
CREATE OR REPLACE FUNCTION dash_acmt_prune(p_now timestamp) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  DELETE FROM "BtAutoCommentTarget" WHERE "createdAt" < p_now - interval '90 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM "BtAutoCommentRun" WHERE "dayKey" < (p_now - interval '90 days')::date;
  RETURN n;
END
$$;

REVOKE ALL ON FUNCTION dash_acmt_forget_account(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_acmt_forget_account(text) TO service_role;
REVOKE ALL ON FUNCTION dash_acmt_prune(timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_acmt_prune(timestamp) TO service_role;

NOTIFY pgrst, 'reload schema';
