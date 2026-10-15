"use client";

import React, { useMemo, useState } from "react";
import { CheckCircle2, Clock, CreditCard, ExternalLink, Loader2, Receipt, RefreshCw, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { approveAdminInvoice, cancelAdminInvoice, fetchAdminBilling, syncAdminInvoice } from "@/lib/admin-client";
import {
  INVOICE_STATUS_LABEL,
  PAYMENT_PROVIDER_LABEL,
  paymentMethodLabel,
  type AdminBillingResponse,
  type InvoiceDTO,
  type InvoiceStatus,
} from "@/lib/billing-types";
import { formatRupiah } from "@/lib/plan-types";
import { formatWibFull } from "@/lib/scheduling";
import { Banner, ListSkeleton } from "@/components/autopilot/shared";
import { errorText, formatInt } from "@/components/settings/format";
import { BTN_OUTLINE, BTN_PRIMARY, EmptyState, Pill, RefreshButton, type PillTone } from "@/components/settings/states";
import { useRemote } from "@/components/settings/use-remote";
import { AdminLoadError, FilterChips, RefreshError, SearchField, useAdmin, type ChipOption } from "./shared";
import { Panel, StatStrip, rupiah } from "./ui";

const LOAD_ERROR = "Gagal memuat transaksi dan tagihan platform.";

type StatusFilter = "ALL" | InvoiceStatus;

const STATUS_TONE: Record<InvoiceStatus, PillTone> = {
  PAID: "success",
  PENDING: "warning",
  EXPIRED: "neutral",
  CANCELLED: "danger",
};

export function BillingTab() {
  const { guard, rev, invalidate, can } = useAdmin();
  const manage = can("tagihan.kelola");
  const { data, error, status, loading, refreshing, reload, mutate } = useRemote<AdminBillingResponse>(
    `transaksi:${rev.transaksi}`,
    (signal) => guard(fetchAdminBilling(signal)),
    LOAD_ERROR
  );

  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const items = useMemo(() => data?.invoices ?? [], [data]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { ALL: items.length, PENDING: 0, PAID: 0, EXPIRED: 0, CANCELLED: 0 };
    for (const inv of items) {
      c[inv.status] = (c[inv.status] ?? 0) + 1;
    }
    return c;
  }, [items]);

  const chips: ChipOption<StatusFilter>[] = [
    { value: "ALL", label: "Semua", count: counts.ALL },
    { value: "PENDING", label: "Menunggu", count: counts.PENDING },
    { value: "PAID", label: "Lunas", count: counts.PAID },
    { value: "CANCELLED", label: "Dibatalkan", count: counts.CANCELLED },
  ];

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items.filter((inv) => {
      if (filter !== "ALL" && inv.status !== filter) return false;
      if (!query) return true;
      return (
        inv.id.toLowerCase().includes(query) ||
        inv.workspaceNama.toLowerCase().includes(query) ||
        inv.planNama.toLowerCase().includes(query) ||
        (inv.externalId ?? "").toLowerCase().includes(query)
      );
    });
  }, [items, filter, q]);

  if (loading) return <ListSkeleton label="Memuat transaksi & tagihan" rows={4} />;
  if (!data) return <AdminLoadError message={error ?? LOAD_ERROR} status={status} onRetry={reload} />;

  const handleSettle = async (inv: InvoiceDTO) => {
    if (busyId) return;
    setBusyId(inv.id);
    setActionError(null);
    setNotice(null);
    try {
      const res = await guard(approveAdminInvoice(inv.id));
      mutate((prev) => ({
        ...prev,
        invoices: prev.invoices.map((item) => (item.id === inv.id ? res.invoice : item)),
        summary: {
          ...prev.summary,
          paidCount: prev.summary.paidCount + 1,
          pendingCount: Math.max(0, prev.summary.pendingCount - 1),
          totalRevenue: prev.summary.totalRevenue + inv.amount,
          revenue30d: prev.summary.revenue30d + inv.amount,
        },
      }));
      invalidate(["ringkasan", "workspace", "paket", "audit"]);
      setNotice(`Tagihan ${inv.id} disetujui dan Paket ${inv.planNama} telah diaktifkan untuk workspace ${inv.workspaceNama}.`);
    } catch (e) {
      setActionError(errorText(e, "Gagal menyetujui tagihan."));
    } finally {
      setBusyId(null);
    }
  };

  const handleSync = async (inv: InvoiceDTO) => {
    if (busyId) return;
    setBusyId(inv.id);
    setActionError(null);
    setNotice(null);
    try {
      const res = await guard(syncAdminInvoice(inv.id));
      if (res.invoice.status !== inv.status) {
        reload();
        invalidate(["ringkasan", "workspace", "paket", "audit"]);
      }
      setNotice(`Status ${inv.id} di Midtrans: ${INVOICE_STATUS_LABEL[res.invoice.status]}.`);
    } catch (e) {
      setActionError(errorText(e, "Gagal mengecek status ke Midtrans."));
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (inv: InvoiceDTO) => {
    if (busyId) return;
    setBusyId(inv.id);
    setActionError(null);
    setNotice(null);
    try {
      const res = await guard(cancelAdminInvoice(inv.id));
      mutate((prev) => ({
        ...prev,
        invoices: prev.invoices.map((item) => (item.id === inv.id ? res.invoice : item)),
        summary: {
          ...prev.summary,
          pendingCount: Math.max(0, prev.summary.pendingCount - 1),
          cancelledCount: prev.summary.cancelledCount + 1,
        },
      }));
      invalidate(["ringkasan", "audit"]);
      setNotice(`Tagihan ${inv.id} dibatalkan.`);
    } catch (e) {
      setActionError(errorText(e, "Gagal membatalkan tagihan."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <Panel>
        <StatStrip
          items={[
            { label: "Total kas masuk", value: rupiah(data.summary.totalRevenue), hint: "Semua tagihan lunas" },
            { label: "30 hari terakhir", value: rupiah(data.summary.revenue30d), tone: data.summary.revenue30d > 0 ? "success" : "neutral" },
            { label: "Tagihan lunas", value: formatInt(data.summary.paidCount), hint: "Paket otomatis aktif" },
            { label: "Menunggu bayar", value: formatInt(data.summary.pendingCount), hint: "Lunas otomatis via Midtrans", tone: data.summary.pendingCount > 0 ? "warning" : "neutral" },
          ]}
        />
      </Panel>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <FilterChips ariaLabel="Saring status tagihan" options={chips} value={filter} onChange={setFilter} />
        <div className="flex items-center gap-2 sm:w-80">
          <SearchField label="Cari tagihan" value={q} onChange={setQ} placeholder="Cari ID invoice atau workspace..." />
          <RefreshButton onClick={reload} busy={refreshing} />
        </div>
      </div>

      <RefreshError error={error} onRetry={reload} />
      {actionError && (
        <Banner tone="danger" onClose={() => setActionError(null)}>
          {actionError}
        </Banner>
      )}
      {notice && (
        <Banner tone="success" onClose={() => setNotice(null)}>
          {notice}
        </Banner>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Receipt className="w-6 h-6" />}
          title={q || filter !== "ALL" ? "Tidak ada tagihan yang cocok." : "Belum ada transaksi langganan."}
          action={
            q || filter !== "ALL" ? (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  setFilter("ALL");
                }}
                className={BTN_OUTLINE}
              >
                Reset filter
              </button>
            ) : undefined
          }
        >
          Tagihan dibuat otomatis saat pemilik workspace menyewa atau memperpanjang paket dari menu Pengaturan.
        </EmptyState>
      ) : (
        <ul className="card divide-y divide-line">
          {filtered.map((inv) => {
            const isBusy = busyId === inv.id;
            return (
              <li key={inv.id} className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                      inv.status === "PAID"
                        ? "bg-success-soft text-success"
                        : inv.status === "PENDING"
                          ? "bg-warning-soft text-warning"
                          : "bg-subtle text-muted"
                    )}
                  >
                    {inv.status === "PAID" ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : inv.status === "PENDING" ? (
                      <Clock className="w-5 h-5" />
                    ) : (
                      <CreditCard className="w-5 h-5" />
                    )}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-fg">{inv.workspaceNama}</span>
                      <span className="text-xs font-semibold text-accent">
                        Paket {inv.planNama} ({inv.months} bulan)
                      </span>
                      <Pill tone={STATUS_TONE[inv.status] ?? "neutral"}>{INVOICE_STATUS_LABEL[inv.status]}</Pill>
                    </div>
                    <p className="text-xs text-muted">
                      <span className="font-mono text-[11px] text-fg">{inv.id}</span> · {paymentMethodLabel(inv.paymentMethod) ?? PAYMENT_PROVIDER_LABEL[inv.provider] ?? inv.provider} · Dibuat{" "}
                      {formatWibFull(new Date(inv.createdAt))}
                      {inv.paidAt ? ` · Lunas ${formatWibFull(new Date(inv.paidAt))}` : ""}
                    </p>
                    {inv.externalId && (
                      <p className="text-[11px] font-mono text-muted">
                        {inv.provider === "XENDIT" ? "ID Xendit" : "Order Midtrans"}: {inv.externalId}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 shrink-0 border-t border-line pt-3 lg:border-t-0 lg:pt-0">
                  <div className="text-left lg:text-right">
                    <p className="text-base font-extrabold text-fg tabular-nums">{formatRupiah(inv.amount)}</p>
                    <p className="text-[11px] text-muted">{inv.months === 12 ? 365 : inv.months * 30} hari aktif</p>
                  </div>

                  {inv.paymentUrl && inv.status === "PENDING" && (
                    <a href={inv.paymentUrl} target="_blank" rel="noreferrer" className={BTN_OUTLINE}>
                      <ExternalLink className="w-3.5 h-3.5" />
                      Link Bayar
                    </a>
                  )}

                  {manage && inv.status === "PENDING" && (
                    <div className="flex items-center gap-2">
                      {inv.externalId && (
                        <button type="button" disabled={isBusy} onClick={() => void handleSync(inv)} className={BTN_OUTLINE}>
                          <RefreshCw className="w-3.5 h-3.5" />
                          Cek Midtrans
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleSettle(inv)}
                        className={BTN_PRIMARY}
                      >
                        {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        Tandai Lunas
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleCancel(inv)}
                        className={cn(BTN_OUTLINE, "hover:border-danger hover:text-danger")}
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Batalkan
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
