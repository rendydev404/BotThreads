"use client";

import React, { useState } from "react";
import { CheckCircle2, KeyRound, Link2Off, Loader2 } from "lucide-react";
import { ContentApiError } from "@/lib/content-client";
import { resetPasswordWithToken } from "@/lib/team-client";
import { cn } from "@/lib/utils";
import { FormError, PasswordField } from "@/components/settings/fields";
import { AUTH_BUTTON_CLS, AuthFrame, AuthNotice } from "./auth-frame";

const PASSWORD_MIN = 10;

/** Pasang password baru dari tautan reset buatan admin (sekali pakai, 60 menit). */
export function ResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"form" | "done" | "invalid">("form");

  const passwordError = touched && password.length < PASSWORD_MIN ? `Password minimal ${PASSWORD_MIN} karakter.` : null;
  const confirmError = touched && confirm !== password ? "Konfirmasi tidak sama dengan password baru." : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setTouched(true);
    setError(null);
    if (password.length < PASSWORD_MIN || confirm !== password) return;
    setBusy(true);
    try {
      await resetPasswordWithToken(token, password);
      setState("done");
    } catch (err) {
      // 404 = tautan sudah dipakai atau kedaluwarsa: tidak ada gunanya mencoba lagi dengan tautan ini.
      if (err instanceof ContentApiError && err.status === 404) setState("invalid");
      else setError(err instanceof Error ? err.message : "Gagal menyimpan password. Coba lagi.");
    } finally {
      setBusy(false);
    }
  };

  if (state === "done") {
    return (
      <AuthFrame title="Password diperbarui">
        <AuthNotice icon={<CheckCircle2 className="w-6 h-6" />} tone="success" title="Password baru tersimpan">
          Semua perangkat yang masih masuk dengan password lama otomatis keluar. Masuk lagi dengan password baru.
        </AuthNotice>
      </AuthFrame>
    );
  }

  if (state === "invalid") {
    return (
      <AuthFrame title="Reset password">
        <AuthNotice icon={<Link2Off className="w-6 h-6" />} tone="danger" title="Tautan tidak berlaku">
          Tautan reset hanya bisa dipakai sekali dan berlaku 60 menit. Minta admin membuat tautan baru.
        </AuthNotice>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Reset password" subtitle="Buat password baru untuk akun dashboard Anda.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <PasswordField
          label="Password baru"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          maxLength={200}
          disabled={busy}
          autoFocus
          hint={`Minimal ${PASSWORD_MIN} karakter.`}
          error={passwordError}
        />
        <PasswordField
          label="Ulangi password baru"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          maxLength={200}
          disabled={busy}
          error={confirmError}
        />
        <FormError message={error} />
        <button type="submit" disabled={busy || !password || !confirm} className={cn(AUTH_BUTTON_CLS, "bg-accent hover:bg-accent-hover text-on-accent")}>
          {busy ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <KeyRound className="w-[18px] h-[18px]" />}
          {busy ? "Menyimpan..." : "Simpan password"}
        </button>
      </form>
    </AuthFrame>
  );
}
