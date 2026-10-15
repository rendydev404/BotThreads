-- =============================================================================
-- Paket langganan: batas per workspace (akun ber-autopilot, posting per hari, anggota tim, mode
-- Otomatis) yang ditentukan paketnya. Paket adalah DATA yang diisi super admin dari panel /admin;
-- tidak ada paket atau harga bawaan.
--
-- ADITIF dan idempoten. Prasyarat: sql/005, sql/008, dan sql/010 sudah dijalankan. Jalankan MANUAL di
-- SQL Editor Supabase oleh pemilik.
--
-- Aturan: workspace tanpa paket memakai "paket bawaan" platform bila ada; bila tidak ada paket bawaan,
-- workspace itu tanpa batas (perilaku sebelum berkas ini). Paket yang lewat masa berlakunya membuat
-- autopilot workspace itu berhenti sampai diperpanjang; datanya tetap bisa dibuka.
-- Pembayaran belum otomatis: super admin memasang paket dan masa berlakunya setelah menerima pembayaran.
--
-- Berkas ini juga menurunkan batas bawah posting per hari dari 3 menjadi 1, supaya paket kecil mungkin.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "Plan" (
  id                  text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
  nama                text NOT NULL,
  deskripsi           text,
  -- Rupiah per bulan; 0 = gratis. Hanya untuk ditampilkan: penagihan belum otomatis.
  "hargaBulanan"      integer NOT NULL DEFAULT 0 CHECK ("hargaBulanan" >= 0),
  -- Jumlah akun Threads yang autopilot-nya boleh menyala bersamaan.
  "maxAkun"           integer NOT NULL CHECK ("maxAkun" BETWEEN 1 AND 1000),
  "maxPostingPerHari" smallint NOT NULL CHECK ("maxPostingPerHari" BETWEEN 1 AND 6),
  -- Anggota tim termasuk undangan yang belum diterima.
  "maxAnggota"        integer NOT NULL CHECK ("maxAnggota" BETWEEN 1 AND 1000),
  -- False = hanya mode Tinjau dulu.
  "modeOtomatis"      boolean NOT NULL DEFAULT true,
  -- Ditampilkan di halaman perkenalan.
  publik              boolean NOT NULL DEFAULT true,
  aktif               boolean NOT NULL DEFAULT true,
  urutan              smallint NOT NULL DEFAULT 0,
  "updatedBy"         text,
  "updatedAt"         timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);

ALTER TABLE "WorkspaceSettings" ADD COLUMN IF NOT EXISTS "planId" text;
-- NULL = tanpa batas waktu.
ALTER TABLE "WorkspaceSettings" ADD COLUMN IF NOT EXISTS "planBerakhir" timestamp(3);
ALTER TABLE "PlatformSettings" ADD COLUMN IF NOT EXISTS "planBawaan" text;

ALTER TABLE "AutopilotConfig" DROP CONSTRAINT IF EXISTS "AutopilotConfig_postsPerDay_check";
ALTER TABLE "AutopilotConfig" ADD CONSTRAINT "AutopilotConfig_postsPerDay_check" CHECK ("postsPerDay" BETWEEN 1 AND 6);

ALTER TABLE "Plan" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Plan" FROM anon, authenticated;

-- ------------------------------------------------------------------ baca

-- Daftar paket. p_public = true: hanya yang aktif dan publik (halaman perkenalan).
CREATE OR REPLACE FUNCTION dash_plan_list(p_public boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.urutan, t."hargaBulanan", t.id), '[]'::jsonb) FROM (
    SELECT p.id, p.nama, p.deskripsi, p."hargaBulanan", p."maxAkun", p."maxPostingPerHari", p."maxAnggota",
           p."modeOtomatis", p.publik, p.aktif, p.urutan,
           (p.id = (SELECT "planBawaan" FROM "PlatformSettings" WHERE id = 1)) IS TRUE AS bawaan,
           (SELECT count(*) FROM "WorkspaceSettings" s WHERE s."planId" = p.id) AS dipakai
    FROM "Plan" p
    WHERE NOT COALESCE(p_public, false) OR (p.aktif AND p.publik)
  ) t
$$;

-- Paket yang berlaku untuk sebuah workspace beserta pemakaiannya. `plan` NULL = tanpa batas.
CREATE OR REPLACE FUNCTION dash_plan_limits(p_ws text, p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH s AS (
    SELECT "planId", "planBerakhir" FROM "WorkspaceSettings" WHERE "workspaceId" = p_ws
  ), pilih AS (
    SELECT COALESCE((SELECT "planId" FROM s), (SELECT "planBawaan" FROM "PlatformSettings" WHERE id = 1)) AS id,
           ((SELECT "planId" FROM s) IS NULL) AS bawaan
  )
  SELECT jsonb_build_object(
    'plan', (SELECT to_jsonb(t) FROM (
        SELECT p.id, p.nama, p."hargaBulanan", p."maxAkun", p."maxPostingPerHari", p."maxAnggota", p."modeOtomatis"
        FROM "Plan" p JOIN pilih ON pilih.id = p.id) t),
    'bawaan', (SELECT bawaan FROM pilih),
    'berakhir', (SELECT "planBerakhir" FROM s WHERE "planId" IS NOT NULL),
    'kedaluwarsa', COALESCE((SELECT "planId" IS NOT NULL AND "planBerakhir" IS NOT NULL AND "planBerakhir" <= p_now FROM s), false),
    'pakai', jsonb_build_object(
      'akun', (SELECT count(*) FROM "AutopilotConfig" c WHERE c."workspaceId" = p_ws AND c.mode <> 'MATI'),
      'anggota', (SELECT count(*) FROM "DashboardMembership" m WHERE m."workspaceId" = p_ws)
               + (SELECT count(*) FROM "DashboardInvite" i WHERE i."workspaceId" = p_ws AND i."acceptedAt" IS NULL AND i."expiresAt" > p_now)))
$$;

-- Workspace yang paketnya sudah lewat masa berlaku (autopilotnya dihentikan oleh tick).
CREATE OR REPLACE FUNCTION dash_plan_expired(p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg("workspaceId"), '[]'::jsonb) FROM "WorkspaceSettings"
  WHERE "planId" IS NOT NULL AND "planBerakhir" IS NOT NULL AND "planBerakhir" <= p_now
$$;

-- ------------------------------------------------------------------ kelola (super admin)

-- Buat atau ubah paket. Hasil: OK | FORBIDDEN
CREATE OR REPLACE FUNCTION dash_sa_plan_upsert(p_actor text, p_plan jsonb, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN 'FORBIDDEN'; END IF;
  INSERT INTO "Plan" (id, nama, deskripsi, "hargaBulanan", "maxAkun", "maxPostingPerHari", "maxAnggota", "modeOtomatis",
                      publik, aktif, urutan, "updatedBy", "updatedAt")
  VALUES (p_plan->>'id', p_plan->>'nama', NULLIF(p_plan->>'deskripsi', ''), (p_plan->>'hargaBulanan')::integer,
          (p_plan->>'maxAkun')::integer, (p_plan->>'maxPostingPerHari')::smallint, (p_plan->>'maxAnggota')::integer,
          (p_plan->>'modeOtomatis')::boolean, (p_plan->>'publik')::boolean, (p_plan->>'aktif')::boolean,
          COALESCE((p_plan->>'urutan')::smallint, 0), p_actor, p_now)
  ON CONFLICT (id) DO UPDATE SET
    nama = EXCLUDED.nama, deskripsi = EXCLUDED.deskripsi, "hargaBulanan" = EXCLUDED."hargaBulanan",
    "maxAkun" = EXCLUDED."maxAkun", "maxPostingPerHari" = EXCLUDED."maxPostingPerHari", "maxAnggota" = EXCLUDED."maxAnggota",
    "modeOtomatis" = EXCLUDED."modeOtomatis", publik = EXCLUDED.publik, aktif = EXCLUDED.aktif, urutan = EXCLUDED.urutan,
    "updatedBy" = p_actor, "updatedAt" = p_now;
  PERFORM dash_sa_log(p_actor, 'PAKET_SIMPAN', 'SISTEM', p_plan->>'id', p_plan, p_now);
  RETURN 'OK';
END
$$;

-- Hapus paket yang tidak dipakai workspace mana pun. Hasil: OK | FORBIDDEN | NOT_FOUND | IN_USE
CREATE OR REPLACE FUNCTION dash_sa_plan_delete(p_actor text, p_id text, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN 'FORBIDDEN'; END IF;
  IF EXISTS (SELECT 1 FROM "WorkspaceSettings" WHERE "planId" = p_id)
     OR EXISTS (SELECT 1 FROM "PlatformSettings" WHERE id = 1 AND "planBawaan" = p_id) THEN
    RETURN 'IN_USE';
  END IF;
  DELETE FROM "Plan" WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  PERFORM dash_sa_log(p_actor, 'PAKET_HAPUS', 'SISTEM', p_id, '{}'::jsonb, p_now);
  RETURN 'OK';
END
$$;

-- Paket bawaan untuk workspace yang belum dipasangi paket (NULL = tanpa batas). Hasil: OK | FORBIDDEN | NO_PLAN
CREATE OR REPLACE FUNCTION dash_sa_plan_default(p_actor text, p_id text, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN 'FORBIDDEN'; END IF;
  IF p_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Plan" WHERE id = p_id AND aktif) THEN RETURN 'NO_PLAN'; END IF;
  UPDATE "PlatformSettings" SET "planBawaan" = p_id, "updatedBy" = p_actor, "updatedAt" = p_now WHERE id = 1;
  PERFORM dash_sa_log(p_actor, 'PAKET_BAWAAN', 'SISTEM', p_id, '{}'::jsonb, p_now);
  RETURN 'OK';
END
$$;

-- Pasang paket ke workspace (p_plan NULL = kembali ke paket bawaan). p_until NULL = tanpa batas waktu.
-- Hasil: OK | FORBIDDEN | NOT_FOUND | NO_PLAN
CREATE OR REPLACE FUNCTION dash_sa_workspace_plan(p_actor text, p_ws text, p_plan text, p_until timestamp, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN 'FORBIDDEN'; END IF;
  IF NOT dash_sa_tenant_exists(p_ws) THEN RETURN 'NOT_FOUND'; END IF;
  IF p_plan IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Plan" WHERE id = p_plan) THEN RETURN 'NO_PLAN'; END IF;
  INSERT INTO "WorkspaceSettings" ("workspaceId", "planId", "planBerakhir", "updatedBy", "updatedAt")
  VALUES (p_ws, p_plan, CASE WHEN p_plan IS NULL THEN NULL ELSE p_until END, p_actor, p_now)
  ON CONFLICT ("workspaceId") DO UPDATE SET
    "planId" = EXCLUDED."planId", "planBerakhir" = EXCLUDED."planBerakhir", "updatedBy" = p_actor, "updatedAt" = p_now;
  PERFORM dash_sa_log(p_actor, 'WORKSPACE_PAKET', 'WORKSPACE', p_ws, jsonb_build_object('paket', p_plan, 'sampai', p_until), p_now);
  RETURN 'OK';
END
$$;

-- Daftar workspace untuk panel admin ikut memuat paketnya (definisi dari sql/010 + dua kolom paket).
CREATE OR REPLACE FUNCTION dash_sa_workspace_plans() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_object_agg(s."workspaceId", jsonb_build_object('planId', s."planId", 'planBerakhir', s."planBerakhir")), '{}'::jsonb)
  FROM "WorkspaceSettings" s WHERE s."planId" IS NOT NULL
$$;

-- ------------------------------------------------------------------ hak akses

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND (p.proname LIKE 'dash\_plan\_%' OR p.proname LIKE 'dash\_sa\_%')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
