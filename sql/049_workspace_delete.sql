-- =============================================================================
-- Hapus workspace (tenant dashboard) dari Konsol Super Admin: /admin/workspace.
--
-- Urutan dalam SATU transaksi (gagal di tengah = tidak ada yang berubah):
--   1. PUTUS DARI AKUN BUZZER / SUMBER LAIN. Workspace lain yang menumpang di kelompok tenant ini (mis.
--      "Suka Shawarma Buzzer") dilepas, BUKAN dihapus. Data per-akun mereka yang tersimpan atas nama tenant
--      ini (konfigurasi Autopilot, ide konten, gaya, komentar, dll.) dipindah ke workspace asal akunnya,
--      Autopilot akun itu dimatikan dan slot yang baru direncanakan dibuang (sama dengan "lepas tautan" di
--      modul Sumber Akun). Akun Threads milik workspace ini sendiri dikeluarkan dari pasukan buzzer: profil
--      buzzernya dihapus dan tugas buzzer yang masih terjadwal (sebagai buzzer maupun sebagai target) dibatalkan.
--   2. Akun Threads milik workspace ini dihapus lewat dash_tc_remove (urutan aman yang sama dengan hapus akun
--      di dashboard: antrean posting digagalkan, slot Autopilot dibatalkan, penghubung posting dilepas).
--   3. Data dashboard workspace dihapus: anggota, undangan, pengaturan, paket, ide, Autopilot, komentar, dll.
--      Tagihan yang masih menunggu dibatalkan. Riwayat yang dipertahankan: tagihan (catatan keuangan),
--      log audit, serta tabel milik worker (Outlet, ScheduledPost) supaya riwayat posting tetap utuh.
--
-- Konfirmasi: p_confirm wajib sama dengan nama workspace (tanpa beda huruf besar-kecil).
-- ADITIF dan idempoten. Prasyarat: sql/010, sql/011, sql/012, sql/026, sql/029.
-- =============================================================================

-- Tabel yang punya kolom ini? (tabel opsional boleh belum dipasang di database lama)
CREATE OR REPLACE FUNCTION dash_sa__has_col(p_table text, p_col text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_col
  )
$$;

-- Gambaran dampak sebelum menghapus (untuk dialog konfirmasi).
-- Hasil: null bila tidak ada | { id, nama, anggota, akun, buzzer, tugasBuzzer, tagihanMenunggu, paket, bagianKelompok,
--         dilepas: [{ id, nama, akun, autopilotAktif }] }
CREATE OR REPLACE FUNCTION dash_sa_workspace_delete_preview(p_actor text, p_ws text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_own text[];
  v_linked text[];
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RAISE EXCEPTION 'BUKAN_SUPERADMIN' USING ERRCODE = '42501'; END IF;
  IF NOT dash_sa_tenant_exists(p_ws) THEN RETURN NULL; END IF;

  SELECT COALESCE(array_agg(id), '{}') INTO v_own FROM "ThreadsAccount" WHERE "workspaceId" = p_ws;
  SELECT COALESCE(array_agg("workspaceId"), '{}') INTO v_linked
  FROM "DashboardWorkspaceGroup" WHERE "groupId" = p_ws AND "workspaceId" <> p_ws;

  RETURN jsonb_build_object(
    'id', p_ws,
    'nama', (SELECT COALESCE(s."namaBrand", w.nama, p_ws) FROM (SELECT 1) x
             LEFT JOIN "WorkspaceSettings" s ON s."workspaceId" = p_ws
             LEFT JOIN "Workspace" w ON w.id = p_ws),
    'anggota', (SELECT count(*) FROM "DashboardMembership" WHERE "workspaceId" = p_ws),
    'akun', cardinality(v_own),
    'buzzer', (SELECT count(*) FROM "BuzzerProfile" WHERE "accountId" = ANY(v_own)),
    'tugasBuzzer', (SELECT count(*) FROM "BuzzerTask" t
                    WHERE t.status = 'TERJADWAL'
                      AND (t."buzzerAccountId" = ANY(v_own)
                           OR t."campaignId" IN (SELECT id FROM "BuzzerCampaign" WHERE "targetAccountId" = ANY(v_own)))),
    'tagihanMenunggu', (SELECT count(*) FROM "SubscriptionInvoice" WHERE "workspaceId" = p_ws AND status = 'PENDING'),
    'paket', (SELECT "planId" FROM "WorkspaceSettings" WHERE "workspaceId" = p_ws),
    'bagianKelompok', EXISTS (SELECT 1 FROM "DashboardWorkspaceGroup" WHERE "workspaceId" = p_ws AND "groupId" <> p_ws),
    'dilepas', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', w.id,
               'nama', COALESCE(w.nama, g."workspaceId"),
               'akun', (SELECT count(*) FROM "ThreadsAccount" ta WHERE ta."workspaceId" = g."workspaceId"),
               'autopilotAktif', (SELECT count(*) FROM "AutopilotConfig" c
                                  JOIN "ThreadsAccount" ta ON ta.id = c."accountId"
                                  WHERE ta."workspaceId" = g."workspaceId" AND c.mode <> 'MATI')
             ) ORDER BY COALESCE(w.nama, g."workspaceId")), '[]'::jsonb)
      FROM "DashboardWorkspaceGroup" g
      LEFT JOIN "Workspace" w ON w.id = g."workspaceId"
      WHERE g."workspaceId" = ANY(v_linked)
    )
  );
END
$$;

-- Hasil: { status: OK | FORBIDDEN | NOT_FOUND | NAMA_SALAH | BAGIAN_KELOMPOK, nama?, akunDihapus?, dilepas?, anggota? }
CREATE OR REPLACE FUNCTION dash_sa_workspace_delete(p_actor text, p_ws text, p_confirm text, p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_nama text;
  v_own text[];
  v_linked text[];
  v_linked_acc text[];
  v_members text[];
  v_campaigns text[];
  v_dilepas jsonb;
  v_tugas integer := 0;
  v_hapus integer := 0;
  v_pair text[];
  v_tbl text;
  -- Tabel per-akun yang menyimpan "workspaceId" tenant: [tabel, kolom akun]. Dipakai untuk memindah data akun
  -- buzzer/sumber yang dilepas ke workspace asalnya.
  v_rehome text[][] := ARRAY[
    ARRAY['AccountOnboarding', 'accountId'], ARRAY['AccountStyleLesson', 'accountId'],
    ARRAY['AffiliateConfig', 'accountId'], ARRAY['AffiliateUse', 'accountId'],
    ARRAY['AutoCommentSetting', 'threadsAccountId'], ARRAY['AutopilotConfig', 'accountId'],
    ARRAY['AutopilotSlot', 'accountId'], ARRAY['BtAutoCommentRun', 'accountId'],
    ARRAY['BtAutoCommentSetting', 'accountId'], ARRAY['BtAutoCommentTarget', 'accountId'],
    ARRAY['BuzzerProfile', 'accountId'], ARRAY['ContentIdea', 'accountId'],
    ARRAY['ContentOutcome', 'accountId'], ARRAY['KnowledgeBase', 'accountId'],
    ARRAY['StyleExample', 'accountId'], ARRAY['ThreadsComment', 'accountId'],
    ARRAY['ThreadsReplySetting', 'accountId'], ARRAY['TrendSignal', 'accountId']
  ];
  -- Data dashboard yang dihapus (anak lebih dulu). Tidak termasuk: SubscriptionInvoice, DashboardAuditLog,
  -- Outlet, ScheduledPost (riwayat keuangan, audit, dan posting milik worker).
  v_purge text[] := ARRAY[
    'AutopilotSlot', 'ContentOutcome', 'AffiliateUse', 'BtAutoCommentRun', 'BtAutoCommentTarget',
    'BtAutoCommentSetting', 'BtAutoCommentConfig', 'AutoCommentSetting', 'AutopilotConfig', 'ContentIdea',
    'ContentMoment', 'AccountOnboarding', 'AccountStyleLesson', 'StyleExample', 'KnowledgeBase', 'TrendSignal',
    'ThreadsComment', 'ThreadsReplySetting', 'AffiliateConfig', 'AffiliateProduct', 'AffiliateWorkspace',
    'BuzzerProfile', 'DashboardNotification', 'DashboardMemberAccount', 'DashboardInvite', 'DashboardMembership',
    'WorkspaceSettings'
  ];
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN jsonb_build_object('status', 'FORBIDDEN'); END IF;
  IF NOT dash_sa_tenant_exists(p_ws) THEN RETURN jsonb_build_object('status', 'NOT_FOUND'); END IF;

  SELECT COALESCE(s."namaBrand", w.nama, p_ws) INTO v_nama FROM (SELECT 1) x
  LEFT JOIN "WorkspaceSettings" s ON s."workspaceId" = p_ws
  LEFT JOIN "Workspace" w ON w.id = p_ws;
  IF lower(btrim(COALESCE(p_confirm, ''))) <> lower(btrim(v_nama)) THEN
    RETURN jsonb_build_object('status', 'NAMA_SALAH');
  END IF;
  -- Workspace yang menumpang di tenant lain: akunnya tampil di tenant itu, jadi lepaskan dulu lewat Sumber Akun.
  IF EXISTS (SELECT 1 FROM "DashboardWorkspaceGroup" WHERE "workspaceId" = p_ws AND "groupId" <> p_ws) THEN
    RETURN jsonb_build_object('status', 'BAGIAN_KELOMPOK');
  END IF;

  -- Kunci kelompok supaya tidak ada tautan sumber baru di tengah penghapusan.
  PERFORM 1 FROM "DashboardWorkspaceGroup" WHERE "groupId" = p_ws FOR UPDATE;

  SELECT COALESCE(array_agg("workspaceId" ORDER BY "workspaceId"), '{}') INTO v_linked
  FROM "DashboardWorkspaceGroup" WHERE "groupId" = p_ws AND "workspaceId" <> p_ws;
  SELECT COALESCE(array_agg(id), '{}') INTO v_linked_acc FROM "ThreadsAccount" WHERE "workspaceId" = ANY(v_linked);
  SELECT COALESCE(array_agg(id), '{}') INTO v_own FROM "ThreadsAccount" WHERE "workspaceId" = p_ws;
  SELECT COALESCE(array_agg("userId"), '{}') INTO v_members FROM "DashboardMembership" WHERE "workspaceId" = p_ws;

  -- ---------------------------------------------------------------- 1a. lepas workspace buzzer/sumber
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', g."workspaceId", 'nama', COALESCE(w.nama, g."workspaceId"),
           'akun', (SELECT count(*) FROM "ThreadsAccount" ta WHERE ta."workspaceId" = g."workspaceId"))
         ORDER BY COALESCE(w.nama, g."workspaceId")), '[]'::jsonb)
    INTO v_dilepas
  FROM "DashboardWorkspaceGroup" g LEFT JOIN "Workspace" w ON w.id = g."workspaceId"
  WHERE g."workspaceId" = ANY(v_linked);

  IF cardinality(v_linked_acc) > 0 THEN
    FOREACH v_pair SLICE 1 IN ARRAY v_rehome LOOP
      IF dash_sa__has_col(v_pair[1], 'workspaceId') AND dash_sa__has_col(v_pair[1], v_pair[2]) THEN
        EXECUTE format(
          'UPDATE %I t SET "workspaceId" = ta."workspaceId" FROM "ThreadsAccount" ta
           WHERE t."workspaceId" = $1 AND ta.id = t.%I AND ta.id = ANY($2)', v_pair[1], v_pair[2])
        USING p_ws, v_linked_acc;
      END IF;
    END LOOP;
    -- Sama dengan "lepas tautan" di Sumber Akun: Autopilot dimatikan, rencana slot dibuang.
    UPDATE "AutopilotConfig" SET mode = 'MATI', "pausedReason" = NULL, "pausedAt" = NULL,
           "updatedBy" = p_actor, "updatedAt" = p_now
    WHERE "accountId" = ANY(v_linked_acc) AND mode <> 'MATI';
    DELETE FROM "AutopilotSlot" WHERE "accountId" = ANY(v_linked_acc) AND status = 'DIRENCANAKAN';
    DELETE FROM "DashboardMemberAccount" WHERE "workspaceId" = p_ws AND "accountId" = ANY(v_linked_acc);
  END IF;
  DELETE FROM "DashboardWorkspaceGroup" WHERE "workspaceId" = ANY(v_linked);
  FOR v_tbl IN SELECT unnest(v_linked) LOOP
    PERFORM dash_sa_log(p_actor, 'SUMBER_TAUTKAN', 'SUMBER', v_tbl,
                        jsonb_build_object('dari', p_ws, 'ke', v_tbl, 'alasan', 'Workspace induk dihapus',
                                           'akun', (SELECT count(*) FROM "ThreadsAccount" WHERE "workspaceId" = v_tbl)), p_now);
  END LOOP;

  -- ---------------------------------------------------------------- 1b. keluarkan akun sendiri dari pasukan buzzer
  IF cardinality(v_own) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT t."campaignId"), '{}') INTO v_campaigns
    FROM "BuzzerTask" t
    WHERE t.status = 'TERJADWAL'
      AND (t."buzzerAccountId" = ANY(v_own)
           OR t."campaignId" IN (SELECT id FROM "BuzzerCampaign" WHERE "targetAccountId" = ANY(v_own)));
    UPDATE "BuzzerTask" t SET status = 'DIBATALKAN', "lockedAt" = NULL,
           "lastError" = 'Workspace dihapus.', "updatedAt" = p_now
    WHERE t.status = 'TERJADWAL'
      AND (t."buzzerAccountId" = ANY(v_own)
           OR t."campaignId" IN (SELECT id FROM "BuzzerCampaign" WHERE "targetAccountId" = ANY(v_own)));
    GET DIAGNOSTICS v_tugas = ROW_COUNT;
    FOR v_tbl IN SELECT unnest(v_campaigns) LOOP
      PERFORM dash_buzzer_finalize(v_tbl, p_now);
    END LOOP;
    DELETE FROM "BuzzerProfile" WHERE "accountId" = ANY(v_own);
  END IF;

  -- ---------------------------------------------------------------- 2. hapus akun Threads milik workspace ini
  FOR v_tbl IN SELECT unnest(v_own) LOOP
    PERFORM dash_tc_remove(p_ws, v_tbl, p_actor, p_now);
    v_hapus := v_hapus + 1;
  END LOOP;

  -- ---------------------------------------------------------------- 3. hapus data dashboard
  FOREACH v_tbl IN ARRAY v_purge LOOP
    IF dash_sa__has_col(v_tbl, 'workspaceId') THEN
      EXECUTE format('DELETE FROM %I WHERE "workspaceId" = $1', v_tbl) USING p_ws;
    END IF;
  END LOOP;
  DELETE FROM "DashboardWorkspaceGroup" WHERE "groupId" = p_ws OR "workspaceId" = p_ws;
  UPDATE "SubscriptionInvoice" SET status = 'CANCELLED' WHERE "workspaceId" = p_ws AND status = 'PENDING';
  UPDATE "DashboardUser" SET "lastWorkspaceId" = NULL WHERE "lastWorkspaceId" = p_ws;
  -- Baris Workspace buatan dashboard (dws_*) ikut dihapus bila tidak lagi dipakai riwayat posting worker.
  IF p_ws LIKE 'dws\_%'
     AND NOT EXISTS (SELECT 1 FROM "Outlet" WHERE "workspaceId" = p_ws)
     AND NOT EXISTS (SELECT 1 FROM "ScheduledPost" WHERE "workspaceId" = p_ws)
     AND NOT EXISTS (SELECT 1 FROM "ThreadsAccount" WHERE "workspaceId" = p_ws) THEN
    DELETE FROM "Workspace" WHERE id = p_ws;
  END IF;

  PERFORM dash_sa_log(p_actor, 'WORKSPACE_HAPUS', 'WORKSPACE', p_ws,
                      jsonb_build_object('nama', v_nama, 'akunDihapus', v_hapus, 'dilepas', v_dilepas,
                                         'anggota', cardinality(v_members), 'tugasBuzzerDibatalkan', v_tugas), p_now);

  RETURN jsonb_build_object('status', 'OK', 'nama', v_nama, 'akunDihapus', v_hapus, 'dilepas', v_dilepas,
                            'anggota', cardinality(v_members), 'tugasBuzzerDibatalkan', v_tugas);
END
$$;

REVOKE ALL ON FUNCTION dash_sa__has_col(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dash_sa_workspace_delete_preview(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dash_sa_workspace_delete(text, text, text, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_sa__has_col(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION dash_sa_workspace_delete_preview(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION dash_sa_workspace_delete(text, text, text, timestamp) TO service_role;
