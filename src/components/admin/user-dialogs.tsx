"use client";

import React, { useId, useState } from "react";
import { Check, Copy, Loader2, RefreshCw, Save, ShieldCheck, UserPlus } from "lucide-react";
import { createAdminUser, fetchAdminRoles, setUserPlatformRole, updateAdminUser, grantSuperAdmin, revokeSuperAdmin } from "@/lib/admin-client";
import type { AdminRoleDTO, AdminRolesResponse } from "@/lib/admin-perms";
import type { AdminUserDTO } from "@/lib/admin-types";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { Dropdown, type DropdownOption } from "@/components/autopilot/dropdown";
import { ControlLabel, FormError, TextField } from "@/components/settings/fields";
import { errorDetails, errorText } from "@/components/settings/format";
import { memberName } from "@/components/settings/team-dialogs";
import { useRemote } from "@/components/settings/use-remote";
import { useAdmin } from "./shared";

const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[^\s@<>]{2,24}$/;
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const PASSWORD_MIN = 10;
const NO_ROLE = "__none__";

interface Failure {
  message: string;
  details?: string[];
}

/** Password acak 16 karakter (huruf, angka) dari generator kriptografis peramban. */
function randomPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/** Pilihan peran admin: dari sql/014 bila terpasang, selain itu hanya Super Admin. */
function useRoleOptions(enabled: boolean) {
  const { guard } = useAdmin();
  const roles = useRemote<AdminRolesResponse>(enabled ? "peran-pilihan" : null, (signal) => guard(fetchAdminRoles(signal)), "Gagal memuat daftar peran.");
  const options: DropdownOption<string>[] = [
    { value: NO_ROLE, label: "Bukan staf admin", hint: "Pengguna biasa: hanya dashboard workspace" },
    ...(roles.data?.roles ?? []).map((r: AdminRoleDTO) => ({ value: r.id, label: r.nama, hint: r.deskripsi ?? undefined })),
  ];
  return { options, loading: roles.loading, error: roles.error, installed: roles.data?.installed ?? true };
}

/* ------------------------------------------------------------------ buat pengguna */

export function CreateUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (username: string) => void }) {
  const { guard, isSuper } = useAdmin();
  const formId = useId();
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(randomPassword);
  const [role, setRole] = useState(NO_ROLE);
  const [copied, setCopied] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const roles = useRoleOptions(isSuper);

  const u = username.trim().toLowerCase();
  const e = email.trim().toLowerCase();
  const errors = {
    username: USERNAME.test(u) ? null : "3-32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung.",
    email: !e || EMAIL.test(e) ? null : "Alamat email tidak valid.",
    password: password.length >= PASSWORD_MIN ? null : `Minimal ${PASSWORD_MIN} karakter.`,
  };
  const invalid = Object.values(errors).some(Boolean);

  const submit = async () => {
    setSubmitted(true);
    if (busy || invalid) return;
    setBusy(true);
    setFailure(null);
    try {
      await guard(createAdminUser({ username: u, email: e || null, name: name.trim() || null, password, role: role === NO_ROLE ? null : role }));
      onCreated(u);
    } catch (err) {
      setFailure({ message: errorText(err, "Gagal membuat akun. Coba lagi."), details: errorDetails(err) });
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* papan klip ditolak peramban: password tetap terlihat untuk disalin manual */
    }
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      busy={busy}
      title="Buat akun pengguna"
      description="Akun langsung aktif. Tambahkan ke workspace lewat modul Workspace, atau biarkan ia membuat workspace sendiri."
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            Batal
          </ModalButton>
          <ModalButton variant="primary" type="submit" form={formId} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            {busy ? "Membuat..." : "Buat akun"}
          </ModalButton>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          void submit();
        }}
        className="space-y-4"
      >
        <TextField
          label="Username"
          data-autofocus
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={setUsername}
          maxLength={32}
          placeholder="contoh: budi.santoso"
          error={submitted ? errors.username : null}
          hint="Dipakai untuk masuk. Huruf kecil, tanpa spasi."
          disabled={busy}
        />
        <div className="grid sm:grid-cols-2 gap-4">
          <TextField label="Nama (opsional)" value={name} onChange={setName} maxLength={80} placeholder="Budi Santoso" disabled={busy} />
          <TextField
            label="Email (opsional)"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={setEmail}
            maxLength={254}
            placeholder="budi@contoh.com"
            error={submitted ? errors.email : null}
            disabled={busy}
          />
        </div>
        <div>
          <ControlLabel hint="Berikan ke pengguna lewat saluran aman. Ia bisa menggantinya setelah masuk.">Password awal</ControlLabel>
          <div className="flex items-center gap-2">
            <input
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              aria-label="Password awal"
              autoComplete="new-password"
              spellCheck={false}
              maxLength={200}
              disabled={busy}
              className="flex-1 min-w-0 h-11 px-3.5 rounded-xl border border-line-strong bg-surface font-mono text-sm text-fg outline-none focus:border-accent focus:ring-4 focus:ring-accent/15"
            />
            <button type="button" onClick={() => setPassword(randomPassword())} disabled={busy} aria-label="Buat password acak" title="Buat password acak" className="w-11 h-11 rounded-xl border border-line-strong inline-flex items-center justify-center text-muted hover:text-fg cursor-pointer">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => void copy()} aria-label="Salin password" title="Salin password" className="w-11 h-11 rounded-xl border border-line-strong inline-flex items-center justify-center text-muted hover:text-fg cursor-pointer">
              {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          {submitted && errors.password && <p className="mt-1.5 text-xs font-medium text-danger">{errors.password}</p>}
        </div>
        {isSuper && (
          <div>
            <ControlLabel hint="Kosongkan untuk pengguna biasa. Peran bisa diubah kapan saja.">Peran admin platform</ControlLabel>
            <Dropdown ariaLabel="Peran admin platform" value={role} options={roles.options} onChange={setRole} disabled={busy || roles.loading} className="w-full" buttonClassName="w-full" />
          </div>
        )}
        <FormError message={failure?.message} details={failure?.details} />
      </form>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ ubah profil */

export function EditUserDialog({ user, onClose, onSaved }: { user: AdminUserDTO; onClose: () => void; onSaved: (next: { name: string | null; email: string | null }) => void }) {
  const { guard } = useAdmin();
  const formId = useId();
  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const e = email.trim().toLowerCase();
  const emailError = !e || EMAIL.test(e) ? null : "Alamat email tidak valid.";
  const next = { name: name.trim() || null, email: e || null };
  const changed = next.name !== (user.name ?? null) || next.email !== (user.email ?? null);

  const submit = async () => {
    setSubmitted(true);
    if (busy || emailError || !changed) return;
    setBusy(true);
    setFailure(null);
    try {
      await guard(updateAdminUser(user.id, next));
      onSaved(next);
    } catch (err) {
      setFailure({ message: errorText(err, "Gagal menyimpan profil. Coba lagi.") });
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      busy={busy}
      title={`Ubah profil ${memberName(user)}`}
      description={`@${user.username} · username tidak bisa diubah.`}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            Batal
          </ModalButton>
          <ModalButton variant="primary" type="submit" form={formId} disabled={busy || !changed}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {busy ? "Menyimpan..." : "Simpan"}
          </ModalButton>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          void submit();
        }}
        className="space-y-4"
      >
        <TextField label="Nama" data-autofocus value={name} onChange={setName} maxLength={80} disabled={busy} />
        <TextField
          label="Email"
          type="email"
          inputMode="email"
          value={email}
          onChange={setEmail}
          maxLength={254}
          error={submitted ? emailError : null}
          hint="Dipakai untuk undangan dan masuk dengan Google."
          disabled={busy}
        />
        <FormError message={failure?.message} />
      </form>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ peran admin */

export function RoleDialog({ user, onClose, onSaved }: { user: AdminUserDTO; onClose: () => void; onSaved: (role: { id: string | null; nama: string | null }) => void }) {
  const { guard } = useAdmin();
  const roles = useRoleOptions(true);
  const current = user.platformRole ?? (user.superadmin ? "SUPERADMIN" : null);
  const [role, setRole] = useState(current ?? NO_ROLE);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const picked = role === NO_ROLE ? null : role;

  const submit = async () => {
    if (busy || picked === current) return;
    setBusy(true);
    setFailure(null);
    try {
      if (roles.installed) await guard(setUserPlatformRole(user.id, picked));
      // Sebelum sql/014 hanya ada Super Admin: pakai tindakan lama.
      else await guard(picked === "SUPERADMIN" ? grantSuperAdmin(user.id) : revokeSuperAdmin(user.id));
      onSaved({ id: picked, nama: roles.options.find((o) => o.value === role)?.label ?? null });
    } catch (err) {
      setFailure(errorText(err, "Gagal mengubah peran. Coba lagi."));
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      busy={busy}
      title={`Peran admin ${memberName(user)}`}
      description="Peran menentukan modul konsol yang bisa ia buka dan ubah. Keanggotaan workspace-nya tidak berubah."
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            Batal
          </ModalButton>
          <ModalButton variant="primary" onClick={() => void submit()} disabled={busy || picked === current || roles.loading}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            {busy ? "Menyimpan..." : "Simpan peran"}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        <Dropdown ariaLabel="Peran admin" value={role} options={roles.options} onChange={setRole} disabled={busy || roles.loading} className="w-full" buttonClassName="w-full" />
        {!roles.installed && (
          <p className="text-xs text-muted leading-relaxed">
            Peran selain Super Admin tersedia setelah <code className="font-mono">sql/014_admin_rbac.sql</code> dipasang.
          </p>
        )}
        {picked === "SUPERADMIN" && current !== "SUPERADMIN" && (
          <p className="rounded-xl bg-warning-soft text-warning p-3 text-[13px] font-medium leading-relaxed">
            Super Admin memegang semua izin, termasuk mengatur peran admin lain dan mencabut peran Anda.
          </p>
        )}
        <FormError message={failure ?? roles.error} />
      </div>
    </ModalShell>
  );
}
