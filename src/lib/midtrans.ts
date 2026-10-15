/**
 * Klien Midtrans Core API (tanpa pustaka tambahan, tanpa Snap): charge, cek status, expire, dan
 * verifikasi notifikasi. Halaman bayar dibuat sendiri dari data yang dikembalikan charge (nomor VA,
 * URL QR, deeplink e-wallet).
 * Dokumentasi: https://docs.midtrans.com/reference/core-api-overview
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { PaymentInstructions, PaymentMethodId } from "./billing-types";

const SANDBOX_URL = "https://api.sandbox.midtrans.com";
const PRODUCTION_URL = "https://api.midtrans.com";
const FETCH_TIMEOUT_MS = 12_000;
const WIB_OFFSET_MS = 7 * 3600_000;

export interface MidtransKeys {
  serverKey: string;
  isProduction: boolean;
}

export type MidtransTxStatus =
  | "pending"
  | "settlement"
  | "capture"
  | "deny"
  | "cancel"
  | "expire"
  | "failure"
  | "refund"
  | "partial_refund"
  | "chargeback"
  | "partial_chargeback"
  | "authorize";

interface MidtransAction {
  name: string;
  method?: string;
  url: string;
}

export interface MidtransTransaction {
  status_code: string;
  status_message?: string;
  transaction_id?: string;
  order_id: string;
  gross_amount: string;
  payment_type?: string;
  transaction_status?: MidtransTxStatus;
  fraud_status?: string;
  expiry_time?: string;
  va_numbers?: { bank: string; va_number: string }[];
  permata_va_number?: string;
  bill_key?: string;
  biller_code?: string;
  actions?: MidtransAction[];
  qr_string?: string;
  issuer?: string;
  acquirer?: string;
  bank?: string;
  signature_key?: string;
}

export class MidtransError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/** Kunci sandbox lama berawalan SB-; kunci akun baru tidak, jadi mode juga diatur lewat flag isProduction. */
export const midtransIsProduction = (serverKey: string, flag: boolean): boolean => (serverKey.startsWith("SB-") ? false : flag);

const baseUrl = (keys: MidtransKeys) => (midtransIsProduction(keys.serverKey, keys.isProduction) ? PRODUCTION_URL : SANDBOX_URL);

/** Status HTTP 2xx tetap bisa membawa status_code gagal di badan (mis. "402" kanal belum aktif). */
const OK_CODES = new Set(["200", "201", "202", "407"]);

async function call(keys: MidtransKeys, path: string, init: RequestInit & { notifyUrl?: string } = {}): Promise<MidtransTransaction> {
  const { notifyUrl, ...rest } = init;
  const res = await fetch(`${baseUrl(keys)}${path}`, {
    ...rest,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${keys.serverKey}:`).toString("base64")}`,
      // Kirim notifikasi juga ke aplikasi ini tanpa harus mengubah pengaturan di dashboard Midtrans.
      ...(notifyUrl ? { "X-Append-Notification": notifyUrl } : {}),
      ...rest.headers,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as (MidtransTransaction & { error_messages?: string[] }) | null;
  if (!res.ok || !body || !OK_CODES.has(String(body.status_code))) {
    const why = body?.error_messages?.join("; ") || body?.status_message || `HTTP ${res.status}`;
    throw new MidtransError(`Midtrans: ${why}`, Number(body?.status_code) || res.status);
  }
  return body;
}

/* ------------------------------------------------------------------ metode bayar */

type ChargePart = Record<string, unknown>;

interface MethodSpec {
  /** Bagian body charge khusus metode ini. */
  body: () => ChargePart;
  /** Batas waktu bayar maksimum (menit). VA mengikuti umur tagihan, QR/e-wallet pendek. */
  maxMinutes: number;
}

const va = (bank: string): MethodSpec => ({
  body: () => ({ payment_type: "bank_transfer", bank_transfer: { bank } }),
  maxMinutes: 24 * 60,
});

const METHOD_SPECS: Record<PaymentMethodId, MethodSpec> = {
  qris: { body: () => ({ payment_type: "qris", qris: { acquirer: "gopay" } }), maxMinutes: 30 },
  gopay: { body: () => ({ payment_type: "gopay", gopay: { enable_callback: false } }), maxMinutes: 30 },
  shopeepay: { body: () => ({ payment_type: "shopeepay", shopeepay: {} }), maxMinutes: 30 },
  bca_va: va("bca"),
  bni_va: va("bni"),
  bri_va: va("bri"),
  permata_va: va("permata"),
  cimb_va: va("cimb"),
  mandiri_bill: {
    body: () => ({ payment_type: "echannel", echannel: { bill_info1: "Pembayaran:", bill_info2: "Langganan" } }),
    maxMinutes: 24 * 60,
  },
};

/** Waktu WIB "yyyy-MM-dd HH:mm:ss +0700" untuk custom_expiry.order_time. */
function wibStamp(d: Date): string {
  return `${new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ")} +0700`;
}

/** expiry_time Midtrans ("2026-10-16 10:00:00", WIB) ➜ ISO UTC. */
export function parseWib(s: string | undefined): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s.replace(" ", "T")}+07:00`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export interface ChargeInput {
  orderId: string;
  amount: number;
  method: PaymentMethodId;
  itemName: string;
  customerName: string;
  email: string | null;
  /** Batas akhir tagihan; batas bayar transaksi tidak pernah melewatinya. */
  invoiceExpiresAt: Date;
  /** URL notifikasi publik (https). Kosong saat uji di localhost. */
  notifyUrl?: string;
  /** Kembali ke aplikasi setelah membuka aplikasi e-wallet. */
  returnUrl?: string;
}

export async function chargeMidtrans(keys: MidtransKeys, input: ChargeInput, now = new Date()): Promise<{ tx: MidtransTransaction; payment: PaymentInstructions }> {
  const spec = METHOD_SPECS[input.method];
  const remaining = Math.floor((input.invoiceExpiresAt.getTime() - now.getTime()) / 60_000);
  const minutes = Math.max(1, Math.min(spec.maxMinutes, remaining));
  const part = spec.body();
  if (input.returnUrl && input.method === "gopay") part.gopay = { enable_callback: true, callback_url: input.returnUrl };
  if (input.returnUrl && input.method === "shopeepay") part.shopeepay = { callback_url: input.returnUrl };

  const tx = await call(keys, "/v2/charge", {
    method: "POST",
    notifyUrl: input.notifyUrl,
    body: JSON.stringify({
      ...part,
      transaction_details: { order_id: input.orderId, gross_amount: input.amount },
      item_details: [{ id: input.orderId.slice(0, 50), price: input.amount, quantity: 1, name: input.itemName.slice(0, 50) }],
      customer_details: {
        first_name: input.customerName.slice(0, 50),
        ...(input.email ? { email: input.email } : {}),
      },
      custom_expiry: { order_time: wibStamp(now), expiry_duration: minutes, unit: "minute" },
    }),
  });
  if (tx.transaction_status === "deny" || tx.transaction_status === "failure") {
    throw new MidtransError(`Midtrans menolak transaksi (${tx.status_message || tx.transaction_status}).`, 402);
  }
  return { tx, payment: toInstructions(input.method, tx, new Date(now.getTime() + minutes * 60_000)) };
}

const actionUrl = (tx: MidtransTransaction, name: string): string | null => tx.actions?.find((a) => a.name === name)?.url ?? null;

/** Respons charge ➜ data yang ditampilkan di UI pembayaran. */
export function toInstructions(method: PaymentMethodId, tx: MidtransTransaction, fallbackExpiry: Date): PaymentInstructions {
  const base = {
    method,
    orderId: tx.order_id,
    transactionId: tx.transaction_id ?? null,
    expiresAt: parseWib(tx.expiry_time) ?? fallbackExpiry.toISOString(),
    status: (tx.transaction_status ?? "pending") as PaymentInstructions["status"],
  };
  switch (method) {
    case "qris":
      return { ...base, kind: "qr", qrUrl: actionUrl(tx, "generate-qr-code"), qrString: tx.qr_string ?? null };
    case "gopay":
      return { ...base, kind: "qr", qrUrl: actionUrl(tx, "generate-qr-code"), qrString: tx.qr_string ?? null, deeplinkUrl: actionUrl(tx, "deeplink-redirect") };
    case "shopeepay":
      return { ...base, kind: "deeplink", deeplinkUrl: actionUrl(tx, "deeplink-redirect") };
    case "mandiri_bill":
      return { ...base, kind: "bill", billerCode: tx.biller_code ?? null, billKey: tx.bill_key ?? null };
    case "permata_va":
      return { ...base, kind: "va", vaNumber: tx.permata_va_number ?? tx.va_numbers?.[0]?.va_number ?? null };
    default:
      return { ...base, kind: "va", vaNumber: tx.va_numbers?.[0]?.va_number ?? null };
  }
}

export function getMidtransStatus(keys: MidtransKeys, orderId: string): Promise<MidtransTransaction> {
  return call(keys, `/v2/${encodeURIComponent(orderId)}/status`);
}

/** Matikan transaksi yang belum dibayar (nomor VA/QR tidak bisa dipakai lagi). */
export function expireMidtrans(keys: MidtransKeys, orderId: string): Promise<MidtransTransaction> {
  return call(keys, `/v2/${encodeURIComponent(orderId)}/expire`, { method: "POST" });
}

/** Lunas menurut Midtrans: settlement, atau capture yang lolos pemeriksaan fraud. */
export const midtransPaid = (tx: Pick<MidtransTransaction, "transaction_status" | "fraud_status">): boolean =>
  tx.transaction_status === "settlement" || (tx.transaction_status === "capture" && (tx.fraud_status ?? "accept") === "accept");

/** signature_key notifikasi = SHA512(order_id + status_code + gross_amount + ServerKey), dibandingkan waktu konstan. */
export function notificationSignatureValid(
  serverKey: string,
  n: { order_id?: unknown; status_code?: unknown; gross_amount?: unknown; signature_key?: unknown }
): boolean {
  if (!serverKey || typeof n.signature_key !== "string") return false;
  const expected = createHash("sha512")
    .update(`${String(n.order_id ?? "")}${String(n.status_code ?? "")}${String(n.gross_amount ?? "")}${serverKey}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(n.signature_key.toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

