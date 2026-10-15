-- =============================================================================
-- Konsol admin platform: peran admin dengan hak akses per modul (RBAC), plus pembuatan dan pengubahan
-- profil pengguna oleh admin.
--
-- Sebelumnya hanya ada satu peran platform (SUPERADMIN). Berkas ini menambah tabel "PlatformRole"
-- berisi peran staf (Admin Operasional, Dukungan, Keuangan, Auditor, dan peran buatan sendiri), masing-
-- masing dengan daftar izin "<modul>.lihat" / "<modul>.kelola". SUPERADMIN selalu memegang semua izin
-- dan satu-satunya yang boleh mengatur peran serta memberikannya ke pengguna.
--
-- Arti fungsi pembantu setelah berkas ini:
--   dash_sa_is(u)    = staf platform aktif (peran apa pun). Dipakai fungsi lama sebagai pengaman lapis
--                      database; izin per modul diperiksa server dashboard sebelum fungsi dipanggil.
--   dash_sa_super(u) = SUPERADMIN aktif. Wajib untuk mengubah peran platform.
--   dash_sa_izin(u)  = daftar izin staf ('*' = semua).
--
-- ADITIF dan idempoten. Prasyarat: sql/010 dan sql/011 sudah dijalankan. Jalankan MANUAL di SQL Editor
-- Supabase oleh pemilik.
-- =============================================================================

-- ------------------------------------------------------------------ tabel peran

-- Kolom platformRole dulu dibatasi CHECK ('SUPERADMIN'); sekarang mengacu ke tabel peran.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = '"DashboardUser"'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%platformRole%'
  LOOP
    EXECUTE format('ALTER TABLE "DashboardUser" DROP CONSTRAINT %I', c);
  END LOOP;
END
$$;

CREATE TABLE IF NOT EXISTS "PlatformRole" (
  id          text PRIMARY KEY CHECK (id ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  nama        text NOT NULL CHECK (char_length(nama) BETWEEN 2 AND 60),
  deskripsi   text CHECK (deskripsi IS NULL OR char_length(deskripsi) <= 300),
  izin        text[] NOT NULL DEFAULT '{}',
  -- Peran bawaan sistem (SUPERADMIN): tidak bisa dihapus atau diubah izinnya.
  sistem      boolean NOT NULL DEFAULT false,
  urutan      smallint NOT NULL DEFAULT 50,
  "createdAt" timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updatedAt" timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
ALTER TABLE "PlatformRole" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PlatformRole" FROM anon, authenticated;

INSERT INTO "PlatformRole" (id, nama, deskripsi, izin, sistem, urutan) VALUES
  ('SUPERADMIN', 'Super Admin', 'Akses penuh ke seluruh konsol, termasuk mengatur peran dan hak akses admin lain.', '{*}', true, 0),
  ('ADMIN', 'Admin Operasional', 'Mengelola pengguna, workspace, konten, dan sumber akun. Paket dan tagihan hanya bisa dilihat.',
   '{dashboard.lihat,pengguna.lihat,pengguna.kelola,workspace.lihat,workspace.kelola,konten.lihat,konten.kelola,sumber.lihat,sumber.kelola,paket.lihat,tagihan.lihat,sistem.lihat,audit.lihat}', false, 10),
  ('SUPPORT', 'Dukungan Pelanggan', 'Membantu pelanggan: lihat pengguna dan workspace, buat tautan reset password, kelola antrean konten.',
   '{dashboard.lihat,pengguna.lihat,pengguna.kelola,workspace.lihat,konten.lihat,konten.kelola,audit.lihat}', false, 20),
  ('KEUANGAN', 'Keuangan', 'Mengelola paket harga dan tagihan, serta memasang paket ke workspace.',
   '{dashboard.lihat,paket.lihat,paket.kelola,tagihan.lihat,tagihan.kelola,workspace.lihat,audit.lihat}', false, 30),
  ('AUDITOR', 'Auditor (baca saja)', 'Melihat semua modul tanpa bisa mengubah apa pun.',
   '{dashboard.lihat,pengguna.lihat,workspace.lihat,konten.lihat,paket.lihat,tagihan.lihat,sumber.lihat,integrasi.lihat,sistem.lihat,audit.lihat}', false, 40)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DashboardUser_platformRole_fkey') THEN
    ALTER TABLE "DashboardUser" ADD CONSTRAINT "DashboardUser_platformRole_fkey"
      FOREIGN KEY ("platformRole") REFERENCES "PlatformRole"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS "DashboardUser_platformRole_idx" ON "DashboardUser" ("platformRole") WHERE "platformRole" IS NOT NULL;

-- ------------------------------------------------------------------ pembantu

-- Izin yang boleh diberikan ke peran staf. "akses.kelola" sengaja tidak ada: hanya SUPERADMIN.
CREATE OR REPLACE FUNCTION dash_sa_izin_valid() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'dashboard.lihat',
    'pengguna.lihat', 'pengguna.kelola',
    'workspace.lihat', 'workspace.kelola',
    'konten.lihat', 'konten.kelola',
    'paket.lihat', 'paket.kelola',
    'tagihan.lihat', 'tagihan.kelola',
    'sumber.lihat', 'sumber.kelola',
    'integrasi.lihat', 'integrasi.kelola',
    'sistem.lihat', 'sistem.kelola',
    'audit.lihat'
  ]::text[]
$$;

CREATE OR REPLACE FUNCTION dash_sa_super(p_user text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM "DashboardUser" WHERE id = p_user AND "isActive" AND "platformRole" = 'SUPERADMIN')
$$;

-- Staf platform aktif (peran apa pun yang terdaftar).
CREATE OR REPLACE FUNCTION dash_sa_is(p_user text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM "DashboardUser" u JOIN "PlatformRole" r ON r.id = u."platformRole"
    WHERE u.id = p_user AND u."isActive" AND u."bannedAt" IS NULL)
$$;

CREATE OR REPLACE FUNCTION dash_sa_izin(p_user text) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
    SELECT CASE WHEN r.id = 'SUPERADMIN' THEN ARRAY['*']::text[] ELSE r.izin END
    FROM "DashboardUser" u JOIN "PlatformRole" r ON r.id = u."platformRole"
    WHERE u.id = p_user AND u."isActive" AND u."bannedAt" IS NULL), '{}'::text[])
$$;

-- Konteks platform: sama seperti sql/010, ditambah peran dan izin staf.
CREATE OR REPLACE FUNCTION dash_sa_ctx(p_user text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'superadmin', dash_sa_is(p_user),
    'platformRole', (SELECT CASE WHEN dash_sa_is(p_user) THEN u."platformRole" END FROM "DashboardUser" u WHERE u.id = p_user),
    'roleNama', (SELECT r.nama FROM "DashboardUser" u JOIN "PlatformRole" r ON r.id = u."platformRole" WHERE u.id = p_user AND dash_sa_is(p_user)),
    'izin', to_jsonb(dash_sa_izin(p_user)),
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

-- ------------------------------------------------------------------ pengguna

-- Daftar pengguna: sama seperti sql/010, ditambah peran platform. p_status tambahan: STAF (peran apa pun).
CREATE OR REPLACE FUNCTION dash_sa_users(
  p_q text, p_status text, p_cursor_at timestamp, p_cursor_id text, p_limit int
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."createdAt" DESC, t.id DESC), '[]'::jsonb) FROM (
    SELECT u.id, u.username, u.email, u.name, u."isActive", (u."platformRole" = 'SUPERADMIN') IS TRUE AS superadmin,
           u."platformRole", r.nama AS "roleNama",
           u."bannedAt", u."bannedReason", u."lastLoginAt", u."createdAt", (u."googleSub" IS NOT NULL) AS google,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'workspaceId', m."workspaceId", 'role', m.role,
                     'nama', COALESCE(s."namaBrand", w.nama, m."workspaceId")) ORDER BY m."createdAt"), '[]'::jsonb)
            FROM "DashboardMembership" m
            LEFT JOIN "WorkspaceSettings" s ON s."workspaceId" = m."workspaceId"
            LEFT JOIN "Workspace" w ON w.id = m."workspaceId"
            WHERE m."userId" = u.id) AS workspaces
    FROM "DashboardUser" u
    LEFT JOIN "PlatformRole" r ON r.id = u."platformRole"
    WHERE (p_q IS NULL OR p_q = '' OR u.username ILIKE '%' || p_q || '%' ESCAPE '\'
           OR u.email ILIKE '%' || p_q || '%' ESCAPE '\' OR u.name ILIKE '%' || p_q || '%' ESCAPE '\')
      AND (p_status IS NULL
           OR (p_status = 'AKTIF' AND u."isActive")
           OR (p_status = 'DIBLOKIR' AND u."bannedAt" IS NOT NULL)
           OR (p_status = 'NONAKTIF' AND NOT u."isActive" AND u."bannedAt" IS NULL)
           OR (p_status = 'SUPERADMIN' AND u."platformRole" = 'SUPERADMIN')
           OR (p_status = 'STAF' AND u."platformRole" IS NOT NULL))
      AND (p_cursor_at IS NULL OR (u."createdAt", u.id) < (p_cursor_at, p_cursor_id))
    ORDER BY u."createdAt" DESC, u.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 26), 1), 101)
  ) t
$$;

-- Beri/cabut SUPERADMIN (versi sql/010) kini hanya boleh oleh SUPERADMIN; diteruskan ke fungsi peran umum.
CREATE OR REPLACE FUNCTION dash_sa_user_role(p_actor text, p_target text, p_super boolean, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_cur text;
BEGIN
  IF NOT dash_sa_super(p_actor) THEN RETURN 'FORBIDDEN'; END IF;
  SELECT "platformRole" INTO v_cur FROM "DashboardUser" WHERE id = p_target;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF p_super AND v_cur = 'SUPERADMIN' THEN RETURN 'ALREADY'; END IF;
  IF NOT p_super AND v_cur IS DISTINCT FROM 'SUPERADMIN' THEN RETURN 'ALREADY'; END IF;
  RETURN dash_sa_user_platform_role(p_actor, p_target, CASE WHEN p_super THEN 'SUPERADMIN' END, p_now);
END
$$;

-- Atur peran platform seorang pengguna (NULL = bukan staf). Hanya SUPERADMIN; tidak bisa mengubah peran
-- sendiri; SUPERADMIN aktif terakhir tidak bisa diturunkan.
-- Hasil: OK | FORBIDDEN | NOT_FOUND | SELF | NO_ROLE | INACTIVE | LAST | ALREADY
CREATE OR REPLACE FUNCTION dash_sa_user_platform_role(p_actor text, p_target text, p_role text, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE u "DashboardUser"%ROWTYPE;
BEGIN
  IF NOT dash_sa_super(p_actor) THEN RETURN 'FORBIDDEN'; END IF;
  IF p_actor = p_target THEN RETURN 'SELF'; END IF;
  IF p_role IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "PlatformRole" WHERE id = p_role) THEN RETURN 'NO_ROLE'; END IF;
  -- Satu kunci untuk semua perubahan peran: dua penurunan serentak tidak boleh menghabiskan super admin.
  PERFORM pg_advisory_xact_lock(hashtext('dash_sa_role'));
  SELECT * INTO u FROM "DashboardUser" WHERE id = p_target FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF u."platformRole" IS NOT DISTINCT FROM p_role THEN RETURN 'ALREADY'; END IF;
  IF p_role IS NOT NULL AND (NOT u."isActive" OR u."bannedAt" IS NOT NULL) THEN RETURN 'INACTIVE'; END IF;
  IF u."platformRole" = 'SUPERADMIN' AND u."isActive"
     AND (SELECT count(*) FROM "DashboardUser" WHERE "platformRole" = 'SUPERADMIN' AND "isActive") <= 1 THEN
    RETURN 'LAST';
  END IF;
  UPDATE "DashboardUser" SET "platformRole" = p_role, "updatedAt" = p_now WHERE id = p_target;
  PERFORM dash_sa_log(p_actor,
    CASE WHEN p_role = 'SUPERADMIN' THEN 'SUPERADMIN_BERI'
         WHEN u."platformRole" = 'SUPERADMIN' AND p_role IS NULL THEN 'SUPERADMIN_CABUT'
         ELSE 'AKSES_PERAN_PENGGUNA' END,
    'PENGGUNA', p_target,
    jsonb_build_object('username', u.username, 'dari', u."platformRole", 'ke', p_role), p_now);
  RETURN 'OK';
END
$$;

-- Admin membuat akun pengguna (tanpa workspace; tambahkan lewat modul Workspace atau tautan undangan).
-- p_user: { username, email, name, passwordHash }. Hasil: { status: OK|FORBIDDEN|USERNAME|EMAIL, id? }
CREATE OR REPLACE FUNCTION dash_sa_user_create(p_actor text, p_user jsonb, p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_username text := lower(btrim(p_user->>'username'));
  v_email text := NULLIF(lower(btrim(p_user->>'email')), '');
  v_id text;
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN jsonb_build_object('status', 'FORBIDDEN'); END IF;
  IF v_username IS NULL OR v_username = '' OR COALESCE(p_user->>'passwordHash', '') = '' THEN
    RAISE EXCEPTION 'data pengguna baru tidak lengkap' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM "DashboardUser" WHERE lower(username) = v_username) THEN RETURN jsonb_build_object('status', 'USERNAME'); END IF;
  IF v_email IS NOT NULL AND EXISTS (SELECT 1 FROM "DashboardUser" WHERE lower(email) = v_email) THEN RETURN jsonb_build_object('status', 'EMAIL'); END IF;
  -- id diisi eksplisit: tabel dibuat Prisma, kolomnya bisa tanpa default database.
  INSERT INTO "DashboardUser" (id, username, email, name, "passwordHash", "isActive", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, v_username, v_email, NULLIF(btrim(p_user->>'name'), ''), p_user->>'passwordHash', true, p_now, p_now)
  RETURNING id INTO v_id;
  PERFORM dash_sa_log(p_actor, 'PENGGUNA_BUAT', 'PENGGUNA', v_id, jsonb_build_object('username', v_username, 'email', v_email), p_now);
  RETURN jsonb_build_object('status', 'OK', 'id', v_id);
END
$$;

-- Admin mengubah nama dan/atau email pengguna. p_patch: { name?, email? } (kunci yang ada saja yang diubah).
-- Hasil: OK | FORBIDDEN | NOT_FOUND | EMAIL | NOOP
CREATE OR REPLACE FUNCTION dash_sa_user_update(p_actor text, p_target text, p_patch jsonb, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u "DashboardUser"%ROWTYPE;
  v_name text;
  v_email text;
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN 'FORBIDDEN'; END IF;
  SELECT * INTO u FROM "DashboardUser" WHERE id = p_target FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  v_name := CASE WHEN p_patch ? 'name' THEN NULLIF(btrim(p_patch->>'name'), '') ELSE u.name END;
  v_email := CASE WHEN p_patch ? 'email' THEN NULLIF(lower(btrim(p_patch->>'email')), '') ELSE u.email END;
  IF v_name IS NOT DISTINCT FROM u.name AND v_email IS NOT DISTINCT FROM u.email THEN RETURN 'NOOP'; END IF;
  IF v_email IS NOT NULL AND v_email IS DISTINCT FROM lower(u.email)
     AND EXISTS (SELECT 1 FROM "DashboardUser" WHERE lower(email) = v_email AND id <> p_target) THEN
    RETURN 'EMAIL';
  END IF;
  UPDATE "DashboardUser" SET name = v_name, email = v_email, "updatedAt" = p_now WHERE id = p_target;
  PERFORM dash_sa_log(p_actor, 'PENGGUNA_UBAH', 'PENGGUNA', p_target,
    jsonb_build_object('username', u.username,
                       'nama', CASE WHEN v_name IS DISTINCT FROM u.name THEN jsonb_build_object('dari', u.name, 'ke', v_name) END,
                       'email', CASE WHEN v_email IS DISTINCT FROM u.email THEN jsonb_build_object('dari', u.email, 'ke', v_email) END),
    p_now);
  RETURN 'OK';
END
$$;

-- ------------------------------------------------------------------ peran

-- Semua peran beserta jumlah staf aktif yang memegangnya.
CREATE OR REPLACE FUNCTION dash_sa_roles() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.urutan, t.id), '[]'::jsonb) FROM (
    SELECT r.id, r.nama, r.deskripsi, r.izin, r.sistem, r.urutan,
           (SELECT count(*) FROM "DashboardUser" u WHERE u."platformRole" = r.id AND u."isActive")::int AS anggota
    FROM "PlatformRole" r
  ) t
$$;

-- Buat atau ubah peran. p_role: { id, nama, deskripsi, izin[] }. Peran sistem tidak bisa diubah.
-- Hasil: OK | FORBIDDEN | SYSTEM | INVALID
CREATE OR REPLACE FUNCTION dash_sa_role_upsert(p_actor text, p_role jsonb, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id text := upper(btrim(p_role->>'id'));
  v_izin text[];
  v_baru boolean;
BEGIN
  IF NOT dash_sa_super(p_actor) THEN RETURN 'FORBIDDEN'; END IF;
  IF v_id IS NULL OR v_id !~ '^[A-Z][A-Z0-9_]{1,31}$' THEN RETURN 'INVALID'; END IF;
  IF EXISTS (SELECT 1 FROM "PlatformRole" WHERE id = v_id AND sistem) THEN RETURN 'SYSTEM'; END IF;
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}') INTO v_izin
  FROM jsonb_array_elements_text(COALESCE(p_role->'izin', '[]'::jsonb)) x;
  IF NOT v_izin <@ dash_sa_izin_valid() THEN RETURN 'INVALID'; END IF;
  v_baru := NOT EXISTS (SELECT 1 FROM "PlatformRole" WHERE id = v_id);
  INSERT INTO "PlatformRole" (id, nama, deskripsi, izin, sistem, urutan, "createdAt", "updatedAt")
  VALUES (v_id, btrim(p_role->>'nama'), NULLIF(btrim(p_role->>'deskripsi'), ''), v_izin, false,
          COALESCE((p_role->>'urutan')::smallint, 50), p_now, p_now)
  ON CONFLICT (id) DO UPDATE SET nama = EXCLUDED.nama, deskripsi = EXCLUDED.deskripsi, izin = EXCLUDED.izin, "updatedAt" = p_now;
  PERFORM dash_sa_log(p_actor, CASE WHEN v_baru THEN 'AKSES_PERAN_BUAT' ELSE 'AKSES_PERAN_UBAH' END, 'AKSES', v_id,
    jsonb_build_object('nama', btrim(p_role->>'nama'), 'izin', to_jsonb(v_izin)), p_now);
  RETURN 'OK';
END
$$;

-- Hapus peran yang tidak dipegang siapa pun. Hasil: OK | FORBIDDEN | NOT_FOUND | SYSTEM | IN_USE
CREATE OR REPLACE FUNCTION dash_sa_role_delete(p_actor text, p_id text, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r "PlatformRole"%ROWTYPE;
BEGIN
  IF NOT dash_sa_super(p_actor) THEN RETURN 'FORBIDDEN'; END IF;
  SELECT * INTO r FROM "PlatformRole" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF r.sistem THEN RETURN 'SYSTEM'; END IF;
  IF EXISTS (SELECT 1 FROM "DashboardUser" WHERE "platformRole" = p_id) THEN RETURN 'IN_USE'; END IF;
  DELETE FROM "PlatformRole" WHERE id = p_id;
  PERFORM dash_sa_log(p_actor, 'AKSES_PERAN_HAPUS', 'AKSES', p_id, jsonb_build_object('nama', r.nama), p_now);
  RETURN 'OK';
END
$$;

-- Staf platform saat ini (untuk halaman Hak Akses): semua pengguna yang memegang peran apa pun.
CREATE OR REPLACE FUNCTION dash_sa_staff() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.urutan, t.username), '[]'::jsonb) FROM (
    SELECT u.id, u.username, u.email, u.name, u."isActive", u."lastLoginAt", u."platformRole", r.nama AS "roleNama", r.urutan
    FROM "DashboardUser" u JOIN "PlatformRole" r ON r.id = u."platformRole"
  ) t
$$;

-- ------------------------------------------------------------------ hak akses

-- Sama seperti sql/010: hanya server dashboard (service_role) yang boleh memanggil fungsi dash_sa_*.
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
