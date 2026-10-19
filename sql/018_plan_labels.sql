-- Label rekomendasi/terlaris untuk kartu paket. ADITIF dan idempoten.
-- Prasyarat: sql/011_plans.sql sudah dijalankan. Jalankan MANUAL di SQL Editor Supabase oleh pemilik.

ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS label text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"Plan"'::regclass AND conname = 'Plan_label_check'
  ) THEN
    ALTER TABLE "Plan" ADD CONSTRAINT "Plan_label_check"
      CHECK (label IS NULL OR label IN ('REKOMENDASI', 'TERLARIS'));
  END IF;
END
$$;

-- Sertakan label di hasil untuk halaman publik dan Super Admin.
CREATE OR REPLACE FUNCTION dash_plan_list(p_public boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.urutan, t."hargaBulanan", t.id), '[]'::jsonb) FROM (
    SELECT p.id, p.nama, p.deskripsi, p.label, p."hargaBulanan", p."maxAkun", p."maxPostingPerHari", p."maxAnggota",
           p."modeOtomatis", p.publik, p.aktif, p.urutan,
           (p.id = (SELECT "planBawaan" FROM "PlatformSettings" WHERE id = 1)) IS TRUE AS bawaan,
           (SELECT count(*) FROM "WorkspaceSettings" s WHERE s."planId" = p.id) AS dipakai
    FROM "Plan" p
    WHERE NOT COALESCE(p_public, false) OR (p.aktif AND p.publik)
  ) t
$$;

-- Simpan label melalui jalur RPC Super Admin yang sudah ada.
CREATE OR REPLACE FUNCTION dash_sa_plan_upsert_v2(p_actor text, p_plan jsonb, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN 'FORBIDDEN'; END IF;
  INSERT INTO "Plan" (id, nama, deskripsi, label, "hargaBulanan", "maxAkun", "maxPostingPerHari", "maxAnggota", "modeOtomatis",
                      publik, aktif, urutan, "updatedBy", "updatedAt")
  VALUES (p_plan->>'id', p_plan->>'nama', NULLIF(p_plan->>'deskripsi', ''), NULLIF(p_plan->>'label', ''),
          (p_plan->>'hargaBulanan')::integer, (p_plan->>'maxAkun')::integer, (p_plan->>'maxPostingPerHari')::smallint,
          (p_plan->>'maxAnggota')::integer, (p_plan->>'modeOtomatis')::boolean, (p_plan->>'publik')::boolean,
          (p_plan->>'aktif')::boolean, COALESCE((p_plan->>'urutan')::smallint, 0), p_actor, p_now)
  ON CONFLICT (id) DO UPDATE SET
    nama = EXCLUDED.nama, deskripsi = EXCLUDED.deskripsi, label = EXCLUDED.label,
    "hargaBulanan" = EXCLUDED."hargaBulanan", "maxAkun" = EXCLUDED."maxAkun",
    "maxPostingPerHari" = EXCLUDED."maxPostingPerHari", "maxAnggota" = EXCLUDED."maxAnggota",
    "modeOtomatis" = EXCLUDED."modeOtomatis", publik = EXCLUDED.publik, aktif = EXCLUDED.aktif, urutan = EXCLUDED.urutan,
    "updatedBy" = p_actor, "updatedAt" = p_now;
  PERFORM dash_sa_log(p_actor, 'PAKET_SIMPAN', 'SISTEM', p_plan->>'id', p_plan, p_now);
  RETURN 'OK';
END
$$;

REVOKE ALL ON FUNCTION dash_sa_plan_upsert_v2(text, jsonb, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_sa_plan_upsert_v2(text, jsonb, timestamp) TO service_role;

NOTIFY pgrst, 'reload schema';
