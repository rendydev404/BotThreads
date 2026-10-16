-- =============================================================================
-- Perbaikan race "pemilik terakhir" di workspace (write skew).
--
-- dash_mu_member_set / dash_mu_member_remove hanya mengunci baris anggota yang diubah, lalu menghitung
-- jumlah pemilik. Dua pemilik yang saling menurunkan atau mengeluarkan pada saat bersamaan sama-sama
-- melihat 2 pemilik, keduanya lolos, dan workspace tersisa tanpa pemilik. Berkas ini mendefinisikan ulang
-- kedua fungsi dengan kunci advisory per workspace di awal transaksi; isi lainnya sama dengan sql/008.
--
-- ADITIF dan idempoten. Prasyarat: sql/008_multiuser.sql. Jalankan MANUAL di SQL Editor Supabase.
-- =============================================================================

CREATE OR REPLACE FUNCTION dash_mu_member_set(
  p_workspace text, p_target text, p_role text, p_account_ids text[], p_actor text, p_now timestamp
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old text; v_actor text; v_scope text := CASE WHEN p_account_ids IS NULL THEN 'SEMUA' ELSE 'PILIHAN' END;
BEGIN
  -- Satu kunci per workspace untuk semua perubahan peran/keanggotaan: tanpa ini dua pemilik yang saling
  -- menurunkan/mengeluarkan serentak sama-sama melihat "masih ada 2 pemilik" dan workspace tersisa tanpa pemilik.
  PERFORM pg_advisory_xact_lock(hashtext('dash_ws_member:' || p_workspace));
  SELECT role INTO v_old FROM "DashboardMembership" WHERE "userId" = p_target AND "workspaceId" = p_workspace FOR UPDATE;
  IF v_old IS NULL THEN RETURN 'NOT_FOUND'; END IF;
  SELECT role INTO v_actor FROM "DashboardMembership" WHERE "userId" = p_actor AND "workspaceId" = p_workspace;
  IF (v_old = 'OWNER' OR p_role = 'OWNER') AND v_actor IS DISTINCT FROM 'OWNER' THEN RETURN 'FORBIDDEN'; END IF;
  IF v_old = 'OWNER' AND p_role <> 'OWNER' AND
     (SELECT COUNT(*) FROM "DashboardMembership" m JOIN "DashboardUser" u ON u.id = m."userId"
      WHERE m."workspaceId" = p_workspace AND m.role = 'OWNER' AND u."isActive") <= 1 THEN
    RETURN 'LAST_OWNER';
  END IF;
  -- Pemilik selalu melihat semua akun.
  IF p_role = 'OWNER' THEN v_scope := 'SEMUA'; END IF;

  UPDATE "DashboardMembership" SET role = p_role, "accountScope" = v_scope, "updatedAt" = p_now
  WHERE "userId" = p_target AND "workspaceId" = p_workspace;
  DELETE FROM "DashboardMemberAccount" WHERE "userId" = p_target AND "workspaceId" = p_workspace;
  IF v_scope = 'PILIHAN' THEN
    INSERT INTO "DashboardMemberAccount" ("userId", "workspaceId", "accountId")
    SELECT p_target, p_workspace, ta.id FROM "ThreadsAccount" ta
    WHERE ta.id = ANY(p_account_ids) AND dash_ap_tenant_of(ta."workspaceId") = p_workspace;
  END IF;
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (p_workspace, p_actor, 'ANGGOTA_UBAH', p_target,
          jsonb_build_object('dari', v_old, 'ke', p_role, 'lingkup', v_scope), p_now);
  RETURN 'OK';
END
$$;

CREATE OR REPLACE FUNCTION dash_mu_member_remove(p_workspace text, p_target text, p_actor text, p_now timestamp)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old text; v_actor text;
BEGIN
  -- Satu kunci per workspace untuk semua perubahan peran/keanggotaan: tanpa ini dua pemilik yang saling
  -- menurunkan/mengeluarkan serentak sama-sama melihat "masih ada 2 pemilik" dan workspace tersisa tanpa pemilik.
  PERFORM pg_advisory_xact_lock(hashtext('dash_ws_member:' || p_workspace));
  SELECT role INTO v_old FROM "DashboardMembership" WHERE "userId" = p_target AND "workspaceId" = p_workspace FOR UPDATE;
  IF v_old IS NULL THEN RETURN 'NOT_FOUND'; END IF;
  SELECT role INTO v_actor FROM "DashboardMembership" WHERE "userId" = p_actor AND "workspaceId" = p_workspace;
  IF v_old = 'OWNER' AND v_actor IS DISTINCT FROM 'OWNER' THEN RETURN 'FORBIDDEN'; END IF;
  IF v_old = 'OWNER' AND
     (SELECT COUNT(*) FROM "DashboardMembership" m JOIN "DashboardUser" u ON u.id = m."userId"
      WHERE m."workspaceId" = p_workspace AND m.role = 'OWNER' AND u."isActive") <= 1 THEN
    RETURN 'LAST_OWNER';
  END IF;
  DELETE FROM "DashboardMemberAccount" WHERE "userId" = p_target AND "workspaceId" = p_workspace;
  DELETE FROM "DashboardMembership" WHERE "userId" = p_target AND "workspaceId" = p_workspace;
  UPDATE "DashboardUser" SET "lastWorkspaceId" = NULL WHERE id = p_target AND "lastWorkspaceId" = p_workspace;
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (p_workspace, p_actor, 'ANGGOTA_KELUAR', p_target, jsonb_build_object('peran', v_old), p_now);
  RETURN 'OK';
END
$$;

-- ------------------------------------------------------------------ hak akses

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('dash_mu_member_set', 'dash_mu_member_remove')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
