-- =============================================================================
-- Tagihan langganan via Xendit Invoice + kunci integrasi platform (Xendit, Google OAuth, Threads OAuth).
--
-- ADITIF dan idempoten. Prasyarat: sql/010_superadmin.sql dan sql/011_plans.sql. Jalankan MANUAL di
-- SQL Editor Supabase oleh pemilik; aman dijalankan ulang.
--
-- Kunci rahasia disimpan di "PlatformIntegration" (RLS aktif, tanpa grant) dan hanya dibaca server
-- lewat fungsi SECURITY DEFINER. Catatan audit hanya memuat NAMA kolom yang berubah, bukan nilainya.
--
-- Pelunasan tagihan atomik (`dash_bill_settle`): baris tagihan dikunci, paket workspace diperpanjang,
-- dan status menjadi PAID dalam satu transaksi, sehingga callback Xendit yang dikirim ulang tidak
-- memperpanjang paket dua kali.
-- =============================================================================

-- ------------------------------------------------------------------ tabel

CREATE TABLE IF NOT EXISTS "PlatformIntegration" (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  "updatedBy" text,
  "updatedAt" timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
-- { secretKey, callbackToken }
ALTER TABLE "PlatformIntegration" ADD COLUMN IF NOT EXISTS xendit jsonb NOT NULL DEFAULT '{}'::jsonb;
-- { enabled, clientId, clientSecret, appUrl }
ALTER TABLE "PlatformIntegration" ADD COLUMN IF NOT EXISTS "googleOauth" jsonb NOT NULL DEFAULT '{}'::jsonb;
-- { enabled, appId, appSecret }
ALTER TABLE "PlatformIntegration" ADD COLUMN IF NOT EXISTS "threadsOauth" jsonb NOT NULL DEFAULT '{}'::jsonb;
INSERT INTO "PlatformIntegration" (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS "SubscriptionInvoice" (
  id                text PRIMARY KEY,
  "workspaceId"     text NOT NULL,
  "workspaceNama"   text NOT NULL,
  "userId"          text NOT NULL,
  "userName"        text NOT NULL,
  "userEmail"       text,
  "planId"          text NOT NULL,
  "planNama"        text NOT NULL,
  months            smallint NOT NULL CHECK (months IN (1, 3, 12)),
  "unitPrice"       integer NOT NULL CHECK ("unitPrice" >= 0),
  "discountAmount"  integer NOT NULL DEFAULT 0 CHECK ("discountAmount" >= 0),
  amount            integer NOT NULL CHECK (amount >= 0),
  provider          text NOT NULL,
  status            text NOT NULL CHECK (status IN ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED')),
  "paymentUrl"      text,
  "externalId"      text,
  "paymentMethod"   text,
  notes             text,
  "createdAt"       timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "paidAt"          timestamp(3),
  "expiresAt"       timestamp(3) NOT NULL,
  "planActiveUntil" timestamp(3)
);
-- Penyedia: XENDIT (bayar online) atau GRATIS (paket Rp 0, langsung lunas).
ALTER TABLE "SubscriptionInvoice" DROP CONSTRAINT IF EXISTS "SubscriptionInvoice_provider_check";
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_provider_check" CHECK (provider IN ('XENDIT', 'GRATIS')) NOT VALID;

CREATE INDEX IF NOT EXISTS "SubscriptionInvoice_ws_idx" ON "SubscriptionInvoice" ("workspaceId", "createdAt" DESC, id DESC);
CREATE INDEX IF NOT EXISTS "SubscriptionInvoice_waktu_idx" ON "SubscriptionInvoice" ("createdAt" DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionInvoice_external_uq" ON "SubscriptionInvoice" ("externalId") WHERE "externalId" IS NOT NULL;

ALTER TABLE "PlatformIntegration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SubscriptionInvoice" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PlatformIntegration", "SubscriptionInvoice" FROM anon, authenticated;

-- ------------------------------------------------------------------ data lama

-- Versi sebelumnya menyimpan kunci di detail catatan audit (aksi INTEGRASI_SIMPAN). Pindahkan kunci
-- terbaru ke tabel (hanya bila tabel masih kosong), lalu hapus nilai rahasia dari catatan audit.
-- Baris audit format baru (sesudah berkas ini) berisi daftar nama kolom, bukan objek; dilewati.
WITH terakhir AS (
  SELECT detail FROM "PlatformAuditLog"
  WHERE action = 'INTEGRASI_SIMPAN'
    AND 'object' IN (jsonb_typeof(detail->'xendit'), jsonb_typeof(detail->'googleOauth'), jsonb_typeof(detail->'threadsOauth'))
  ORDER BY "createdAt" DESC, id DESC LIMIT 1
)
UPDATE "PlatformIntegration" pi SET
  xendit = CASE WHEN pi.xendit = '{}'::jsonb THEN jsonb_strip_nulls(jsonb_build_object(
    'secretKey', NULLIF(t.detail->'xendit'->>'secretKey', ''),
    'callbackToken', NULLIF(t.detail->'xendit'->>'webhookToken', ''))) ELSE pi.xendit END,
  "googleOauth" = CASE WHEN pi."googleOauth" = '{}'::jsonb THEN jsonb_strip_nulls(jsonb_build_object(
    'enabled', t.detail->'googleOauth'->'enabled',
    'clientId', NULLIF(t.detail->'googleOauth'->>'clientId', ''),
    'clientSecret', NULLIF(t.detail->'googleOauth'->>'clientSecret', ''),
    'appUrl', NULLIF(t.detail->'googleOauth'->>'appUrl', ''))) ELSE pi."googleOauth" END,
  "threadsOauth" = CASE WHEN pi."threadsOauth" = '{}'::jsonb THEN jsonb_strip_nulls(jsonb_build_object(
    'enabled', t.detail->'threadsOauth'->'enabled',
    'appId', NULLIF(t.detail->'threadsOauth'->>'appId', ''),
    'appSecret', NULLIF(t.detail->'threadsOauth'->>'appSecret', ''))) ELSE pi."threadsOauth" END
FROM terakhir t
WHERE pi.id = 1;

UPDATE "PlatformAuditLog" a SET detail = (
  SELECT jsonb_object_agg(k, CASE WHEN jsonb_typeof(v) = 'object'
    THEN v - 'serverKey' - 'secretKey' - 'webhookToken' - 'callbackToken' - 'clientSecret' - 'appSecret' ELSE v END)
  FROM jsonb_each(a.detail) e(k, v))
WHERE a.action = 'INTEGRASI_SIMPAN' AND jsonb_typeof(a.detail) = 'object' AND a.detail <> '{}'::jsonb;

-- ------------------------------------------------------------------ integrasi

CREATE OR REPLACE FUNCTION dash_bill_config() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('xendit', xendit, 'googleOauth', "googleOauth", 'threadsOauth', "threadsOauth",
                            'updatedAt', "updatedAt")
  FROM "PlatformIntegration" WHERE id = 1
$$;

-- Ubah kunci integrasi. p_patch: { xendit?: {...}, googleOauth?: {...}, threadsOauth?: {...} }; tiap bagian
-- digabung ke nilai lama (kolom yang tidak dikirim tetap). Nilai "" menghapus kolom itu.
-- Hasil: konfigurasi terbaru, atau NULL bila pelaku bukan super admin.
CREATE OR REPLACE FUNCTION dash_bill_config_set(p_actor text, p_patch jsonb, p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_x jsonb := COALESCE(p_patch->'xendit', '{}'::jsonb);
  v_g jsonb := COALESCE(p_patch->'googleOauth', '{}'::jsonb);
  v_t jsonb := COALESCE(p_patch->'threadsOauth', '{}'::jsonb);
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN NULL; END IF;
  UPDATE "PlatformIntegration" SET
    xendit = (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(xendit || v_x) e(k, v) WHERE v <> '""'::jsonb),
    "googleOauth" = (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each("googleOauth" || v_g) e(k, v) WHERE v <> '""'::jsonb),
    "threadsOauth" = (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each("threadsOauth" || v_t) e(k, v) WHERE v <> '""'::jsonb),
    "updatedBy" = p_actor, "updatedAt" = p_now
  WHERE id = 1;
  PERFORM dash_sa_log(p_actor, 'INTEGRASI_SIMPAN', 'SISTEM', 'integrations', jsonb_build_object(
    'xendit', (SELECT COALESCE(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(v_x) k),
    'googleOauth', (SELECT COALESCE(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(v_g) k),
    'threadsOauth', (SELECT COALESCE(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(v_t) k)), p_now);
  RETURN dash_bill_config();
END
$$;

-- ------------------------------------------------------------------ tagihan

-- Satu tagihan sebagai JSON; PENDING yang lewat batas waktu dilaporkan EXPIRED.
CREATE OR REPLACE FUNCTION dash_bill_json(i "SubscriptionInvoice", p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT to_jsonb(i) || jsonb_build_object('status',
    CASE WHEN i.status = 'PENDING' AND i."expiresAt" <= p_now THEN 'EXPIRED' ELSE i.status END)
$$;

CREATE OR REPLACE FUNCTION dash_bill_get(p_id text, p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT dash_bill_json(i, p_now) FROM "SubscriptionInvoice" i WHERE i.id = p_id
$$;

-- Daftar tagihan terbaru. p_ws NULL = semua workspace (panel super admin). Maksimal 200 baris.
CREATE OR REPLACE FUNCTION dash_bill_list(p_ws text, p_limit int, p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(dash_bill_json(t.inv, p_now) ORDER BY t."createdAt" DESC, t.id DESC), '[]'::jsonb) FROM (
    SELECT i AS inv, i."createdAt", i.id FROM "SubscriptionInvoice" i
    WHERE p_ws IS NULL OR i."workspaceId" = p_ws
    ORDER BY i."createdAt" DESC, i.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  ) t
$$;

-- Ringkasan pendapatan dihitung di database (bukan dari daftar yang terpotong).
CREATE OR REPLACE FUNCTION dash_bill_summary(p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'totalRevenue', COALESCE(SUM(amount) FILTER (WHERE status = 'PAID'), 0),
    'revenue30d', COALESCE(SUM(amount) FILTER (WHERE status = 'PAID' AND "paidAt" >= p_now - interval '30 days'), 0),
    'paidCount', count(*) FILTER (WHERE status = 'PAID'),
    'pendingCount', count(*) FILTER (WHERE status = 'PENDING' AND "expiresAt" > p_now),
    'cancelledCount', count(*) FILTER (WHERE status IN ('CANCELLED', 'EXPIRED') OR (status = 'PENDING' AND "expiresAt" <= p_now)))
  FROM "SubscriptionInvoice"
$$;

-- Simpan tagihan baru (dibentuk server setelah invoice Xendit dibuat). Hasil: tagihan tersimpan.
CREATE OR REPLACE FUNCTION dash_bill_create(p_inv jsonb, p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r "SubscriptionInvoice";
BEGIN
  INSERT INTO "SubscriptionInvoice" (id, "workspaceId", "workspaceNama", "userId", "userName", "userEmail", "planId",
    "planNama", months, "unitPrice", "discountAmount", amount, provider, status, "paymentUrl", "externalId", "createdAt", "expiresAt")
  VALUES (p_inv->>'id', p_inv->>'workspaceId', p_inv->>'workspaceNama', p_inv->>'userId', p_inv->>'userName',
    p_inv->>'userEmail', p_inv->>'planId', p_inv->>'planNama', (p_inv->>'months')::smallint, (p_inv->>'unitPrice')::int,
    (p_inv->>'discountAmount')::int, (p_inv->>'amount')::int, p_inv->>'provider', 'PENDING', p_inv->>'paymentUrl',
    p_inv->>'externalId', p_now, (p_inv->>'expiresAt')::timestamp)
  RETURNING * INTO r;
  PERFORM dash_sa_log(r."userId", 'TAGIHAN_BUAT', 'WORKSPACE', r."workspaceId",
    jsonb_build_object('tagihan', r.id, 'paket', r."planId", 'bulan', r.months, 'jumlah', r.amount), p_now);
  RETURN dash_bill_json(r, p_now);
END
$$;

-- Lunasi tagihan dan pasang/perpanjang paket workspace dalam satu transaksi.
-- Masa aktif diperpanjang dari tanggal berakhir paket yang sama bila masih berjalan, selain itu dari sekarang.
-- Hasil: { result: OK | ALREADY | NOT_FOUND | NO_PLAN | NO_TENANT, invoice }
CREATE OR REPLACE FUNCTION dash_bill_settle(p_id text, p_actor text, p_method text, p_notes text, p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r "SubscriptionInvoice";
  v_plan text;
  v_end timestamp;
  v_until timestamp;
BEGIN
  SELECT * INTO r FROM "SubscriptionInvoice" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'NOT_FOUND'); END IF;
  IF r.status = 'PAID' THEN RETURN jsonb_build_object('result', 'ALREADY', 'invoice', dash_bill_json(r, p_now)); END IF;
  IF NOT EXISTS (SELECT 1 FROM "Plan" WHERE id = r."planId") THEN
    RETURN jsonb_build_object('result', 'NO_PLAN', 'invoice', dash_bill_json(r, p_now));
  END IF;
  IF NOT dash_sa_tenant_exists(r."workspaceId") THEN
    RETURN jsonb_build_object('result', 'NO_TENANT', 'invoice', dash_bill_json(r, p_now));
  END IF;

  SELECT "planId", "planBerakhir" INTO v_plan, v_end FROM "WorkspaceSettings" WHERE "workspaceId" = r."workspaceId" FOR UPDATE;
  v_until := CASE WHEN v_plan = r."planId" AND v_end > p_now THEN v_end ELSE p_now END
             + CASE WHEN r.months = 12 THEN interval '365 days' ELSE make_interval(days => r.months * 30) END;

  INSERT INTO "WorkspaceSettings" ("workspaceId", "planId", "planBerakhir", "updatedBy", "updatedAt")
  VALUES (r."workspaceId", r."planId", v_until, p_actor, p_now)
  ON CONFLICT ("workspaceId") DO UPDATE SET
    "planId" = EXCLUDED."planId", "planBerakhir" = EXCLUDED."planBerakhir", "updatedBy" = p_actor, "updatedAt" = p_now;

  UPDATE "SubscriptionInvoice" SET status = 'PAID', "paidAt" = p_now, "paymentMethod" = LEFT(p_method, 60),
    notes = COALESCE(LEFT(p_notes, 200), notes), "planActiveUntil" = v_until
  WHERE id = r.id
  RETURNING * INTO r;

  PERFORM dash_sa_log(p_actor, 'TAGIHAN_LUNAS', 'WORKSPACE', r."workspaceId",
    jsonb_build_object('tagihan', r.id, 'paket', r."planId", 'sampai', v_until, 'metode', r."paymentMethod", 'jumlah', r.amount), p_now);
  RETURN jsonb_build_object('result', 'OK', 'invoice', dash_bill_json(r, p_now));
END
$$;

-- Tutup tagihan yang belum lunas. p_status: CANCELLED | EXPIRED. Hasil: OK | NOT_FOUND | PAID | CLOSED
CREATE OR REPLACE FUNCTION dash_bill_close(p_id text, p_actor text, p_status text, p_notes text, p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r "SubscriptionInvoice";
BEGIN
  IF p_status NOT IN ('CANCELLED', 'EXPIRED') THEN RAISE EXCEPTION 'status tidak valid: %', p_status; END IF;
  SELECT * INTO r FROM "SubscriptionInvoice" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'NOT_FOUND'); END IF;
  IF r.status = 'PAID' THEN RETURN jsonb_build_object('result', 'PAID', 'invoice', dash_bill_json(r, p_now)); END IF;
  IF r.status <> 'PENDING' THEN RETURN jsonb_build_object('result', 'CLOSED', 'invoice', dash_bill_json(r, p_now)); END IF;
  UPDATE "SubscriptionInvoice" SET status = p_status, notes = COALESCE(LEFT(p_notes, 200), notes)
  WHERE id = r.id RETURNING * INTO r;
  PERFORM dash_sa_log(p_actor, CASE WHEN p_status = 'EXPIRED' THEN 'TAGIHAN_KEDALUWARSA' ELSE 'TAGIHAN_BATAL' END,
    'WORKSPACE', r."workspaceId", jsonb_build_object('tagihan', r.id), p_now);
  RETURN jsonb_build_object('result', 'OK', 'invoice', dash_bill_json(r, p_now));
END
$$;

-- ------------------------------------------------------------------ hak akses

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'dash\_bill\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
