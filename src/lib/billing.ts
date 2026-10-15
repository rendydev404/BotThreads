/**
 * Tagihan langganan via Midtrans Core API (UI bayar sendiri, tanpa Snap) dan kalkulasi KPI SaaS.
 *
 * Alur: pengguna memilih paket + metode bayar ➜ `createCheckoutInvoice` menyimpan tagihan di
 * "SubscriptionInvoice" lalu `payInvoice` membuat transaksi Midtrans (charge) dan menyimpan instruksi
 * bayarnya (nomor VA / QR / deeplink) ➜ pengguna membayar ➜ notifikasi Midtrans, polling UI, atau
 * scheduler memanggil `syncInvoice`, yang SELALU menanyakan status ke API Midtrans memakai server key
 * sebelum melunasi. Isi notifikasi tidak pernah dipercaya begitu saja (signature dicek, status diambil
 * ulang), jadi notifikasi palsu tidak bisa mengaktifkan paket. Pelunasan + perpanjangan paket atomik di
 * database (`dash_bill_settle`).
 *
 * Satu tagihan bisa punya beberapa transaksi Midtrans bila pengguna ganti metode atau QR kedaluwarsa:
 * order_id = id tagihan, lalu `<id>-2`, `<id>-3`, dst. Transaksi lama di-expire sebelum yang baru dibuat.
 */
import { randomBytes } from "node:crypto";
import {
  BILLING_CYCLES,
  calculateCyclePrice,
  type AdminBillingResponse,
  type BillingCycleMonths,
  type InvoiceDTO,
  type PaymentInstructions,
  type PaymentMethodId,
  type SaaSKpiMetrics,
  type WorkspaceBillingResponse,
} from "./billing-types";
import { getRawIntegrations, type StoredIntegrations } from "./integrations";
import {
  MidtransError,
  chargeMidtrans,
  expireMidtrans,
  getMidtransStatus,
  midtransPaid,
  notificationSignatureValid,
  type MidtransKeys,
  type MidtransTransaction,
} from "./midtrans";
import { adminPlans, forgetPlans, workspacePlans } from "./plan";
import { db, rpc, utc } from "./supabase";
import type { Failure } from "./threads-publish";

/** Lama tagihan bisa dibayar. */
const INVOICE_TTL_SECONDS = 24 * 3600;
/** Tagihan menunggu yang masih berlaku selama ini dipakai ulang alih-alih membuat tagihan baru. */
const REUSE_MIN_REMAINING_MS = 30 * 60_000;
/** Instruksi bayar dianggap masih bisa dipakai bila sisa waktunya lebih dari ini. */
const PAYMENT_MIN_REMAINING_MS = 2 * 60_000;
/** Batas transaksi Midtrans per tagihan (ganti metode berulang). */
const MAX_ATTEMPTS = 20;

const ORDER_RE = /^(INV-\d{8}-[0-9A-F]{6,8})(?:-(\d{1,3}))?$/;

const failure = (status: number, error: string): Failure => ({ ok: false, status, error });
type InvoiceResult = { ok: true; invoice: InvoiceDTO } | Failure;

const NOT_INSTALLED = "Fitur tagihan belum dipasang di database. Jalankan sql/012_billing_and_integrations.sql di Supabase SQL Editor.";
const MIDTRANS_NOT_INSTALLED = "Pembayaran Midtrans belum dipasang di database. Jalankan sql/017_midtrans.sql di Supabase SQL Editor.";
const NOT_ACTIVE = "Pembayaran online belum diaktifkan oleh pengelola platform. Hubungi admin untuk mengaktifkan paket.";

/* ------------------------------------------------------------------ baca */

type RawInvoice = Omit<InvoiceDTO, "createdAt" | "paidAt" | "expiresAt" | "planActiveUntil" | "payment"> & {
  createdAt: string;
  paidAt: string | null;
  expiresAt: string;
  planActiveUntil: string | null;
  payment?: PaymentInstructions | null;
};

const iso = (v: string | null): string | null => (v ? utc(v).toISOString() : null);

/** Baris dari database (timestamp tanpa zona, UTC) ➜ DTO dengan waktu ISO ber-Z. */
function toDto(r: RawInvoice): InvoiceDTO {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    workspaceNama: r.workspaceNama,
    userId: r.userId,
    userName: r.userName,
    userEmail: r.userEmail ?? null,
    planId: r.planId,
    planNama: r.planNama,
    months: Number(r.months) as BillingCycleMonths,
    unitPrice: Number(r.unitPrice),
    discountAmount: Number(r.discountAmount),
    amount: Number(r.amount),
    provider: r.provider,
    status: r.status,
    paymentUrl: r.paymentUrl ?? null,
    externalId: r.externalId ?? null,
    payment: r.payment ?? null,
    paymentMethod: r.paymentMethod ?? null,
    notes: r.notes ?? null,
    createdAt: iso(r.createdAt) as string,
    paidAt: iso(r.paidAt),
    expiresAt: iso(r.expiresAt) as string,
    planActiveUntil: iso(r.planActiveUntil),
  };
}

async function getInvoice(id: string, now = new Date()): Promise<InvoiceDTO | null> {
  const row = await rpc<RawInvoice | null>("dash_bill_get", { p_id: id, p_now: now });
  return row ? toDto(row) : null;
}

export async function listWorkspaceInvoices(workspaceId: string, now = new Date()): Promise<InvoiceDTO[]> {
  const rows = await rpc<RawInvoice[]>("dash_bill_list", { p_ws: workspaceId, p_limit: 50, p_now: now });
  return rows.map(toDto);
}

const paymentReady = (cfg: StoredIntegrations): boolean => cfg.stored && cfg.midtransSchema && !!cfg.midtrans.serverKey;

const keysOf = (cfg: StoredIntegrations): MidtransKeys => ({ serverKey: cfg.midtrans.serverKey, isProduction: cfg.midtrans.isProduction });

export async function getWorkspaceBilling(workspaceId: string): Promise<WorkspaceBillingResponse> {
  const cfg = await getRawIntegrations();
  return {
    success: true,
    paymentReady: paymentReady(cfg),
    testMode: !cfg.midtrans.isProduction,
    methods: cfg.midtrans.methods,
    invoices: cfg.stored ? await listWorkspaceInvoices(workspaceId) : [],
  };
}

interface BillingSummary {
  totalRevenue: number;
  revenue30d: number;
  pendingCount: number;
  paidCount: number;
  cancelledCount: number;
}

const EMPTY_SUMMARY: BillingSummary = { totalRevenue: 0, revenue30d: 0, pendingCount: 0, paidCount: 0, cancelledCount: 0 };

async function billingSummary(now: Date): Promise<BillingSummary> {
  const s = await rpc<BillingSummary>("dash_bill_summary", { p_now: now });
  return {
    totalRevenue: Number(s.totalRevenue),
    revenue30d: Number(s.revenue30d),
    pendingCount: Number(s.pendingCount),
    paidCount: Number(s.paidCount),
    cancelledCount: Number(s.cancelledCount),
  };
}

export async function getAdminBilling(now = new Date()): Promise<AdminBillingResponse> {
  const cfg = await getRawIntegrations();
  if (!cfg.stored) return { success: true, invoices: [], summary: EMPTY_SUMMARY };
  const [rows, summary] = await Promise.all([
    rpc<RawInvoice[]>("dash_bill_list", { p_ws: null, p_limit: 200, p_now: now }),
    billingSummary(now),
  ]);
  return { success: true, invoices: rows.map(toDto), summary };
}

/* ------------------------------------------------------------------ checkout */

/** Instruksi bayar yang masih bisa dipakai untuk metode ini (tidak perlu charge ulang). */
function usablePayment(inv: InvoiceDTO, method: PaymentMethodId, now: Date): boolean {
  const p = inv.payment;
  return !!p && p.method === method && p.status === "pending" && p.orderId === inv.externalId && Date.parse(p.expiresAt) - now.getTime() > PAYMENT_MIN_REMAINING_MS;
}

function nextOrderId(inv: InvoiceDTO): string | null {
  if (!inv.externalId) return inv.id;
  const m = ORDER_RE.exec(inv.externalId);
  const n = m?.[2] ? Number(m[2]) + 1 : 2;
  return n > MAX_ATTEMPTS ? null : `${inv.id}-${n}`;
}

/** URL notifikasi hanya untuk alamat publik https (Midtrans tidak bisa menjangkau localhost). */
function notifyUrlFor(origin: string): string | undefined {
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:" || /^(localhost|127\.|\[::1\])/.test(u.hostname) || u.hostname.endsWith(".localhost")) return undefined;
    return `${u.origin}/api/billing/webhook`;
  } catch {
    return undefined;
  }
}

export async function createCheckoutInvoice(
  params: { workspaceId: string; userId: string; planId: string; months: BillingCycleMonths; method: string; origin: string },
  now = new Date()
): Promise<InvoiceResult> {
  if (!BILLING_CYCLES.some((c) => c.months === params.months)) {
    return failure(400, "Durasi langganan harus 1, 3, atau 12 bulan.");
  }
  const cfg = await getRawIntegrations();
  if (!cfg.stored) return failure(503, NOT_INSTALLED);

  // Hanya paket yang ditawarkan ke publik; paket internal dipasang super admin dari panel.
  const plan = (await adminPlans()).items.find((p) => p.id === params.planId && p.aktif && p.publik);
  if (!plan) return failure(404, "Paket langganan tidak ditemukan atau sedang tidak aktif.");
  const pricing = calculateCyclePrice(plan.hargaBulanan, params.months);

  if (pricing.total > 0) {
    if (!cfg.midtransSchema) return failure(503, MIDTRANS_NOT_INSTALLED);
    if (!cfg.midtrans.serverKey) return failure(503, NOT_ACTIVE);
    if (!cfg.midtrans.methods.includes(params.method as PaymentMethodId)) return failure(400, "Pilih metode pembayaran yang tersedia.");

    // Tagihan yang sama dan masih bisa dibayar: pakai ulang supaya tidak menumpuk tagihan.
    const reusable = (await listWorkspaceInvoices(params.workspaceId, now)).find(
      (i) =>
        i.status === "PENDING" &&
        i.provider === "MIDTRANS" &&
        i.planId === plan.id &&
        i.months === params.months &&
        i.amount === pricing.total &&
        Date.parse(i.expiresAt) - now.getTime() > REUSE_MIN_REMAINING_MS
    );
    if (reusable) return payInvoice(reusable.id, params.method, { actorId: params.userId, origin: params.origin }, now);
  }

  const [userRes, wsSettings, wsRes] = await Promise.all([
    db().from("DashboardUser").select("username, name, email").eq("id", params.userId).maybeSingle(),
    rpc<{ namaBrand: string | null } | null>("dash_mu_settings_get", { p_workspace: params.workspaceId }).catch(() => null),
    db().from("Workspace").select("nama").eq("id", params.workspaceId).maybeSingle(),
  ]);
  const u = (userRes.data ?? {}) as { username?: string; name?: string | null; email?: string | null };
  const workspaceNama =
    wsSettings?.namaBrand || (wsRes.data as { nama?: string } | null)?.nama || params.workspaceId;
  const userName = u.name || u.username || "Pengguna";

  const id = `INV-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(4).toString("hex").toUpperCase()}`;
  const base = {
    id,
    workspaceId: params.workspaceId,
    workspaceNama,
    userId: params.userId,
    userName,
    userEmail: u.email ?? null,
    planId: plan.id,
    planNama: plan.nama,
    months: params.months,
    unitPrice: plan.hargaBulanan,
    discountAmount: pricing.discountAmount,
    amount: pricing.total,
    expiresAt: new Date(now.getTime() + INVOICE_TTL_SECONDS * 1000).toISOString(),
  };

  // Paket Rp 0: langsung aktif tanpa pembayaran.
  if (pricing.total === 0) {
    await rpc("dash_bill_create", { p_inv: { ...base, provider: "GRATIS" }, p_now: now });
    return settleInvoice(id, { actorId: params.userId, paymentMethod: "FREE_PLAN", notes: "Aktivasi paket gratis", now });
  }

  await rpc("dash_bill_create", { p_inv: { ...base, provider: "MIDTRANS" }, p_now: now });
  return payInvoice(id, params.method, { actorId: params.userId, origin: params.origin }, now);
}

/**
 * Buat (atau pakai ulang) transaksi Midtrans untuk tagihan menunggu dengan metode pilihan pengguna.
 * Transaksi lama dimatikan dulu; bila ternyata sudah dibayar, tagihan dilunasi alih-alih ditagih ulang.
 */
export async function payInvoice(
  invoiceId: string,
  method: string,
  opts: { actorId: string; origin: string },
  now = new Date()
): Promise<InvoiceResult> {
  const cfg = await getRawIntegrations();
  if (!cfg.midtransSchema) return failure(503, MIDTRANS_NOT_INSTALLED);
  if (!cfg.midtrans.serverKey) return failure(503, NOT_ACTIVE);
  if (!cfg.midtrans.methods.includes(method as PaymentMethodId)) return failure(400, "Pilih metode pembayaran yang tersedia.");
  const pm = method as PaymentMethodId;

  const inv = await getInvoice(invoiceId, now);
  if (!inv) return failure(404, "Tagihan tidak ditemukan.");
  if (inv.status === "PAID") return { ok: true, invoice: inv };
  if (inv.status !== "PENDING") return failure(409, "Tagihan ini sudah tidak berlaku. Buat tagihan baru.");
  if (inv.provider !== "MIDTRANS") return failure(409, "Tagihan lama ini tidak bisa dibayar lewat Midtrans. Buat tagihan baru.");
  if (usablePayment(inv, pm, now)) return { ok: true, invoice: inv };

  const keys = keysOf(cfg);
  if (inv.externalId) {
    // Matikan transaksi sebelumnya supaya nomor VA/QR lama tidak bisa dibayar dobel.
    const prev = await retireTransaction(keys, inv.externalId);
    if (prev && midtransPaid(prev)) return applyMidtrans(inv, prev, opts.actorId, now);
  }

  const orderId = nextOrderId(inv);
  if (!orderId) return failure(409, "Terlalu sering ganti metode untuk tagihan ini. Batalkan lalu buat tagihan baru.");

  let charged: Awaited<ReturnType<typeof chargeMidtrans>>;
  try {
    charged = await chargeMidtrans(
      keys,
      {
        orderId,
        amount: inv.amount,
        method: pm,
        itemName: `Paket ${inv.planNama} ${inv.months} bulan`,
        customerName: inv.userName,
        email: inv.userEmail,
        invoiceExpiresAt: new Date(inv.expiresAt),
        notifyUrl: notifyUrlFor(opts.origin),
        returnUrl: `${opts.origin}/pengaturan?tab=langganan&invoice=${encodeURIComponent(inv.id)}`,
      },
      now
    );
  } catch (err) {
    console.warn(`[billing] charge Midtrans gagal untuk ${inv.id}:`, err instanceof Error ? err.message : err);
    const why = err instanceof Error ? err.message : "Gagal menghubungi Midtrans.";
    return failure(err instanceof MidtransError && err.status === 402 ? 409 : 502, why);
  }

  const res = await rpc<{ result: "OK" | "NOT_FOUND" | "PAID" | "CLOSED"; invoice?: RawInvoice }>("dash_bill_pay", {
    p_id: inv.id,
    p_external: orderId,
    p_payment: charged.payment,
    p_now: now,
  });
  if (res.result === "NOT_FOUND" || !res.invoice) return failure(404, "Tagihan tidak ditemukan.");
  if (res.result === "CLOSED") return failure(409, "Tagihan ini sudah tidak berlaku. Buat tagihan baru.");
  return { ok: true, invoice: toDto(res.invoice) };
}

/** Expire transaksi lama; hasilnya status terakhir transaksi itu (null bila tidak diketahui). */
async function retireTransaction(keys: MidtransKeys, orderId: string): Promise<MidtransTransaction | null> {
  try {
    return await expireMidtrans(keys, orderId);
  } catch {
    // Sudah lunas/kedaluwarsa/tidak ada di Midtrans: expire ditolak, ambil statusnya saja.
    return getMidtransStatus(keys, orderId).catch(() => null);
  }
}

/* ------------------------------------------------------------------ pelunasan */

type SettleResult = "OK" | "ALREADY" | "NOT_FOUND" | "NO_PLAN" | "NO_TENANT";

/**
 * Lunasi tagihan dan pasang/perpanjang paket workspace (atomik di database).
 * Hanya dipanggil setelah pembayaran terverifikasi: status dari API Midtrans, paket gratis, atau super admin.
 */
export async function settleInvoice(
  invoiceId: string,
  opts: { actorId: string; paymentMethod: string; notes?: string; now?: Date }
): Promise<InvoiceResult> {
  const res = await rpc<{ result: SettleResult; invoice?: RawInvoice }>("dash_bill_settle", {
    p_id: invoiceId,
    p_actor: opts.actorId,
    p_method: opts.paymentMethod,
    p_notes: opts.notes ?? null,
    p_now: opts.now ?? new Date(),
  });
  if (res.result === "NOT_FOUND" || !res.invoice) return failure(404, "Tagihan tidak ditemukan.");
  if (res.result === "NO_PLAN") return failure(409, "Paket pada tagihan ini sudah dihapus. Hubungi admin platform.");
  if (res.result === "NO_TENANT") return failure(409, "Workspace pada tagihan ini tidak ditemukan.");
  forgetPlans();
  return { ok: true, invoice: toDto(res.invoice) };
}

async function closeInvoice(
  invoiceId: string,
  actorId: string,
  status: "CANCELLED" | "EXPIRED",
  notes: string,
  now = new Date()
): Promise<InvoiceResult> {
  const res = await rpc<{ result: "OK" | "NOT_FOUND" | "PAID" | "CLOSED"; invoice?: RawInvoice }>("dash_bill_close", {
    p_id: invoiceId,
    p_actor: actorId,
    p_status: status,
    p_notes: notes,
    p_now: now,
  });
  if (res.result === "NOT_FOUND" || !res.invoice) return failure(404, "Tagihan tidak ditemukan.");
  if (res.result === "PAID") return failure(409, "Tagihan yang sudah lunas tidak bisa dibatalkan.");
  return { ok: true, invoice: toDto(res.invoice) };
}

/** Metode bayar sebenarnya dari data transaksi Midtrans (untuk catatan paymentMethod). */
function methodOfTx(tx: MidtransTransaction): string {
  switch (tx.payment_type) {
    case "bank_transfer":
      return tx.permata_va_number ? "PERMATA_VA" : `${(tx.va_numbers?.[0]?.bank ?? "BANK").toUpperCase()}_VA`;
    case "echannel":
      return "MANDIRI_BILL";
    default:
      return (tx.payment_type ?? "ONLINE").toUpperCase();
  }
}

/** Terapkan status transaksi dari API Midtrans ke tagihan kita. */
async function applyMidtrans(inv: InvoiceDTO, tx: MidtransTransaction, actorId: string, now = new Date()): Promise<InvoiceResult> {
  const owner = ORDER_RE.exec(tx.order_id)?.[1];
  if (owner !== inv.id || Math.round(Number(tx.gross_amount)) !== inv.amount) {
    console.warn(`[billing] data Midtrans tidak cocok untuk ${inv.id} (order_id/nominal berbeda)`);
    return failure(409, "Data transaksi di Midtrans tidak cocok dengan tagihan.");
  }
  if (midtransPaid(tx)) {
    return settleInvoice(inv.id, { actorId, paymentMethod: `MIDTRANS_${methodOfTx(tx)}`, notes: `Lunas via Midtrans (${tx.order_id})`, now });
  }
  // Transaksi yang sedang berlaku berubah status (kedaluwarsa/ditolak): catat supaya UI menawarkan kode baru.
  const st = tx.transaction_status;
  if (inv.payment && tx.order_id === inv.externalId && st && st !== inv.payment.status && ["expire", "cancel", "deny", "failure"].includes(st)) {
    const res = await rpc<{ result: string; invoice?: RawInvoice }>("dash_bill_pay", {
      p_id: inv.id,
      p_external: inv.externalId,
      p_payment: { ...inv.payment, status: st },
      p_now: now,
    });
    if (res.invoice) return { ok: true, invoice: toDto(res.invoice) };
  }
  return { ok: true, invoice: inv };
}

/**
 * Cocokkan tagihan dengan status terbaru di Midtrans (polling UI, tombol "Cek status", scheduler).
 * Aman dipanggil berulang.
 */
export async function syncInvoice(invoiceId: string, actorId: string): Promise<InvoiceResult> {
  const inv = await getInvoice(invoiceId);
  if (!inv) return failure(404, "Tagihan tidak ditemukan.");
  if (inv.provider !== "MIDTRANS" || !inv.externalId || inv.status === "PAID" || inv.status === "CANCELLED") {
    return { ok: true, invoice: inv };
  }
  const cfg = await getRawIntegrations();
  if (!cfg.midtrans.serverKey) return failure(503, "Server key Midtrans belum diisi.");
  try {
    return await applyMidtrans(inv, await getMidtransStatus(keysOf(cfg), inv.externalId), actorId);
  } catch (err) {
    // Transaksi belum tercatat di Midtrans (mis. charge gagal di tengah jalan): belum ada yang dibayar.
    if (err instanceof MidtransError && err.status === 404) return { ok: true, invoice: inv };
    return failure(502, err instanceof Error ? err.message : "Gagal menghubungi Midtrans.");
  }
}

/** Batalkan tagihan yang belum lunas; transaksi di Midtrans ikut dimatikan supaya kode bayarnya mati. */
export async function cancelInvoice(invoiceId: string, actorId: string, notes: string): Promise<InvoiceResult> {
  const inv = await getInvoice(invoiceId);
  if (!inv) return failure(404, "Tagihan tidak ditemukan.");
  if (inv.status === "PAID") return failure(409, "Tagihan yang sudah lunas tidak bisa dibatalkan.");

  const cfg = await getRawIntegrations();
  if (inv.provider === "MIDTRANS" && inv.externalId && cfg.midtrans.serverKey && inv.status === "PENDING") {
    const last = await retireTransaction(keysOf(cfg), inv.externalId);
    // Sempat dibayar sebelum dimatikan: lunasi, jangan batalkan.
    if (last && midtransPaid(last)) {
      const settled = await applyMidtrans(inv, last, actorId);
      return settled.ok ? failure(409, "Tagihan ini ternyata sudah dibayar. Paket sudah aktif.") : settled;
    }
  }
  return closeInvoice(inv.id, actorId, "CANCELLED", notes);
}

/** Super admin menandai lunas secara manual (mis. transfer di luar Midtrans). */
export function approveInvoice(invoiceId: string, adminId: string, notes: string) {
  return settleInvoice(invoiceId, { actorId: adminId, paymentMethod: "VERIFIKASI_SUPERADMIN", notes });
}

/**
 * Notifikasi HTTP Midtrans. signature_key wajib valid; apa pun isinya, status tetap diambil ulang dari
 * API Midtrans sebelum tagihan dilunasi. Hasil `status` adalah kode HTTP untuk Midtrans (2xx = jangan kirim ulang).
 */
export async function handleMidtransNotification(body: unknown): Promise<{ status: number; message: string }> {
  const cfg = await getRawIntegrations();
  if (!cfg.stored || !cfg.midtrans.serverKey) return { status: 503, message: "Midtrans belum dikonfigurasi." };

  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (!notificationSignatureValid(cfg.midtrans.serverKey, b)) return { status: 401, message: "Signature tidak valid." };

  const orderId = typeof b.order_id === "string" ? b.order_id : "";
  const invoiceId = ORDER_RE.exec(orderId)?.[1];
  // Transaksi lain di akun Midtrans yang sama (atau uji coba dari dashboard): akui supaya tidak dikirim ulang.
  if (!invoiceId) return { status: 200, message: "Diabaikan." };

  const inv = await getInvoice(invoiceId);
  if (!inv) return { status: 200, message: "Tagihan tidak dikenal." };
  if (inv.status === "PAID") return { status: 200, message: "Sudah lunas." };
  try {
    const res = await applyMidtrans(inv, await getMidtransStatus(keysOf(cfg), orderId), "system:midtrans");
    if (!res.ok) return { status: res.status >= 500 ? 502 : 200, message: res.error };
    return { status: 200, message: `Status ${res.invoice.status}.` };
  } catch (err) {
    return { status: 502, message: err instanceof Error ? err.message : "Gagal menghubungi Midtrans." };
  }
}

/**
 * Cadangan bila notifikasi Midtrans terlewat (server mati, localhost): cocokkan tagihan menunggu
 * dengan status di Midtrans. Dipanggil dari tick autopilot.
 */
export async function syncPendingInvoices(limit = 20, now = new Date()): Promise<{ checked: number; paid: number }> {
  const cfg = await getRawIntegrations();
  if (!paymentReady(cfg)) return { checked: 0, paid: 0 };
  const ids = await rpc<string[]>("dash_bill_pending", { p_limit: limit, p_now: now }).catch(() => [] as string[]);
  let paid = 0;
  for (const id of ids) {
    const res = await syncInvoice(id, "system:midtrans").catch(() => null);
    if (res?.ok && res.invoice.status === "PAID") paid += 1;
  }
  return { checked: ids.length, paid };
}

/* ------------------------------------------------------------------ KPI SaaS */

export async function computeSaaSKpis(
  overview: {
    workspaces: { total: number; ditangguhkan: number; tanpaAkun: number };
    accounts: { total: number; tanpaPemilik: number };
    autopilot: { otomatis: number; tinjau: number; dijeda: number; slot24Jam: Record<string, number> };
  },
  now = new Date()
): Promise<SaaSKpiMetrics> {
  const cfg = await getRawIntegrations();
  const [plansRes, wsPlanMap, summary] = await Promise.all([
    adminPlans(),
    workspacePlans(),
    cfg.stored ? billingSummary(now).catch(() => EMPTY_SUMMARY) : EMPTY_SUMMARY,
  ]);

  const plans = plansRes.items;
  const defaultPlan = plans.find((p) => p.bawaan) ?? null;
  const planById = new Map(plans.map((p) => [p.id, p]));

  const nowMs = now.getTime();
  const sevenDaysMs = nowMs + 7 * 86_400_000;

  let mrr = 0;
  let paidWorkspaces = 0;
  let freeWorkspaces = 0;
  let expiredWorkspaces = 0;
  let expiringSoon7d = 0;

  const countsByPlan = new Map<string, number>();
  const assignedWorkspaceIds = Object.keys(wsPlanMap);

  for (const wsId of assignedWorkspaceIds) {
    const entry = wsPlanMap[wsId];
    const plan = planById.get(entry.planId);
    if (!plan) continue;

    const endMs = entry.planBerakhir ? Date.parse(entry.planBerakhir) : null;
    const isExpired = endMs !== null && Number.isFinite(endMs) && endMs <= nowMs;
    const isExpiringSoon = !isExpired && endMs !== null && Number.isFinite(endMs) && endMs <= sevenDaysMs;

    if (isExpired) {
      expiredWorkspaces += 1;
      continue;
    }
    if (isExpiringSoon) {
      expiringSoon7d += 1;
    }

    countsByPlan.set(plan.id, (countsByPlan.get(plan.id) ?? 0) + 1);
    if (plan.hargaBulanan > 0) {
      paidWorkspaces += 1;
      mrr += plan.hargaBulanan;
    } else {
      freeWorkspaces += 1;
    }
  }

  // Workspace yang belum punya planId sendiri mengikuti defaultPlan
  const unassignedCount = Math.max(0, overview.workspaces.total - assignedWorkspaceIds.length);
  if (unassignedCount > 0 && defaultPlan) {
    countsByPlan.set(defaultPlan.id, (countsByPlan.get(defaultPlan.id) ?? 0) + unassignedCount);
    if (defaultPlan.hargaBulanan > 0) {
      paidWorkspaces += unassignedCount;
      mrr += defaultPlan.hargaBulanan * unassignedCount;
    } else {
      freeWorkspaces += unassignedCount;
    }
  } else if (unassignedCount > 0) {
    freeWorkspaces += unassignedCount;
  }

  const arr = mrr * 12;
  const arpu = paidWorkspaces > 0 ? Math.round(mrr / paidWorkspaces) : 0;
  const totalWs = Math.max(1, overview.workspaces.total);
  const conversionRate = overview.workspaces.total > 0 ? Math.round((paidWorkspaces / totalWs) * 1000) / 10 : 0;

  const activatedWs = Math.max(0, overview.workspaces.total - overview.workspaces.tanpaAkun);
  const tenantActivationRate = overview.workspaces.total > 0 ? Math.round((activatedWs / totalWs) * 1000) / 10 : 0;

  const activeAutopilotAccounts = overview.autopilot.otomatis + overview.autopilot.tinjau;
  const autopilotAdoptionRate =
    overview.accounts.total > 0
      ? Math.round((Math.min(overview.accounts.total, activeAutopilotAccounts) / overview.accounts.total) * 1000) / 10
      : 0;

  const terbit24h = overview.autopilot.slot24Jam.TERBIT ?? 0;
  const gagal24h = overview.autopilot.slot24Jam.GAGAL ?? 0;
  const publishSuccessRate24h =
    terbit24h + gagal24h > 0 ? Math.round((terbit24h / (terbit24h + gagal24h)) * 1000) / 10 : 100;

  const planBreakdown = plans.map((p) => {
    const count = countsByPlan.get(p.id) ?? 0;
    return {
      planId: p.id,
      nama: p.nama,
      hargaBulanan: p.hargaBulanan,
      count,
      mrrContribution: count * p.hargaBulanan,
    };
  });

  return {
    mrr,
    arr,
    arpu,
    totalRevenue: summary.totalRevenue,
    revenue30d: summary.revenue30d,
    paidWorkspaces,
    freeWorkspaces,
    expiredWorkspaces,
    expiringSoon7d,
    conversionRate,
    tenantActivationRate,
    autopilotAdoptionRate,
    publishSuccessRate24h,
    pendingInvoices: summary.pendingCount,
    paidInvoices: summary.paidCount,
    planBreakdown,
  };
}
