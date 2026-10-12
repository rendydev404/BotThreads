"use client";

import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Tumpukan dialog terbuka: hanya yang paling atas menangani Esc dan Tab. */
const openStack: symbol[] = [];

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])';

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Saat sibuk, Esc/klik latar tidak menutup dialog. */
  busy?: boolean;
  size?: "md" | "lg";
}

/**
 * Dialog kustom: bottom sheet di mobile, modal tengah di desktop. Fokus terkunci di dalam dialog,
 * Esc menutup, fokus kembali ke pemicu, scroll halaman di belakangnya dikunci.
 */
export function ModalShell({ open, onClose, title, description, children, footer, busy, size = "md" }: ModalShellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);

  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  });

  useEffect(() => {
    if (!open) return;
    const token = Symbol("modal");
    openStack.push(token);
    const previous = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const node = ref.current;
    const first = node?.querySelector<HTMLElement>("[data-autofocus]") ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== token) return;
      if (e.key === "Escape" && !busyRef.current) {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const at = openStack.indexOf(token);
      if (at >= 0) openStack.splice(at, 1);
      document.body.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/55 animate-[fade-in_150ms_ease-out]"
        onClick={() => !busy && onClose()}
        aria-hidden
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative w-full bg-surface border border-line shadow-pop flex flex-col outline-none",
          "max-h-[92dvh] rounded-t-3xl animate-[sheet-up_220ms_ease-out]",
          "sm:rounded-2xl sm:max-h-[88dvh] sm:animate-[pop-in_150ms_ease-out]",
          size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg"
        )}
      >
        <div className="sm:hidden pt-2.5 flex justify-center" aria-hidden>
          <span className="w-10 h-1.5 rounded-full bg-line-strong" />
        </div>
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold text-fg">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Tutup"
            className="w-9 h-9 -mr-2 shrink-0 rounded-full text-muted hover:text-fg hover:bg-subtle flex items-center justify-center cursor-pointer transition-colors disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
        {footer && (
          <div className="px-5 py-4 border-t border-line flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/** Tombol standar modal agar konsisten. */
export function ModalButton({
  variant = "secondary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "h-11 sm:h-10 px-5 rounded-full text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
        variant === "primary" && "bg-accent text-on-accent hover:bg-accent-hover",
        variant === "secondary" && "bg-subtle text-fg hover:bg-line",
        variant === "danger" && "bg-danger text-on-accent hover:opacity-90",
        className
      )}
    />
  );
}
