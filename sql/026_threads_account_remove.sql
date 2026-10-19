-- =============================================================================
-- Hapus (lepas) akun Threads dari workspace lewat dashboard, supaya slot kuota paket kosong lagi.
--
-- Satu fungsi SECURITY DEFINER yang sempit, karena tabel worker (SocialAccount, Outlet, PostDispatch) tidak
-- bisa ditulis service_role. Urutan dalam satu transaksi:
--   1. Posting yang masih antre lewat akun ini ditandai GAGAL (worker tidak mencoba menerbitkannya).
--   2. Slot Autopilot yang belum terbit dibatalkan; konfigurasi Autopilot, saklar balas komentar, dan
--      pembatasan akses anggota untuk akun ini dihapus.
--   3. Penghubung posting (SocialAccount) dihapus dan cabang tersembunyinya (Outlet TH-<USERNAME>)
--      dinonaktifkan. Riwayat posting tetap ada (PostDispatch."socialAccountId" menjadi NULL).
--   4. Baris ThreadsAccount dihapus (statistik akun ikut terhapus lewat ON DELETE CASCADE milik worker).
--
-- Hanya akun milik workspace itu sendiri; akun workspace lain dalam kelompok tenant tidak bisa dihapus dari sini.
-- dash_tc_publish_map diperbarui: cabang yang dinonaktifkan dihidupkan lagi saat akun dihubungkan ulang.
--
-- Kuota akun mengikuti paket yang berlaku sekarang (dash_plan_over_quota): akun terbaru di atas kuota
-- dihentikan, dan dash_publish_accounts membawa tandanya ("overQuota") supaya posting, Autopilot, dan balas
-- komentar ikut berhenti tanpa kueri tambahan.
--
-- ADITIF dan idempoten. Prasyarat: sql/003, sql/005, sql/008, sql/011, sql/016. Jalankan MANUAL di SQL Editor Supabase.
-- =============================================================================

-- Hasil: { status: OK | NOT_FOUND | BUKAN_MILIK, username?, dibatalkan? }
CREATE OR REPLACE FUNCTION dash_tc_remove(p_workspace text, p_account text, p_user text, p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ta record;
  v_sa text;
  v_outlet text;
  v_dispatch integer := 0;
  v_slot integer := 0;
BEGIN
  SELECT id, "workspaceId", username INTO ta FROM "ThreadsAccount" WHERE id = p_account FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'NOT_FOUND'); END IF;
  IF ta."workspaceId" <> p_workspace THEN RETURN jsonb_build_object('status', 'BUKAN_MILIK'); END IF;

  SELECT id, "outletId" INTO v_sa, v_outlet FROM "SocialAccount" WHERE "threadsAccountId" = ta.id;
  IF v_sa IS NOT NULL THEN
    UPDATE "PostDispatch" SET status = 'GAGAL', "pesanError" = 'Akun Threads dihapus dari dashboard.', "updatedAt" = p_now
    WHERE "socialAccountId" = v_sa AND status IN ('DRAF', 'MENUNGGU');
    GET DIAGNOSTICS v_dispatch = ROW_COUNT;
  END IF;

  UPDATE "AutopilotSlot" SET status = 'DIBATALKAN', "skipReason" = 'Akun Threads dihapus.', "leaseUntil" = NULL, "updatedAt" = p_now
  WHERE "accountId" = ta.id AND status IN ('DIRENCANAKAN', 'MENULIS', 'MENUNGGU_TINJAU', 'TERANTRE');
  GET DIAGNOSTICS v_slot = ROW_COUNT;
  DELETE FROM "AutopilotConfig" WHERE "accountId" = ta.id;
  DELETE FROM "DashboardMemberAccount" WHERE "accountId" = ta.id;
  IF to_regclass('"ThreadsReplySetting"') IS NOT NULL THEN
    EXECUTE 'DELETE FROM "ThreadsReplySetting" WHERE "accountId" = $1' USING ta.id;
  END IF;

  IF v_sa IS NOT NULL THEN
    DELETE FROM "SocialAccount" WHERE id = v_sa;
    -- Cabang tersembunyi khusus akun ini (dibuat dash_tc_publish_map): nonaktifkan bila tidak dipakai akun lain.
    UPDATE "Outlet" o SET "isActive" = false, "updatedAt" = p_now
    WHERE o.id = v_outlet AND o.kode LIKE 'TH-%'
      AND NOT EXISTS (SELECT 1 FROM "SocialAccount" s WHERE s."outletId" = o.id);
  END IF;

  DELETE FROM "ThreadsAccount" WHERE id = ta.id;

  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (p_workspace, p_user, 'THREADS_HAPUS', ta.id,
          jsonb_build_object('username', ta.username, 'postinganDibatalkan', v_dispatch, 'slotDibatalkan', v_slot), p_now);

  RETURN jsonb_build_object('status', 'OK', 'username', ta.username, 'dibatalkan', v_dispatch + v_slot);
END
$$;

REVOKE ALL ON FUNCTION dash_tc_remove(text, text, text, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_tc_remove(text, text, text, timestamp) TO service_role;

-- Sama dengan sql/016, ditambah: cabang yang dinonaktifkan saat akun dihapus dihidupkan lagi saat dihubungkan ulang.
CREATE OR REPLACE FUNCTION dash_tc_publish_map(p_account text, p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ta record;
  v_kode text;
  v_outlet text;
  v_sa text;
BEGIN
  SELECT id, "workspaceId", username, COALESCE(NULLIF(btrim("displayName"), ''), username) AS nama
    INTO ta FROM "ThreadsAccount" WHERE id = p_account;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'NOT_FOUND'); END IF;

  SELECT id, "outletId" INTO v_sa, v_outlet FROM "SocialAccount" WHERE "threadsAccountId" = ta.id;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'OK', 'outletId', v_outlet, 'socialAccountId', v_sa, 'created', false);
  END IF;

  v_kode := upper(left('TH-' || ta.username, 40));
  SELECT id INTO v_outlet FROM "Outlet" WHERE "workspaceId" = ta."workspaceId" AND kode = v_kode;
  IF FOUND THEN
    UPDATE "Outlet" SET "isActive" = true, "updatedAt" = p_now WHERE id = v_outlet AND NOT "isActive";
  ELSE
    -- id diisi eksplisit: tabel milik worker dibuat Prisma (id dibuat aplikasi, tanpa default database).
    v_outlet := gen_random_uuid()::text;
    INSERT INTO "Outlet" (id, "workspaceId", nama, kode, cluster, "isActive", "createdAt", "updatedAt")
    VALUES (v_outlet, ta."workspaceId", left(ta.nama, 80), v_kode, 'Threads', true, p_now, p_now);
  END IF;

  v_sa := gen_random_uuid()::text;
  INSERT INTO "SocialAccount" (id, "outletId", platform, handle, "threadsAccountId", "isConnected", "createdAt", "updatedAt")
  VALUES (v_sa, v_outlet, 'THREADS', '@' || ta.username, ta.id, true, p_now, p_now);

  RETURN jsonb_build_object('status', 'OK', 'outletId', v_outlet, 'socialAccountId', v_sa, 'created', true);
END
$$;

REVOKE ALL ON FUNCTION dash_tc_publish_map(text, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_tc_publish_map(text, timestamp) TO service_role;

-- Akun yang melebihi kuota akun paket tenantnya, dihitung langsung dari paket yang berlaku sekarang (paket
-- workspace dari billing, atau paket bawaan). Bila super admin menurunkan "maxAkun" (mis. 10 -> 5) atau
-- workspace pindah ke paket lebih kecil, akun terlama tetap jalan dan akun terbaru di atas kuota dihentikan
-- (posting, Autopilot, balas komentar) sampai akun dihapus atau paket dinaikkan. Hanya tenant dashboard
-- (punya anggota); workspace milik worker sendiri tidak disentuh. Hasil: larik id akun.
CREATE OR REPLACE FUNCTION dash_plan_over_quota() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH acc AS (
    SELECT ta.id, COALESCE(g."groupId", ta."workspaceId") AS tenant, ta."createdAt"
    FROM "ThreadsAccount" ta
    LEFT JOIN "DashboardWorkspaceGroup" g ON g."workspaceId" = ta."workspaceId"
  ), cap AS (
    SELECT t.tenant, p."maxAkun"
    FROM (SELECT DISTINCT tenant FROM acc) t
    LEFT JOIN "WorkspaceSettings" s ON s."workspaceId" = t.tenant
    JOIN "Plan" p ON p.id = COALESCE(s."planId", (SELECT "planBawaan" FROM "PlatformSettings" WHERE id = 1))
    WHERE EXISTS (SELECT 1 FROM "DashboardMembership" m WHERE m."workspaceId" = t.tenant)
  ), ranked AS (
    SELECT acc.id, cap."maxAkun", row_number() OVER (PARTITION BY acc.tenant ORDER BY acc."createdAt", acc.id) AS urut
    FROM acc JOIN cap ON cap.tenant = acc.tenant
  )
  SELECT COALESCE(jsonb_agg(id ORDER BY id), '[]'::jsonb) FROM ranked WHERE urut > "maxAkun"
$$;

REVOKE ALL ON FUNCTION dash_plan_over_quota() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_plan_over_quota() TO service_role;

-- Sama dengan sql/003, ditambah "overQuota" (dash_plan_over_quota) supaya kesiapan akun memuat kuota paket
-- dalam satu perjalanan ke database.
CREATE OR REPLACE FUNCTION dash_publish_accounts() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH over AS (SELECT jsonb_array_elements_text(dash_plan_over_quota()) AS id)
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT ta.id, ta.username, ta."displayName", ta."avatarUrl", ta."needsReconnect",
           ta."accessExpiresAt", ta.scopes,
           sa.id AS "socialAccountId", o.id AS "outletId", o.nama AS "outletNama",
           o."isActive" AS "outletActive", o."workspaceId",
           EXISTS (SELECT 1 FROM over WHERE over.id = ta.id) AS "overQuota"
    FROM "ThreadsAccount" ta
    LEFT JOIN "SocialAccount" sa ON sa."threadsAccountId" = ta.id
    LEFT JOIN "Outlet" o ON o.id = sa."outletId"
    ORDER BY ta."displayName" ASC, ta.id ASC
  ) t
$$;

NOTIFY pgrst, 'reload schema';
