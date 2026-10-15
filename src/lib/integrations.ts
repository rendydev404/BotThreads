/**
 * Kunci integrasi platform: Midtrans (pembayaran), Google OAuth (masuk), dan Meta Threads OAuth (hubungkan akun).
 *
 * Sumber nilai per kolom: tabel "PlatformIntegration" (diisi super admin di /admin > Integrasi) lalu
 * variabel lingkungan sebagai cadangan. Bila sql/012 belum dipasang, hanya variabel lingkungan yang
 * dipakai, jadi mengisi .env saja sudah cukup.
 */
import { PAYMENT_METHOD_IDS, type PaymentMethodId, type PlatformIntegrationsDTO } from "./billing-types";
import { midtransIsProduction } from "./midtrans";
import { tokenKeyConfigured } from "./threads-token";
import { rpc } from "./supabase";
import type { Failure } from "./threads-publish";

const CACHE_TTL_MS = 15_000;

type Source = "database" | "env" | "none";

export interface StoredIntegrations {
  /** Tabel konfigurasi tersedia (sql/012 terpasang). */
  stored: boolean;
  /** sql/017_midtrans.sql terpasang (kolom konfigurasi Midtrans + RPC pembayaran). */
  midtransSchema: boolean;
  midtrans: {
    serverKey: string;
    clientKey: string;
    merchantId: string;
    isProduction: boolean;
    methods: PaymentMethodId[];
    source: Source;
  };
  googleOauth: { enabled: boolean; clientId: string; clientSecret: string; appUrl: string; source: Source };
  threadsOauth: { enabled: boolean; appId: string; appSecret: string; source: Source };
}

interface ConfigRow {
  midtrans?: Record<string, unknown>;
  googleOauth?: Record<string, unknown>;
  threadsOauth?: Record<string, unknown>;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const env = (name: string): string => (process.env[name] ?? "").trim();
const noSlash = (s: string): string => s.replace(/\/+$/, "");

/** Nilai dari database bila terisi, selain itu dari env. */
function pick(dbValue: unknown, envName: string): { value: string; source: Source } {
  const fromDb = str(dbValue);
  if (fromDb) return { value: fromDb, source: "database" };
  const fromEnv = env(envName);
  return fromEnv ? { value: fromEnv, source: "env" } : { value: "", source: "none" };
}

let cache: { at: number; value: StoredIntegrations } | null = null;

export function forgetIntegrations(): void {
  cache = null;
}

export async function getRawIntegrations(): Promise<StoredIntegrations> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  let row: ConfigRow | null = null;
  let stored = false;
  try {
    row = await rpc<ConfigRow | null>("dash_bill_config");
    stored = true;
  } catch {
    // sql/012 belum dipasang: jalan dengan env saja.
  }
  const m = row?.midtrans ?? {};
  const g = row?.googleOauth ?? {};
  const t = row?.threadsOauth ?? {};

  const mServer = pick(m.serverKey, "MIDTRANS_SERVER_KEY");
  const mClient = pick(m.clientKey, "MIDTRANS_CLIENT_KEY");
  const mMerchant = pick(m.merchantId, "MIDTRANS_MERCHANT_ID");
  const mProd = typeof m.isProduction === "boolean" ? m.isProduction : env("MIDTRANS_IS_PRODUCTION") === "true";
  const mMethods = Array.isArray(m.methods)
    ? PAYMENT_METHOD_IDS.filter((id) => (m.methods as unknown[]).includes(id))
    : PAYMENT_METHOD_IDS;
  const gId = pick(g.clientId, "GOOGLE_CLIENT_ID");
  const gSecret = pick(g.clientSecret, "GOOGLE_CLIENT_SECRET");
  const gUrl = pick(g.appUrl, "APP_URL");
  const tId = pick(t.appId, "THREADS_APP_ID");
  const tSecret = pick(t.appSecret, "THREADS_APP_SECRET");

  const value: StoredIntegrations = {
    stored,
    midtransSchema: !!row && typeof row === "object" && "midtrans" in row,
    midtrans: {
      serverKey: mServer.value,
      clientKey: mClient.value,
      merchantId: mMerchant.value,
      isProduction: midtransIsProduction(mServer.value, mProd),
      methods: mMethods,
      source: mServer.source,
    },
    googleOauth: {
      enabled: typeof g.enabled === "boolean" ? g.enabled : true,
      clientId: gId.value,
      clientSecret: gSecret.value,
      appUrl: noSlash(gUrl.value),
      source: gId.source,
    },
    threadsOauth: {
      enabled: typeof t.enabled === "boolean" ? t.enabled : true,
      appId: tId.value,
      appSecret: tSecret.value,
      source: tId.source,
    },
  };
  cache = { at: Date.now(), value };
  return value;
}

function maskSecret(secret: string): string {
  const s = secret.trim();
  if (!s) return "";
  if (s.length <= 8) return "••••••••";
  return `${s.slice(0, 4)}••••••••${s.slice(-4)}`;
}

export async function getPublicIntegrations(origin: string): Promise<PlatformIntegrationsDTO> {
  const raw = await getRawIntegrations();
  const base = raw.googleOauth.appUrl || origin;
  return {
    stored: raw.stored,
    appUrl: raw.googleOauth.appUrl,
    midtrans: {
      ready: !!raw.midtrans.serverKey,
      mode: raw.midtrans.isProduction ? "production" : "sandbox",
      merchantId: raw.midtrans.merchantId,
      clientKey: raw.midtrans.clientKey,
      serverKeyMasked: maskSecret(raw.midtrans.serverKey),
      methods: raw.midtrans.methods,
      notificationUrl: `${base}/api/billing/webhook`,
      source: raw.midtrans.source,
    },
    googleOauth: {
      enabled: raw.googleOauth.enabled,
      clientId: raw.googleOauth.clientId,
      clientSecretMasked: maskSecret(raw.googleOauth.clientSecret),
      hasClientSecret: !!raw.googleOauth.clientSecret,
      callbackUrl: `${base}/api/auth/google/callback`,
      source: raw.googleOauth.source,
    },
    threadsOauth: {
      enabled: raw.threadsOauth.enabled,
      appId: raw.threadsOauth.appId,
      appSecretMasked: maskSecret(raw.threadsOauth.appSecret),
      hasAppSecret: !!raw.threadsOauth.appSecret,
      callbackUrl: `${base}/api/threads/oauth/callback`,
      tokenKeyConfigured: tokenKeyConfigured(),
      source: raw.threadsOauth.source,
    },
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Ambil kolom teks dari masukan: undefined = tidak diubah, "" = hapus (kembali ke env). */
function textField(src: Record<string, unknown>, key: string, max: number): string | undefined {
  const v = src[key];
  if (typeof v !== "string") return undefined;
  return v.trim().slice(0, max);
}

/**
 * Simpan perubahan kunci. Kolom rahasia yang dikirim kosong dianggap "tidak diubah" (formulir tidak
 * pernah menampilkan nilai lamanya); untuk menghapusnya kirim `clear: ["midtrans.serverKey", ...]`.
 */
export async function saveIntegrations(
  adminId: string,
  body: unknown,
  origin: string,
  now = new Date()
): Promise<{ ok: true; integrations: PlatformIntegrationsDTO } | Failure> {
  if (!isRecord(body)) return { ok: false, status: 400, error: "Data integrasi tidak valid." };
  const current = await getRawIntegrations();
  if (!current.stored) {
    return {
      ok: false,
      status: 503,
      error: "Tabel konfigurasi belum dipasang. Jalankan sql/012_billing_and_integrations.sql di Supabase SQL Editor, atau isi kunci lewat variabel lingkungan.",
    };
  }

  const inM = isRecord(body.midtrans) ? body.midtrans : {};
  const inG = isRecord(body.googleOauth) ? body.googleOauth : {};
  const inT = isRecord(body.threadsOauth) ? body.threadsOauth : {};
  const clear = new Set(Array.isArray(body.clear) ? body.clear.filter((c): c is string => typeof c === "string") : []);

  const secret = (src: Record<string, unknown>, key: string, path: string): string | undefined => {
    if (clear.has(path)) return "";
    const v = textField(src, key, 300);
    return v ? v : undefined;
  };

  const midtrans: Record<string, unknown> = {};
  const mKey = secret(inM, "serverKey", "midtrans.serverKey");
  if (mKey !== undefined) {
    if (mKey && !/^(SB-)?Mid-server-[A-Za-z0-9_-]{8,}$/.test(mKey)) {
      return { ok: false, status: 400, error: "Server Key Midtrans harus diawali Mid-server- (atau SB-Mid-server- untuk sandbox lama)." };
    }
    midtrans.serverKey = mKey;
  }
  const mClient = textField(inM, "clientKey", 120);
  if (mClient !== undefined) {
    if (mClient && !/^(SB-)?Mid-client-[A-Za-z0-9_-]{8,}$/.test(mClient)) {
      return { ok: false, status: 400, error: "Client Key Midtrans harus diawali Mid-client- (atau SB-Mid-client-)." };
    }
    midtrans.clientKey = mClient;
  }
  const mMerchant = textField(inM, "merchantId", 40);
  if (mMerchant !== undefined) {
    if (mMerchant && !/^[A-Za-z0-9]{4,30}$/.test(mMerchant)) return { ok: false, status: 400, error: "Merchant ID Midtrans tidak valid." };
    midtrans.merchantId = mMerchant;
  }
  if (typeof inM.isProduction === "boolean") midtrans.isProduction = inM.isProduction;
  if (Array.isArray(inM.methods)) {
    const methods = PAYMENT_METHOD_IDS.filter((id) => (inM.methods as unknown[]).includes(id));
    if (methods.length === 0) return { ok: false, status: 400, error: "Aktifkan minimal satu metode pembayaran." };
    midtrans.methods = methods;
  }
  if (!current.midtransSchema) {
    if (midtrans.serverKey || midtrans.clientKey || midtrans.merchantId) {
      return { ok: false, status: 503, error: "Kolom Midtrans belum dipasang. Jalankan sql/017_midtrans.sql di Supabase SQL Editor." };
    }
    for (const k of Object.keys(midtrans)) delete midtrans[k];
  }

  const googleOauth: Record<string, unknown> = {};
  if (typeof inG.enabled === "boolean") googleOauth.enabled = inG.enabled;
  const gId = textField(inG, "clientId", 200);
  if (gId !== undefined) googleOauth.clientId = gId;
  const gSecret = secret(inG, "clientSecret", "googleOauth.clientSecret");
  if (gSecret !== undefined) googleOauth.clientSecret = gSecret;
  const gUrl = textField(inG, "appUrl", 200);
  if (gUrl !== undefined) {
    const clean = noSlash(gUrl);
    if (clean && !/^https?:\/\/[^/\s]+$/.test(clean)) {
      return { ok: false, status: 400, error: "App URL harus berupa asal situs saja, contoh https://wargi.sukashawarma.com" };
    }
    googleOauth.appUrl = clean;
  }

  const threadsOauth: Record<string, unknown> = {};
  if (typeof inT.enabled === "boolean") threadsOauth.enabled = inT.enabled;
  const tId = textField(inT, "appId", 60);
  if (tId !== undefined) {
    if (tId && !/^\d{5,30}$/.test(tId)) return { ok: false, status: 400, error: "Threads App ID harus berupa angka." };
    threadsOauth.appId = tId;
  }
  const tSecret = secret(inT, "appSecret", "threadsOauth.appSecret");
  if (tSecret !== undefined) threadsOauth.appSecret = tSecret;

  const saved = await rpc<ConfigRow | null>("dash_bill_config_set", {
    p_actor: adminId,
    p_patch: { midtrans, googleOauth, threadsOauth },
    p_now: now,
  });
  if (!saved) return { ok: false, status: 403, error: "Hanya super admin yang boleh mengubah integrasi." };
  forgetIntegrations();
  return { ok: true, integrations: await getPublicIntegrations(origin) };
}
