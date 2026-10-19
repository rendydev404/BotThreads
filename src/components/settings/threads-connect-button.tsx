"use client";

import React, { useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
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

const OAUTH_ERRORS: Record<string, string> = {
  threads_oauth_off: "Fitur hubungkan akun Threads belum diaktifkan oleh pengelola platform.",
  threads_key_off: "Fitur hubungkan akun Threads belum diaktifkan oleh pengelola platform.",
  threads_insecure: "Login Threads hanya bisa dari alamat https.",
};

/**
 * Bantuan khusus HP. Link threads.net yang diketuk sering dibuka sistem di aplikasi Threads, dan halaman izinnya
 * tidak muncul. Link yang DITEMPEL di address bar browser tidak dialihkan ke aplikasi, jadi tombol ini menyalin
 * alamat izin Threads (state bertanda tangan, berlaku 15 menit) untuk dibuka manual di browser.
 */
export function ThreadsMobileHelp({ className }: { className?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "copied">("idle");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const copy = async () => {
    setState("busy");
    setError(null);
    try {
      const res = await fetch("/api/threads/oauth?format=link", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as { success?: boolean; url?: string; error?: string } | null;
      if (!res.ok || !body?.url) throw new Error(OAUTH_ERRORS[body?.error ?? ""] ?? body?.error ?? "Link login gagal dibuat.");
      setLink(body.url);
      try {
        await navigator.clipboard.writeText(body.url);
        setState("copied");
      } catch {
        // Clipboard ditolak (mis. bukan https): tampilkan linknya untuk disalin manual.
        setState("idle");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Link login gagal dibuat.");
      setState("idle");
    }
  };

  return (
    <div className={cn("rounded-xl bg-subtle p-3.5 text-left text-xs text-muted leading-relaxed", className)}>
      <p className="font-semibold text-fg text-[13px]">Di HP, aplikasi Threads terbuka sendiri?</p>
      <p className="mt-1">
        Salin link login, tempel di address bar Chrome atau Safari, lalu masuk dan tekan <b>Izinkan</b>. Akun langsung terhubung,
        walau Anda membukanya di browser lain.
      </p>
      <button
        type="button"
        onClick={() => void copy()}
        disabled={state === "busy"}
        className="mt-2.5 h-10 px-4 rounded-full border border-line-strong bg-surface text-[13px] font-semibold text-fg inline-flex items-center gap-2 hover:border-accent hover:text-accent transition-colors cursor-pointer disabled:opacity-60"
      >
        {state === "busy" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : state === "copied" ? (
          <Check className="w-4 h-4 text-success" />
        ) : (
          <Copy className="w-4 h-4" />
        )}
        {state === "copied" ? "Link tersalin, tempel di browser" : "Salin link login"}
      </button>
      {link && state !== "copied" && (
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Link login Threads"
          className="mt-2 w-full h-9 px-3 rounded-lg border border-line bg-surface text-[11px] font-mono text-fg"
        />
      )}
      {error && <p role="alert" className="mt-2 font-medium text-danger">{error}</p>}
    </div>
  );
}
