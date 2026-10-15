/**
 * Klien Xendit Invoice API v2 (tanpa pustaka tambahan).
 * Mode uji/live ditentukan oleh kunci itu sendiri: xnd_development_* = uji, xnd_production_* = live.
 * Dokumentasi: https://developers.xendit.co/api-reference/#create-invoice
 */
import { timingSafeEqual } from "node:crypto";

const BASE_URL = "https://api.xendit.co";
const FETCH_TIMEOUT_MS = 10_000;

export type XenditMode = "test" | "live" | null;

export const xenditMode = (secretKey: string): XenditMode =>
  secretKey.startsWith("xnd_production_") ? "live" : secretKey.startsWith("xnd_development_") ? "test" : null;

export type XenditInvoiceStatus = "PENDING" | "PAID" | "SETTLED" | "EXPIRED";

export interface XenditInvoice {
  id: string;
  external_id: string;
  status: XenditInvoiceStatus;
  amount: number;
  invoice_url: string;
  expiry_date?: string;
  payment_method?: string;
  payment_channel?: string;
}

export class XenditError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function call<T>(secretKey: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
      ...init.headers,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as (T & { message?: string; error_code?: string }) | null;
  if (!res.ok || !body) {
    const why = body?.message || body?.error_code || `HTTP ${res.status}`;
    throw new XenditError(`Xendit: ${why}`, res.status);
  }
  return body;
}

export interface CreateInvoiceInput {
  externalId: string;
  amount: number;
  description: string;
  payerEmail: string | null;
  customerName: string;
  itemName: string;
  durationSeconds: number;
  returnUrl: string;
}

export function createXenditInvoice(secretKey: string, input: CreateInvoiceInput): Promise<XenditInvoice> {
  return call<XenditInvoice>(secretKey, "/v2/invoices", {
    method: "POST",
    body: JSON.stringify({
      external_id: input.externalId,
      amount: input.amount,
      currency: "IDR",
      description: input.description.slice(0, 250),
      invoice_duration: input.durationSeconds,
      ...(input.payerEmail ? { payer_email: input.payerEmail } : {}),
      customer: {
        given_names: input.customerName.slice(0, 50),
        ...(input.payerEmail ? { email: input.payerEmail } : {}),
      },
      items: [{ name: input.itemName.slice(0, 100), quantity: 1, price: input.amount }],
      success_redirect_url: input.returnUrl,
      failure_redirect_url: input.returnUrl,
    }),
  });
}

export function getXenditInvoice(secretKey: string, invoiceId: string): Promise<XenditInvoice> {
  return call<XenditInvoice>(secretKey, `/v2/invoices/${encodeURIComponent(invoiceId)}`);
}

/** Tutup invoice di Xendit supaya tautan bayarnya tidak bisa dipakai lagi. */
export function expireXenditInvoice(secretKey: string, invoiceId: string): Promise<XenditInvoice> {
  return call<XenditInvoice>(secretKey, `/invoices/${encodeURIComponent(invoiceId)}/expire!`, { method: "POST" });
}

/** Bandingkan header x-callback-token dengan token verifikasi dari dashboard Xendit (waktu konstan). */
export function callbackTokenMatches(expected: string, given: string | null): boolean {
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
