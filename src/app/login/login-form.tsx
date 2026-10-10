"use client";

import React, { useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Eye, EyeOff, Loader2, Lock, User } from "lucide-react";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { safeNextPath } from "@/lib/safe-next";

export function LoginForm() {
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
        setError(data.error || "Login gagal. Coba lagi.");
        setPassword("");
        setLoading(false);
        return;
      }

      // Muat ulang penuh agar seluruh state klien bersih dan cookie terbaca
      window.location.assign(safeNextPath(params.get("next")));
    } catch {
      setError("Tidak bisa terhubung ke server. Periksa koneksi Anda.");
      setLoading(false);
    }
  };

  const inputBase =
    "w-full h-11 rounded-lg bg-subtle border border-transparent text-sm text-fg placeholder-faint focus:bg-surface focus:border-accent focus:outline-none transition-colors";

  return (
    <main className="relative flex-1 min-h-screen flex items-center justify-center px-4 py-10">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <Image
            src="/logo.webp"
            alt=""
            width={64}
            height={64}
            priority
            className="w-16 h-16 rounded-2xl"
          />
          <h1 className="mt-5 text-2xl font-bold text-fg">
            Dashboard Analytics Threads
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Masuk untuk melihat performa akun
          </p>
        </div>

        <form onSubmit={onSubmit} className="card mt-8 p-6 space-y-4" noValidate>
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 p-3 rounded-lg bg-danger-soft text-danger text-sm"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="username" className="text-sm font-medium text-fg">
              Email atau username
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-faint absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                className={`${inputBase} pl-10 pr-3`}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium text-fg">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-faint absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                className={`${inputBase} pl-10 pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                aria-pressed={showPassword}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md text-muted hover:text-fg hover:bg-line/60 flex items-center justify-center transition-colors cursor-pointer"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="w-full h-11 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Memeriksa…
              </>
            ) : (
              "Masuk"
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-faint">
          Akses terbatas untuk administrator.
        </p>
      </div>
    </main>
  );
}
