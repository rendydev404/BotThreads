/**
 * Kontrak data pembayaran (Xendit Invoice), tagihan langganan, integrasi API eksternal,
 * serta metrik KPI SaaS standar industri. Aman diimpor di komponen "use client".
 */

/** XENDIT = dibayar online lewat Xendit; GRATIS = paket Rp 0 yang langsung aktif. */
export type PaymentProvider = "XENDIT" | "GRATIS";
export type BillingCycleMonths = 1 | 3 | 12;
export type InvoiceStatus = "PENDING" | "PAID" | "EXPIRED" | "CANCELLED";

export interface BillingCycleOption {
  months: BillingCycleMonths;
  label: string;
  discountPercent: number;
  badge: string | null;
}

export const BILLING_CYCLES: BillingCycleOption[] = [
  { months: 1, label: "1 Bulan", discountPercent: 0, badge: null },
  { months: 3, label: "3 Bulan", discountPercent: 10, badge: "Hemat 10%" },
  { months: 12, label: "1 Tahun (12 Bulan)", discountPercent: 20, badge: "Hemat 20%" },
];

export function calculateCyclePrice(hargaBulanan: number, months: BillingCycleMonths): {
  subtotal: number;
  discountAmount: number;
  total: number;
  monthlyEquivalent: number;
} {
  const cycle = BILLING_CYCLES.find((c) => c.months === months) ?? BILLING_CYCLES[0];
  const subtotal = Math.max(0, Math.round(hargaBulanan)) * cycle.months;
  const discountAmount = Math.round((subtotal * cycle.discountPercent) / 100);
  const total = Math.max(0, subtotal - discountAmount);
  const monthlyEquivalent = Math.round(total / cycle.months);
  return { subtotal, discountAmount, total, monthlyEquivalent };
}

export interface InvoiceDTO {
  id: string;
  workspaceId: string;
  workspaceNama: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  planId: string;
  planNama: string;
  months: BillingCycleMonths;
  unitPrice: number;
  discountAmount: number;
  amount: number;
  provider: PaymentProvider;
  status: InvoiceStatus;
  /** Halaman checkout Xendit (QRIS, Virtual Account, e-wallet, gerai retail). */
  paymentUrl: string | null;
  /** Id invoice di Xendit. */
  externalId: string | null;
  paymentMethod: string | null;
  notes: string | null;
  createdAt: string;
  paidAt: string | null;
  expiresAt: string;
  planActiveUntil: string | null;
}

export interface WorkspaceBillingResponse {
  success: true;
  /** Xendit siap dipakai (secret key terisi dan tabel tagihan terpasang). */
  paymentReady: boolean;
  /** Kunci Xendit mode uji (xnd_development_): pembayaran tidak menarik uang sungguhan. */
  testMode: boolean;
  invoices: InvoiceDTO[];
}

export interface PlatformIntegrationsDTO {
  /** Tabel konfigurasi terpasang (sql/012); bila false, kunci hanya bisa diisi lewat env. */
  stored: boolean;
  appUrl: string;
  xendit: {
    ready: boolean;
    mode: "test" | "live" | null;
    secretKeyMasked: string;
    hasCallbackToken: boolean;
    callbackTokenMasked: string;
    webhookUrl: string;
    source: "database" | "env" | "none";
  };
  googleOauth: {
    enabled: boolean;
    clientId: string;
    clientSecretMasked: string;
    hasClientSecret: boolean;
    callbackUrl: string;
    source: "database" | "env" | "none";
  };
  threadsOauth: {
    enabled: boolean;
    appId: string;
    appSecretMasked: string;
    hasAppSecret: boolean;
    callbackUrl: string;
    /** TOKEN_ENCRYPTION_KEY terisi di server (wajib sama dengan worker auto-suka). */
    tokenKeyConfigured: boolean;
    source: "database" | "env" | "none";
  };
}

export interface AdminIntegrationsResponse {
  success: true;
  integrations: PlatformIntegrationsDTO;
}

export interface AdminBillingResponse {
  success: true;
  invoices: InvoiceDTO[];
  summary: {
    totalRevenue: number;
    revenue30d: number;
    pendingCount: number;
    paidCount: number;
    cancelledCount: number;
  };
}

export interface SaaSKpiMetrics {
  /** Monthly Recurring Revenue (IDR) dari workspace berbayar aktif */
  mrr: number;
  /** Annual Run Rate (MRR * 12) dalam IDR */
  arr: number;
  /** Average Revenue Per Paying Workspace (IDR) */
  arpu: number;
  /** Total pendapatan terkumpul dari seluruh invoice berstatus PAID (IDR) */
  totalRevenue: number;
  /** Pendapatan 30 hari terakhir dari invoice PAID (IDR) */
  revenue30d: number;
  /** Jumlah workspace pada paket berbayar aktif */
  paidWorkspaces: number;
  /** Jumlah workspace pada paket gratis / trial */
  freeWorkspaces: number;
  /** Jumlah workspace yang masa berlaku paketnya telah kedaluwarsa */
  expiredWorkspaces: number;
  /** Jumlah workspace yang akan kedaluwarsa dalam <= 7 hari ke depan (Churn Risk) */
  expiringSoon7d: number;
  /** Rasio konversi workspace berbayar terhadap total workspace (0-100) */
  conversionRate: number;
  /** Rasio aktivasi tenant: workspace yang sudah menghubungkan >= 1 akun Threads (0-100) */
  tenantActivationRate: number;
  /** Rasio adopsi autopilot: akun Threads dengan mode autopilot aktif (0-100) */
  autopilotAdoptionRate: number;
  /** Tingkat keberhasilan penerbitan konten otomatis 24 jam (0-100) */
  publishSuccessRate24h: number;
  /** Jumlah tagihan yang menunggu pembayaran / verifikasi */
  pendingInvoices: number;
  /** Jumlah tagihan lunas */
  paidInvoices: number;
  /** Distribusi workspace dan kontribusi MRR per paket */
  planBreakdown: {
    planId: string;
    nama: string;
    hargaBulanan: number;
    count: number;
    mrrContribution: number;
  }[];
}

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  PENDING: "Menunggu Pembayaran",
  PAID: "Lunas",
  EXPIRED: "Kedaluwarsa",
  CANCELLED: "Dibatalkan",
};

export const PAYMENT_PROVIDER_LABEL: Record<PaymentProvider, string> = {
  XENDIT: "Xendit",
  GRATIS: "Paket Gratis",
};

/** Label metode bayar dari Xendit (mis. XENDIT_QRIS ➜ QRIS) untuk ditampilkan. */
export function paymentMethodLabel(method: string | null): string | null {
  if (!method) return null;
  if (method === "FREE_PLAN") return "Gratis";
  if (method === "VERIFIKASI_SUPERADMIN") return "Disetujui Super Admin";
  return method.replace(/^XENDIT_/, "").replace(/_/g, " ");
}
