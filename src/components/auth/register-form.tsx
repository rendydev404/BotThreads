"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, Rocket } from "lucide-react";
import { registerAccount } from "@/lib/team-client";
import { cn } from "@/lib/utils";
import { hardNavigate } from "@/components/layout/session-nav";
import { FormError, PasswordField, TextField } from "@/components/settings/fields";
import { AUTH_BUTTON_CLS, AuthFrame } from "./auth-frame";
import { GoogleButton } from "./google-button";

const PASSWORD_MIN = 10;
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[^\s@<>]{2,24}$/;

const OAUTH_ERRORS: Record<string, string> = {
  google_not_configured:
    "Login Google belum dikonfigurasi. Masukkan Google Client ID & Secret di Dashboard Super Admin (tab Integrasi & API Keys) atau file .env.local.",
  google_cancelled: "Pendaftaran dengan Google dibatalkan.",
  google_state: "Sesi pendaftaran Google berakhir. Silakan klik Daftar dengan Google sekali lagi.",
  google_failed: "Tidak bisa terhubung ke Google saat ini. Coba lagi sebentar.",
  google_unverified: "Email akun Google ini belum terverifikasi oleh Google.",
  google_banned: "Akun ini telah dinonaktifkan oleh pengelola platform.",
};

/** Daftar mandiri: akun baru sekaligus workspace baru, pendaftar menjadi Pemilik. */
export function RegisterForm({ open }: { open: boolean }) {
  const searchParams = useSearchParams();
  const oauthCode = searchParams.get("error");
  const oauthError = oauthCode ? (OAUTH_ERRORS[oauthCode] ?? null) : null;
  const [brand, setBrand] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <AuthFrame back title="Pendaftaran belum dibuka" subtitle="Saat ini akun baru dibuat lewat undangan dari pemilik workspace.">
        <Link href="/login" className={cn(AUTH_BUTTON_CLS, "bg-accent hover:bg-accent-hover text-on-accent")}>
          Ke halaman masuk
        </Link>
      </AuthFrame>
    );
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanUsername = username.trim().toLowerCase();
  const cleanBrand = brand.replace(/\s+/g, " ").trim();
  const errors = {
    brand: cleanBrand.length < 2 ? "Nama brand minimal 2 karakter." : null,
    email: EMAIL.test(cleanEmail) ? null : "Alamat email tidak valid.",
    username: USERNAME.test(cleanUsername) ? null : "3-32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung.",
    password: password.length < PASSWORD_MIN ? `Password minimal ${PASSWORD_MIN} karakter.` : null,
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (e: string | null) => (touched ? e : null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setTouched(true);
    setError(null);
    if (invalid) return;
    setBusy(true);
    try {
      await registerAccount({ email: cleanEmail, username: cleanUsername, name: name.trim() || undefined, brand: cleanBrand, password });
      // Sesi sudah dipasang server: muat penuh supaya seluruh state klien bersih.
      hardNavigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mendaftar. Coba lagi.");
      setBusy(false);
    }
  };

  return (
    <AuthFrame back title="Buat akun" subtitle="Satu akun, satu workspace untuk brand Anda. Anggota tim bisa diundang setelahnya.">
      {/* Tautan biasa: server mengalihkan ke Google lalu membuat akun + workspace dari profil Google. */}
      <GoogleButton href="/api/auth/google?signup=1">Daftar dengan Google</GoogleButton>
      <div className="my-5 flex items-center gap-3 text-xs text-faint" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        atau isi sendiri
        <span className="h-px flex-1 bg-line" />
      </div>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField label="Nama brand" value={brand} onChange={setBrand} maxLength={80} disabled={busy} hint="Dipakai AI untuk menulis dengan suara brand Anda." error={show(errors.brand)} />
        <TextField label="Nama Anda (opsional)" value={name} onChange={setName} autoComplete="name" maxLength={80} disabled={busy} />
        <TextField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} disabled={busy} error={show(errors.email)} />
        <TextField label="Username" value={username} onChange={setUsername} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={32} disabled={busy} error={show(errors.username)} />
        <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="new-password" maxLength={200} disabled={busy} hint={`Minimal ${PASSWORD_MIN} karakter.`} error={show(errors.password)} />
        <FormError message={error ?? oauthError} />
        <button type="submit" disabled={busy} className={cn(AUTH_BUTTON_CLS, "bg-accent hover:bg-accent-hover text-on-accent")}>
          {busy ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <Rocket className="w-[18px] h-[18px]" />}
          {busy ? "Membuat akun..." : "Daftar dan mulai"}
        </button>
      </form>
      <p className="mt-5 text-center text-sm text-muted">
        Sudah punya akun?{" "}
        <Link href="/login" className="font-semibold text-accent hover:underline">
          Masuk
        </Link>
      </p>
    </AuthFrame>
  );
}
