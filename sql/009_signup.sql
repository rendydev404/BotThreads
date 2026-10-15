-- =============================================================================
-- Pendaftaran mandiri (PRD Fase 5, bagian pertama): pengguna baru membuat akun dan workspace sendiri.
--
-- ADITIF dan idempoten. Prasyarat: sql/005 dan sql/008 sudah dijalankan. Jalankan MANUAL di SQL Editor
-- Supabase oleh pemilik. Tidak menyentuh tabel milik auto-suka.
--
-- Workspace hasil pendaftaran adalah tenant dashboard murni: id-nya berawalan "dws_" dan TIDAK punya
-- baris di tabel "Workspace" auto-suka, jadi belum punya akun Threads sampai akun dihubungkan lewat
-- SukaPost dan workspace SukaPost-nya dimasukkan ke kelompok tenant ini ("DashboardWorkspaceGroup").
--
-- Keamanan sama dengan fungsi dash_* lain: SECURITY DEFINER, search_path dikunci, hanya service_role.
-- =============================================================================

-- Buat pengguna + workspace + keanggotaan Pemilik dalam satu transaksi.
-- p_user: { username, email, name?, passwordHash }. Hasil: { status: 'OK'|'EMAIL'|'USERNAME', userId?,
-- passwordHash?, workspaceId? }. Email dan username dibandingkan tanpa membedakan huruf besar/kecil.
CREATE OR REPLACE FUNCTION dash_mu_signup(p_user jsonb, p_brand text, p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_email text := lower(btrim(p_user->>'email'));
  v_username text := lower(btrim(p_user->>'username'));
  v_brand text := NULLIF(btrim(p_brand), '');
  v_user text;
  v_hash text;
  v_ws text := 'dws_' || replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF v_email IS NULL OR v_email = '' OR v_username IS NULL OR v_username = '' OR v_brand IS NULL
     OR COALESCE(p_user->>'passwordHash', '') = '' THEN
    RAISE EXCEPTION 'data pendaftaran tidak lengkap' USING ERRCODE = '22023';
  END IF;
  -- Satu kunci per email/username supaya dua pendaftaran serentak tidak lolos bersama.
  PERFORM pg_advisory_xact_lock(hashtext('dash_signup:' || v_email));
  PERFORM pg_advisory_xact_lock(hashtext('dash_signup:' || v_username));
  IF EXISTS (SELECT 1 FROM "DashboardUser" WHERE lower(email) = v_email) THEN
    RETURN jsonb_build_object('status', 'EMAIL');
  END IF;
  IF EXISTS (SELECT 1 FROM "DashboardUser" WHERE lower(username) = v_username) THEN
    RETURN jsonb_build_object('status', 'USERNAME');
  END IF;

  -- id diisi eksplisit: tabel dibuat Prisma (@default(uuid()) di sisi aplikasi), kolomnya tanpa default database.
  INSERT INTO "DashboardUser" (id, username, email, name, "passwordHash", "isActive", "lastWorkspaceId", "updatedAt")
  VALUES (gen_random_uuid()::text, v_username, v_email, NULLIF(btrim(p_user->>'name'), ''), p_user->>'passwordHash', true, v_ws, p_now)
  RETURNING id, "passwordHash" INTO v_user, v_hash;

  INSERT INTO "DashboardMembership" ("userId", "workspaceId", role) VALUES (v_user, v_ws, 'OWNER');
  INSERT INTO "WorkspaceSettings" ("workspaceId", "namaBrand", "updatedBy", "updatedAt") VALUES (v_ws, LEFT(v_brand, 80), v_user, p_now);
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (v_ws, v_user, 'DAFTAR', v_user, jsonb_build_object('brand', LEFT(v_brand, 80)), p_now);

  RETURN jsonb_build_object('status', 'OK', 'userId', v_user, 'passwordHash', v_hash, 'workspaceId', v_ws);
END
$$;

REVOKE ALL ON FUNCTION dash_mu_signup(jsonb, text, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_mu_signup(jsonb, text, timestamp) TO service_role;

NOTIFY pgrst, 'reload schema';
