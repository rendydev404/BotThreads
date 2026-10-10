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
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { safeNextPath } from "@/lib/safe-next";
import { cn } from "@/lib/utils";
import { NetworkCanvas } from "./network-canvas";

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

const inputCls =
  "peer w-full h-14 pt-5 px-4 rounded-xl bg-subtle border border-transparent text-[15px] text-fg outline-none transition-colors placeholder-transparent focus:bg-surface focus:border-accent disabled:opacity-60";

export function LoginForm() {
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState("");
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
        return fail(data.error || "Login gagal. Coba lagi.");
      }
      // Muat ulang penuh agar seluruh state klien bersih dan cookie terbaca
      window.location.assign(safeNextPath(params.get("next")));
    } catch {
      fail("Tidak bisa terhubung ke server. Periksa koneksi Anda.");
    }
  };

  return (
    <main className="min-h-screen flex flex-col lg:flex-row bg-canvas">
      {/* Panel jaringan: satu titik = satu akun cabang */}
      <aside className="relative lg:w-[46%] h-52 lg:h-auto lg:min-h-screen overflow-hidden bg-[#0b0d16] text-white">
        <NetworkCanvas className="absolute inset-0 w-full h-full" />
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />

        <div className="relative z-10 h-full p-6 lg:p-10 flex flex-col justify-between pointer-events-none">
          <div className="flex items-center gap-3">
            <Image
              src="/logo.webp"
              alt=""
              width={36}
              height={36}
              priority
              className="w-9 h-9 rounded-lg"
            />
            <span className="text-sm font-semibold tracking-wide text-white/90">
              Dashboard Analytics Threads
            </span>
          </div>

          <div className="hidden lg:block max-w-md">
            <p className="text-[2.1rem] leading-[1.15] font-semibold tracking-tight">
              Semua akun cabang,
              <br />
              terbaca dalam satu layar.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-white/60">
              Penayangan, interaksi, dan peringkat tiap cabang dari hari ke
              hari, lengkap dengan saran langkah berikutnya.
            </p>
            <p className="mt-8 text-xs text-white/40">
              Gerakkan kursor di atas jaringan ini.
            </p>
          </div>
        </div>
      </aside>

      {/* Form */}
      <section className="relative flex-1 flex items-center justify-center px-5 py-10">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-[380px]">
          <h1 className="text-[1.75rem] font-semibold tracking-tight text-fg">
            Masuk
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Gunakan email atau username admin.
          </p>

          <form
            key={shake}
            onSubmit={onSubmit}
            noValidate
            className={cn("mt-8 space-y-3.5", shake > 0 && "animate-[shake_380ms_ease-in-out]")}
          >
            <Field id="username" label="Email atau username">
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
                aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                aria-pressed={showPassword}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-lg text-muted hover:text-fg hover:bg-line/60 flex items-center justify-center transition-colors cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
              </button>
            </Field>

            <div className="min-h-5" aria-live="polite">
              {capsLock && (
                <p className="flex items-center gap-1.5 text-xs text-warning">
                  <TriangleAlert className="w-3.5 h-3.5" />
                  Caps Lock sedang aktif
                </p>
              )}
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 p-3 rounded-xl bg-danger-soft text-danger text-sm"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username.trim() || !password}
              className="group relative w-full h-14 rounded-xl bg-accent hover:bg-accent-hover text-on-accent text-[15px] font-semibold overflow-hidden flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-[18px] h-[18px] animate-spin" />
                  Memeriksa…
                </>
              ) : (
                <>
                  Masuk
                  <ArrowRight className="w-[18px] h-[18px] transition-transform group-hover:translate-x-1" />
                </>
              )}
            </button>
          </form>

          <p className="mt-8 text-xs text-faint leading-relaxed">
            Akses terbatas untuk administrator. Percobaan masuk yang gagal
            berulang akan dikunci sementara.
          </p>
        </div>
      </section>
    </main>
  );
}
