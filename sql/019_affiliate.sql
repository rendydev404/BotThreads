-- =============================================================================
-- Shopee Affiliate di autopilot Threads (docs/specs/2026-10-16-shopee-affiliate-design.md).
--
-- ADITIF dan idempoten. Prasyarat: sql/005_autopilot.sql. Jalankan MANUAL di SQL Editor Supabase oleh
-- pemilik; aman dijalankan ulang. Tidak mengubah fungsi dash_ap_* yang sudah ada, jadi urutan dengan
-- berkas SQL lain tidak penting.
--
-- - "AffiliateProduct"   : katalog produk per niche (tingkat workspace/tenant), link affiliate Shopee.
-- - "AffiliateConfig"    : pengaturan affiliate per akun Threads (saklar, batas, niche, teks balasan).
-- - "AffiliateWorkspace" : saklar "jeda semua affiliate" per workspace.
-- - "AffiliateUse"       : satu baris per slot autopilot yang ditulis sebagai postingan affiliate, sekaligus
--                          antrean balasan pertama berisi link (dikerjakan worker auto-suka).
-- =============================================================================

CREATE TABLE IF NOT EXISTS "AffiliateProduct" (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspaceId" text NOT NULL,
  nama          text NOT NULL,
  link          text NOT NULL,
  niche         text[] NOT NULL DEFAULT '{}',
  catatan       text NOT NULL DEFAULT '',                -- fakta produk: satu-satunya sumber klaim untuk AI
  aktif         boolean NOT NULL DEFAULT true,
  "updatedBy"   text,
  "createdAt"   timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updatedAt"   timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS "AffiliateProduct_ws_idx" ON "AffiliateProduct" ("workspaceId", aktif);

CREATE TABLE IF NOT EXISTS "AffiliateConfig" (
  "accountId"       text PRIMARY KEY,
  "workspaceId"     text NOT NULL,
  aktif             boolean NOT NULL DEFAULT false,
  "perHari"         smallint NOT NULL DEFAULT 1 CHECK ("perHari" BETWEEN 0 AND 6),
  porsi             real NOT NULL DEFAULT 0.3 CHECK (porsi BETWEEN 0 AND 1),
  "jarakJam"        smallint NOT NULL DEFAULT 4 CHECK ("jarakJam" BETWEEN 0 AND 12),
  "jedaHari"        smallint NOT NULL DEFAULT 14 CHECK ("jedaHari" BETWEEN 0 AND 60),
  niche             text[] NOT NULL DEFAULT '{}',
  "templateBalasan" text NOT NULL,
  "updatedBy"       text,
  "updatedAt"       timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS "AffiliateConfig_ws_idx" ON "AffiliateConfig" ("workspaceId");

CREATE TABLE IF NOT EXISTS "AffiliateWorkspace" (
  "workspaceId" text PRIMARY KEY,
  aktif         boolean NOT NULL DEFAULT true,
  "updatedBy"   text,
  "updatedAt"   timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS "AffiliateUse" (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "slotId"      text NOT NULL UNIQUE,                    -- AutopilotSlot.id (satu slot = satu postingan)
  "workspaceId" text NOT NULL,
  "accountId"   text NOT NULL,
  "productId"   text NOT NULL,
  "dayKey"      date NOT NULL,
  "slotAt"      timestamp(3) NOT NULL,
  "replyText"   text NOT NULL,
  "delayDetik"  smallint NOT NULL DEFAULT 120 CHECK ("delayDetik" BETWEEN 0 AND 900),
  status        text NOT NULL DEFAULT 'MENUNGGU' CHECK (status IN ('MENUNGGU', 'TERKIRIM', 'GAGAL', 'BATAL')),
  attempts      smallint NOT NULL DEFAULT 0,
  "nextAt"      timestamp(3),                            -- kunci sementara / jadwal coba ulang worker
  "replyPostId" text,
  error         text,
  "createdAt"   timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updatedAt"   timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS "AffiliateUse_akun_produk_idx" ON "AffiliateUse" ("accountId", "productId", "slotAt" DESC);
CREATE INDEX IF NOT EXISTS "AffiliateUse_ws_hari_idx" ON "AffiliateUse" ("workspaceId", "dayKey");
-- Antrean worker: hanya balasan yang belum dikirim.
CREATE INDEX IF NOT EXISTS "AffiliateUse_antre_idx" ON "AffiliateUse" ("slotAt") WHERE status = 'MENUNGGU';

ALTER TABLE "AffiliateProduct"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AffiliateConfig"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AffiliateWorkspace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AffiliateUse"       ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AffiliateProduct", "AffiliateConfig", "AffiliateWorkspace", "AffiliateUse" FROM anon, authenticated;

-- ------------------------------------------------------------------ tick autopilot

-- Semua yang dibutuhkan undian slot affiliate untuk akun-akun yang sedang ditulis, dalam satu panggilan.
-- p_from: hari (WIB) paling awal slot yang ditulis. Agregasi dikerjakan di sini, bukan di aplikasi.
CREATE OR REPLACE FUNCTION dash_aff_state(p_account_ids text[], p_from date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH cfg AS (
    SELECT * FROM "AffiliateConfig" WHERE "accountId" = ANY(p_account_ids)
  ), ws AS (
    SELECT DISTINCT "workspaceId" FROM cfg
  ), uses AS (
    -- Pemakaian yang masih berlaku: belum dibatalkan, slotnya tidak dilewati/gagal, dan draf slotnya (bila
    -- sudah ada) memang affiliate untuk produk yang sama. Slot yang ditulis ulang menjadi postingan biasa
    -- tidak ikut terhitung.
    SELECT u."slotId", u."workspaceId", u."accountId", u."productId", u."dayKey", u."slotAt"
    FROM "AffiliateUse" u
    JOIN "AutopilotSlot" s ON s.id = u."slotId"
    WHERE u."workspaceId" IN (SELECT "workspaceId" FROM ws) AND u."dayKey" >= p_from - 60
      AND u.status <> 'BATAL'
      AND s.status NOT IN ('DILEWATI', 'DIBATALKAN', 'GAGAL')
      AND (s.draft IS NULL OR s.draft->'affiliate'->>'productId' = u."productId")
  )
  SELECT jsonb_build_object(
    'configs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'accountId', c."accountId", 'workspaceId', c."workspaceId", 'aktif', c.aktif, 'perHari', c."perHari",
        'porsi', c.porsi, 'jarakJam', c."jarakJam", 'jedaHari', c."jedaHari", 'niche', c.niche,
        'templateBalasan', c."templateBalasan")) FROM cfg c), '[]'::jsonb),
    'paused', COALESCE((SELECT jsonb_agg(w."workspaceId") FROM "AffiliateWorkspace" w
                        WHERE w.aktif = false AND w."workspaceId" IN (SELECT "workspaceId" FROM ws)), '[]'::jsonb),
    'products', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'workspaceId', p."workspaceId", 'nama', p.nama, 'link', p.link, 'niche', p.niche, 'catatan', p.catatan)
        ORDER BY p."createdAt", p.id)
        FROM "AffiliateProduct" p WHERE p.aktif AND p."workspaceId" IN (SELECT "workspaceId" FROM ws)), '[]'::jsonb),
    -- Pemakaian di sekitar hari yang ditulis: batas harian, jarak jam, dan produk kembar antar-akun.
    'recent', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'slotId', u."slotId", 'accountId', u."accountId", 'workspaceId', u."workspaceId", 'productId', u."productId",
        'dayKey', u."dayKey", 'slotAt', u."slotAt"))
        FROM uses u WHERE u."dayKey" >= p_from - 1), '[]'::jsonb),
    -- Terakhir kali tiap akun memakai tiap produk (60 hari): jeda produk dan rotasi.
    'lastUse', COALESCE((SELECT jsonb_agg(jsonb_build_object('accountId', l."accountId", 'productId', l."productId", 'lastAt', l.at))
        FROM (SELECT u."accountId", u."productId", max(u."slotAt") AS at FROM uses u
              WHERE u."accountId" = ANY(p_account_ids)
              GROUP BY u."accountId", u."productId") l), '[]'::jsonb)
  )
$$;

-- Catat slot yang ditulis sebagai affiliate (upsert per slot: tulis ulang mengganti produk dan teks balasan).
CREATE OR REPLACE FUNCTION dash_aff_use_save(p_item jsonb, p_now timestamp) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO "AffiliateUse" ("slotId", "workspaceId", "accountId", "productId", "dayKey", "slotAt", "replyText",
                              "delayDetik", status, attempts, "nextAt", "replyPostId", error, "createdAt", "updatedAt")
  VALUES (p_item->>'slotId', p_item->>'workspaceId', p_item->>'accountId', p_item->>'productId',
          (p_item->>'dayKey')::date, (p_item->>'slotAt')::timestamp, p_item->>'replyText',
          COALESCE((p_item->>'delayDetik')::smallint, 120), 'MENUNGGU', 0, NULL, NULL, NULL, p_now, p_now)
  ON CONFLICT ("slotId") DO UPDATE SET
    "productId" = EXCLUDED."productId", "dayKey" = EXCLUDED."dayKey", "slotAt" = EXCLUDED."slotAt",
    "replyText" = EXCLUDED."replyText", "delayDetik" = EXCLUDED."delayDetik",
    status = 'MENUNGGU', attempts = 0, "nextAt" = NULL, "replyPostId" = NULL, error = NULL, "updatedAt" = p_now
  WHERE "AffiliateUse".status <> 'TERKIRIM'
  RETURNING id
$$;

-- ------------------------------------------------------------------ dashboard

-- Isi tab Affiliate: saklar workspace, pengaturan akun yang terlihat, katalog, dan laporan 30 hari.
CREATE OR REPLACE FUNCTION dash_aff_overview(p_workspace text, p_account_ids text[], p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH uses AS (
    SELECT u.*, s.status AS "slotStatus", s."postId"
    FROM "AffiliateUse" u
    JOIN "AutopilotSlot" s ON s.id = u."slotId"
    WHERE u."workspaceId" = p_workspace AND u."slotAt" >= p_now - interval '30 days'
      AND (p_account_ids IS NULL OR u."accountId" = ANY(p_account_ids))
      AND (s.draft IS NULL OR s.draft->'affiliate'->>'productId' = u."productId")
  )
  SELECT jsonb_build_object(
    'aktif', COALESCE((SELECT w.aktif FROM "AffiliateWorkspace" w WHERE w."workspaceId" = p_workspace), true),
    'configs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'accountId', c."accountId", 'aktif', c.aktif, 'perHari', c."perHari", 'porsi', c.porsi, 'jarakJam', c."jarakJam",
        'jedaHari', c."jedaHari", 'niche', c.niche, 'templateBalasan', c."templateBalasan", 'updatedAt', c."updatedAt"))
        FROM "AffiliateConfig" c
        WHERE c."workspaceId" = p_workspace AND (p_account_ids IS NULL OR c."accountId" = ANY(p_account_ids))), '[]'::jsonb),
    'products', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'nama', p.nama, 'link', p.link, 'niche', p.niche, 'catatan', p.catatan, 'aktif', p.aktif,
        'updatedAt', p."updatedAt",
        'dipakai30', (SELECT count(*) FROM uses u WHERE u."productId" = p.id AND u."slotStatus" = 'TERBIT'),
        'terakhir', (SELECT max(u."slotAt") FROM uses u WHERE u."productId" = p.id AND u."slotStatus" = 'TERBIT'))
        ORDER BY p.aktif DESC, p."createdAt" DESC, p.id)
        FROM "AffiliateProduct" p WHERE p."workspaceId" = p_workspace), '[]'::jsonb),
    'recent', COALESCE((SELECT jsonb_agg(r ORDER BY r."slotAt" DESC, r.id) FROM (
        SELECT u.id, u."accountId", u."productId", p.nama AS "produk", u."slotAt", u."slotStatus", u.status AS "balasan",
               u.error, d."releaseUrl"
        FROM uses u
        LEFT JOIN "AffiliateProduct" p ON p.id = u."productId"
        LEFT JOIN LATERAL (SELECT x."releaseUrl" FROM "PostDispatch" x WHERE x."postId" = u."postId" LIMIT 1) d ON true
        WHERE u."slotStatus" NOT IN ('DILEWATI', 'DIBATALKAN')
        ORDER BY u."slotAt" DESC, u.id
        LIMIT 50) r), '[]'::jsonb),
    'summary', (SELECT jsonb_build_object(
        'terbit', count(*) FILTER (WHERE u."slotStatus" = 'TERBIT'),
        'terjadwal', count(*) FILTER (WHERE u."slotStatus" IN ('MENUNGGU_TINJAU', 'TERANTRE', 'MENULIS', 'DIRENCANAKAN')),
        'balasanTerkirim', count(*) FILTER (WHERE u.status = 'TERKIRIM'),
        'balasanGagal', count(*) FILTER (WHERE u.status = 'GAGAL')) FROM uses u)
  )
$$;

-- Tambah (p_item.id kosong) atau ubah produk katalog. NULL bila produk tidak ditemukan di workspace itu.
CREATE OR REPLACE FUNCTION dash_aff_product_upsert(p_item jsonb, p_user text, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id text := NULLIF(p_item->>'id', '');
  v_niche text[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_item->'niche', '[]'::jsonb)));
BEGIN
  IF v_id IS NULL THEN
    INSERT INTO "AffiliateProduct" ("workspaceId", nama, link, niche, catatan, aktif, "updatedBy", "createdAt", "updatedAt")
    VALUES (p_item->>'workspaceId', p_item->>'nama', p_item->>'link', v_niche, COALESCE(p_item->>'catatan', ''),
            COALESCE((p_item->>'aktif')::boolean, true), p_user, p_now, p_now)
    RETURNING id INTO v_id;
  ELSE
    UPDATE "AffiliateProduct" SET nama = p_item->>'nama', link = p_item->>'link', niche = v_niche,
           catatan = COALESCE(p_item->>'catatan', ''), aktif = COALESCE((p_item->>'aktif')::boolean, aktif),
           "updatedBy" = p_user, "updatedAt" = p_now
    WHERE id = v_id AND "workspaceId" = p_item->>'workspaceId';
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (p_item->>'workspaceId', p_user, 'AFFILIATE_PRODUK_SIMPAN', v_id, jsonb_build_object('nama', p_item->>'nama'), p_now);
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION dash_aff_product_delete(p_id text, p_workspace text, p_user text, p_now timestamp) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM "AffiliateProduct" WHERE id = p_id AND "workspaceId" = p_workspace;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  -- Balasan yang belum terkirim untuk produk ini tidak boleh lagi mengirim link-nya.
  UPDATE "AffiliateUse" SET status = 'BATAL', error = 'Produk dihapus dari katalog.', "updatedAt" = p_now
  WHERE "productId" = p_id AND status = 'MENUNGGU';
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (p_workspace, p_user, 'AFFILIATE_PRODUK_HAPUS', p_id, '{}'::jsonb, p_now);
  RETURN TRUE;
END
$$;

-- p_items: baris AffiliateConfig lengkap (server yang memvalidasi dan menggabungkan nilai bawaan).
CREATE OR REPLACE FUNCTION dash_aff_config_upsert(p_items jsonb, p_user text, p_now timestamp) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n integer;
BEGIN
  INSERT INTO "AffiliateConfig" ("accountId", "workspaceId", aktif, "perHari", porsi, "jarakJam", "jedaHari", niche,
                                 "templateBalasan", "updatedBy", "updatedAt")
  SELECT it->>'accountId', it->>'workspaceId', (it->>'aktif')::boolean, (it->>'perHari')::smallint, (it->>'porsi')::real,
         (it->>'jarakJam')::smallint, (it->>'jedaHari')::smallint,
         ARRAY(SELECT jsonb_array_elements_text(COALESCE(it->'niche', '[]'::jsonb))), it->>'templateBalasan', p_user, p_now
  FROM jsonb_array_elements(p_items) it
  ON CONFLICT ("accountId") DO UPDATE SET
    "workspaceId" = EXCLUDED."workspaceId", aktif = EXCLUDED.aktif, "perHari" = EXCLUDED."perHari", porsi = EXCLUDED.porsi,
    "jarakJam" = EXCLUDED."jarakJam", "jedaHari" = EXCLUDED."jedaHari", niche = EXCLUDED.niche,
    "templateBalasan" = EXCLUDED."templateBalasan", "updatedBy" = p_user, "updatedAt" = p_now;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  SELECT DISTINCT it->>'workspaceId', p_user, 'AFFILIATE_ATUR', NULL::text,
         jsonb_build_object('akun', (SELECT jsonb_agg(x->>'accountId') FROM jsonb_array_elements(p_items) x)), p_now
  FROM jsonb_array_elements(p_items) it;
  RETURN v_n;
END
$$;

CREATE OR REPLACE FUNCTION dash_aff_workspace_set(p_workspace text, p_aktif boolean, p_user text, p_now timestamp) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO "AffiliateWorkspace" ("workspaceId", aktif, "updatedBy", "updatedAt")
  VALUES (p_workspace, p_aktif, p_user, p_now)
  ON CONFLICT ("workspaceId") DO UPDATE SET aktif = EXCLUDED.aktif, "updatedBy" = p_user, "updatedAt" = p_now;
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (p_workspace, p_user, CASE WHEN p_aktif THEN 'AFFILIATE_LANJUT' ELSE 'AFFILIATE_JEDA' END, NULL, '{}'::jsonb, p_now);
  RETURN p_aktif;
END
$$;

-- ------------------------------------------------------------------ worker auto-suka (balasan pertama)

-- Ambil dan kunci balasan yang sudah waktunya dikirim: postingan utama sudah TERBIT di Threads dan
-- jedanya sudah lewat. Sekaligus membatalkan balasan yang tidak akan pernah bisa dikirim (slot
-- dilewati/gagal, draf bukan affiliate lagi, posting gagal, atau menunggu lebih dari 2 hari).
-- Aman dipanggil serentak (FOR UPDATE SKIP LOCKED + kunci "nextAt" 5 menit).
CREATE OR REPLACE FUNCTION dash_aff_reply_due(p_now timestamp, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_out jsonb;
BEGIN
  UPDATE "AffiliateUse" u SET status = 'BATAL', error = 'Postingan affiliate tidak jadi terbit.', "updatedAt" = p_now
  WHERE u.status = 'MENUNGGU'
    AND (u."slotAt" < p_now - interval '2 days'
         OR NOT EXISTS (
           SELECT 1 FROM "AutopilotSlot" s
           WHERE s.id = u."slotId" AND s.status NOT IN ('DILEWATI', 'DIBATALKAN', 'GAGAL')
             AND (s.draft IS NULL OR s.draft->'affiliate'->>'productId' = u."productId")
             AND NOT EXISTS (SELECT 1 FROM "PostDispatch" d WHERE d."postId" = s."postId" AND d.status = 'GAGAL')));

  WITH due AS (
    SELECT u.id, d."platformPostId" AS "mediaId", sa."threadsAccountId"
    FROM "AffiliateUse" u
    JOIN "AutopilotSlot" s ON s.id = u."slotId" AND s."postId" IS NOT NULL
    JOIN "PostDispatch" d ON d."postId" = s."postId" AND d.publisher = 'THREADS' AND d.status = 'TERBIT'
                         AND d."platformPostId" IS NOT NULL
    JOIN "SocialAccount" sa ON sa.id = d."socialAccountId" AND sa."threadsAccountId" = u."accountId"
    WHERE u.status = 'MENUNGGU' AND (u."nextAt" IS NULL OR u."nextAt" <= p_now)
      AND s.draft->'affiliate'->>'productId' = u."productId"
      AND COALESCE(d."updatedAt", d."createdAt") <= p_now - make_interval(secs => u."delayDetik")
    ORDER BY u."slotAt", u.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50)
    FOR UPDATE OF u SKIP LOCKED
  ), locked AS (
    UPDATE "AffiliateUse" u SET "nextAt" = p_now + interval '5 minutes', "updatedAt" = p_now
    FROM due WHERE u.id = due.id
    RETURNING u.id, u."replyText", due."mediaId", due."threadsAccountId"
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', l.id, 'text', l."replyText", 'mediaId', l."mediaId",
                                               'threadsAccountId', l."threadsAccountId")), '[]'::jsonb)
  INTO v_out FROM locked l;
  RETURN v_out;
END
$$;

-- Hasil pengiriman balasan. Gagal: coba lagi di p_retry_at (maks 3 kali); p_retry_at NULL = gagal permanen.
CREATE OR REPLACE FUNCTION dash_aff_reply_done(p_id text, p_reply_id text, p_error text, p_retry_at timestamp, p_now timestamp)
RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE "AffiliateUse" SET
    status = CASE WHEN p_error IS NULL THEN 'TERKIRIM'
                  WHEN p_retry_at IS NULL OR attempts + 1 >= 3 THEN 'GAGAL' ELSE 'MENUNGGU' END,
    attempts = attempts + CASE WHEN p_error IS NULL THEN 0 ELSE 1 END,
    "replyPostId" = COALESCE(p_reply_id, "replyPostId"),
    error = left(p_error, 500),
    "nextAt" = CASE WHEN p_error IS NULL THEN NULL ELSE p_retry_at END,
    "updatedAt" = p_now
  WHERE id = p_id AND status = 'MENUNGGU'
  RETURNING status
$$;

-- ------------------------------------------------------------------ hak akses

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'dash\_aff\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;
