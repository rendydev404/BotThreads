"use client";

import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Gem,
  Loader2,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  BILLING_CYCLES,
  INVOICE_STATUS_LABEL,
  calculateCyclePrice,
  paymentMethodLabel,
  type BillingCycleMonths,
  type InvoiceDTO,
  type InvoiceStatus,
  type WorkspaceBillingResponse,
} from "@/lib/billing-types";
import { formatRupiah, type PublicPlansResponse, type WorkspacePlanResponse } from "@/lib/plan-types";
import {
  cancelBillingInvoice,
  createBillingCheckout,
  fetchPublicPlans,
  fetchWorkspaceBilling,
  fetchWorkspacePlan,
  syncBillingInvoice,
} from "@/lib/team-client";
import { cn } from "@/lib/utils";
import { Banner } from "@/components/autopilot/shared";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { FormError } from "./fields";
import { errorText, formatDateWib, formatInt } from "./format";
import { BTN_OUTLINE, BTN_PRIMARY, EmptyState, LoadError, Pill, RefreshButton, type PillTone } from "./states";
import { useRemote } from "./use-remote";

type PlanItem = PublicPlansResponse["items"][number];

const STATUS_TONE: Record<InvoiceStatus, PillTone> = {
  PAID: "success",
  PENDING: "warning",
  EXPIRED: "neutral",
  CANCELLED: "danger",
};

export function SubscriptionTab({ canManage }: { canManage: boolean }) {
  const wsPlan = useRemote<WorkspacePlanResponse>("paket", fetchWorkspacePlan, "Gagal memuat paket aktif.");
  const pubPlans = useRemote<PublicPlansResponse>("paket-publik", fetchPublicPlans, "Gagal memuat katalog paket.");
  const billing = useRemote<WorkspaceBillingResponse>("tagihan-ws", fetchWorkspaceBilling, "Gagal memuat riwayat tagihan.");
  const returnedInvoice = useSearchParams().get("invoice");

  const [cycle, setCycle] = useState<BillingCycleMonths>(1);
  const [checkoutPlan, setCheckoutPlan] = useState<PlanItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "info"; text: string } | null>(null);

  const reloadAll = () => {
    wsPlan.reload();
    pubPlans.reload();
    billing.reload();
  };

  const reportStatus = (inv: InvoiceDTO) => {
    if (inv.status === "PAID") {
      setNotice({
        tone: "success",
        text: `Pembayaran ${inv.id} diterima. Paket ${inv.planNama} aktif sampai ${
          inv.planActiveUntil ? formatDateWib(inv.planActiveUntil) : "tanpa batas"
        }.`,
      });
    } else if (inv.status === "PENDING") {
      setNotice({ tone: "info", text: `Tagihan ${inv.id} belum dibayar. Selesaikan pembayaran di halaman Xendit.` });
    } else {
      setNotice({ tone: "info", text: `Tagihan ${inv.id} ${INVOICE_STATUS_LABEL[inv.status].toLowerCase()}.` });
    }
  };

  // Kembali dari halaman bayar Xendit (?invoice=ID): langsung cek statusnya sekali.
  const checkedReturn = useRef(false);
  useEffect(() => {
    if (!returnedInvoice || checkedReturn.current || !canManage) return;
    checkedReturn.current = true;
    void syncBillingInvoice(returnedInvoice)
      .then((res) => {
        reportStatus(res.invoice);
        if (res.invoice.status === "PAID") {
          wsPlan.reload();
          billing.reload();
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnedInvoice, canManage]);

  const run = async (key: string, fn: () => Promise<void>, fallback: string) => {
    if (busy) return;
    setBusy(key);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(errorText(e, fallback));
    } finally {
      setBusy(null);
    }
  };

  const openCheckout = (plan: PlanItem) => {
    setActionError(null);
    setCheckoutPlan(plan);
  };

  const handleCheckout = () =>
    run(
      "checkout",
      async () => {
        if (!checkoutPlan) return;
        const res = await createBillingCheckout({ planId: checkoutPlan.id, months: cycle });
        if (res.invoice.status === "PAID") {
          setCheckoutPlan(null);
          reloadAll();
          reportStatus(res.invoice);
        } else if (res.invoice.paymentUrl) {
          // Ke halaman bayar Xendit; Xendit mengembalikan pengguna ke tab ini dengan ?invoice=ID.
          window.location.assign(res.invoice.paymentUrl);
        } else {
          setCheckoutPlan(null);
          billing.reload();
        }
      },
      "Gagal membuat tagihan langganan."
    );

  const handleSync = (inv: InvoiceDTO) =>
    run(
      `sync:${inv.id}`,
      async () => {
        const res = await syncBillingInvoice(inv.id);
        reportStatus(res.invoice);
        if (res.invoice.status !== inv.status) reloadAll();
      },
      "Gagal mengecek status pembayaran."
    );

  const handleCancel = (inv: InvoiceDTO) =>
    run(
      `cancel:${inv.id}`,
      async () => {
        await cancelBillingInvoice(inv.id);
        billing.reload();
        setNotice({ tone: "info", text: `Tagihan ${inv.id} dibatalkan.` });
      },
      "Gagal membatalkan tagihan."
    );

  if (pubPlans.loading && !pubPlans.data) {
    return (
      <div className="card p-6 space-y-4 animate-pulse" aria-busy="true">
        <div className="h-5 w-48 rounded bg-subtle" />
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-64 rounded-2xl bg-subtle" />
          ))}
        </div>
      </div>
    );
  }

  if (pubPlans.error && !pubPlans.data) {
    return <LoadError message={pubPlans.error} status={pubPlans.status} onRetry={reloadAll} />;
  }

  const plans = pubPlans.data?.items ?? [];
  const currentPlanId = wsPlan.data?.plan?.id ?? null;
  const isDefaultPlan = wsPlan.data?.bawaan ?? true;
  const invoices = billing.data?.invoices ?? [];
  const paymentReady = billing.data?.paymentReady ?? false;
  const testMode = billing.data?.testMode ?? false;

  return (
    <div className="space-y-6">
      {notice && (
        <Banner tone={notice.tone} onClose={() => setNotice(null)}>
          {notice.text}
        </Banner>
      )}
      {actionError && !checkoutPlan && (
        <Banner tone="danger" onClose={() => setActionError(null)}>
          {actionError}
        </Banner>
      )}
      {billing.data && !paymentReady && canManage && (
        <Banner tone="warning">
          Pembayaran online belum diaktifkan oleh pengelola platform. Paket gratis tetap bisa dipakai; untuk paket berbayar
          hubungi admin.
        </Banner>
      )}

      {/* Pemilih Siklus Sewa & Katalog Paket */}
      <section className="space-y-4" aria-label="Pilih paket langganan">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-fg">Pilih Paket Langganan</h3>
            <p className="text-xs text-muted">
              Sewa paket sesuai jumlah akun Threads yang ingin diotomatisasi. Aktif seketika setelah pembayaran.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div role="group" aria-label="Siklus penagihan" className="inline-flex p-1 rounded-xl bg-subtle border border-line">
              {BILLING_CYCLES.map((c) => {
                const active = cycle === c.months;
                return (
                  <button
                    key={c.months}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setCycle(c.months)}
                    className={cn(
                      "h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer",
                      active ? "bg-surface text-fg shadow-xs" : "text-muted hover:text-fg"
                    )}
                  >
                    <span>{c.label}</span>
                    {c.badge && (
                      <span className="px-1.5 py-0.5 rounded bg-accent-soft text-accent text-[10px] font-bold">
                        {c.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <RefreshButton onClick={reloadAll} busy={pubPlans.refreshing || billing.refreshing} />
          </div>
        </div>

        {plans.length === 0 ? (
          <EmptyState icon={<Gem className="w-6 h-6" />} title="Belum ada paket langganan publik.">
            Super admin dapat menambahkan atau mengaktifkan paket dari konsol Super Admin.
          </EmptyState>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {plans.map((p) => {
              const isCurrent = currentPlanId === p.id && !wsPlan.data?.kedaluwarsa;
              const pricing = calculateCyclePrice(p.hargaBulanan, cycle);
              const isPopular = p.id === "pro";

              return (
                <article
                  key={p.id}
                  className={cn(
                    "card p-5 flex flex-col justify-between transition-colors",
                    isPopular ? "border-accent ring-1 ring-accent/20" : "border-line"
                  )}
                >
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-base font-bold text-fg">{p.nama}</h4>
                        <p className="text-[11px] font-mono text-faint">{p.id}</p>
                      </div>
                      {isCurrent ? (
                        <Pill tone="success" icon={<CheckCircle2 className="w-3 h-3" />}>
                          {isDefaultPlan ? "Bawaan" : "Aktif"}
                        </Pill>
                      ) : isPopular ? (
                        <Pill tone="accent" icon={<Sparkles className="w-3 h-3" />}>
                          Populer
                        </Pill>
                      ) : null}
                    </div>

                    {p.deskripsi && <p className="text-xs text-muted leading-relaxed min-h-[2.25rem]">{p.deskripsi}</p>}

                    <div className="pt-1 border-t border-line">
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-extrabold text-fg tabular-nums">
                          {formatRupiah(pricing.monthlyEquivalent)}
                        </span>
                        {p.hargaBulanan > 0 && <span className="text-xs text-muted">/ bulan</span>}
                      </div>
                      {p.hargaBulanan > 0 && cycle > 1 ? (
                        <p className="mt-0.5 text-[11px] text-accent font-semibold">
                          Total {formatRupiah(pricing.total)} untuk {cycle} bulan (Hemat {formatRupiah(pricing.discountAmount)})
                        </p>
                      ) : (
                        <p className="mt-0.5 text-[11px] text-muted">
                          {p.hargaBulanan === 0 ? "Gratis untuk uji coba awal" : "Ditagih bulanan"}
                        </p>
                      )}
                    </div>

                    <ul className="space-y-2 pt-2 text-xs text-fg">
                      <li className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-success shrink-0 mt-0.5" />
                        <span>
                          Maksimal <strong className="font-bold">{formatInt(p.maxAkun)} akun Threads</strong>
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-success shrink-0 mt-0.5" />
                        <span>
                          Sampai <strong className="font-bold">{formatInt(p.maxPostingPerHari)} posting/hari</strong> tiap akun
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-success shrink-0 mt-0.5" />
                        <span>
                          Hingga <strong className="font-bold">{formatInt(p.maxAnggota)} anggota tim</strong>
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-success shrink-0 mt-0.5" />
                        <span>{p.modeOtomatis ? "Mode Otomatis Penuh & Tinjau Dulu" : "Hanya Mode Tinjau Dulu"}</span>
                      </li>
                    </ul>
                  </div>

                  <div className="mt-6 pt-3 border-t border-line">
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => openCheckout(p)}
                        className={cn(
                          "w-full h-10 px-4 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer",
                          isPopular || !isCurrent
                            ? "bg-accent hover:bg-accent-hover text-on-accent"
                            : "bg-subtle hover:bg-line text-fg"
                        )}
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        {isCurrent && !isDefaultPlan
                          ? "Perpanjang Paket"
                          : p.hargaBulanan === 0
                            ? "Pakai Paket Ini"
                            : "Sewa Paket Ini"}
                      </button>
                    ) : (
                      <p className="text-[11px] text-center text-muted">Hanya Pemilik/Admin yang dapat menyewa paket.</p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Riwayat Tagihan / Invoice */}
      <section className="space-y-3" aria-label="Riwayat tagihan">
        <div>
          <h3 className="text-base font-bold text-fg">Riwayat Tagihan & Pembayaran</h3>
          <p className="text-xs text-muted">Daftar invoice langganan workspace ini. Status lunas diperbarui otomatis dari Xendit.</p>
        </div>

        {invoices.length === 0 ? (
          <div className="card p-6 text-center">
            <Receipt className="w-6 h-6 text-muted mx-auto" />
            <p className="mt-2 text-sm font-semibold text-fg">Belum ada riwayat tagihan</p>
            <p className="mt-0.5 text-xs text-muted">Tagihan akan muncul di sini setelah Anda memilih paket langganan di atas.</p>
          </div>
        ) : (
          <ul className="card divide-y divide-line">
            {invoices.map((inv) => {
              const method = paymentMethodLabel(inv.paymentMethod);
              return (
                <li key={inv.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-fg font-mono">{inv.id}</span>
                      <Pill tone={STATUS_TONE[inv.status]}>{INVOICE_STATUS_LABEL[inv.status]}</Pill>
                      {method && <Pill tone="neutral">{method}</Pill>}
                    </div>
                    <p className="text-xs text-fg font-medium">
                      Paket <span className="font-bold">{inv.planNama}</span> · {inv.months} bulan ·{" "}
                      <span className="font-bold text-accent">{formatRupiah(inv.amount)}</span>
                    </p>
                    <p className="text-[11px] text-muted">
                      Dibuat {formatDateWib(inv.createdAt)}
                      {inv.status === "PENDING" ? ` · Bayar sebelum ${formatDateWib(inv.expiresAt)}` : ""}
                      {inv.paidAt ? ` · Lunas ${formatDateWib(inv.paidAt)}` : ""}
                      {inv.planActiveUntil ? ` · Berlaku s/d ${formatDateWib(inv.planActiveUntil)}` : ""}
                    </p>
                  </div>

                  {inv.status === "PENDING" && canManage && (
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {inv.paymentUrl && (
                        <a href={inv.paymentUrl} className={BTN_PRIMARY}>
                          <CreditCard className="w-3.5 h-3.5" />
                          Bayar
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => void handleSync(inv)}
                        className={BTN_OUTLINE}
                      >
                        {busy === `sync:${inv.id}` ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        Cek status
                      </button>
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => void handleCancel(inv)}
                        className={cn(BTN_OUTLINE, "hover:border-danger hover:text-danger")}
                      >
                        {busy === `cancel:${inv.id}` && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Batalkan
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Ringkasan sebelum ke halaman bayar Xendit */}
      {checkoutPlan && (
        <ModalShell
          open
          onClose={() => !busy && setCheckoutPlan(null)}
          busy={!!busy}
          title={`Sewa Paket ${checkoutPlan.nama}`}
          description="Periksa ringkasan tagihan sebelum membayar"
          footer={
            <>
              <ModalButton onClick={() => setCheckoutPlan(null)} disabled={!!busy}>
                Batal
              </ModalButton>
              <ModalButton
                variant="primary"
                onClick={() => void handleCheckout()}
                disabled={!!busy || (checkoutPlan.hargaBulanan > 0 && !paymentReady)}
              >
                {busy === "checkout" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                {busy === "checkout"
                  ? "Menyiapkan pembayaran..."
                  : checkoutPlan.hargaBulanan === 0
                    ? "Aktifkan Paket Gratis"
                    : "Lanjut Bayar"}
              </ModalButton>
            </>
          }
        >
          {(() => {
            const p = calculateCyclePrice(checkoutPlan.hargaBulanan, cycle);
            return (
              <div className="space-y-5">
                <div className="rounded-xl bg-subtle p-4 space-y-2 border border-line">
                  <div className="flex items-center justify-between gap-3 text-xs text-muted">
                    <span>Paket & Kuota</span>
                    <span className="font-semibold text-fg text-right">
                      {checkoutPlan.nama} ({checkoutPlan.maxAkun} akun · {checkoutPlan.maxPostingPerHari} post/hari)
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>Durasi Langganan</span>
                    <span className="font-semibold text-fg">{cycle} Bulan</span>
                  </div>
                  {p.discountAmount > 0 && (
                    <div className="flex items-center justify-between text-xs text-success">
                      <span>Potongan Diskon Siklus</span>
                      <span className="font-semibold">-{formatRupiah(p.discountAmount)}</span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-line flex items-center justify-between">
                    <span className="text-sm font-bold text-fg">Total Tagihan</span>
                    <span className="text-lg font-extrabold text-accent tabular-nums">{formatRupiah(p.total)}</span>
                  </div>
                </div>

                {p.total > 0 &&
                  (paymentReady ? (
                    <div className="rounded-xl border border-line p-3.5 flex items-start gap-3">
                      <ShieldCheck className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                      <div className="text-xs text-muted leading-relaxed">
                        <p className="font-bold text-fg">
                          Dibayar lewat Xendit {testMode && <Pill tone="warning">Mode uji</Pill>}
                        </p>
                        <p className="mt-0.5">
                          Anda akan diarahkan ke halaman pembayaran Xendit (QRIS, Virtual Account, e-wallet, atau gerai
                          retail). Paket aktif otomatis begitu pembayaran diterima.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-warning p-3.5 flex items-start gap-3 text-xs text-fg">
                      <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
                      Pembayaran online belum diaktifkan oleh pengelola platform.
                    </div>
                  ))}

                <FormError message={actionError} />
              </div>
            );
          })()}
        </ModalShell>
      )}
    </div>
  );
}
