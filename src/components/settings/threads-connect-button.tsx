import React from "react";
import { cn } from "@/lib/utils";
import { ThreadsMark } from "@/components/landing/threads-mark";

/**
 * Tombol "hubungkan akun Threads" bergaya merek Threads: logo Threads, hitam di tema terang dan putih di
 * tema gelap (warna resmi Threads), supaya pengguna langsung tahu tombol ini membawanya ke Threads.
 * Satu-satunya pintu masuk OAuth: /api/threads/oauth (Pemilik/Admin).
 */
const BASE =
  "inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap transition-colors bg-black text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-neutral-400/40";
const SIZE = {
  sm: "h-9 px-3.5 rounded-lg text-xs",
  md: "h-10 px-5 rounded-full text-sm",
} as const;

export function ThreadsConnectButton({
  label = "Hubungkan Akun Threads",
  size = "md",
  disabled,
  disabledTitle,
  className,
}: {
  label?: string;
  size?: keyof typeof SIZE;
  /** Belum bisa dipakai (mis. fitur belum diaktifkan pengelola): tampil redup, tidak bisa diklik. */
  disabled?: boolean;
  disabledTitle?: string;
  className?: string;
}) {
  const icon = <ThreadsMark className={size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} />;
  if (disabled) {
    return (
      <button type="button" disabled title={disabledTitle} className={cn(BASE, SIZE[size], "opacity-50 cursor-not-allowed", className)}>
        {icon}
        {label}
      </button>
    );
  }
  return (
    <a href="/api/threads/oauth" className={cn(BASE, SIZE[size], className)}>
      {icon}
      {label}
    </a>
  );
}
