"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Keadaan popover kecil (menu, dropdown notifikasi): klik di luar dan Esc menutup, fokus kembali ke
 * tombol pemicu. Pasang `rootRef` pada pembungkus tombol + popover dan `triggerRef` pada tombolnya.
 */
export function usePopover<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<T>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Halaman yang disembunyikan (Activity) tidak boleh kembali dengan popover masih terbuka.
  useLayoutEffect(() => () => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    // Di window (fase capture) supaya Esc menutup popover dulu, bukan dialog yang membungkusnya.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return { open, setOpen, rootRef, triggerRef };
}
