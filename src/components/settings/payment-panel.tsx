"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  TimerOff,
} from "lucide-react";
import { PAYMENT_METHODS, paymentMethodOption, type InvoiceDTO, type PaymentMethodId } from "@/lib/billing-types";
import { formatRupiah } from "@/lib/plan-types";
import { cn } from "@/lib/utils";
import { PaymentLogo } from "./payment-logos";
import { Pill } from "./states";

/* ------------------------------------------------------------------ format */

const WIB_TIME = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatWibTime = (iso: string): string => `${WIB_TIME.format(new Date(iso)).replace(/\./g, ":")} WIB`;

function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** 8277 0012 3456 7890: lebih mudah dibaca dan dicocokkan di aplikasi bank. */
const groupDigits = (s: string): string => s.replace(/(\d{4})(?=\d)/g, "$1 ");

/** Detik berjalan untuk hitung mundur; berhenti saat komponen dilepas. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function CopyButton({ value, label = "Salin" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="h-9 px-3 rounded-full border border-line-strong text-xs font-semibold text-fg inline-flex items-center gap-1.5 cursor-pointer transition-colors hover:border-accent hover:text-accent shrink-0"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Tersalin" : label}
    </button>
  );
}

/* ------------------------------------------------------------------ pemilih metode */

const GROUPS: { id: "qr" | "ewallet" | "va"; title: string; icon: React.ReactNode }[] = [
  { id: "qr", title: "Scan QR", icon: <QrCode className="w-3.5 h-3.5" /> },
  { id: "ewallet", title: "E-Wallet", icon: <Smartphone className="w-3.5 h-3.5" /> },
  { id: "va", title: "Transfer Bank", icon: <Building2 className="w-3.5 h-3.5" /> },
];

/** "BCA Virtual Account" ➜ "BCA VA" supaya muat di kartu dua kolom. */
const shortLabel = (label: string) => label.replace(" Virtual Account", " VA").replace(" Bill Payment", " Bill");

function SelectedMark({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "w-5 h-5 rounded-full shrink-0 flex items-center justify-center transition-colors",
        active ? "bg-accent text-on-accent" : "border-2 border-line-strong"
      )}
    >
      {active && <Check className="w-3 h-3" strokeWidth={3} />}
    </span>
  );
}

export function MethodPicker({
  methods,
  value,
  onChange,
  disabled,
}: {
  methods: PaymentMethodId[];
  value: PaymentMethodId | null;
  onChange: (m: PaymentMethodId) => void;
  disabled?: boolean;
}) {
  const allowed = PAYMENT_METHODS.filter((m) => methods.includes(m.id));
  const card = (active: boolean) =>
    cn(
      "relative text-left rounded-xl border bg-surface transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed",
      active ? "border-accent ring-2 ring-accent/20 shadow-sm" : "border-line hover:border-line-strong hover:shadow-xs"
    );

  return (
    <div className="space-y-4" role="radiogroup" aria-label="Metode pembayaran">
      {GROUPS.map((g) => {
        const items = allowed.filter((m) => m.group === g.id);
        if (items.length === 0) return null;
        return (
          <div key={g.id} className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-faint inline-flex items-center gap-1.5">
              {g.icon}
              {g.title}
            </p>
            {g.id === "qr" ? (
              items.map((m) => {
                const active = value === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={m.label}
                    disabled={disabled}
                    onClick={() => onChange(m.id)}
                    className={cn(card(active), "w-full p-3 flex items-center gap-3.5")}
                  >
                    <PaymentLogo id={m.id} className="w-16 h-11" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-bold text-fg">{m.label}</span>
                        <span className="px-1.5 py-0.5 rounded-md bg-success-soft text-success text-[10px] font-bold">Paling cepat</span>
                      </span>
                      <span className="block text-xs text-muted mt-0.5">{m.hint}</span>
                    </span>
                    <SelectedMark active={active} />
                  </button>
                );
              })
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {items.map((m) => {
                  const active = value === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={m.label}
                      title={m.hint}
                      disabled={disabled}
                      onClick={() => onChange(m.id)}
                      className={cn(card(active), "p-2.5 flex items-center gap-2.5")}
                    >
                      <PaymentLogo id={m.id} className="w-14 h-9" />
                      <span className="min-w-0 flex-1 text-[13px] font-semibold text-fg leading-tight">{shortLabel(m.label)}</span>
                      <SelectedMark active={active} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ panel bayar */

const STEPS: Partial<Record<PaymentMethodId, string[]>> = {
  bca_va: ["Buka m-BCA / KlikBCA / ATM BCA", "Pilih m-Transfer ➜ BCA Virtual Account", "Masukkan nomor VA di atas, cek nama dan nominal, lalu bayar"],
  bni_va: ["Buka BNI Mobile Banking / ATM BNI", "Pilih Transfer ➜ Virtual Account Billing", "Masukkan nomor VA di atas lalu konfirmasi"],
  bri_va: ["Buka BRImo / ATM BRI", "Pilih Pembayaran ➜ BRIVA", "Masukkan nomor VA di atas lalu konfirmasi"],
  permata_va: ["Buka PermataMobile X / ATM Permata", "Pilih Pembayaran ➜ Virtual Account", "Masukkan nomor VA di atas lalu konfirmasi"],
  cimb_va: ["Buka OCTO Mobile / ATM CIMB Niaga", "Pilih Transfer ➜ Virtual Account", "Masukkan nomor VA di atas lalu konfirmasi"],
  mandiri_bill: ["Buka Livin' by Mandiri / ATM Mandiri", "Pilih Bayar ➜ Multipayment, cari Midtrans (kode perusahaan di atas)", "Masukkan kode bayar lalu konfirmasi"],
  qris: ["Buka aplikasi bank atau e-wallet (GoPay, OVO, DANA, ShopeePay, m-banking)", "Pilih Scan / Bayar QRIS lalu arahkan ke kode di atas", "Pastikan nominal sesuai lalu bayar"],
  gopay: ["Buka aplikasi Gojek lalu pilih Bayar / Scan", "Scan kode QR di atas, atau ketuk tombol Buka GoPay dari HP", "Konfirmasi pembayaran"],
  shopeepay: ["Ketuk Buka ShopeePay dari HP yang memasang aplikasi Shopee", "Konfirmasi pembayaran di aplikasi", "Kembali ke halaman ini; status diperbarui otomatis"],
};

export interface PaymentPanelProps {
  invoice: InvoiceDTO;
  testMode: boolean;
  methods: PaymentMethodId[];
  busy: string | null;
  /** Cek status sekarang (dipanggil juga oleh polling). */
  onCheck: (silent: boolean) => void;
  onChangeMethod: (m: PaymentMethodId) => void;
}

const POLL_MS = 8000;

/** Layar bayar sendiri (tanpa Snap): instruksi per metode, hitung mundur, dan cek status otomatis. */
export function PaymentPanel({ invoice, testMode, methods, busy, onCheck, onChangeMethod }: PaymentPanelProps) {
  const p = invoice.payment;
  const pending = invoice.status === "PENDING";
  const now = useNow(pending);
  const [picking, setPicking] = useState(!p);
  const [method, setMethod] = useState<PaymentMethodId | null>(p?.method ?? methods[0] ?? null);

  const expiresMs = p ? Date.parse(p.expiresAt) - now : 0;
  const payable = !!p && p.status === "pending" && expiresMs > 0;

  // Polling status selama kode bayar masih aktif dan tab terlihat; webhook tetap jalur utama.
  const checkRef = useRef(onCheck);
  useEffect(() => {
    checkRef.current = onCheck;
  });
  useEffect(() => {
    if (!pending || !payable || picking) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") checkRef.current(true);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [pending, payable, picking, p?.orderId]);

  if (invoice.status === "PAID") {
    return (
      <div className="py-6 text-center space-y-3">
        <div className="w-14 h-14 mx-auto rounded-full bg-success-soft text-success flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <div>
          <p className="text-base font-bold text-fg">Pembayaran berhasil</p>
          <p className="text-sm text-muted mt-1">
            Paket {invoice.planNama} aktif
            {invoice.planActiveUntil ? ` sampai ${formatWibTime(invoice.planActiveUntil)}` : ""}.
          </p>
        </div>
      </div>
    );
  }

  if (!pending) {
    return (
      <div className="py-6 text-center space-y-2">
        <TimerOff className="w-8 h-8 text-muted mx-auto" />
        <p className="text-sm font-semibold text-fg">Tagihan ini sudah tidak berlaku.</p>
        <p className="text-xs text-muted">Tutup jendela ini lalu pilih paket lagi untuk membuat tagihan baru.</p>
      </div>
    );
  }

  const option = p ? paymentMethodOption(p.method) : undefined;
  const changing = busy === "pay";

  return (
    <div className="space-y-5">
      {/* Ringkasan nominal */}
      <div className="rounded-xl bg-subtle border border-line p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted">Total bayar</p>
          <p className="text-2xl font-extrabold text-fg tabular-nums">{formatRupiah(invoice.amount)}</p>
          <p className="text-[11px] text-faint font-mono truncate">{invoice.id}</p>
        </div>
        <CopyButton value={String(invoice.amount)} label="Salin nominal" />
      </div>

      {picking || !p ? (
        <div className="space-y-4">
          <MethodPicker methods={methods} value={method} onChange={setMethod} disabled={changing} />
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            {p && (
              <button type="button" onClick={() => setPicking(false)} disabled={changing} className="h-10 px-4 rounded-full text-sm font-semibold text-muted hover:text-fg cursor-pointer">
                Kembali
              </button>
            )}
            <button
              type="button"
              disabled={!method || changing}
              onClick={() => {
                if (!method) return;
                onChangeMethod(method);
                setPicking(false);
              }}
              className="h-10 px-5 rounded-full bg-accent text-on-accent text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {changing && <Loader2 className="w-4 h-4 animate-spin" />}
              Tampilkan kode bayar
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <PaymentLogo id={p.method} className="w-14 h-9" />
              <span className="text-sm font-bold text-fg truncate">{option?.label ?? p.method}</span>
              {testMode && <Pill tone="warning">Sandbox</Pill>}
            </div>
            {payable ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-warning tabular-nums" aria-live="off">
                <Clock className="w-3.5 h-3.5" />
                Sisa {formatCountdown(expiresMs)}
              </span>
            ) : (
              <Pill tone="danger">Kode bayar kedaluwarsa</Pill>
            )}
          </div>

          {payable ? (
            <PaymentCode invoice={invoice} />
          ) : (
            <div className="rounded-xl border border-dashed border-line-strong p-5 text-center space-y-3">
              <p className="text-sm text-muted">
                {p.status === "pending" ? "Batas waktu kode bayar ini sudah lewat." : "Transaksi ini tidak bisa dipakai lagi."} Tagihan masih
                berlaku sampai {formatWibTime(invoice.expiresAt)}.
              </p>
              <button
                type="button"
                disabled={changing}
                onClick={() => onChangeMethod(p.method)}
                className="h-10 px-5 rounded-full bg-accent text-on-accent text-sm font-semibold inline-flex items-center gap-2 cursor-pointer hover:bg-accent-hover disabled:opacity-50"
              >
                {changing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Buat kode bayar baru
              </button>
            </div>
          )}

          {payable && STEPS[p.method] && (
            <ol className="space-y-1.5 text-xs text-muted list-decimal pl-5">
              {STEPS[p.method]!.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}

          {testMode && payable && (
            <p className="text-[11px] text-muted rounded-lg bg-warning-soft/60 px-3 py-2">
              Mode sandbox: tidak ada uang sungguhan. Bayar lewat{" "}
              <a href="https://simulator.sandbox.midtrans.com" target="_blank" rel="noreferrer" className="font-semibold text-fg underline">
                simulator Midtrans
              </a>{" "}
              memakai nomor VA atau URL gambar QR di atas.
            </p>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => setPicking(true)}
              disabled={changing}
              className="h-9 px-1 text-xs font-semibold text-muted hover:text-accent inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Ganti metode bayar
            </button>
            {payable && (
              <button
                type="button"
                onClick={() => onCheck(false)}
                disabled={!!busy}
                className="h-10 px-5 rounded-full border border-line-strong text-sm font-semibold text-fg inline-flex items-center justify-center gap-2 cursor-pointer hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {busy === "check" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Saya sudah bayar
              </button>
            )}
          </div>

          <p className="text-[11px] text-faint inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-accent shrink-0" />
            Diproses Midtrans. Status diperbarui otomatis; paket aktif begitu pembayaran diterima.
          </p>
        </>
      )}
    </div>
  );
}

function PaymentCode({ invoice }: { invoice: InvoiceDTO }) {
  const p = invoice.payment!;
  if (p.kind === "va" && p.vaNumber) {
    const vaGroups = p.vaNumber.match(/\d{1,4}/g) ?? [p.vaNumber];
    return (
      <div className="rounded-xl border border-line p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted">Nomor Virtual Account</p>
            <p className="mt-0.5 text-[11px] text-muted">Salin nomor ini untuk menyelesaikan transfer.</p>
          </div>
          <CopyButton value={p.vaNumber} />
        </div>
        <p
          aria-label={`Nomor Virtual Account ${groupDigits(p.vaNumber)}`}
          className="flex flex-wrap justify-center gap-x-2 gap-y-1 rounded-lg bg-subtle px-3 py-3 text-lg font-extrabold font-mono tabular-nums tracking-wide text-fg sm:text-xl"
        >
          {vaGroups.map((group, index) => (
            <span className="whitespace-nowrap" key={`${index}-${group}`}>
              {group}
            </span>
          ))}
        </p>
      </div>
    );
  }
  if (p.kind === "bill" && p.billKey) {
    return (
      <div className="rounded-xl border border-line divide-y divide-line">
        <div className="p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted">Kode perusahaan (Biller Code)</p>
            <p className="text-lg font-extrabold font-mono text-fg">{p.billerCode}</p>
          </div>
          {p.billerCode && <CopyButton value={p.billerCode} />}
        </div>
        <div className="p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted">Kode bayar (Bill Key)</p>
            <p className="text-xl font-extrabold font-mono text-fg tracking-wide break-all">{groupDigits(p.billKey)}</p>
          </div>
          <CopyButton value={p.billKey} />
        </div>
      </div>
    );
  }
  if (p.kind === "qr" && p.qrUrl) {
    return (
      <div className="rounded-xl border border-line p-4 flex flex-col items-center gap-3">
        {/* Gambar QR dari Midtrans (bukan aset statis, jadi tidak lewat next/image). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.qrUrl} alt={`Kode QR pembayaran ${invoice.id}`} width={224} height={224} className="w-56 h-56 rounded-lg bg-white p-2" />
        <p className="text-[11px] text-muted text-center">Scan dengan aplikasi bank atau e-wallet yang mendukung QRIS.</p>
        <div className="flex flex-wrap justify-center gap-2">
          {p.deeplinkUrl && (
            <a href={p.deeplinkUrl} className="h-9 px-4 rounded-full bg-accent text-on-accent text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-accent-hover sm:hidden">
              <Smartphone className="w-3.5 h-3.5" />
              Buka GoPay
            </a>
          )}
          <a href={p.qrUrl} target="_blank" rel="noreferrer" className="h-9 px-3 rounded-full border border-line-strong text-xs font-semibold text-fg inline-flex items-center gap-1.5 hover:border-accent hover:text-accent">
            <ExternalLink className="w-3.5 h-3.5" />
            Buka gambar QR
          </a>
        </div>
      </div>
    );
  }
  if (p.kind === "deeplink" && p.deeplinkUrl) {
    return (
      <div className="rounded-xl border border-line p-5 text-center space-y-3">
        <Smartphone className="w-8 h-8 text-accent mx-auto" />
        <p className="text-sm text-muted">Lanjutkan pembayaran di aplikasi Shopee.</p>
        <a href={p.deeplinkUrl} className="h-10 px-5 rounded-full bg-accent text-on-accent text-sm font-semibold inline-flex items-center gap-2 hover:bg-accent-hover">
          Buka ShopeePay
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    );
  }
  return <p className="text-sm text-muted">Instruksi bayar belum tersedia. Coba ganti metode bayar.</p>;
}
