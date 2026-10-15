-- =============================================================================
-- Super admin sistem (pengelola platform): kelola semua pengguna dan workspace, blokir pengguna,
-- tangguhkan workspace, tautkan sumber akun Threads, pengaturan platform, dan audit platform.
--
-- ADITIF dan idempoten. Prasyarat: sql/005 dan sql/008 sudah dijalankan. Jalankan MANUAL di SQL Editor
-- Supabase oleh pemilik. Tabel milik auto-suka hanya DIBACA.
--
-- Pengaman berlapis: selain diperiksa di server dashboard, SETIAP fungsi yang mengubah data memeriksa
-- sendiri bahwa pelakunya super admin aktif, dan mencatat tindakannya ke "PlatformAuditLog".
-- Aturan tetap: tidak bisa memblokir diri sendiri, tidak bisa memblokir sesama super admin (cabut dulu
-- perannya), dan super admin terakhir tidak bisa dicabut.
--
-- Data awal: bila belum ada super admin sama sekali, pengguna aktif TERTUA menjadi super admin.
-- Menjalankan ulang tidak menambah super admin baru.
-- =============================================================================

-- ------------------------------------------------------------------ kolom dan tabel

ALTER TABLE "DashboardUser" ADD COLUMN IF NOT EXISTS "platformRole" text CHECK ("platformRole" IN ('SUPERADMIN'));
ALTER TABLE "DashboardUser" ADD COLUMN IF NOT EXISTS "bannedAt" timestamp(3);
ALTER TABLE "DashboardUser" ADD COLUMN IF NOT EXISTS "bannedReason" text;
ALTER TABLE "DashboardUser" ADD COLUMN IF NOT EXISTS "bannedBy" text;
-- Sesi yang diterbitkan sebelum waktu ini tidak berlaku lagi ("keluarkan dari semua perangkat").
ALTER TABLE "DashboardUser" ADD COLUMN IF NOT EXISTS "sessionsValidAfter" timestamp(3);

ALTER TABLE "WorkspaceSettings" ADD COLUMN IF NOT EXISTS "suspendedAt" timestamp(3);
ALTER TABLE "WorkspaceSettings" ADD COLUMN IF NOT EXISTS "suspendedReason" text;
ALTER TABLE "WorkspaceSettings" ADD COLUMN IF NOT EXISTS "suspendedBy" text;
-- Nilai saklar autopilot sebelum ditangguhkan, untuk dikembalikan saat penangguhan dicabut.
ALTER TABLE "WorkspaceSettings" ADD COLUMN IF NOT EXISTS "autopilotSebelumTangguh" boolean;

CREATE TABLE IF NOT EXISTS "PlatformSettings" (
  id                smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Pendaftaran mandiri dibuka (tetap butuh SIGNUP_ENABLED=true di server).
  "signupOpen"      boolean NOT NULL DEFAULT true,
  -- Saklar darurat: false = autopilot berhenti untuk SEMUA workspace.
  "autopilotGlobal" boolean NOT NULL DEFAULT true,
  -- Pengumuman singkat yang tampil di atas dashboard semua pengguna.
  announcement      text,
  "updatedBy"       text,
  "updatedAt"       timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
INSERT INTO "PlatformSettings" (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS "PlatformAuditLog" (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  actor        text NOT NULL,
  action       text NOT NULL,
  "targetType" text NOT NULL,          -- PENGGUNA | WORKSPACE | SUMBER | SISTEM
  "targetId"   text,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"  timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_waktu_idx" ON "PlatformAuditLog" ("createdAt" DESC, id DESC);
CREATE INDEX IF NOT EXISTS "DashboardUser_daftar_idx" ON "DashboardUser" ("createdAt" DESC, id DESC);

ALTER TABLE "PlatformSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformAuditLog" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PlatformSettings", "PlatformAuditLog" FROM anon, authenticated;

-- ------------------------------------------------------------------ data awal

WITH pertama AS (
  SELECT id FROM "DashboardUser" WHERE "isActive" ORDER BY "createdAt" ASC, id ASC LIMIT 1
), jadi AS (
  UPDATE "DashboardUser" u SET "platformRole" = 'SUPERADMIN'
  FROM pertama p
  WHERE u.id = p.id AND NOT EXISTS (SELECT 1 FROM "DashboardUser" WHERE "platformRole" = 'SUPERADMIN')
  RETURNING u.id
)
INSERT INTO "PlatformAuditLog" (actor, action, "targetType", "targetId", detail)
SELECT 'system:pemasangan', 'SUPERADMIN_AWAL', 'PENGGUNA', id, '{}'::jsonb FROM jadi;

-- ------------------------------------------------------------------ pembantu

-- Pelaku adalah super admin yang aktif?
CREATE OR REPLACE FUNCTION dash_sa_is(p_user text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM "DashboardUser" WHERE id = p_user AND "isActive" AND "platformRole" = 'SUPERADMIN')
$$;

-- Id itu sebuah tenant dashboard? (punya pengaturan, anggota, atau menjadi pemimpin kelompok)
CREATE OR REPLACE FUNCTION dash_sa_tenant_exists(p_ws text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_ws IS NOT NULL AND (
    EXISTS (SELECT 1 FROM "WorkspaceSettings" WHERE "workspaceId" = p_ws)
    OR EXISTS (SELECT 1 FROM "DashboardMembership" WHERE "workspaceId" = p_ws)
    OR EXISTS (SELECT 1 FROM "DashboardWorkspaceGroup" WHERE "groupId" = p_ws))
$$;

CREATE OR REPLACE FUNCTION dash_sa_log(p_actor text, p_action text, p_type text, p_target text, p_detail jsonb, p_now timestamp) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO "PlatformAuditLog" (actor, action, "targetType", "targetId", detail, "createdAt")
  VALUES (p_actor, p_action, p_type, p_target, COALESCE(p_detail, '{}'::jsonb), p_now)
$$;

-- ------------------------------------------------------------------ konteks dan saklar

-- Saklar platform (dipakai halaman masuk/daftar dan tick autopilot).
CREATE OR REPLACE FUNCTION dash_sa_flags() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object('signupOpen', p."signupOpen", 'autopilotGlobal', p."autopilotGlobal", 'announcement', p.announcement)
     FROM "PlatformSettings" p WHERE p.id = 1),
    jsonb_build_object('signupOpen', true, 'autopilotGlobal', true, 'announcement', NULL))
$$;

-- Konteks platform satu pengguna dalam satu perjalanan: super admin atau bukan, status blokir, batas
-- sesi, workspace-nya yang sedang ditangguhkan, dan saklar platform.
CREATE OR REPLACE FUNCTION dash_sa_ctx(p_user text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'superadmin', dash_sa_is(p_user),
    'banned', COALESCE((SELECT u."bannedAt" IS NOT NULL FROM "DashboardUser" u WHERE u.id = p_user), false),
    'bannedReason', (SELECT u."bannedReason" FROM "DashboardUser" u WHERE u.id = p_user),
    'sessionsValidAfter', (SELECT u."sessionsValidAfter" FROM "DashboardUser" u WHERE u.id = p_user),
    'suspended', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('workspaceId', s."workspaceId", 'reason', s."suspendedReason")), '[]'::jsonb)
      FROM "WorkspaceSettings" s
      JOIN "DashboardMembership" m ON m."workspaceId" = s."workspaceId"
      WHERE m."userId" = p_user AND s."suspendedAt" IS NOT NULL),
    'flags', dash_sa_flags())
$$;

-- ------------------------------------------------------------------ ringkasan

CREATE OR REPLACE FUNCTION dash_sa_overview(p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH tenant AS (
    SELECT "workspaceId" AS id FROM "WorkspaceSettings"
    UNION SELECT "workspaceId" FROM "DashboardMembership"
    UNION SELECT "groupId" FROM "DashboardWorkspaceGroup"
  ), akun AS (
    SELECT ta.id, dash_ap_tenant_of(ta."workspaceId") AS tenant FROM "ThreadsAccount" ta
  )
  SELECT jsonb_build_object(
    'users', (SELECT jsonb_build_object(
        'total', count(*),
        'aktif', count(*) FILTER (WHERE "isActive"),
        'diblokir', count(*) FILTER (WHERE "bannedAt" IS NOT NULL),
        'superadmin', count(*) FILTER (WHERE "platformRole" = 'SUPERADMIN' AND "isActive"),
        'baru7Hari', count(*) FILTER (WHERE "createdAt" >= p_now - interval '7 days'),
        'masuk24Jam', count(*) FILTER (WHERE "lastLoginAt" >= p_now - interval '24 hours'))
      FROM "DashboardUser"),
    'workspaces', jsonb_build_object(
        'total', (SELECT count(*) FROM tenant),
        'ditangguhkan', (SELECT count(*) FROM "WorkspaceSettings" WHERE "suspendedAt" IS NOT NULL),
        'tanpaAkun', (SELECT count(*) FROM tenant t WHERE NOT EXISTS (SELECT 1 FROM akun a WHERE a.tenant = t.id))),
    'accounts', jsonb_build_object(
        'total', (SELECT count(*) FROM akun),
        -- Akun yang tenant-nya belum punya anggota: belum bisa dilihat siapa pun di dashboard.
        'tanpaPemilik', (SELECT count(*) FROM akun a WHERE NOT EXISTS (SELECT 1 FROM "DashboardMembership" m WHERE m."workspaceId" = a.tenant))),
    'autopilot', jsonb_build_object(
        'otomatis', (SELECT count(*) FROM "AutopilotConfig" WHERE mode = 'OTOMATIS'),
        'tinjau', (SELECT count(*) FROM "AutopilotConfig" WHERE mode = 'TINJAU'),
        'dijeda', (SELECT count(*) FROM "AutopilotConfig" WHERE "pausedReason" IS NOT NULL AND mode <> 'MATI'),
        'tickTerakhir', (SELECT max("startedAt") FROM "AutopilotRun"),
        'slot24Jam', (SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb) FROM (
            SELECT status, count(*) AS n FROM "AutopilotSlot"
            WHERE "slotAt" >= p_now - interval '24 hours' AND "slotAt" < p_now + interval '24 hours'
            GROUP BY status) x)),
    'flags', dash_sa_flags())
$$;

-- ------------------------------------------------------------------ pengguna

-- Daftar pengguna, terbaru dulu, paginasi kursor (createdAt, id). p_status: NULL | AKTIF | DIBLOKIR |
-- NONAKTIF | SUPERADMIN. p_q dicari di username, email, dan nama.
CREATE OR REPLACE FUNCTION dash_sa_users(
  p_q text, p_status text, p_cursor_at timestamp, p_cursor_id text, p_limit int
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."createdAt" DESC, t.id DESC), '[]'::jsonb) FROM (
    SELECT u.id, u.username, u.email, u.name, u."isActive", (u."platformRole" = 'SUPERADMIN') IS TRUE AS superadmin,
           u."bannedAt", u."bannedReason", u."lastLoginAt", u."createdAt", (u."googleSub" IS NOT NULL) AS google,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'workspaceId', m."workspaceId", 'role', m.role,
                     'nama', COALESCE(s."namaBrand", w.nama, m."workspaceId")) ORDER BY m."createdAt"), '[]'::jsonb)
            FROM "DashboardMembership" m
            LEFT JOIN "WorkspaceSettings" s ON s."workspaceId" = m."workspaceId"
            LEFT JOIN "Workspace" w ON w.id = m."workspaceId"
            WHERE m."userId" = u.id) AS workspaces
    FROM "DashboardUser" u
    WHERE (p_q IS NULL OR p_q = '' OR u.username ILIKE '%' || p_q || '%' ESCAPE '\'
           OR u.email ILIKE '%' || p_q || '%' ESCAPE '\' OR u.name ILIKE '%' || p_q || '%' ESCAPE '\')
      AND (p_status IS NULL
           OR (p_status = 'AKTIF' AND u."isActive")
           OR (p_status = 'DIBLOKIR' AND u."bannedAt" IS NOT NULL)
           OR (p_status = 'NONAKTIF' AND NOT u."isActive" AND u."bannedAt" IS NULL)
           OR (p_status = 'SUPERADMIN' AND u."platformRole" = 'SUPERADMIN'))
      AND (p_cursor_at IS NULL OR (u."createdAt", u.id) < (p_cursor_at, p_cursor_id))
    ORDER BY u."createdAt" DESC, u.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 26), 1), 101)
  ) t
$$;

-- Blokir pengguna: akun dinonaktifkan dan semua sesinya gugur.
-- Hasil: OK | FORBIDDEN | NOT_FOUND | SELF | SUPERADMIN | ALREADY
CREATE OR REPLACE FUNCTION dash_sa_user_ban(p_actor text, p_target text, p_reason text, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE u "DashboardUser"%ROWTYPE;
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN 'FORBIDDEN'; END IF;
  IF p_actor = p_target THEN RETURN 'SELF'; END IF;
  SELECT * INTO u FROM "DashboardUser" WHERE id = p_target FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF u."platformRole" = 'SUPERADMIN' THEN RETURN 'SUPERADMIN'; END IF;
  IF u."bannedAt" IS NOT NULL THEN RETURN 'ALREADY'; END IF;
  UPDATE "DashboardUser" SET "isActive" = false, "bannedAt" = p_now, "bannedReason" = LEFT(p_reason, 300), "bannedBy" = p_actor,
         "sessionsValidAfter" = p_now, "updatedAt" = p_now
  WHERE id = p_target;
  PERFORM dash_sa_log(p_actor, 'PENGGUNA_BLOKIR', 'PENGGUNA', p_target, jsonb_build_object('alasan', LEFT(p_reason, 300), 'username', u.username), p_now);
  RETURN 'OK';
END
$$;

-- Buka blokir / aktifkan kembali. Hasil: OK | FORBIDDEN | NOT_FOUND | ALREADY
CREATE OR REPLACE FUNCTION dash_sa_user_unban(p_actor text, p_target text, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE u "DashboardUser"%ROWTYPE;
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN 'FORBIDDEN'; END IF;
  SELECT * INTO u FROM "DashboardUser" WHERE id = p_target FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF u."isActive" THEN RETURN 'ALREADY'; END IF;
  UPDATE "DashboardUser" SET "isActive" = true, "bannedAt" = NULL, "bannedReason" = NULL, "bannedBy" = NULL, "updatedAt" = p_now
  WHERE id = p_target;
  PERFORM dash_sa_log(p_actor, 'PENGGUNA_BUKA_BLOKIR', 'PENGGUNA', p_target, jsonb_build_object('username', u.username), p_now);
  RETURN 'OK';
END
$$;

-- Beri atau cabut peran super admin. Hasil: OK | FORBIDDEN | NOT_FOUND | INACTIVE | LAST | ALREADY
CREATE OR REPLACE FUNCTION dash_sa_user_role(p_actor text, p_target text, p_super boolean, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE u "DashboardUser"%ROWTYPE;
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN 'FORBIDDEN'; END IF;
  -- Satu kunci untuk semua perubahan peran: dua pencabutan serentak tidak boleh menghabiskan super admin.
  PERFORM pg_advisory_xact_lock(hashtext('dash_sa_role'));
  SELECT * INTO u FROM "DashboardUser" WHERE id = p_target FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF p_super THEN
    IF NOT u."isActive" THEN RETURN 'INACTIVE'; END IF;
    IF u."platformRole" = 'SUPERADMIN' THEN RETURN 'ALREADY'; END IF;
    UPDATE "DashboardUser" SET "platformRole" = 'SUPERADMIN', "updatedAt" = p_now WHERE id = p_target;
    PERFORM dash_sa_log(p_actor, 'SUPERADMIN_BERI', 'PENGGUNA', p_target, jsonb_build_object('username', u.username), p_now);
  ELSE
    IF u."platformRole" IS DISTINCT FROM 'SUPERADMIN' THEN RETURN 'ALREADY'; END IF;
    IF (SELECT count(*) FROM "DashboardUser" WHERE "platformRole" = 'SUPERADMIN' AND "isActive") <= 1 THEN RETURN 'LAST'; END IF;
    UPDATE "DashboardUser" SET "platformRole" = NULL, "updatedAt" = p_now WHERE id = p_target;
    PERFORM dash_sa_log(p_actor, 'SUPERADMIN_CABUT', 'PENGGUNA', p_target, jsonb_build_object('username', u.username), p_now);
  END IF;
  RETURN 'OK';
END
$$;

-- Keluarkan pengguna dari semua perangkat (sesi lama gugur; password tidak berubah).
CREATE OR REPLACE FUNCTION dash_sa_user_logout(p_actor text, p_target text, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_name text;
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN 'FORBIDDEN'; END IF;
  UPDATE "DashboardUser" SET "sessionsValidAfter" = p_now, "updatedAt" = p_now WHERE id = p_target RETURNING username INTO v_name;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  PERFORM dash_sa_log(p_actor, 'PENGGUNA_KELUARKAN', 'PENGGUNA', p_target, jsonb_build_object('username', v_name), p_now);
  RETURN 'OK';
END
$$;

-- Tautan reset password untuk pengguna mana pun (sekali pakai). Hanya hash token yang disimpan.
CREATE OR REPLACE FUNCTION dash_sa_reset_create(
  p_actor text, p_target text, p_token_hash text, p_expires timestamp, p_now timestamp
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_name text;
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN 'FORBIDDEN'; END IF;
  SELECT username INTO v_name FROM "DashboardUser" WHERE id = p_target;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  DELETE FROM "DashboardPasswordReset" WHERE "userId" = p_target AND ("usedAt" IS NOT NULL OR "expiresAt" <= p_now);
  INSERT INTO "DashboardPasswordReset" ("userId", "tokenHash", "expiresAt", "createdBy", "createdAt")
  VALUES (p_target, p_token_hash, p_expires, p_actor, p_now);
  PERFORM dash_sa_log(p_actor, 'PENGGUNA_TAUTAN_RESET', 'PENGGUNA', p_target, jsonb_build_object('username', v_name), p_now);
  RETURN 'OK';
END
$$;

-- ------------------------------------------------------------------ workspace (tenant)

-- Semua tenant dengan jumlah anggota, akun, dan autopilot aktif. Urut nama lalu id; paginasi kursor.
CREATE OR REPLACE FUNCTION dash_sa_workspaces(p_q text, p_after_nama text, p_after_id text, p_limit int) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH tenant AS (
    SELECT "workspaceId" AS id FROM "WorkspaceSettings"
    UNION SELECT "workspaceId" FROM "DashboardMembership"
    UNION SELECT "groupId" FROM "DashboardWorkspaceGroup"
  ), baris AS (
    SELECT t.id, COALESCE(s."namaBrand", w.nama, t.id) AS nama,
           s."suspendedAt", s."suspendedReason", COALESCE(s."autopilotAktif", true) AS "autopilotAktif",
           (SELECT count(*) FROM "DashboardMembership" m WHERE m."workspaceId" = t.id) AS anggota,
           (SELECT count(*) FROM "ThreadsAccount" ta WHERE dash_ap_tenant_of(ta."workspaceId") = t.id) AS akun,
           (SELECT count(*) FROM "AutopilotConfig" c WHERE c."workspaceId" = t.id AND c.mode <> 'MATI') AS "autopilotAkun",
           (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', u.id, 'username', u.username, 'email', u.email, 'role', m.role)
                                      ORDER BY m."createdAt"), '[]'::jsonb)
            FROM "DashboardMembership" m JOIN "DashboardUser" u ON u.id = m."userId"
            WHERE m."workspaceId" = t.id) AS members
    FROM tenant t
    LEFT JOIN "WorkspaceSettings" s ON s."workspaceId" = t.id
    LEFT JOIN "Workspace" w ON w.id = t.id
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.nama, b.id), '[]'::jsonb) FROM (
    SELECT * FROM baris
    WHERE (p_q IS NULL OR p_q = '' OR nama ILIKE '%' || p_q || '%' ESCAPE '\')
      AND (p_after_nama IS NULL OR (nama, id) > (p_after_nama, p_after_id))
    ORDER BY nama, id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 26), 1), 101)
  ) b
$$;

-- Tangguhkan workspace: anggotanya kehilangan akses dan autopilotnya berhenti.
-- Hasil: OK | FORBIDDEN | NOT_FOUND | ALREADY
CREATE OR REPLACE FUNCTION dash_sa_workspace_suspend(p_actor text, p_ws text, p_reason text, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN 'FORBIDDEN'; END IF;
  IF NOT dash_sa_tenant_exists(p_ws) THEN RETURN 'NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM "WorkspaceSettings" WHERE "workspaceId" = p_ws AND "suspendedAt" IS NOT NULL) THEN RETURN 'ALREADY'; END IF;
  INSERT INTO "WorkspaceSettings" ("workspaceId", "autopilotAktif", "suspendedAt", "suspendedReason", "suspendedBy",
                                   "autopilotSebelumTangguh", "updatedBy", "updatedAt")
  VALUES (p_ws, false, p_now, LEFT(p_reason, 300), p_actor, true, p_actor, p_now)
  ON CONFLICT ("workspaceId") DO UPDATE SET
    "autopilotSebelumTangguh" = "WorkspaceSettings"."autopilotAktif", "autopilotAktif" = false,
    "suspendedAt" = p_now, "suspendedReason" = LEFT(p_reason, 300), "suspendedBy" = p_actor,
    "updatedBy" = p_actor, "updatedAt" = p_now;
  PERFORM dash_sa_log(p_actor, 'WORKSPACE_TANGGUHKAN', 'WORKSPACE', p_ws, jsonb_build_object('alasan', LEFT(p_reason, 300)), p_now);
  RETURN 'OK';
END
$$;

CREATE OR REPLACE FUNCTION dash_sa_workspace_unsuspend(p_actor text, p_ws text, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN 'FORBIDDEN'; END IF;
  UPDATE "WorkspaceSettings" SET
    "autopilotAktif" = COALESCE("autopilotSebelumTangguh", true), "autopilotSebelumTangguh" = NULL,
    "suspendedAt" = NULL, "suspendedReason" = NULL, "suspendedBy" = NULL, "updatedBy" = p_actor, "updatedAt" = p_now
  WHERE "workspaceId" = p_ws AND "suspendedAt" IS NOT NULL;
  IF NOT FOUND THEN RETURN 'ALREADY'; END IF;
  PERFORM dash_sa_log(p_actor, 'WORKSPACE_PULIHKAN', 'WORKSPACE', p_ws, '{}'::jsonb, p_now);
  RETURN 'OK';
END
$$;

-- Atur keanggotaan di workspace mana pun. p_role NULL = keluarkan. p_identifier = email atau username.
-- Hasil: OK | FORBIDDEN | NOT_FOUND (workspace) | NO_USER | NOT_MEMBER
CREATE OR REPLACE FUNCTION dash_sa_member_set(p_actor text, p_ws text, p_identifier text, p_role text, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user text; v_key text := lower(btrim(p_identifier));
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN 'FORBIDDEN'; END IF;
  IF NOT dash_sa_tenant_exists(p_ws) THEN RETURN 'NOT_FOUND'; END IF;
  IF p_role IS NOT NULL AND p_role NOT IN ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER') THEN
    RAISE EXCEPTION 'peran tidak valid' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_user FROM "DashboardUser" WHERE lower(email) = v_key OR lower(username) = v_key OR id = p_identifier LIMIT 1;
  IF v_user IS NULL THEN RETURN 'NO_USER'; END IF;
  IF p_role IS NULL THEN
    DELETE FROM "DashboardMemberAccount" WHERE "userId" = v_user AND "workspaceId" = p_ws;
    DELETE FROM "DashboardMembership" WHERE "userId" = v_user AND "workspaceId" = p_ws;
    IF NOT FOUND THEN RETURN 'NOT_MEMBER'; END IF;
    PERFORM dash_sa_log(p_actor, 'WORKSPACE_ANGGOTA_HAPUS', 'WORKSPACE', p_ws, jsonb_build_object('userId', v_user), p_now);
  ELSE
    INSERT INTO "DashboardMembership" ("userId", "workspaceId", role, "accountScope", "createdAt", "updatedAt")
    VALUES (v_user, p_ws, p_role, 'SEMUA', p_now, p_now)
    ON CONFLICT ("userId", "workspaceId") DO UPDATE SET role = EXCLUDED.role, "updatedAt" = p_now;
    PERFORM dash_sa_log(p_actor, 'WORKSPACE_ANGGOTA_ATUR', 'WORKSPACE', p_ws, jsonb_build_object('userId', v_user, 'peran', p_role), p_now);
  END IF;
  RETURN 'OK';
END
$$;

-- ------------------------------------------------------------------ sumber akun (workspace SukaPost)

-- Workspace SukaPost yang punya akun Threads atau sudah ditautkan, beserta tenant dashboard-nya.
CREATE OR REPLACE FUNCTION dash_sa_sources() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.akun DESC, t.nama, t."workspaceId"), '[]'::jsonb) FROM (
    SELECT w.id AS "workspaceId", w.nama,
           (SELECT count(*) FROM "ThreadsAccount" ta WHERE ta."workspaceId" = w.id) AS akun,
           g."groupId" AS "tenantId",
           (SELECT COALESCE(s."namaBrand", tw.nama, g."groupId") FROM (SELECT 1) x
            LEFT JOIN "WorkspaceSettings" s ON s."workspaceId" = g."groupId"
            LEFT JOIN "Workspace" tw ON tw.id = g."groupId") AS "tenantNama",
           -- Workspace ini pemimpin kelompok yang masih punya anggota lain: tidak bisa dipindah.
           (g."groupId" = w.id AND EXISTS (SELECT 1 FROM "DashboardWorkspaceGroup" o WHERE o."groupId" = w.id AND o."workspaceId" <> w.id)) AS pemimpin
    FROM "Workspace" w
    LEFT JOIN "DashboardWorkspaceGroup" g ON g."workspaceId" = w.id
    WHERE g."workspaceId" IS NOT NULL OR EXISTS (SELECT 1 FROM "ThreadsAccount" ta WHERE ta."workspaceId" = w.id)
  ) t
$$;

-- Tautkan workspace SukaPost ke sebuah tenant dashboard (p_tenant NULL = lepas tautan). Autopilot akun
-- yang ikut pindah dimatikan dan rencana slotnya dibuang, supaya tenant baru memulai dari keadaan bersih.
-- Hasil: OK | FORBIDDEN | NOT_FOUND (workspace) | NO_TENANT | LEADER | ALREADY
CREATE OR REPLACE FUNCTION dash_sa_source_link(p_actor text, p_workspace text, p_tenant text, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_cur text; v_old text; v_new text; v_ids text[];
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN 'FORBIDDEN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Workspace" WHERE id = p_workspace) THEN RETURN 'NOT_FOUND'; END IF;
  IF p_tenant IS NOT NULL AND p_tenant <> p_workspace AND NOT dash_sa_tenant_exists(p_tenant) THEN RETURN 'NO_TENANT'; END IF;
  SELECT "groupId" INTO v_cur FROM "DashboardWorkspaceGroup" WHERE "workspaceId" = p_workspace;
  IF v_cur IS NOT DISTINCT FROM p_tenant THEN RETURN 'ALREADY'; END IF;
  -- Pemimpin kelompok tidak bisa dipindah atau dilepas selama masih ada workspace lain yang menumpang.
  IF p_tenant IS DISTINCT FROM p_workspace
     AND EXISTS (SELECT 1 FROM "DashboardWorkspaceGroup" WHERE "groupId" = p_workspace AND "workspaceId" <> p_workspace) THEN
    RETURN 'LEADER';
  END IF;
  v_old := COALESCE(v_cur, p_workspace);
  v_new := COALESCE(p_tenant, p_workspace);

  IF p_tenant IS NULL THEN
    DELETE FROM "DashboardWorkspaceGroup" WHERE "workspaceId" = p_workspace;
  ELSE
    INSERT INTO "DashboardWorkspaceGroup" ("workspaceId", "groupId") VALUES (p_workspace, p_tenant)
    ON CONFLICT ("workspaceId") DO UPDATE SET "groupId" = EXCLUDED."groupId";
  END IF;

  IF v_old <> v_new THEN
    SELECT COALESCE(array_agg(id), '{}') INTO v_ids FROM "ThreadsAccount" WHERE "workspaceId" = p_workspace;
    UPDATE "AutopilotConfig" SET "workspaceId" = v_new, mode = 'MATI', "pausedReason" = NULL, "pausedAt" = NULL,
           "updatedBy" = p_actor, "updatedAt" = p_now
    WHERE "accountId" = ANY(v_ids);
    DELETE FROM "AutopilotSlot" WHERE "accountId" = ANY(v_ids) AND status = 'DIRENCANAKAN';
    DELETE FROM "DashboardMemberAccount" WHERE "workspaceId" = v_old AND "accountId" = ANY(v_ids);
  END IF;
  PERFORM dash_sa_log(p_actor, 'SUMBER_TAUTKAN', 'SUMBER', p_workspace,
                      jsonb_build_object('dari', v_old, 'ke', v_new, 'akun', COALESCE(array_length(v_ids, 1), 0)), p_now);
  RETURN 'OK';
END
$$;

-- ------------------------------------------------------------------ pengaturan dan audit platform

-- Ubah saklar platform. p_patch: { signupOpen?, autopilotGlobal?, announcement? }. Hasil: saklar terbaru
-- atau NULL bila pelaku bukan super admin.
CREATE OR REPLACE FUNCTION dash_sa_settings_set(p_actor text, p_patch jsonb, p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN NULL; END IF;
  UPDATE "PlatformSettings" SET
    "signupOpen" = CASE WHEN p_patch ? 'signupOpen' THEN (p_patch->>'signupOpen')::boolean ELSE "signupOpen" END,
    "autopilotGlobal" = CASE WHEN p_patch ? 'autopilotGlobal' THEN (p_patch->>'autopilotGlobal')::boolean ELSE "autopilotGlobal" END,
    announcement = CASE WHEN p_patch ? 'announcement' THEN NULLIF(LEFT(btrim(COALESCE(p_patch->>'announcement', '')), 300), '') ELSE announcement END,
    "updatedBy" = p_actor, "updatedAt" = p_now
  WHERE id = 1;
  PERFORM dash_sa_log(p_actor, 'SISTEM_PENGATURAN', 'SISTEM', NULL, p_patch, p_now);
  RETURN dash_sa_flags();
END
$$;

-- Catatan audit platform, terbaru dulu, paginasi kursor (createdAt, id); nama pelaku ikut disertakan.
CREATE OR REPLACE FUNCTION dash_sa_audit(p_cursor_at timestamp, p_cursor_id text, p_limit int) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."createdAt" DESC, t.id DESC), '[]'::jsonb) FROM (
    SELECT a.id, a.actor, COALESCE(u.name, u.username, a.actor) AS "actorName", a.action, a."targetType", a."targetId", a.detail, a."createdAt"
    FROM "PlatformAuditLog" a
    LEFT JOIN "DashboardUser" u ON u.id = a.actor
    WHERE p_cursor_at IS NULL OR (a."createdAt", a.id) < (p_cursor_at, p_cursor_id)
    ORDER BY a."createdAt" DESC, a.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 26), 1), 101)
  ) t
$$;

-- ------------------------------------------------------------------ hak akses

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
