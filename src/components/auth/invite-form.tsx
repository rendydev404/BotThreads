"use client";

import React, { useState } from "react";
import { CheckCircle2, Link2Off, Loader2, UserRound } from "lucide-react";
import { ROLE_HINTS, ROLE_LABELS, acceptInvite, peekInvite } from "@/lib/team-client";
import { cn } from "@/lib/utils";
import { hardNavigate } from "@/components/layout/session-nav";
import { FormError, PasswordField, TextField } from "@/components/settings/fields";
import { useRemote } from "@/components/settings/use-remote";
import { AUTH_BUTTON_CLS, AuthFrame, AuthNotice, AuthSkeleton } from "./auth-frame";
import { GoogleButton } from "./google-button";

const PASSWORD_MIN = 10;
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** Usulan username dari bagian depan email ("Rendy.Dev@x.id" -> "rendy.dev"). */
const suggestUsername = (email: string): string =>
  email
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+/, "")
    .slice(0, 32);

function NewAccountForm({ token, email }: { token: string; email: string }) {
  const [username, setUsername] = useState(() => suggestUsername(email));
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanUsername = username.trim().toLowerCase();
  const usernameError = touched && !USERNAME.test(cleanUsername) ? "3-32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung." : null;
  const passwordError = touched && password.length < PASSWORD_MIN ? `Password minimal ${PASSWORD_MIN} karakter.` : null;
  const confirmError = touched && confirm !== password ? "Konfirmasi tidak sama dengan password." : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setTouched(true);
    setError(null);
    if (!USERNAME.test(cleanUsername) || password.length < PASSWORD_MIN || confirm !== password) return;
    setBusy(true);
    try {
      await acceptInvite({ token, username: cleanUsername, name: name.trim() || undefined, password });
      // Sesi sudah dipasang server: muat penuh supaya seluruh state klien bersih.
      hardNavigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menerima undangan. Coba lagi.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <TextField
        label="Username"
        value={username}
        onChange={setUsername}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={32}
        disabled={busy}
        hint="Dipakai untuk masuk, selain email Anda."
        error={usernameError}
      />
      <TextField label="Nama (opsional)" value={name} onChange={setName} autoComplete="name" maxLength={80} disabled={busy} />
      <PasswordField
        label="Password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        maxLength={200}
        disabled={busy}
        hint={`Minimal ${PASSWORD_MIN} karakter.`}
        error={passwordError}
      />
      <PasswordField
        label="Ulangi password"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        maxLength={200}
        disabled={busy}
        error={confirmError}
      />
      <FormError message={error} />
      <button type="submit" disabled={busy || !username || !password || !confirm} className={cn(AUTH_BUTTON_CLS, "bg-accent hover:bg-accent-hover text-on-accent")}>
        {busy ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <UserRound className="w-[18px] h-[18px]" />}
        {busy ? "Membuat akun..." : "Buat akun dan masuk"}
      </button>
    </form>
  );
}

/** Email yang diundang sudah punya akun: cukup konfirmasi, lalu masuk seperti biasa. */
function ExistingAccountPanel({ token, onDone }: { token: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await acceptInvite({ token });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menerima undangan. Coba lagi.");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted leading-relaxed">
        Email ini sudah punya akun dashboard. Terima undangan untuk menambahkan akses workspace ke akun itu, lalu masuk
        seperti biasa.
      </p>
      <FormError message={error} />
      <button type="button" onClick={accept} disabled={busy} className={cn(AUTH_BUTTON_CLS, "bg-accent hover:bg-accent-hover text-on-accent")}>
        {busy ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <CheckCircle2 className="w-[18px] h-[18px]" />}
        {busy ? "Memproses..." : "Terima undangan"}
      </button>
    </div>
  );
}

export function InviteForm({ token }: { token: string }) {
  const { data, error, loading } = useRemote(token, () => peekInvite(token), "Gagal memuat undangan. Periksa koneksi Anda.");
  const [accepted, setAccepted] = useState(false);
  const invite = data?.invite;

  if (accepted) {
    return (
      <AuthFrame title="Undangan diterima">
        <AuthNotice icon={<CheckCircle2 className="w-6 h-6" />} tone="success" title="Akses ditambahkan">
          Masuk dengan akun Anda yang sudah ada untuk membuka workspace {invite?.workspace}.
        </AuthNotice>
      </AuthFrame>
    );
  }

  if (loading) {
    return (
      <AuthFrame title="Undangan bergabung">
        <AuthSkeleton label="Memuat undangan" />
      </AuthFrame>
    );
  }

  if (!invite) {
    return (
      <AuthFrame title="Undangan bergabung">
        <AuthNotice icon={<Link2Off className="w-6 h-6" />} tone="danger" title="Undangan tidak bisa dibuka">
          {error ?? "Tautan undangan tidak berlaku lagi. Minta admin mengirim undangan baru."}
        </AuthNotice>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title="Undangan bergabung"
      subtitle={
        <>
          Anda diundang ke <span className="font-semibold text-fg">{invite.workspace}</span> sebagai{" "}
          <span className="font-semibold text-fg">{ROLE_LABELS[invite.role]}</span>.
        </>
      }
    >
      <div className="mb-5 rounded-xl bg-subtle px-3.5 py-3 text-xs text-muted leading-relaxed">
        <p className="font-semibold text-fg break-all">{invite.email}</p>
        <p className="mt-0.5">{ROLE_HINTS[invite.role]}</p>
      </div>

      {invite.hasAccount ? (
        <ExistingAccountPanel token={token} onDone={() => setAccepted(true)} />
      ) : (
        <>
          <NewAccountForm token={token} email={invite.email} />
          {data?.google && (
            <>
              <div className="my-4 flex items-center gap-3 text-xs text-faint" aria-hidden="true">
                <span className="h-px flex-1 bg-line" />
                atau
                <span className="h-px flex-1 bg-line" />
              </div>
              {/* Tautan biasa: server mengalihkan ke Google; undangan hanya diterima bila emailnya sama. */}
              <GoogleButton href={`/api/auth/google?invite=${encodeURIComponent(token)}`}>Lanjutkan dengan Google</GoogleButton>
            </>
          )}
        </>
      )}
    </AuthFrame>
  );
}
