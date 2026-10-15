"use client";

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DropdownOption<T> {
  value: T;
  label: string;
  hint?: string;
}

interface DropdownProps<T> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (next: T) => void;
  ariaLabel: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  /** Sisi popover menempel pada tombol. */
  align?: "left" | "right";
  className?: string;
  buttonClassName?: string;
}

/**
 * Dropdown kustom (pengganti <select>): tombol + listbox. Panah atas/bawah memindah fokus, Esc
 * menutup dan mengembalikan fokus ke tombol, klik di luar menutup.
 */
export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  icon,
  disabled,
  align = "left",
  className,
  buttonClassName,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);

  // Halaman yang disembunyikan (Activity) tidak boleh kembali dengan popover masih terbuka.
  useLayoutEffect(() => () => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-selected="true"]') ?? list?.querySelector<HTMLElement>("button");
    current?.focus({ preventScroll: true });
    // Fokus tidak boleh menggulung halaman, tetapi pada daftar panjang (mis. 31 tanggal) opsi terpilih
    // harus terlihat: gulung DI DALAM daftar sampai opsi itu kira-kira di tengah.
    if (list && current) list.scrollTop = Math.max(0, current.offsetTop - (list.clientHeight - current.offsetHeight) / 2);
    list?.scrollIntoView({ block: "nearest" });

    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    // Di window (fase capture) supaya Esc menutup dropdown dulu, bukan dialog yang membungkusnya.
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
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) || !list) return;
      e.preventDefault();
      const items = [...list.querySelectorAll<HTMLElement>("button")];
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? items.length - 1
            : e.key === "ArrowDown"
              ? Math.min(items.length - 1, at + 1)
              : Math.max(0, at - 1);
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
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${ariaLabel}: ${selected?.label ?? "belum dipilih"}`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full h-10 pl-3 pr-2.5 flex items-center gap-2 rounded-xl border bg-surface text-sm text-fg text-left transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
          open ? "border-accent ring-4 ring-accent/15" : "border-line-strong hover:border-accent",
          buttonClassName
        )}
      >
        {icon}
        <span className="flex-1 min-w-0 truncate font-medium">{selected?.label ?? "Pilih"}</span>
        <ChevronDown className={cn("w-4 h-4 text-muted shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className={cn(
            "absolute z-30 top-full mt-1 min-w-full w-max max-w-[min(20rem,calc(100vw-2rem))] max-h-64 overflow-y-auto overscroll-contain",
            "bg-surface border border-line rounded-xl shadow-pop p-1 animate-[pop-in_150ms_ease-out]",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
                className={cn(
                  "w-full min-h-10 px-3 py-2 rounded-lg flex items-center gap-2.5 text-left text-sm cursor-pointer transition-colors",
                  active ? "bg-accent-soft text-accent" : "text-fg hover:bg-subtle"
                )}
              >
                <span className="flex-1 min-w-0">
                  <span className="block font-medium">{o.label}</span>
                  {o.hint && <span className={cn("block text-xs", active ? "text-accent" : "text-muted")}>{o.hint}</span>}
                </span>
                {active && <Check className="w-4 h-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
