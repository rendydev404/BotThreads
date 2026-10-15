-- =============================================================================
-- Pemetaan posting untuk akun Threads yang dihubungkan dari dashboard.
--
-- Worker penerbit (auto-suka) hanya memposting lewat akun yang punya "cabang" (Outlet) dan penghubung
-- cabang -> akun (SocialAccount, platform THREADS). Saat akun dihubungkan dari BotThreads, dashboard
-- membuat satu cabang tersembunyi khusus akun itu (kode TH-<USERNAME>).
--
-- Sebelumnya dashboard menulis langsung ke tabel "Outlet"/"SocialAccount", padahal service_role tidak
-- punya izin atas tabel milik worker itu ("permission denied for table Outlet"): akun tersimpan tetapi
-- tidak bisa dipakai posting. Berkas ini memindahkan langkah itu ke satu fungsi SECURITY DEFINER yang
-- sempit, lalu memperbaiki akun yang sudah terlanjur terhubung tanpa pemetaan.
--
-- ADITIF dan idempoten. Jalankan MANUAL di Supabase SQL Editor.
-- =============================================================================

-- Pastikan akun punya cabang + penghubung untuk posting. Idempoten: memanggil ulang tidak menggandakan.
-- Hasil: { status: OK | NOT_FOUND, outletId?, socialAccountId?, created? }
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
  IF NOT FOUND THEN
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

-- Perbaikan data: akun yang dihubungkan dari dashboard (workspace buatan dashboard, id diawali "dws_")
-- tetapi belum punya pemetaan karena galat izin di atas. Akun milik worker sendiri tidak disentuh.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT ta.id FROM "ThreadsAccount" ta
    WHERE ta."workspaceId" LIKE 'dws\_%'
      AND NOT EXISTS (SELECT 1 FROM "SocialAccount" sa WHERE sa."threadsAccountId" = ta.id)
  LOOP
    PERFORM dash_tc_publish_map(r.id, (now() AT TIME ZONE 'UTC')::timestamp);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
