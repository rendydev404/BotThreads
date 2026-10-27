"use client";

import React, { useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { BackToLanding } from "@/components/auth/auth-frame";
import { GoogleButton } from "@/components/auth/google-button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { useT } from "@/components/i18n/lang-provider";
import { LangToggle } from "@/components/i18n/lang-toggle";
import { safeNextPath } from "@/lib/safe-next";
import { cn } from "@/lib/utils";

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      {children}
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-4 top-2 text-[11px] font-medium text-muted transition-all
          peer-placeholder-shown:top-[1.05rem] peer-placeholder-shown:text-sm peer-placeholder-shown:font-normal
          peer-focus:top-2 peer-focus:text-[11px] peer-focus:font-medium peer-focus:text-accent"
      >
        {label}
      </label>
    </div>
  );
}

/** Pesan untuk kode `?error=` yang dikirim alur masuk dengan Google. */
const OAUTH_ERRORS: Record<string, string> = {
  google_off: "Masuk dengan Google belum diaktifkan: isi GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET di panel Super Admin > Integrasi atau .env.local.",
  google_gagal: "Masuk dengan Google gagal atau dibatalkan. Pastikan Authorized Redirect URI di Google Cloud Console sesuai dengan URL callback aplikasi.",
  google_ditolak: "Google menolak akses. Bila aplikasi Google masih berstatus Testing, email ini harus ditambahkan sebagai Test user di Google Cloud Console.",
  google_tidak_terdaftar: "Akun Google ini belum terdaftar dan pendaftaran mandiri sedang ditutup. Minta admin mengundang email Anda.",
  undangan_email: "Undangan itu untuk email lain, atau sudah tidak berlaku. Masuk ke Google dengan email yang diundang.",
  coba_lagi: "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
};

const inputCls =
  "peer w-full h-14 pt-5 px-4 rounded-xl bg-subtle border border-transparent text-[15px] text-fg outline-none transition-colors placeholder-transparent focus:bg-surface focus:border-accent disabled:opacity-60";

export function LoginForm({ google = false, signup = false }: { google?: boolean; signup?: boolean }) {
  const t = useT();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState(() => {
    const msg = OAUTH_ERRORS[params.get("error") ?? ""] ?? "";
    // `why` hanya dikirim server di development (penyebab teknis kegagalan Google). Di produksi diabaikan
    // supaya tautan buatan orang lain tidak bisa menyisipkan teks ke halaman masuk.
    const why = process.env.NODE_ENV !== "production" ? params.get("why") : null;
    return msg && why ? `${msg} (${why})` : msg;
  });
  const [shake, setShake] = useState(0);
  const [loading, setLoading] = useState(false);

  const fail = (msg: string) => {
    setError(msg);
    setShake((n) => n + 1);
    setLoading(false);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setPassword("");
        return fail(t(data.error || "Login gagal. Coba lagi."));
      }
      // Muat ulang penuh agar seluruh state klien bersih dan cookie terbaca
      window.location.assign(next);
    } catch {
      fail(t("Tidak bisa terhubung ke server. Periksa koneksi Anda."));
    }
  };

  return (
    <main className="relative flex-1 w-full min-h-screen flex items-center justify-center px-5 py-10 bg-canvas">
      <BackToLanding />
      <div className="absolute top-4 right-4 flex items-center gap-1.5">
        <LangToggle />
        <ThemeToggle />
      </div>

      <div className="w-full max-w-[400px]">
        <div className="flex flex-col items-center text-center">
          <Image
            src="/logo.webp"
            alt="BotThreads"
            width={88}
            height={88}
            priority
            className="w-[88px] h-[88px] rounded-[1.4rem] shadow-pop"
          />
          <h1 className="mt-6 text-[1.7rem] font-semibold tracking-tight text-fg">
            BotThreads
          </h1>
          <p className="mt-1.5 text-sm text-muted">{t("Masuk untuk melihat performa akun")}</p>
        </div>

        <form
          key={shake}
          onSubmit={onSubmit}
          noValidate
          className={cn(
            "card mt-8 p-6 space-y-3.5 shadow-[0_8px_30px_-12px_rgba(20,23,43,0.18)]",
            shake > 0 && "animate-[shake_380ms_ease-in-out]"
          )}
        >
          <Field id="username" label={t("Email atau username")}>
            <input
              id="username"
              name="username"
              type="text"
              placeholder=" "
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              className={inputCls}
            />
          </Field>

          <Field id="password" label="Password">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              placeholder=" "
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
              onKeyDown={(e) => setCapsLock(e.getModifierState("CapsLock"))}
              onBlur={() => setCapsLock(false)}
              disabled={loading}
              className={cn(inputCls, "pr-12")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? t("Sembunyikan password") : t("Tampilkan password")}
              aria-pressed={showPassword}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-lg text-muted hover:text-fg hover:bg-line/60 flex items-center justify-center transition-colors cursor-pointer"
            >
              {showPassword ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
            </button>
          </Field>

          {capsLock && (
            <p className="flex items-center gap-1.5 text-xs text-warning" aria-live="polite">
              <TriangleAlert className="w-3.5 h-3.5" />
              {t("Caps Lock sedang aktif")}
            </p>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 p-3 rounded-xl bg-danger-soft text-danger text-sm"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{t(error)}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="group w-full h-14 mt-1 rounded-xl bg-accent hover:bg-accent-hover text-on-accent text-[15px] font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-[18px] h-[18px] animate-spin" />
                {t("Memeriksa…")}
              </>
            ) : (
              <>
                {t("Masuk")}
                <ArrowRight className="w-[18px] h-[18px] transition-transform group-hover:translate-x-1" />
              </>
            )}
          </button>
        </form>

        {(google || signup) && (
          <>
            <div className="mt-5 flex items-center gap-3 text-xs text-faint" aria-hidden="true">
              <span className="h-px flex-1 bg-line" />
              {t("atau")}
              <span className="h-px flex-1 bg-line" />
            </div>
            <GoogleButton
              href={`/api/auth/google?signup=1&next=${encodeURIComponent(next)}`}
              className="mt-5"
            >
              {t("Masuk atau Daftar dengan Google")}
            </GoogleButton>
          </>
        )}

        <p className="mt-6 text-center text-xs text-faint">
          {signup ? (
            <>
              {t("Belum punya akun?")}{" "}
              <a href="/daftar" className="font-semibold text-accent hover:underline">
                {t("Daftar gratis")}
              </a>
            </>
          ) : (
            t("Akses hanya untuk anggota yang terdaftar atau diundang.")
          )}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-faint">
          <a href="/kebijakan-privasi" className="hover:text-fg transition-colors">
            {t("Kebijakan Privasi")}
          </a>
          <span aria-hidden="true">·</span>
          <a href="/syarat-ketentuan" className="hover:text-fg transition-colors">
            {t("Syarat & Ketentuan")}
          </a>
          <span aria-hidden="true">·</span>
          <a href="/kebijakan-pengembalian" className="hover:text-fg transition-colors">
            {t("Kebijakan Refund")}
          </a>
        </div>
      </div>
    </main>
  );
}
