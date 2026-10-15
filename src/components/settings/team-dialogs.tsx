"use client";

import React, { useId, useMemo, useState } from "react";
import { Loader2, Save, Send } from "lucide-react";
import type { PublishAccountDTO } from "@/lib/content-types";
import { ROLE_HINTS, ROLE_LABELS, inviteMember, updateMember, type InviteRow, type MemberRow, type Role } from "@/lib/team-client";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { Dropdown, type DropdownOption } from "@/components/autopilot/dropdown";
import { Banner } from "@/components/autopilot/shared";
import { AccountScopeField } from "./account-scope-field";
import { ControlLabel, FormError, TextField } from "./fields";
import { errorDetails, errorText } from "./format";

type InviteRole = Exclude<Role, "OWNER">;

const INVITE_ROLES: InviteRole[] = ["ADMIN", "EDITOR", "VIEWER"];
const ALL_ROLES: Role[] = ["OWNER", "ADMIN", "EDITOR", "VIEWER"];
/** Pola yang sama dengan validasi server (team-service.ts). */
const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[^\s@<>]{2,24}$/;
const EMPTY_SCOPE = "Pilih minimal satu akun, atau gunakan Semua akun.";

const roleOptions = <R extends Role>(roles: R[]): DropdownOption<R>[] =>
  roles.map((r) => ({ value: r, label: ROLE_LABELS[r], hint: ROLE_HINTS[r] }));

export const memberName = (m: { name: string | null; username: string }): string => m.name?.trim() || m.username;

/** Daftar akun untuk pemilih lingkup (dari `usePublishAccounts`). */
export interface AccountsState {
  accounts: PublishAccountDTO[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

interface Failure {
  message: string;
  details?: string[];
}

/* ------------------------------------------------------------------ undang anggota */

export interface InviteResult {
  email: string;
  path: string;
  expiresAt: string;
  /** Baris undangan yang baru dibuat (menggantikan undangan lama untuk email yang sama). */
  invite: InviteRow;
}

interface InviteDialogProps {
  accounts: AccountsState;
  /** Email anggota yang sudah ada (huruf kecil), untuk peringatan dini. */
  memberEmails: Set<string>;
  onClose: () => void;
  onInvited: (result: InviteResult) => void;
}

export function InviteDialog({ accounts, memberEmails, onClose, onInvited }: InviteDialogProps) {
  const [email, setEmail] = useState("");
  // Bawaan peran terendah: akses lebih tinggi harus dipilih dengan sadar.
  const [role, setRole] = useState<InviteRole>("VIEWER");
  const [scope, setScope] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const formId = useId();

  const address = email.trim().toLowerCase();
  const emailError = EMAIL.test(address) ? null : "Alamat email tidak valid.";
  const scopeError = scope !== null && scope.length === 0 ? EMPTY_SCOPE : null;

  const submit = async () => {
    setSubmitted(true);
    if (busy || emailError || scopeError) return;
    setBusy(true);
    setFailure(null);
    try {
      const res = await inviteMember({ email: address, role, accountIds: scope });
      onInvited({ email: address, path: res.path, expiresAt: res.expiresAt, invite: res.invite });
    } catch (e) {
      setFailure({ message: errorText(e, "Gagal membuat undangan. Coba lagi."), details: errorDetails(e) });
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      busy={busy}
      title="Undang anggota"
      description="Dashboard membuat tautan undangan; Anda yang mengirimkannya ke orangnya."
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            Batal
          </ModalButton>
          <ModalButton variant="primary" type="submit" form={formId} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {busy ? "Membuat..." : "Buat tautan undangan"}
          </ModalButton>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-5"
      >
        <TextField
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          data-autofocus
          value={email}
          onChange={(v) => {
            setEmail(v);
            setFailure(null);
          }}
          maxLength={254}
          placeholder="nama@contoh.com"
          error={submitted ? emailError : null}
          hint={
            memberEmails.has(address)
              ? "Email ini sudah menjadi anggota workspace. Ubah aksesnya dari daftar anggota."
              : "Undangan lama yang belum diterima untuk email yang sama otomatis diganti."
          }
          disabled={busy}
        />

        <div>
          <ControlLabel>Peran</ControlLabel>
          <Dropdown ariaLabel="Peran" value={role} options={roleOptions(INVITE_ROLES)} onChange={setRole} disabled={busy} />
          <p className="mt-1.5 text-xs text-muted leading-relaxed">{ROLE_HINTS[role]}</p>
        </div>

        <AccountScopeField
          accounts={accounts.accounts}
          loading={accounts.loading}
          error={accounts.error}
          onRetry={accounts.reload}
          value={scope}
          onChange={setScope}
          disabled={busy}
          invalid={submitted ? scopeError : null}
        />

        <FormError message={failure?.message} details={failure?.details} />
      </form>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ ubah peran dan lingkup */

const sameScope = (a: string[] | null, b: string[] | null): boolean =>
  a === null || b === null ? a === b : a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

interface MemberDialogProps {
  member: MemberRow;
  /** Peran pengubah menurut server (hanya Pemilik yang boleh memberi peran Pemilik). */
  myRole: Role;
  isSelf: boolean;
  accounts: AccountsState;
  onClose: () => void;
  onSaved: (next: { role: Role; accountIds: string[] | null }) => void;
}

export function MemberDialog({ member, myRole, isSelf, accounts, onClose, onSaved }: MemberDialogProps) {
  const original = member.accountScope === "PILIHAN" ? member.accountIds : null;
  const [role, setRole] = useState<Role>(member.role);
  const [scope, setScope] = useState<string[] | null>(original);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const formId = useId();

  // Akun di luar lingkup pengubah tidak bisa dikirim (server menolaknya), jadi dilepas saat disimpan.
  const known = useMemo(() => new Set(accounts.accounts.map((a) => a.id)), [accounts.accounts]);
  const ready = !accounts.loading && !accounts.error;
  const visible = (ids: string[] | null): string[] | null => (ids !== null && ready ? ids.filter((id) => known.has(id)) : ids);
  const visibleScope = visible(scope);
  const hidden = (scope?.length ?? 0) - (visibleScope?.length ?? 0);

  const effective = role === "OWNER" ? null : visibleScope;
  const scopeError = effective !== null && effective.length === 0 ? EMPTY_SCOPE : null;
  const changed = role !== member.role || !sameScope(effective, visible(original));
  const name = memberName(member);

  const submit = async () => {
    setSubmitted(true);
    if (busy || scopeError) return;
    if (!changed) {
      onClose();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await updateMember(member.id, { role, accountIds: effective });
      onSaved({ role, accountIds: effective });
    } catch (e) {
      // Aturan server (Admin tidak boleh mengatur Pemilik, Pemilik terakhir, dst.) tampil apa adanya.
      setFailure({ message: errorText(e, "Gagal menyimpan akses anggota. Coba lagi."), details: errorDetails(e) });
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      busy={busy}
      title="Ubah akses anggota"
      description={member.email ? `${name} · ${member.email}` : name}
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
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-5"
      >
        {isSelf && (
          <Banner tone="warning">
            Ini akses Anda sendiri. Menurunkan peran atau mempersempit akun bisa membuat Anda tidak lagi bisa membuka halaman ini.
          </Banner>
        )}

        <div>
          <ControlLabel>Peran</ControlLabel>
          <Dropdown
            ariaLabel="Peran"
            value={role}
            options={roleOptions(myRole === "OWNER" ? ALL_ROLES : INVITE_ROLES)}
            onChange={(next) => {
              setRole(next);
              setFailure(null);
            }}
            disabled={busy}
          />
          <p className="mt-1.5 text-xs text-muted leading-relaxed">{ROLE_HINTS[role]}</p>
        </div>

        {role === "OWNER" ? (
          <div>
            <ControlLabel>Akses akun</ControlLabel>
            <p className="text-[13px] text-muted">Pemilik selalu melihat dan mengelola semua akun.</p>
          </div>
        ) : (
          <AccountScopeField
            accounts={accounts.accounts}
            loading={accounts.loading}
            error={accounts.error}
            onRetry={accounts.reload}
            value={visibleScope}
            onChange={(next) => {
              setScope(next);
              setFailure(null);
            }}
            disabled={busy}
            invalid={submitted ? scopeError : null}
          />
        )}

        {hidden > 0 && role !== "OWNER" && (
          <Banner tone="info">
            {hidden} akun dalam lingkup anggota ini berada di luar akses Anda. Akun itu dilepas dari lingkupnya bila perubahan disimpan.
          </Banner>
        )}

        <FormError message={failure?.message} details={failure?.details} />
      </form>
    </ModalShell>
  );
}
