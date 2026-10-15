-- =============================================================================
-- Multi-user dashboard (PRD-AI-AUTOPILOT-MULTIUSER.md, Fase 4): keanggotaan workspace, peran,
-- lingkup akun, undangan, reset password, pengaturan workspace, dan daftar posting berfilter akun.
--
-- ADITIF dan idempoten. Jalankan MANUAL di SQL Editor Supabase oleh pemilik.
-- Prasyarat: sql/001 sampai sql/005 sudah dijalankan.
--
-- Yang berubah pada objek lama:
--   * DashboardUser      + kolom googleSub, lastWorkspaceId (aditif).
--   * WorkspaceSettings  + kolom brand (aditif).
--   * dash_post_list / dash_posts_by_ids / dash_post_summary mendapat parameter p_account_ids
--     (default NULL = tanpa filter, jadi kode lama tetap berjalan). Karena daftar argumen berubah,
--     tanda tangan lama di-DROP lalu dibuat ulang.
--
-- Data awal (hanya saat tabel keanggotaan masih kosong): setiap pengguna dashboard yang aktif menjadi
-- OWNER di setiap tenant (kelompok workspace, lihat DashboardWorkspaceGroup di sql/005) yang punya akun
-- Threads, supaya tidak ada yang kehilangan akses saat fitur ini dipasang. Tenant yang muncul setelah
-- itu harus digabungkan ke kelompok atau diberi pemilik secara manual (lihat README).
-- "Workspace" pada berkas ini berarti tenant itu.
--
-- Tabel pengguna (User, Membership) milik auto-suka TIDAK disentuh.
-- =============================================================================

-- ------------------------------------------------------------------ tabel

ALTER TABLE "DashboardUser" ADD COLUMN IF NOT EXISTS "googleSub" text;
ALTER TABLE "DashboardUser" ADD COLUMN IF NOT EXISTS "lastWorkspaceId" text;
CREATE UNIQUE INDEX IF NOT EXISTS "DashboardUser_googleSub_key" ON "DashboardUser" ("googleSub") WHERE "googleSub" IS NOT NULL;

ALTER TABLE "WorkspaceSettings" ADD COLUMN IF NOT EXISTS "namaBrand" text;
ALTER TABLE "WorkspaceSettings" ADD COLUMN IF NOT EXISTS "deskripsiBrand" text;
ALTER TABLE "WorkspaceSettings" ADD COLUMN IF NOT EXISTS "topikTerlarang" text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS "DashboardMembership" (
  "userId"       text NOT NULL,
  "workspaceId"  text NOT NULL,
  role           text NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER')),
  -- SEMUA = semua akun workspace; PILIHAN = hanya akun di DashboardMemberAccount.
  "accountScope" text NOT NULL DEFAULT 'SEMUA' CHECK ("accountScope" IN ('SEMUA', 'PILIHAN')),
  "createdAt"    timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updatedAt"    timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "DashboardMembership_pkey" PRIMARY KEY ("userId", "workspaceId")
);
CREATE INDEX IF NOT EXISTS "DashboardMembership_ws_idx" ON "DashboardMembership" ("workspaceId");

CREATE TABLE IF NOT EXISTS "DashboardMemberAccount" (
  "userId"      text NOT NULL,
  "workspaceId" text NOT NULL,
  "accountId"   text NOT NULL,
  CONSTRAINT "DashboardMemberAccount_pkey" PRIMARY KEY ("userId", "workspaceId", "accountId")
);

CREATE TABLE IF NOT EXISTS "DashboardInvite" (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspaceId" text NOT NULL,
  email         text NOT NULL,
  role          text NOT NULL CHECK (role IN ('ADMIN', 'EDITOR', 'VIEWER')),
  "accountIds"  text[] NOT NULL DEFAULT '{}',              -- kosong = semua akun
  -- Hanya hash token yang disimpan; token asli hanya ada di tautan undangan.
  "tokenHash"   text NOT NULL,
  "expiresAt"   timestamp(3) NOT NULL,
  "acceptedAt"  timestamp(3),
  "invitedBy"   text NOT NULL,
  "createdAt"   timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "DashboardInvite_tokenHash_key" UNIQUE ("tokenHash")
);
CREATE INDEX IF NOT EXISTS "DashboardInvite_ws_idx" ON "DashboardInvite" ("workspaceId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "DashboardPasswordReset" (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"    text NOT NULL,
  "tokenHash" text NOT NULL,
  "expiresAt" timestamp(3) NOT NULL,
  "usedAt"    timestamp(3),
  "createdBy" text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "DashboardPasswordReset_tokenHash_key" UNIQUE ("tokenHash")
);

ALTER TABLE "DashboardMembership"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DashboardMemberAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DashboardInvite"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DashboardPasswordReset" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "DashboardMembership", "DashboardMemberAccount", "DashboardInvite", "DashboardPasswordReset"
  FROM anon, authenticated;

-- ------------------------------------------------------------------ data awal

INSERT INTO "DashboardMembership" ("userId", "workspaceId", role)
SELECT u.id, w.id, 'OWNER'
FROM "DashboardUser" u
CROSS JOIN (SELECT DISTINCT dash_ap_tenant_of("workspaceId") AS id FROM "ThreadsAccount" WHERE "workspaceId" IS NOT NULL) w
WHERE u."isActive"
  -- Hanya saat pertama dipasang (belum ada keanggotaan sama sekali). Tenant yang muncul belakangan
  -- TIDAK otomatis diberi pemilik: pengguna lama tidak boleh mendadak menguasai organisasi lain.
  AND NOT EXISTS (SELECT 1 FROM "DashboardMembership")
ON CONFLICT DO NOTHING;

INSERT INTO "WorkspaceSettings" ("workspaceId", "namaBrand")
SELECT w.id, w.nama FROM "Workspace" w
WHERE EXISTS (SELECT 1 FROM "ThreadsAccount" ta WHERE dash_ap_tenant_of(ta."workspaceId") = w.id)
ON CONFLICT ("workspaceId") DO UPDATE SET "namaBrand" = COALESCE("WorkspaceSettings"."namaBrand", EXCLUDED."namaBrand");

-- ------------------------------------------------------------------ konteks pengguna

-- Semua keanggotaan pengguna beserta lingkup akunnya, dalam satu perjalanan.
CREATE OR REPLACE FUNCTION dash_mu_ctx(p_user text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'lastWorkspaceId', (SELECT u."lastWorkspaceId" FROM "DashboardUser" u WHERE u.id = p_user),
    'memberships', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.nama, t."workspaceId"), '[]'::jsonb) FROM (
        SELECT m."workspaceId", COALESCE(s."namaBrand", w.nama, m."workspaceId") AS nama, m.role, m."accountScope",
               CASE WHEN m."accountScope" = 'PILIHAN' THEN (
                 SELECT COALESCE(jsonb_agg(a."accountId"), '[]'::jsonb) FROM "DashboardMemberAccount" a
                 WHERE a."userId" = m."userId" AND a."workspaceId" = m."workspaceId")
               END AS "accountIds"
        FROM "DashboardMembership" m
        LEFT JOIN "Workspace" w ON w.id = m."workspaceId"
        LEFT JOIN "WorkspaceSettings" s ON s."workspaceId" = m."workspaceId"
        WHERE m."userId" = p_user
      ) t)
  )
$$;

CREATE OR REPLACE FUNCTION dash_mu_set_workspace(p_user text, p_workspace text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "DashboardMembership" WHERE "userId" = p_user AND "workspaceId" = p_workspace) THEN
    RETURN FALSE;
  END IF;
  UPDATE "DashboardUser" SET "lastWorkspaceId" = p_workspace WHERE id = p_user;
  RETURN TRUE;
END
$$;

-- ------------------------------------------------------------------ anggota

CREATE OR REPLACE FUNCTION dash_mu_members(p_workspace text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.rank, t.username), '[]'::jsonb) FROM (
    SELECT u.id, u.username, u.email, u.name, u."isActive", u."lastLoginAt", (u."googleSub" IS NOT NULL) AS google,
           m.role, m."accountScope",
           (SELECT COALESCE(jsonb_agg(a."accountId"), '[]'::jsonb) FROM "DashboardMemberAccount" a
            WHERE a."userId" = m."userId" AND a."workspaceId" = m."workspaceId") AS "accountIds",
           CASE m.role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 WHEN 'EDITOR' THEN 2 ELSE 3 END AS rank
    FROM "DashboardMembership" m
    JOIN "DashboardUser" u ON u.id = m."userId"
    WHERE m."workspaceId" = p_workspace
  ) t
$$;

-- Ubah peran dan lingkup akun anggota. Hasil: 'OK' | 'NOT_FOUND' | 'LAST_OWNER' | 'FORBIDDEN'.
-- Hanya OWNER yang boleh memberi atau mencabut peran OWNER; OWNER terakhir tidak bisa diturunkan.
CREATE OR REPLACE FUNCTION dash_mu_member_set(
  p_workspace text, p_target text, p_role text, p_account_ids text[], p_actor text, p_now timestamp
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old text; v_actor text; v_scope text := CASE WHEN p_account_ids IS NULL THEN 'SEMUA' ELSE 'PILIHAN' END;
BEGIN
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

-- Keluarkan anggota dari workspace. Hasil sama dengan dash_mu_member_set.
CREATE OR REPLACE FUNCTION dash_mu_member_remove(p_workspace text, p_target text, p_actor text, p_now timestamp)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old text; v_actor text;
BEGIN
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

-- ------------------------------------------------------------------ undangan

-- p_item: {workspaceId, email, role, accountIds[] (kosong = semua akun), tokenHash, expiresAt}.
-- Undangan lama yang belum diterima untuk email yang sama di workspace itu dicabut.
CREATE OR REPLACE FUNCTION dash_mu_invite_create(p_item jsonb, p_actor text, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id text;
BEGIN
  DELETE FROM "DashboardInvite"
  WHERE "workspaceId" = p_item->>'workspaceId' AND lower(email) = lower(p_item->>'email') AND "acceptedAt" IS NULL;
  INSERT INTO "DashboardInvite" ("workspaceId", email, role, "accountIds", "tokenHash", "expiresAt", "invitedBy", "createdAt")
  VALUES (p_item->>'workspaceId', lower(p_item->>'email'), p_item->>'role',
          ARRAY(SELECT ta.id FROM "ThreadsAccount" ta
                WHERE dash_ap_tenant_of(ta."workspaceId") = p_item->>'workspaceId'
                  AND ta.id IN (SELECT jsonb_array_elements_text(COALESCE(p_item->'accountIds', '[]'::jsonb)))),
          p_item->>'tokenHash', (p_item->>'expiresAt')::timestamp, p_actor, p_now)
  RETURNING id INTO v_id;
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (p_item->>'workspaceId', p_actor, 'UNDANGAN_BUAT', v_id,
          jsonb_build_object('email', lower(p_item->>'email'), 'peran', p_item->>'role'), p_now);
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION dash_mu_invites(p_workspace text, p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT id, email, role, "accountIds", "expiresAt", "createdAt", ("expiresAt" <= p_now) AS expired
    FROM "DashboardInvite"
    WHERE "workspaceId" = p_workspace AND "acceptedAt" IS NULL
    ORDER BY "createdAt" DESC LIMIT 100
  ) t
$$;

CREATE OR REPLACE FUNCTION dash_mu_invite_revoke(p_id text, p_workspace text, p_actor text, p_now timestamp) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM "DashboardInvite" WHERE id = p_id AND "workspaceId" = p_workspace AND "acceptedAt" IS NULL;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (p_workspace, p_actor, 'UNDANGAN_CABUT', p_id, '{}'::jsonb, p_now);
  RETURN TRUE;
END
$$;

-- Isi undangan yang masih berlaku (untuk halaman terima undangan); NULL bila tidak sah atau kedaluwarsa.
CREATE OR REPLACE FUNCTION dash_mu_invite_peek(p_token_hash text, p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT to_jsonb(t) FROM (
    SELECT i.email, i.role, COALESCE(s."namaBrand", w.nama, i."workspaceId") AS workspace,
           EXISTS (SELECT 1 FROM "DashboardUser" u WHERE lower(u.email) = i.email) AS "hasAccount"
    FROM "DashboardInvite" i
    LEFT JOIN "Workspace" w ON w.id = i."workspaceId"
    LEFT JOIN "WorkspaceSettings" s ON s."workspaceId" = i."workspaceId"
    WHERE i."tokenHash" = p_token_hash AND i."acceptedAt" IS NULL AND i."expiresAt" > p_now
  ) t
$$;

-- Terima undangan (sekali pakai). p_user: {username, name, passwordHash} untuk pengguna baru; untuk
-- pengguna yang emailnya sudah terdaftar, p_user diabaikan dan akunnya langsung menjadi anggota.
-- p_google_sub: tautkan akun Google (opsional). Hasil: {userId, passwordHash} atau NULL bila undangan
-- tidak sah. Username yang sudah dipakai menghasilkan galat unik (23505) untuk ditangani pemanggil.
CREATE OR REPLACE FUNCTION dash_mu_invite_accept(p_token_hash text, p_user jsonb, p_google_sub text, p_now timestamp)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE inv "DashboardInvite"%ROWTYPE; v_user text; v_hash text; v_scope text;
BEGIN
  SELECT * INTO inv FROM "DashboardInvite"
  WHERE "tokenHash" = p_token_hash AND "acceptedAt" IS NULL AND "expiresAt" > p_now FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT id, "passwordHash" INTO v_user, v_hash FROM "DashboardUser" WHERE lower(email) = inv.email;
  IF v_user IS NULL THEN
    IF COALESCE(p_user->>'username', '') = '' OR COALESCE(p_user->>'passwordHash', '') = '' THEN
      RAISE EXCEPTION 'data pengguna baru tidak lengkap' USING ERRCODE = '22023';
    END IF;
    -- id diisi eksplisit: tabel dibuat Prisma, kolomnya tanpa default database.
    INSERT INTO "DashboardUser" (id, username, email, name, "passwordHash", "isActive", "googleSub", "lastWorkspaceId", "updatedAt")
    VALUES (gen_random_uuid()::text, lower(p_user->>'username'), inv.email, NULLIF(p_user->>'name', ''), p_user->>'passwordHash', true,
            p_google_sub, inv."workspaceId", p_now)
    RETURNING id, "passwordHash" INTO v_user, v_hash;
  ELSE
    UPDATE "DashboardUser" SET "isActive" = true, "googleSub" = COALESCE("googleSub", p_google_sub),
           "lastWorkspaceId" = COALESCE("lastWorkspaceId", inv."workspaceId"), "updatedAt" = p_now
    WHERE id = v_user;
  END IF;

  -- Yang sudah menjadi anggota tidak diubah perannya oleh undangan (undangan tidak boleh menjadi
  -- jalan untuk menurunkan atau menaikkan peran orang lain); perubahan peran hanya lewat dash_mu_member_set.
  IF NOT EXISTS (SELECT 1 FROM "DashboardMembership" WHERE "userId" = v_user AND "workspaceId" = inv."workspaceId") THEN
    v_scope := CASE WHEN cardinality(inv."accountIds") > 0 THEN 'PILIHAN' ELSE 'SEMUA' END;
    INSERT INTO "DashboardMembership" ("userId", "workspaceId", role, "accountScope", "createdAt", "updatedAt")
    VALUES (v_user, inv."workspaceId", inv.role, v_scope, p_now, p_now);
    INSERT INTO "DashboardMemberAccount" ("userId", "workspaceId", "accountId")
    SELECT v_user, inv."workspaceId", unnest(inv."accountIds");
  END IF;

  UPDATE "DashboardInvite" SET "acceptedAt" = p_now WHERE id = inv.id;
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (inv."workspaceId", v_user, 'UNDANGAN_TERIMA', inv.id, jsonb_build_object('peran', inv.role), p_now);
  RETURN jsonb_build_object('userId', v_user, 'passwordHash', v_hash);
END
$$;

-- ------------------------------------------------------------------ password dan Google

-- Tautan reset dibuat admin workspace untuk anggotanya. FALSE bila target bukan anggota workspace itu.
CREATE OR REPLACE FUNCTION dash_mu_reset_create(
  p_workspace text, p_target text, p_token_hash text, p_expires timestamp, p_actor text, p_now timestamp
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "DashboardMembership" WHERE "userId" = p_target AND "workspaceId" = p_workspace) THEN
    RETURN FALSE;
  END IF;
  DELETE FROM "DashboardPasswordReset" WHERE "userId" = p_target AND ("usedAt" IS NOT NULL OR "expiresAt" <= p_now);
  INSERT INTO "DashboardPasswordReset" ("userId", "tokenHash", "expiresAt", "createdBy", "createdAt")
  VALUES (p_target, p_token_hash, p_expires, p_actor, p_now);
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (p_workspace, p_actor, 'RESET_PASSWORD_BUAT', p_target, '{}'::jsonb, p_now);
  RETURN TRUE;
END
$$;

-- Pakai tautan reset (sekali): pasang hash password baru. Mengembalikan id pengguna atau NULL.
CREATE OR REPLACE FUNCTION dash_mu_reset_consume(p_token_hash text, p_password_hash text, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user text;
BEGIN
  UPDATE "DashboardPasswordReset" SET "usedAt" = p_now
  WHERE "tokenHash" = p_token_hash AND "usedAt" IS NULL AND "expiresAt" > p_now
  RETURNING "userId" INTO v_user;
  IF v_user IS NULL THEN RETURN NULL; END IF;
  UPDATE "DashboardUser" SET "passwordHash" = p_password_hash, "updatedAt" = p_now WHERE id = v_user AND "isActive";
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN v_user;
END
$$;

-- Pengguna untuk login Google: cocok lewat googleSub; atau lewat email (lalu googleSub ditautkan).
-- Tidak pernah membuat pengguna baru: pendaftaran hanya lewat undangan.
CREATE OR REPLACE FUNCTION dash_mu_google_user(p_sub text, p_email text, p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  UPDATE "DashboardUser" SET "googleSub" = p_sub, "updatedAt" = p_now
  WHERE "googleSub" IS NULL AND lower(email) = lower(p_email) AND "isActive"
    AND NOT EXISTS (SELECT 1 FROM "DashboardUser" x WHERE x."googleSub" = p_sub);
  SELECT jsonb_build_object('id', u.id, 'passwordHash', u."passwordHash", 'isActive', u."isActive") INTO v
  FROM "DashboardUser" u WHERE u."googleSub" = p_sub;
  RETURN v;
END
$$;

-- ------------------------------------------------------------------ pengaturan workspace dan audit

CREATE OR REPLACE FUNCTION dash_mu_settings_get(p_workspace text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    (SELECT to_jsonb(t) FROM (
       SELECT s."workspaceId", COALESCE(s."namaBrand", w.nama) AS "namaBrand", s."deskripsiBrand",
              s."topikTerlarang", s."autopilotAktif"
       FROM "WorkspaceSettings" s LEFT JOIN "Workspace" w ON w.id = s."workspaceId"
       WHERE s."workspaceId" = p_workspace) t),
    (SELECT jsonb_build_object('workspaceId', p_workspace, 'namaBrand', w.nama, 'deskripsiBrand', NULL,
                               'topikTerlarang', '[]'::jsonb, 'autopilotAktif', true)
     FROM "Workspace" w WHERE w.id = p_workspace)
  )
$$;

-- p_item: {namaBrand, deskripsiBrand, topikTerlarang[]}
CREATE OR REPLACE FUNCTION dash_mu_settings_set(p_workspace text, p_item jsonb, p_actor text, p_now timestamp)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO "WorkspaceSettings" ("workspaceId", "namaBrand", "deskripsiBrand", "topikTerlarang", "updatedBy", "updatedAt")
  VALUES (p_workspace, NULLIF(p_item->>'namaBrand', ''), NULLIF(p_item->>'deskripsiBrand', ''),
          ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_item->'topikTerlarang', '[]'::jsonb))), p_actor, p_now)
  ON CONFLICT ("workspaceId") DO UPDATE SET
    "namaBrand" = EXCLUDED."namaBrand", "deskripsiBrand" = EXCLUDED."deskripsiBrand",
    "topikTerlarang" = EXCLUDED."topikTerlarang", "updatedBy" = p_actor, "updatedAt" = p_now;
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (p_workspace, p_actor, 'PENGATURAN_WORKSPACE', p_workspace, '{}'::jsonb, p_now);
  RETURN TRUE;
END
$$;

-- Nama brand dan topik terlarang semua workspace (untuk tick dan prompt).
CREATE OR REPLACE FUNCTION dash_mu_brands() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT w.id AS "workspaceId", COALESCE(s."namaBrand", w.nama) AS "namaBrand", s."deskripsiBrand",
           COALESCE(s."topikTerlarang", '{}') AS "topikTerlarang"
    FROM "Workspace" w LEFT JOIN "WorkspaceSettings" s ON s."workspaceId" = w.id
  ) t
$$;

-- Catatan audit workspace, terbaru dulu, paginasi kursor (createdAt, id); nama pelaku ikut disertakan.
CREATE OR REPLACE FUNCTION dash_mu_audit(p_workspace text, p_cursor_at timestamp, p_cursor_id text, p_limit int) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT a.id, a.actor, COALESCE(u.name, u.username) AS "actorName", a.action, a.target, a.detail, a."createdAt"
    FROM "DashboardAuditLog" a
    LEFT JOIN "DashboardUser" u ON u.id = a.actor
    WHERE a."workspaceId" = p_workspace
      AND (p_cursor_at IS NULL OR (a."createdAt", a.id) < (p_cursor_at, p_cursor_id))
    ORDER BY a."createdAt" DESC, a.id DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 50) + 1
  ) t
$$;

-- Catat satu tindakan ke audit (dipakai route yang tidak punya fungsi SQL sendiri).
CREATE OR REPLACE FUNCTION dash_mu_audit_add(p_workspace text, p_actor text, p_action text, p_target text, p_detail jsonb, p_now timestamp)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (p_workspace, p_actor, p_action, p_target, COALESCE(p_detail, '{}'::jsonb), p_now)
  RETURNING TRUE
$$;

-- ------------------------------------------------------------------ daftar posting berfilter akun

-- Tanda tangan lama dibuang karena daftar argumennya bertambah (p_account_ids, default NULL).
DROP FUNCTION IF EXISTS dash_post_list(text, text, text, timestamp, text, boolean, int, timestamp);
DROP FUNCTION IF EXISTS dash_posts_by_ids(text[], boolean);
DROP FUNCTION IF EXISTS dash_post_summary(boolean, timestamp, timestamp, timestamp, timestamp);

CREATE OR REPLACE FUNCTION dash_post_list(
  p_scope text, p_username text, p_status text,
  p_cursor_at timestamp, p_cursor_id text,
  p_include_all boolean, p_limit int, p_now timestamp,
  p_account_ids text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  IF p_scope = 'upcoming' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v FROM (
      SELECT p.id, d.id AS "dispatchId", p.caption, p.hashtags, p."tayangPada", p.source,
             p.status::text AS "postStatus", d.status::text AS "dispatchStatus", d."pesanError", d."releaseUrl",
             d."platformContainerId", d."lockedAt",
             ta.id AS "threadsAccountId", ta.username, ta."displayName", ta."avatarUrl", o.nama AS "outletNama"
      FROM "ScheduledPost" p
      JOIN "PostDispatch" d ON d."postId" = p.id AND d.publisher = 'THREADS'
      LEFT JOIN "SocialAccount" sa ON sa.id = d."socialAccountId"
      LEFT JOIN "ThreadsAccount" ta ON ta.id = sa."threadsAccountId"
      LEFT JOIN "Outlet" o ON o.id = d."outletId"
      WHERE (p_include_all OR p.source = 'DASHBOARD_AI')
        AND d.status = 'MENUNGGU'
        AND (p_username IS NULL OR lower(ta.username) = lower(p_username))
        AND (p_account_ids IS NULL OR ta.id = ANY(p_account_ids))
        AND dash_status_match(p_status, d.status::text, d."platformContainerId", d."lockedAt", p.status::text, p."tayangPada", p_now)
        AND (p_cursor_at IS NULL OR (p."tayangPada", d.id) > (p_cursor_at, p_cursor_id))
      ORDER BY p."tayangPada" ASC, d.id ASC
      LIMIT p_limit + 1
    ) t;
  ELSE
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v FROM (
      SELECT p.id, d.id AS "dispatchId", p.caption, p.hashtags, p."tayangPada", p.source,
             p.status::text AS "postStatus", d.status::text AS "dispatchStatus", d."pesanError", d."releaseUrl",
             d."platformContainerId", d."lockedAt",
             ta.id AS "threadsAccountId", ta.username, ta."displayName", ta."avatarUrl", o.nama AS "outletNama"
      FROM "ScheduledPost" p
      JOIN "PostDispatch" d ON d."postId" = p.id AND d.publisher = 'THREADS'
      LEFT JOIN "SocialAccount" sa ON sa.id = d."socialAccountId"
      LEFT JOIN "ThreadsAccount" ta ON ta.id = sa."threadsAccountId"
      LEFT JOIN "Outlet" o ON o.id = d."outletId"
      WHERE (p_include_all OR p.source = 'DASHBOARD_AI')
        AND d.status IN ('TERBIT', 'GAGAL')
        AND (p_username IS NULL OR lower(ta.username) = lower(p_username))
        AND (p_account_ids IS NULL OR ta.id = ANY(p_account_ids))
        AND dash_status_match(p_status, d.status::text, d."platformContainerId", d."lockedAt", p.status::text, p."tayangPada", p_now)
        AND (p_cursor_at IS NULL OR (p."tayangPada", d.id) < (p_cursor_at, p_cursor_id))
      ORDER BY p."tayangPada" DESC, d.id DESC
      LIMIT p_limit + 1
    ) t;
  END IF;
  RETURN v;
END
$$;

CREATE OR REPLACE FUNCTION dash_posts_by_ids(p_ids text[], p_include_all boolean, p_account_ids text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT p.id, d.id AS "dispatchId", p.caption, p.hashtags, p."tayangPada", p.source,
           p.status::text AS "postStatus", d.status::text AS "dispatchStatus", d."pesanError", d."releaseUrl",
           d."platformContainerId", d."lockedAt",
           ta.id AS "threadsAccountId", ta.username, ta."displayName", ta."avatarUrl", o.nama AS "outletNama"
    FROM "ScheduledPost" p
    JOIN "PostDispatch" d ON d."postId" = p.id AND d.publisher = 'THREADS'
    LEFT JOIN "SocialAccount" sa ON sa.id = d."socialAccountId"
    LEFT JOIN "ThreadsAccount" ta ON ta.id = sa."threadsAccountId"
    LEFT JOIN "Outlet" o ON o.id = d."outletId"
    WHERE p.id = ANY(p_ids) AND (p_include_all OR p.source = 'DASHBOARD_AI')
      AND (p_account_ids IS NULL OR ta.id = ANY(p_account_ids))
    ORDER BY p."tayangPada" ASC, d.id ASC
    LIMIT 100
  ) t
$$;

CREATE OR REPLACE FUNCTION dash_post_summary(
  p_include_all boolean, p_day_start timestamp, p_day_end timestamp,
  p_week_ago timestamp, p_late_before timestamp, p_account_ids text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'scheduledToday', COUNT(*) FILTER (WHERE d.status = 'MENUNGGU' AND p."tayangPada" >= p_day_start AND p."tayangPada" < p_day_end),
    'published7d', COUNT(*) FILTER (WHERE d.status = 'TERBIT'),
    'failed7d', COUNT(*) FILTER (WHERE d.status = 'GAGAL'),
    'queuedLate', COUNT(*) FILTER (WHERE d.status = 'MENUNGGU' AND d."platformContainerId" IS NULL AND d."lockedAt" IS NULL
                                   AND p.status = 'MENUNGGU' AND p."tayangPada" < p_late_before)
  )
  FROM "PostDispatch" d
  JOIN "ScheduledPost" p ON p.id = d."postId"
  LEFT JOIN "SocialAccount" sa ON sa.id = d."socialAccountId"
  WHERE d.publisher = 'THREADS' AND (p_include_all OR p.source = 'DASHBOARD_AI')
    AND (p."tayangPada" >= p_week_ago OR d.status = 'MENUNGGU')
    AND (p_account_ids IS NULL OR sa."threadsAccountId" = ANY(p_account_ids))
$$;

-- ------------------------------------------------------------------ hak akses

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'dash\_mu\_%' OR p.proname IN ('dash_post_list', 'dash_posts_by_ids', 'dash_post_summary'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
