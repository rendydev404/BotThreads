"use client";

import React, { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Loader2, MoreVertical, RotateCw, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ADMIN_REASON_MAX, ADMIN_REASON_MIN } from "@/lib/admin-types";
import type { AdminPlansResponse, PlanDTO } from "@/lib/plan-types";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { Banner } from "@/components/autopilot/shared";
import { FormError, TextAreaField } from "@/components/settings/fields";
import { errorText } from "@/components/settings/format";
import { BTN_OUTLINE, ICON_BTN, LoadError, NotInstalled } from "@/components/settings/states";
import type { useRemote } from "@/components/settings/use-remote";

/* ------------------------------------------------------------------ konteks panel */

export type AdminTabKey = "ringkasan" | "paket" | "transaksi" | "workspace" | "pengguna" | "sumber" | "integrasi" | "sistem" | "audit";

export interface AdminContextValue {
  /**
   * Bungkus setiap panggilan /api/admin/*: balasan 403 berarti peran super admin dicabut di tengah
   * sesi, jadi profil dimuat ulang dan halaman menutup panelnya. Galat tetap dilempar ke pemanggil.
   */
  guard: <T>(request: Promise<T>) => Promise<T>;
  /** Nomor revisi data tiap tab; masuk ke kunci fetch supaya tab yang datanya basi memuat ulang saat dibuka. */
  rev: Record<AdminTabKey, number>;
  /** Tandai data tab lain basi setelah sebuah mutasi (tab yang sedang dibuka diperbarui secara lokal). */
  invalidate: (tabs: AdminTabKey[]) => void;
  openTab: (tab: AdminTabKey) => void;
  /** Muat ulang profil (mis. setelah mencabut peran super admin sendiri). */
  reloadMe: () => void;
}

export const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin dipakai di luar halaman /admin.");
  return ctx;
}

/* ------------------------------------------------------------------ paket (dipakai tab Paket dan Workspace) */

/** Daftar paket dimuat sekali di halaman lalu dibagi ke tab Paket dan tab Workspace. */
export type PlansRemote = ReturnType<typeof useRemote<AdminPlansResponse>>;

export const PLANS_SQL_FILE = "sql/011_plans.sql";

/** Urutan yang sama dengan server: urutan, harga, lalu kode. */
export const sortPlans = (items: PlanDTO[]): PlanDTO[] =>
  [...items].sort((a, b) => a.urutan - b.urutan || a.hargaBulanan - b.hargaBulanan || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/* ------------------------------------------------------------------ pembantu teks */

export const ADMIN_SQL_FILE = "sql/010_superadmin.sql";
const NOT_INSTALLED = /belum (dipasang|dibuat)/i;
const SQL_FILE = /sql\/\d{3}_[a-z0-9_]+\.sql/i;

/** Jeda pencarian sebelum permintaan dikirim. */
export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_MAX = 80;

/**
 * Rapikan teks bebas persis seperti server (alasan, pengumuman): tanda kurung sudut dibuang dan spasi
 * serta baris baru dirapatkan, supaya pratinjau dan pembaruan lokal sama dengan yang tersimpan.
 */
export const tidyText = (raw: string): string => raw.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();

/** "AKSI_LAIN" menjadi "Aksi lain" untuk nilai yang belum punya label. */
export const humanize = (key: string): string => {
  const s = key.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/**
 * Nilai yang baru diteruskan setelah berhenti berubah selama `ms`. Timer dibuat ulang saat tab
 * terlihat lagi, jadi kotak pencarian dan hasilnya tidak pernah berselisih.
 */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/* ------------------------------------------------------------------ keadaan tab */

/**
 * Tab gagal dimuat. 503 yang menyebut skema belum dipasang (atau menyebut berkas SQL-nya) berarti
 * sql/010_superadmin.sql belum dijalankan di database: tampilkan berkasnya. Galat lain (termasuk 403)
 * memakai tampilan bersama.
 */
export function AdminLoadError({ message, status, onRetry }: { message: string; status: number | null; onRetry: () => void }) {
  if (status === 503 && (NOT_INSTALLED.test(message) || SQL_FILE.test(message))) {
    return (
      <div className="space-y-3">
        <NotInstalled title="Panel super admin belum dipasang." file={SQL_FILE.exec(message)?.[0] ?? ADMIN_SQL_FILE} />
        <div className="flex justify-center">
          <button type="button" onClick={onRetry} className={BTN_OUTLINE}>
            <RotateCw className="w-3.5 h-3.5" />
            Periksa lagi
          </button>
        </div>
      </div>
    );
  }
  return <LoadError message={message} status={status} onRetry={onRetry} />;
}

/** Data lama masih tampil, tetapi penyegaran terakhir gagal. */
export function RefreshError({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (!error) return null;
  return (
    <Banner tone="danger">
      Gagal menyegarkan data: {error}{" "}
      <button type="button" onClick={onRetry} className="underline font-semibold cursor-pointer">
        Coba lagi
      </button>
    </Banner>
  );
}

/* ------------------------------------------------------------------ pencarian dan filter */

export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  modalAutofocus,
  className,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  /** Di dalam dialog: kotak ini yang pertama mendapat fokus. */
  modalAutofocus?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative flex-1 min-w-0", className)}>
      <Search className="w-4 h-4 text-faint absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={value}
        maxLength={SEARCH_MAX}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        data-autofocus={modalAutofocus || undefined}
        className="w-full h-11 pl-10 pr-11 rounded-full bg-surface border border-line-strong text-sm text-fg placeholder:text-faint outline-none focus:border-accent focus:ring-4 focus:ring-accent/15 transition-colors"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Hapus pencarian"
          className="absolute right-0.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full text-muted hover:text-fg inline-flex items-center justify-center cursor-pointer transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export interface ChipOption<T> {
  value: T;
  label: string;
  count?: number;
}

/** Baris chip filter pilihan tunggal; digulir mendatar di layar sempit. */
export function FilterChips<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  ariaLabel: string;
  options: ChipOption<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="-mx-4 px-4 -my-1 py-1 md:-mx-1 md:px-1 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => !active && onChange(o.value)}
            className={cn(
              "shrink-0 h-10 px-3.5 rounded-full border text-[13px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer",
              active ? "bg-accent border-accent text-on-accent" : "bg-surface border-line-strong text-fg hover:border-accent hover:text-accent"
            )}
          >
            {o.label}
            {o.count !== undefined && <span className={cn("tabular-nums", active ? "opacity-80" : "text-muted")}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ saklar */

/** Saklar kustom (role="switch") dengan area sentuh 40px. Labelnya elemen lain, dirujuk lewat id. */
export function Switch({
  checked,
  onChange,
  labelledBy,
  describedBy,
  disabled,
  busy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  labelledBy: string;
  describedBy?: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="shrink-0 w-12 h-10 rounded-full inline-flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <span className={cn("relative w-11 h-6 rounded-full transition-colors", checked ? "bg-accent" : "bg-line-strong")} aria-hidden>
        <span
          className={cn(
            "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-surface inline-flex items-center justify-center transition-transform",
            checked && "translate-x-5"
          )}
        >
          {busy && <Loader2 className="w-3 h-3 text-muted animate-spin" />}
        </span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ menu tindakan */

export interface MenuAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  /** Alasan tindakan tidak tersedia: butir tetap terbaca (dan terfokus), tetapi tidak bisa dipilih. */
  disabledReason?: string | null;
}

/**
 * Menu tindakan ringkas untuk satu baris (tombol titik tiga + role="menu"). Panah memindah fokus,
 * Esc menutup dan mengembalikan fokus ke tombol, klik di luar menutup.
 */
export function ActionMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Tab yang disembunyikan (Activity) tidak boleh kembali dengan menu masih terbuka.
  useLayoutEffect(() => () => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    menu?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    menu?.scrollIntoView({ block: "nearest" });

    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (e.key === "Tab") {
        setOpen(false);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) || !menu) return;
      e.preventDefault();
      const items = [...menu.querySelectorAll<HTMLElement>("button")];
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? items.length - 1
            : e.key === "ArrowDown"
              ? (at + 1) % items.length
              : (at - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className={cn(ICON_BTN, open && "bg-subtle text-fg")}
      >
        <MoreVertical className="w-[18px] h-[18px]" />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute z-30 right-0 top-full mt-1 w-72 max-w-[calc(100vw-3rem)] scroll-mb-28 md:scroll-mb-4 bg-surface border border-line rounded-xl shadow-pop p-1 animate-[pop-in_150ms_ease-out]"
        >
          {actions.map((a) => {
            const off = !!a.disabledReason;
            return (
              <button
                key={a.key}
                type="button"
                role="menuitem"
                aria-disabled={off || undefined}
                onClick={() => {
                  if (off) return;
                  setOpen(false);
                  // Fokus kembali ke tombol dulu, supaya dialog yang dibuka tindakan ini mengembalikan fokus ke sana.
                  buttonRef.current?.focus();
                  a.onSelect();
                }}
                className={cn(
                  "w-full min-h-11 px-3 py-2 rounded-lg flex items-start gap-2.5 text-left text-sm transition-colors",
                  off
                    ? "text-faint cursor-not-allowed"
                    : cn("cursor-pointer", a.danger ? "text-danger hover:bg-danger-soft" : "text-fg hover:bg-subtle")
                )}
              >
                <span className="mt-0.5 shrink-0">{a.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-medium">{a.label}</span>
                  {off && <span className="block text-xs text-muted leading-relaxed">{a.disabledReason}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ dialog alasan */

interface ReasonDialogProps {
  title: string;
  description?: string;
  /** Akibat tindakan dalam satu kalimat. */
  consequence: string;
  confirmLabel: string;
  confirmIcon?: React.ReactNode;
  placeholder?: string;
  onClose: () => void;
  /** Lempar galat untuk menolak: pesannya (dari server) ditampilkan apa adanya. */
  onSubmit: (reason: string) => Promise<void>;
}

/** Konfirmasi tindakan berat yang wajib beralasan (blokir pengguna, tangguhkan workspace). */
export function ReasonDialog({ title, description, consequence, confirmLabel, confirmIcon, placeholder, onClose, onSubmit }: ReasonDialogProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const formId = useId();

  const clean = tidyText(reason);
  const reasonError =
    clean.length < ADMIN_REASON_MIN
      ? `Tulis alasan minimal ${ADMIN_REASON_MIN} karakter.`
      : clean.length > ADMIN_REASON_MAX
        ? `Alasan maksimal ${ADMIN_REASON_MAX} karakter.`
        : null;

  const submit = async () => {
    setSubmitted(true);
    if (busy || reasonError) return;
    setBusy(true);
    setFailure(null);
    try {
      await onSubmit(clean);
    } catch (e) {
      setFailure(errorText(e, "Tindakan gagal. Coba lagi."));
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      busy={busy}
      title={title}
      description={description}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            Batal
          </ModalButton>
          <ModalButton variant="danger" type="submit" form={formId} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : confirmIcon}
            {busy ? "Memproses..." : confirmLabel}
          </ModalButton>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-4"
      >
        <p className="text-sm text-fg leading-relaxed">{consequence}</p>
        <TextAreaField
          label="Alasan"
          data-autofocus
          rows={3}
          value={reason}
          onChange={(v) => {
            setReason(v);
            setFailure(null);
          }}
          maxLength={ADMIN_REASON_MAX}
          placeholder={placeholder}
          error={submitted ? reasonError : null}
          hint="Wajib diisi. Alasan tercatat di audit dan terlihat super admin lain."
          disabled={busy}
        />
        <FormError message={failure} />
      </form>
    </ModalShell>
  );
}
