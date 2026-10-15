/**
 * Tagihan langganan via Xendit Invoice dan kalkulasi KPI SaaS.
 *
 * Alur: pengguna memilih paket ➜ `createCheckoutInvoice` membuat invoice Xendit dan menyimpannya di
 * "SubscriptionInvoice" ➜ pengguna membayar di halaman Xendit ➜ callback Xendit (atau tombol "Cek
 * status") memanggil `syncInvoice`, yang SELALU menanyakan status ke API Xendit memakai secret key
 * sebelum melunasi. Isi callback tidak pernah dipercaya begitu saja, jadi callback palsu tidak bisa
 * mengaktifkan paket. Pelunasan + perpanjangan paket atomik di database (`dash_bill_settle`).
 */
import { randomBytes } from "node:crypto";
import {
  BILLING_CYCLES,
  calculateCyclePrice,
  type AdminBillingResponse,
  type BillingCycleMonths,
  type InvoiceDTO,
  type SaaSKpiMetrics,
  type WorkspaceBillingResponse,
} from "./billing-types";
import { getRawIntegrations } from "./integrations";
import { adminPlans, forgetPlans, workspacePlans } from "./plan";
import { db, rpc, utc } from "./supabase";
import type { Failure } from "./threads-publish";
import {
  callbackTokenMatches,
  createXenditInvoice,
  expireXenditInvoice,
  getXenditInvoice,
  xenditMode,
  type XenditInvoice,
} from "./xendit";

/** Lama tagihan bisa dibayar. */
const INVOICE_TTL_SECONDS = 24 * 3600;
/** Tagihan menunggu yang masih berlaku selama ini dipakai ulang alih-alih membuat invoice baru. */
const REUSE_MIN_REMAINING_MS = 30 * 60_000;

const failure = (status: number, error: string): Failure => ({ ok: false, status, error });

const NOT_INSTALLED = "Fitur tagihan belum dipasang di database. Jalankan sql/012_billing_and_integrations.sql di Supabase SQL Editor.";

/* ------------------------------------------------------------------ baca */

type RawInvoice = Omit<InvoiceDTO, "createdAt" | "paidAt" | "expiresAt" | "planActiveUntil"> & {
  createdAt: string;
  paidAt: string | null;
  expiresAt: string;
  planActiveUntil: string | null;
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

export async function getWorkspaceBilling(workspaceId: string): Promise<WorkspaceBillingResponse> {
  const cfg = await getRawIntegrations();
  return {
    success: true,
    paymentReady: cfg.stored && !!cfg.xendit.secretKey,
    testMode: xenditMode(cfg.xendit.secretKey) === "test",
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

export async function createCheckoutInvoice(
  params: { workspaceId: string; userId: string; planId: string; months: BillingCycleMonths; origin: string },
  now = new Date()
): Promise<{ ok: true; invoice: InvoiceDTO } | Failure> {
  if (!BILLING_CYCLES.some((c) => c.months === params.months)) {
    return failure(400, "Durasi langganan harus 1, 3, atau 12 bulan.");
  }
  const cfg = await getRawIntegrations();
  if (!cfg.stored) return failure(503, NOT_INSTALLED);

  // Hanya paket yang ditawarkan ke publik; paket internal dipasang super admin dari panel.
  const plan = (await adminPlans()).items.find((p) => p.id === params.planId && p.aktif && p.publik);
  if (!plan) return failure(404, "Paket langganan tidak ditemukan atau sedang tidak aktif.");
  const pricing = calculateCyclePrice(plan.hargaBulanan, params.months);

  if (pricing.total > 0 && !cfg.xendit.secretKey) {
    return failure(503, "Pembayaran online belum diaktifkan oleh pengelola platform. Hubungi admin untuk mengaktifkan paket.");
  }

  // Tagihan yang sama dan masih bisa dibayar: pakai ulang supaya tidak menumpuk invoice di Xendit.
  if (pricing.total > 0) {
    const reusable = (await listWorkspaceInvoices(params.workspaceId, now)).find(
      (i) =>
        i.status === "PENDING" &&
        i.planId === plan.id &&
        i.months === params.months &&
        i.amount === pricing.total &&
        !!i.paymentUrl &&
        Date.parse(i.expiresAt) - now.getTime() > REUSE_MIN_REMAINING_MS
    );
    if (reusable) return { ok: true, invoice: reusable };
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

  let xendit: XenditInvoice;
  try {
    xendit = await createXenditInvoice(cfg.xendit.secretKey, {
      externalId: id,
      amount: pricing.total,
      description: `Langganan paket ${plan.nama} ${params.months} bulan - ${workspaceNama}`,
      payerEmail: u.email ?? null,
      customerName: userName,
      itemName: `Paket ${plan.nama} (${params.months} bulan)`,
      durationSeconds: INVOICE_TTL_SECONDS,
      returnUrl: `${params.origin}/pengaturan?tab=langganan&invoice=${encodeURIComponent(id)}`,
    });
  } catch (err) {
    console.warn("[billing] gagal membuat invoice Xendit:", err instanceof Error ? err.message : err);
    return failure(502, err instanceof Error ? err.message : "Gagal menghubungi Xendit.");
  }

  const saved = await rpc<RawInvoice>("dash_bill_create", {
    p_inv: {
      ...base,
      provider: "XENDIT",
      paymentUrl: xendit.invoice_url,
      externalId: xendit.id,
      expiresAt: xendit.expiry_date ? new Date(xendit.expiry_date).toISOString() : base.expiresAt,
    },
    p_now: now,
  });
  return { ok: true, invoice: toDto(saved) };
}

/* ------------------------------------------------------------------ pelunasan */

type SettleResult = "OK" | "ALREADY" | "NOT_FOUND" | "NO_PLAN" | "NO_TENANT";

/**
 * Lunasi tagihan dan pasang/perpanjang paket workspace (atomik di database).
 * Hanya dipanggil setelah pembayaran terverifikasi: status dari API Xendit, paket gratis, atau super admin.
 */
export async function settleInvoice(
  invoiceId: string,
  opts: { actorId: string; paymentMethod: string; notes?: string; now?: Date }
): Promise<{ ok: true; invoice: InvoiceDTO } | Failure> {
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
): Promise<{ ok: true; invoice: InvoiceDTO } | Failure> {
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

/** Terapkan status invoice dari API Xendit ke tagihan kita. */
async function applyXendit(inv: InvoiceDTO, x: XenditInvoice, actorId: string): Promise<{ ok: true; invoice: InvoiceDTO } | Failure> {
  if (x.external_id !== inv.id || Number(x.amount) !== inv.amount) {
    console.warn(`[billing] data Xendit tidak cocok untuk ${inv.id} (external_id/amount berbeda)`);
    return failure(409, "Data invoice di Xendit tidak cocok dengan tagihan.");
  }
  if (x.status === "PAID" || x.status === "SETTLED") {
    const channel = (x.payment_channel || x.payment_method || "INVOICE").toUpperCase();
    return settleInvoice(inv.id, { actorId, paymentMethod: `XENDIT_${channel}`, notes: "Lunas via Xendit" });
  }
  if (x.status === "EXPIRED" && inv.status === "PENDING") {
    return closeInvoice(inv.id, actorId, "EXPIRED", "Kedaluwarsa di Xendit");
  }
  return { ok: true, invoice: inv };
}

/**
 * Cocokkan tagihan dengan status terbaru di Xendit (tombol "Cek status" dan sesudah kembali dari
 * halaman bayar). Aman dipanggil berulang.
 */
export async function syncInvoice(invoiceId: string, actorId: string): Promise<{ ok: true; invoice: InvoiceDTO } | Failure> {
  const inv = await getInvoice(invoiceId);
  if (!inv) return failure(404, "Tagihan tidak ditemukan.");
  if (inv.provider !== "XENDIT" || !inv.externalId || inv.status === "PAID" || inv.status === "CANCELLED") {
    return { ok: true, invoice: inv };
  }
  const cfg = await getRawIntegrations();
  if (!cfg.xendit.secretKey) return failure(503, "Kunci Xendit belum diisi.");
  try {
    return await applyXendit(inv, await getXenditInvoice(cfg.xendit.secretKey, inv.externalId), actorId);
  } catch (err) {
    return failure(502, err instanceof Error ? err.message : "Gagal menghubungi Xendit.");
  }
}

/** Batalkan tagihan yang belum lunas; invoice di Xendit ikut ditutup supaya tautannya mati. */
export async function cancelInvoice(
  invoiceId: string,
  actorId: string,
  notes: string
): Promise<{ ok: true; invoice: InvoiceDTO } | Failure> {
  const inv = await getInvoice(invoiceId);
  if (!inv) return failure(404, "Tagihan tidak ditemukan.");
  if (inv.status === "PAID") return failure(409, "Tagihan yang sudah lunas tidak bisa dibatalkan.");

  const cfg = await getRawIntegrations();
  if (inv.provider === "XENDIT" && inv.externalId && cfg.xendit.secretKey && inv.status === "PENDING") {
    try {
      const x = await expireXenditInvoice(cfg.xendit.secretKey, inv.externalId);
      // Sempat dibayar sebelum ditutup: lunasi, jangan batalkan.
      if (x.status === "PAID" || x.status === "SETTLED") return applyXendit(inv, x, actorId);
    } catch (err) {
      // Invoice yang sudah kedaluwarsa/lunas di Xendit menolak ditutup; cek statusnya.
      const synced = await syncInvoice(inv.id, actorId);
      if (synced.ok && synced.invoice.status === "PAID") return failure(409, "Tagihan ini ternyata sudah dibayar.");
      if (!synced.ok) return failure(502, err instanceof Error ? err.message : "Gagal menutup invoice di Xendit.");
    }
  }
  return closeInvoice(inv.id, actorId, "CANCELLED", notes);
}

/** Super admin menandai lunas secara manual (mis. transfer di luar Xendit). */
export function approveInvoice(invoiceId: string, adminId: string, notes: string) {
  return settleInvoice(invoiceId, { actorId: adminId, paymentMethod: "VERIFIKASI_SUPERADMIN", notes });
}

/**
 * Callback invoice Xendit. Token x-callback-token wajib cocok bila diisi di pengaturan; apa pun isi
 * callback-nya, status tetap diambil ulang dari API Xendit sebelum tagihan dilunasi.
 * Hasil `status` adalah kode HTTP untuk Xendit (2xx = jangan kirim ulang).
 */
export async function handleXenditCallback(
  body: unknown,
  callbackToken: string | null
): Promise<{ status: number; message: string }> {
  const cfg = await getRawIntegrations();
  if (cfg.xendit.callbackToken && !callbackTokenMatches(cfg.xendit.callbackToken, callbackToken)) {
    return { status: 401, message: "Callback token tidak valid." };
  }
  if (!cfg.stored || !cfg.xendit.secretKey) return { status: 503, message: "Xendit belum dikonfigurasi." };

  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const externalId = typeof b.external_id === "string" ? b.external_id : "";
  if (!/^INV-\d{8}-[0-9A-F]{6,8}$/.test(externalId)) {
    // Callback produk Xendit lain (atau uji coba dari dashboard Xendit): akui supaya tidak dikirim ulang.
    return { status: 200, message: "Diabaikan." };
  }

  const inv = await getInvoice(externalId);
  if (!inv) return { status: 200, message: "Tagihan tidak dikenal." };
  const res = await syncInvoice(inv.id, "system:xendit");
  if (!res.ok) return { status: res.status >= 500 ? 502 : 200, message: res.error };
  return { status: 200, message: `Status ${res.invoice.status}.` };
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
