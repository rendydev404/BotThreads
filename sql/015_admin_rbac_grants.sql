-- =============================================================================
-- Perbaikan sql/014_admin_rbac.sql: fungsi baru (dash_sa_roles, dash_sa_staff, dash_sa_role_upsert,
-- dash_sa_role_delete, dash_sa_user_platform_role, dash_sa_user_create, dash_sa_user_update, ...)
-- tertolak untuk server dashboard dengan
--   permission denied for function ... (42501)
--
-- Penyebab: versi awal sql/014 mencabut hak eksekusi dari PUBLIC tanpa memberikannya lagi ke
-- service_role (berkas sebelumnya selalu melakukan keduanya). sql/014 sudah diperbaiki untuk pemasangan
-- baru; berkas ini memperbaiki database yang sudah menjalankan versi awalnya.
--
-- ADITIF dan idempoten. Jalankan MANUAL di Supabase SQL Editor.
-- =============================================================================

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'dash\_sa\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
