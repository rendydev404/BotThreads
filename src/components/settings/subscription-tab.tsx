"use client";

import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CreditCard,
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
  type PaymentMethodId,
  type WorkspaceBillingResponse,
} from "@/lib/billing-types";
import { formatRupiah, type PublicPlansResponse, type WorkspacePlanResponse } from "@/lib/plan-types";
import {
  cancelBillingInvoice,
  createBillingCheckout,
  fetchPublicPlans,
  fetchWorkspaceBilling,
  fetchWorkspacePlan,
  payBillingInvoice,
  syncBillingInvoice,
} from "@/lib/team-client";
import { cn } from "@/lib/utils";
import { Banner } from "@/components/autopilot/shared";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { FormError } from "./fields";
import { MethodPicker, PaymentPanel } from "./payment-panel";
import { errorText, formatDateWib, formatInt } from "./format";
import { BTN_OUTLINE, BTN_PRIMARY, EmptyState, LoadError, Pill, RefreshButton, type PillTone } from "./states";
import { useRemote } from "./use-remote";
import { useT } from "@/components/i18n/lang-provider";

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
  const t = useT();

  const [cycle, setCycle] = useState<BillingCycleMonths>(1);
  const [checkoutPlan, setCheckoutPlan] = useState<PlanItem | null>(null);
  const [method, setMethod] = useState<PaymentMethodId | null>(null);
  /** Tagihan yang sedang dibayar di layar bayar. */
  const [payTarget, setPayTarget] = useState<InvoiceDTO | null>(null);
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
        text: t("Pembayaran {id} diterima. Paket {plan} aktif sampai {until}.", {
          id: inv.id,
          plan: inv.planNama,
          until: inv.planActiveUntil ? formatDateWib(inv.planActiveUntil) : t("tanpa batas"),
        }),
      });
    } else if (inv.status === "PENDING") {
      setNotice({ tone: "info", text: t("Tagihan {id} belum dibayar. Klik Bayar untuk melihat kode pembayarannya.", { id: inv.id }) });
    } else {
      setNotice({ tone: "info", text: t("Tagihan {id}: {status}.", { id: inv.id, status: t(INVOICE_STATUS_LABEL[inv.status]).toLowerCase() }) });
    }
  };

  // Kembali dari aplikasi e-wallet (?invoice=ID): cek statusnya sekali, buka layar bayar bila belum lunas.
  const checkedReturn = useRef(false);
  useEffect(() => {
    if (!returnedInvoice || checkedReturn.current || !canManage) return;
    checkedReturn.current = true;
    void syncBillingInvoice(returnedInvoice)
      .then((res) => {
        if (res.invoice.status === "PENDING") setPayTarget(res.invoice);
        else reportStatus(res.invoice);
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
    setMethod((m) => m ?? billing.data?.methods[0] ?? null);
  };

  const handleCheckout = () =>
    run(
      "checkout",
      async () => {
        if (!checkoutPlan) return;
        const free = calculateCyclePrice(checkoutPlan.hargaBulanan, cycle).total === 0;
        if (!free && !method) throw new Error(t("Pilih metode pembayaran dulu."));
        const res = await createBillingCheckout({ planId: checkoutPlan.id, months: cycle, method: method ?? "qris" });
        setCheckoutPlan(null);
        if (res.invoice.status === "PAID") {
          reloadAll();
          reportStatus(res.invoice);
        } else {
          // Layar bayar sendiri: nomor VA / QR / tombol e-wallet langsung tampil.
          setPayTarget(res.invoice);
          billing.reload();
        }
      },
      "Gagal membuat tagihan langganan."
    );

  /** Cek status dari layar bayar. silent = polling otomatis: tanpa indikator sibuk dan tanpa pesan galat. */
  const checkPayment = async (silent: boolean) => {
    const inv = payTarget;
    if (!inv || (!silent && busy)) return;
    if (!silent) {
      setBusy("check");
      setActionError(null);
    }
    try {
      const res = await syncBillingInvoice(inv.id);
      setPayTarget((cur) => (cur && cur.id === res.invoice.id ? res.invoice : cur));
      if (res.invoice.status === "PAID") {
        reloadAll();
        reportStatus(res.invoice);
      } else if (!silent && res.invoice.status === "PENDING") {
        setActionError(t("Pembayaran belum diterima. Bila baru saja membayar, tunggu sebentar; status diperbarui otomatis."));
      }
    } catch (e) {
      if (!silent) setActionError(errorText(e, "Gagal mengecek status pembayaran."));
    } finally {
      if (!silent) setBusy(null);
    }
  };

  const changeMethod = (m: PaymentMethodId) =>
    run(
      "pay",
      async () => {
        if (!payTarget) return;
        const res = await payBillingInvoice(payTarget.id, m);
        setPayTarget(res.invoice);
        if (res.invoice.status === "PAID") {
          reloadAll();
          reportStatus(res.invoice);
        } else billing.reload();
      },
      "Gagal membuat kode pembayaran."
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
        setNotice({ tone: "info", text: t("Tagihan {id} dibatalkan.", { id: inv.id }) });
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
  const methods = billing.data?.methods ?? [];

  return (
    <div className="space-y-6">
      {notice && (
        <Banner tone={notice.tone} onClose={() => setNotice(null)}>
          {notice.text}
        </Banner>
      )}
      {actionError && !checkoutPlan && !payTarget && (
        <Banner tone="danger" onClose={() => setActionError(null)}>
          {actionError}
        </Banner>
      )}
      {billing.data && !paymentReady && canManage && (
        <Banner tone="warning">
          {t("Pembayaran online belum diaktifkan oleh pengelola platform. Paket gratis tetap bisa dipakai; untuk paket berbayar hubungi admin.")}
        </Banner>
      )}

      {/* Pemilih Siklus Sewa & Katalog Paket */}
      <section className="space-y-4" aria-label={t("Pilih paket langganan")}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-fg">{t("Pilih Paket Langganan")}</h3>
            <p className="text-xs text-muted">
              {t("Sewa paket sesuai jumlah akun Threads yang ingin diotomatisasi. Aktif seketika setelah pembayaran.")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div role="group" aria-label={t("Siklus penagihan")} className="inline-flex p-1 rounded-xl bg-subtle border border-line">
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
                    <span>{t(c.label)}</span>
                    {c.badge && (
                      <span className="px-1.5 py-0.5 rounded bg-accent-soft text-accent text-[10px] font-bold">
                        {t(c.badge)}
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
          <EmptyState icon={<Gem className="w-6 h-6" />} title={t("Belum ada paket langganan publik.")}>
            {t("Super admin dapat menambahkan atau mengaktifkan paket dari konsol Super Admin.")}
          </EmptyState>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {plans.map((p) => {
              const isCurrent = currentPlanId === p.id && !wsPlan.data?.kedaluwarsa;
              const pricing = calculateCyclePrice(p.hargaBulanan, cycle);
              const isPopular = p.id === "pro";
              const badge = p.label === "REKOMENDASI" ? "Rekomendasi" : p.label === "TERLARIS" ? "Terlaris" : null;

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
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {isCurrent && (
                          <Pill tone="success" icon={<CheckCircle2 className="w-3 h-3" />}>
                            {isDefaultPlan ? t("Bawaan") : t("Aktif")}
                          </Pill>
                        )}
                        {badge ? (
                          <Pill tone="accent" icon={<Sparkles className="w-3 h-3" />}>
                            {t(badge)}
                          </Pill>
                        ) : isPopular ? (
                          <Pill tone="accent" icon={<Sparkles className="w-3 h-3" />}>
                            {t("Populer")}
                          </Pill>
                        ) : null}
                      </div>
                    </div>

                    {p.deskripsi && <p className="text-xs text-muted leading-relaxed min-h-[2.25rem]">{p.deskripsi}</p>}

                    <div className="pt-1 border-t border-line">
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-extrabold text-fg tabular-nums">
                          {formatRupiah(pricing.monthlyEquivalent)}
                        </span>
                        {p.hargaBulanan > 0 && <span className="text-xs text-muted">{t("/ bulan")}</span>}
                      </div>
                      {p.hargaBulanan > 0 && cycle > 1 ? (
                        <p className="mt-0.5 text-[11px] text-accent font-semibold">
                          {t("Total {total} untuk {n} bulan (Hemat {saving})", { total: formatRupiah(pricing.total), n: cycle, saving: formatRupiah(pricing.discountAmount) })}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-[11px] text-muted">
                          {p.hargaBulanan === 0 ? t("Gratis untuk uji coba awal") : t("Ditagih bulanan")}
                        </p>
                      )}
                    </div>

                    <ul className="space-y-2 pt-2 text-xs text-fg">
                      <li className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-success shrink-0 mt-0.5" />
                        <span>
                          {t("Maksimal")} <strong className="font-bold">{t("{n} akun Threads", { n: formatInt(p.maxAkun) })}</strong>
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-success shrink-0 mt-0.5" />
                        <span>
                          {t("Sampai")} <strong className="font-bold">{t("{n} posting/hari", { n: formatInt(p.maxPostingPerHari) })}</strong> {t("tiap akun")}
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-success shrink-0 mt-0.5" />
                        <span>{p.modeOtomatis ? t("Mode Otomatis Penuh & Tinjau Dulu") : t("Hanya Mode Tinjau Dulu")}</span>
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
                          ? t("Perpanjang Paket")
                          : p.hargaBulanan === 0
                            ? t("Pakai Paket Ini")
                            : t("Sewa Paket Ini")}
                      </button>
                    ) : (
                      <p className="text-[11px] text-center text-muted">{t("Hanya Pemilik/Admin yang dapat menyewa paket.")}</p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Riwayat Tagihan / Invoice */}
      <section className="space-y-3" aria-label={t("Riwayat tagihan")}>
        <div>
          <h3 className="text-base font-bold text-fg">{t("Riwayat Tagihan & Pembayaran")}</h3>
          <p className="text-xs text-muted">{t("Daftar invoice langganan workspace ini. Status lunas diperbarui otomatis dari Midtrans.")}</p>
        </div>

        {invoices.length === 0 ? (
          <div className="card p-6 text-center">
            <Receipt className="w-6 h-6 text-muted mx-auto" />
            <p className="mt-2 text-sm font-semibold text-fg">{t("Belum ada riwayat tagihan")}</p>
            <p className="mt-0.5 text-xs text-muted">{t("Tagihan akan muncul di sini setelah Anda memilih paket langganan di atas.")}</p>
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
                      <Pill tone={STATUS_TONE[inv.status]}>{t(INVOICE_STATUS_LABEL[inv.status])}</Pill>
                      {method && <Pill tone="neutral">{method}</Pill>}
                    </div>
                    <p className="text-xs text-fg font-medium">
                      {t("Paket")} <span className="font-bold">{inv.planNama}</span> · {t("{n} bulan", { n: inv.months })} ·{" "}
                      <span className="font-bold text-accent">{formatRupiah(inv.amount)}</span>
                    </p>
                    <p className="text-[11px] text-muted">
                      {t("Dibuat {date}", { date: formatDateWib(inv.createdAt) })}
                      {inv.status === "PENDING" ? ` · ${t("Bayar sebelum {date}", { date: formatDateWib(inv.expiresAt) })}` : ""}
                      {inv.paidAt ? ` · ${t("Lunas {date}", { date: formatDateWib(inv.paidAt) })}` : ""}
                      {inv.planActiveUntil ? ` · ${t("Berlaku s/d {date}", { date: formatDateWib(inv.planActiveUntil) })}` : ""}
                    </p>
                  </div>

                  {inv.status === "PENDING" && canManage && (
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {inv.provider === "MIDTRANS" && paymentReady && (
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => {
                            setActionError(null);
                            setPayTarget(inv);
                          }}
                          className={BTN_PRIMARY}
                        >
                          <CreditCard className="w-3.5 h-3.5" />
                          {t("Bayar")}
                        </button>
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
                        {t("Cek status")}
                      </button>
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => void handleCancel(inv)}
                        className={cn(BTN_OUTLINE, "hover:border-danger hover:text-danger")}
                      >
                        {busy === `cancel:${inv.id}` && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        {t("Batalkan")}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Layar bayar (Midtrans Core API, tanpa Snap) */}
      {payTarget && (
        <ModalShell
          open
          onClose={() => {
            if (busy === "pay") return;
            setPayTarget(null);
            setActionError(null);
            billing.reload();
          }}
          busy={busy === "pay"}
          title={payTarget.status === "PAID" ? t("Pembayaran Diterima") : t("Bayar Paket {name}", { name: payTarget.planNama })}
          description={payTarget.status === "PAID" ? undefined : `${t("{n} bulan", { n: payTarget.months })} · ${payTarget.id}`}
          footer={
            <ModalButton
              onClick={() => {
                setPayTarget(null);
                setActionError(null);
                billing.reload();
              }}
              disabled={busy === "pay"}
            >
              {payTarget.status === "PAID" ? t("Selesai") : t("Tutup, bayar nanti")}
            </ModalButton>
          }
        >
          <div className="space-y-4">
            <PaymentPanel
              key={payTarget.id}
              invoice={payTarget}
              testMode={testMode}
              methods={methods}
              busy={busy}
              onCheck={(silent) => void checkPayment(silent)}
              onChangeMethod={(m) => void changeMethod(m)}
            />
            <FormError message={actionError} />
          </div>
        </ModalShell>
      )}

      {/* Ringkasan + pilih metode sebelum layar bayar */}
      {checkoutPlan && (
        <ModalShell
          open
          onClose={() => !busy && setCheckoutPlan(null)}
          busy={!!busy}
          title={t("Sewa Paket {name}", { name: checkoutPlan.nama })}
          description={t("Periksa ringkasan tagihan sebelum membayar")}
          footer={
            <>
              <ModalButton onClick={() => setCheckoutPlan(null)} disabled={!!busy}>
                {t("Batal")}
              </ModalButton>
              <ModalButton
                variant="primary"
                onClick={() => void handleCheckout()}
                disabled={!!busy || (checkoutPlan.hargaBulanan > 0 && (!paymentReady || !method))}
              >
                {busy === "checkout" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                {busy === "checkout"
                  ? t("Menyiapkan pembayaran...")
                  : checkoutPlan.hargaBulanan === 0
                    ? t("Aktifkan Paket Gratis")
                    : t("Bayar {amount}", { amount: formatRupiah(calculateCyclePrice(checkoutPlan.hargaBulanan, cycle).total) })}
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
                    <span>{t("Paket & Kuota")}</span>
                    <span className="font-semibold text-fg text-right">
                      {checkoutPlan.nama} ({t("{n} akun", { n: checkoutPlan.maxAkun })} · {t("{n} post/hari", { n: checkoutPlan.maxPostingPerHari })})
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>{t("Durasi Langganan")}</span>
                    <span className="font-semibold text-fg">{t("{n} Bulan", { n: cycle })}</span>
                  </div>
                  {p.discountAmount > 0 && (
                    <div className="flex items-center justify-between text-xs text-success">
                      <span>{t("Potongan Diskon Siklus")}</span>
                      <span className="font-semibold">-{formatRupiah(p.discountAmount)}</span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-line flex items-center justify-between">
                    <span className="text-sm font-bold text-fg">{t("Total Tagihan")}</span>
                    <span className="text-lg font-extrabold text-accent tabular-nums">{formatRupiah(p.total)}</span>
                  </div>
                </div>

                {p.total > 0 &&
                  (paymentReady ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-fg">{t("Metode pembayaran")}</p>
                        {testMode && <Pill tone="warning">Sandbox</Pill>}
                      </div>
                      <MethodPicker methods={methods} value={method} onChange={setMethod} disabled={!!busy} />
                      <p className="text-[11px] text-muted inline-flex items-start gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-accent shrink-0 mt-px" />
                        {t("Diproses aman oleh Midtrans. Kode bayar tampil di halaman ini; paket aktif otomatis begitu pembayaran diterima.")}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-warning p-3.5 flex items-start gap-3 text-xs text-fg">
                      <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
                      {t("Pembayaran online belum diaktifkan oleh pengelola platform.")}
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
