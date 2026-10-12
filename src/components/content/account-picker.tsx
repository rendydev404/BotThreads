"use client";

import React, { useMemo, useState } from "react";
import { Check, ChevronDown, Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { REASON_LABEL, type PublishAccountDTO } from "@/lib/content-types";
import { AccountAvatar } from "./post-status-chip";
import { ModalButton, ModalShell } from "./modal-shell";

interface AccountPickerProps {
  accounts: PublishAccountDTO[];
  value: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  /** Batas pilihan pada mode multi. */
  max?: number;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  className?: string;
  /** Tampilan ringkas (mis. di dalam kartu draf). */
  compact?: boolean;
}

const handle = (a: PublishAccountDTO) => a.username ?? a.displayName;

/**
 * Pemilih akun kustom (bottom sheet di mobile, dialog di desktop). Akun yang belum siap tampil
 * nonaktif beserta alasannya. Mode multi memakai kotak centang dan tombol Selesai.
 */
export function AccountPicker({
  accounts,
  value,
  onChange,
  multiple = false,
  max = 10,
  disabled,
  loading,
  placeholder = "Pilih akun",
  className,
  compact,
}: AccountPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const selected = value.map((id) => byId.get(id)).filter((a): a is PublishAccountDTO => !!a);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? accounts.filter(
          (a) =>
            a.username?.toLowerCase().includes(q) ||
            a.displayName.toLowerCase().includes(q) ||
            a.outletNama?.toLowerCase().includes(q)
        )
      : accounts;
    // Akun siap tampil lebih dulu.
    return [...list].sort((a, b) => Number(b.ready) - Number(a.ready));
  }, [accounts, query]);

  const readyCount = accounts.filter((a) => a.ready).length;

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const toggle = (id: string) => {
    if (!multiple) {
      onChange([id]);
      close();
      return;
    }
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else if (value.length < max) onChange([...value, id]);
  };

  const label = (() => {
    if (loading) return "Memuat akun...";
    if (selected.length === 0) return placeholder;
    if (!multiple || selected.length === 1) return `@${handle(selected[0])}`;
    return `${selected.length} akun dipilih`;
  })();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled || loading}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "w-full flex items-center gap-2.5 rounded-xl border border-line-strong bg-surface text-left transition-colors cursor-pointer hover:border-accent disabled:opacity-60 disabled:cursor-not-allowed",
          compact ? "h-10 pl-2 pr-2.5" : "h-12 pl-2.5 pr-3",
          className
        )}
      >
        {selected.length === 0 || (multiple && selected.length > 1) ? (
          <span className="w-8 h-8 rounded-full bg-accent-soft text-accent flex items-center justify-center shrink-0">
            <Users className="w-4 h-4" />
          </span>
        ) : (
          <AccountAvatar name={selected[0].displayName} src={selected[0].avatarUrl} size={compact ? "w-6 h-6" : "w-8 h-8"} />
        )}
        <span className="flex-1 min-w-0 text-sm font-semibold text-fg truncate">{label}</span>
        <ChevronDown className="w-4 h-4 text-muted shrink-0" />
      </button>

      <ModalShell
        open={open}
        onClose={close}
        title={multiple ? "Pilih akun tujuan" : "Pilih akun"}
        description={
          multiple
            ? `${value.length}/${max} dipilih. ${readyCount} dari ${accounts.length} akun siap diposting.`
            : `${readyCount} dari ${accounts.length} akun siap diposting.`
        }
        footer={
          multiple ? (
            <>
              {value.length > 0 && (
                <ModalButton onClick={() => onChange([])}>Kosongkan</ModalButton>
              )}
              <ModalButton variant="primary" onClick={close}>
                Selesai
              </ModalButton>
            </>
          ) : undefined
        }
      >
        <div className="relative mb-3">
          <Search className="w-4 h-4 text-faint absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            data-autofocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari nama cabang atau @username"
            aria-label="Cari akun"
            className="w-full h-11 pl-10 pr-3 rounded-xl bg-subtle border border-transparent text-sm text-fg placeholder-faint outline-none focus:bg-surface focus:border-accent transition-colors"
          />
        </div>
        <ul role="listbox" aria-label="Daftar akun" aria-multiselectable={multiple} className="space-y-1">
          {filtered.map((a) => {
            const isSel = value.includes(a.id);
            const blocked = !a.ready;
            const full = multiple && !isSel && value.length >= max;
            return (
              <li key={a.id} role="option" aria-selected={isSel} aria-disabled={blocked || full}>
                <button
                  type="button"
                  disabled={blocked || full}
                  onClick={() => toggle(a.id)}
                  className={cn(
                    "w-full min-h-14 px-3 py-2 rounded-xl flex items-center gap-3 text-left transition-colors cursor-pointer",
                    isSel ? "bg-accent-soft" : "hover:bg-subtle",
                    (blocked || full) && "opacity-55 cursor-not-allowed hover:bg-transparent"
                  )}
                >
                  <AccountAvatar name={a.displayName} src={a.avatarUrl} size="w-9 h-9" />
                  <span className="flex-1 min-w-0 leading-tight">
                    <span className="block text-sm font-semibold text-fg truncate">{a.outletNama ?? a.displayName}</span>
                    <span className="block text-xs text-muted truncate">
                      @{handle(a)}
                      {blocked && a.reason ? ` · ${REASON_LABEL[a.reason]}` : ""}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "w-5 h-5 shrink-0 flex items-center justify-center border",
                      multiple ? "rounded-md" : "rounded-full",
                      isSel ? "bg-accent border-accent text-on-accent" : "border-line-strong bg-surface"
                    )}
                    aria-hidden
                  >
                    {isSel && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                  </span>
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="py-10 text-center text-sm text-muted">Tidak ada akun yang cocok dengan &ldquo;{query}&rdquo;.</li>
          )}
        </ul>
      </ModalShell>
    </>
  );
}
