-- =============================================================================
-- Pembayaran langganan via Midtrans Core API (menggantikan Xendit).
--
-- ADITIF dan idempoten. Prasyarat: sql/012_billing_and_integrations.sql. Jalankan MANUAL di SQL Editor
-- Supabase oleh pemilik; aman dijalankan ulang. Kolom/tagihan Xendit lama tidak dihapus (riwayat tetap).
--
-- - "PlatformIntegration".midtrans: { merchantId, clientKey, serverKey, isProduction, methods[] }
-- - "SubscriptionInvoice".payment: instruksi bayar dari Midtrans (nomor VA, URL QR, deeplink, batas waktu)
--   yang ditampilkan di UI pembayaran sendiri (tanpa Snap).
-- - "externalId" = order_id Midtrans yang sedang berlaku untuk tagihan itu (berganti bila pengguna ganti metode).
-- =============================================================================

ALTER TABLE "PlatformIntegration" ADD COLUMN IF NOT EXISTS midtrans jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "SubscriptionInvoice" ADD COLUMN IF NOT EXISTS payment jsonb;

ALTER TABLE "SubscriptionInvoice" DROP CONSTRAINT IF EXISTS "SubscriptionInvoice_provider_check";
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_provider_check"
  CHECK (provider IN ('MIDTRANS', 'XENDIT', 'GRATIS')) NOT VALID;

-- Pencocokan status cadangan (scheduler): hanya tagihan menunggu yang punya transaksi Midtrans.
CREATE INDEX IF NOT EXISTS "SubscriptionInvoice_pending_idx" ON "SubscriptionInvoice" ("createdAt" DESC, id)
  WHERE status = 'PENDING' AND "externalId" IS NOT NULL;

-- ------------------------------------------------------------------ integrasi

CREATE OR REPLACE FUNCTION dash_bill_config() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('midtrans', midtrans, 'xendit', xendit, 'googleOauth', "googleOauth",
                            'threadsOauth', "threadsOauth", 'updatedAt', "updatedAt")
  FROM "PlatformIntegration" WHERE id = 1
$$;

-- p_patch: { midtrans?: {...}, googleOauth?: {...}, threadsOauth?: {...} }; tiap bagian digabung ke nilai lama.
-- Nilai "" menghapus kolom itu. Hasil: konfigurasi terbaru, atau NULL bila pelaku bukan super admin.
-- Catatan audit hanya memuat NAMA kolom yang berubah.
CREATE OR REPLACE FUNCTION dash_bill_config_set(p_actor text, p_patch jsonb, p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_m jsonb := COALESCE(p_patch->'midtrans', '{}'::jsonb);
  v_g jsonb := COALESCE(p_patch->'googleOauth', '{}'::jsonb);
  v_t jsonb := COALESCE(p_patch->'threadsOauth', '{}'::jsonb);
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN NULL; END IF;
  UPDATE "PlatformIntegration" SET
    midtrans = (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(midtrans || v_m) e(k, v) WHERE v <> '""'::jsonb),
    "googleOauth" = (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each("googleOauth" || v_g) e(k, v) WHERE v <> '""'::jsonb),
    "threadsOauth" = (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each("threadsOauth" || v_t) e(k, v) WHERE v <> '""'::jsonb),
    "updatedBy" = p_actor, "updatedAt" = p_now
  WHERE id = 1;
  PERFORM dash_sa_log(p_actor, 'INTEGRASI_SIMPAN', 'SISTEM', 'integrations', jsonb_build_object(
    'midtrans', (SELECT COALESCE(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(v_m) k),
    'googleOauth', (SELECT COALESCE(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(v_g) k),
    'threadsOauth', (SELECT COALESCE(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(v_t) k)), p_now);
  RETURN dash_bill_config();
END
$$;

-- ------------------------------------------------------------------ tagihan

-- Pasang transaksi Midtrans (order_id + instruksi bayar) ke tagihan yang masih menunggu.
-- Hasil: { result: OK | NOT_FOUND | PAID | CLOSED, invoice }
CREATE OR REPLACE FUNCTION dash_bill_pay(p_id text, p_external text, p_payment jsonb, p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r "SubscriptionInvoice";
BEGIN
  SELECT * INTO r FROM "SubscriptionInvoice" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'NOT_FOUND'); END IF;
  IF r.status = 'PAID' THEN RETURN jsonb_build_object('result', 'PAID', 'invoice', dash_bill_json(r, p_now)); END IF;
  IF r.status <> 'PENDING' OR r."expiresAt" <= p_now THEN
    RETURN jsonb_build_object('result', 'CLOSED', 'invoice', dash_bill_json(r, p_now));
  END IF;
  UPDATE "SubscriptionInvoice" SET "externalId" = p_external, payment = p_payment, "paymentUrl" = NULL
  WHERE id = r.id RETURNING * INTO r;
  RETURN jsonb_build_object('result', 'OK', 'invoice', dash_bill_json(r, p_now));
END
$$;

-- Tagihan Midtrans yang masih menunggu (untuk dicocokkan ulang oleh scheduler bila notifikasi terlewat).
CREATE OR REPLACE FUNCTION dash_bill_pending(p_limit int, p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(t.id ORDER BY t."createdAt" DESC, t.id), '[]'::jsonb) FROM (
    SELECT id, "createdAt" FROM "SubscriptionInvoice"
    WHERE status = 'PENDING' AND "externalId" IS NOT NULL AND provider = 'MIDTRANS'
      AND "createdAt" > p_now - interval '3 days'
    ORDER BY "createdAt" DESC, id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
  ) t
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
