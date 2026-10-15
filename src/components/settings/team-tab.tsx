"use client";

import React, { useLayoutEffect, useMemo, useState } from "react";
import { ChevronDown, KeyRound, Mail, MailX, UserCog, UserMinus, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PublishAccountDTO } from "@/lib/content-types";
import { formatWibFull } from "@/lib/scheduling";
import {
  ROLE_HINTS,
  ROLE_LABELS,
  createResetLink,
  removeMember,
  revokeInvite,
  type InviteRow,
  type MemberRow,
  type Role,
  type TeamResponse,
} from "@/lib/team-client";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { usePublishAccounts } from "@/components/content/use-publish-accounts";
import { ConfirmModal } from "@/components/autopilot/confirm-modal";
import { Banner, ListSkeleton, accountHandle, durationText } from "@/components/autopilot/shared";
import { errorText, formatDateWib } from "./format";
import { OneTimeLinkModal, type OneTimeLink } from "./one-time-link-modal";
import { BTN_PRIMARY, ICON_BTN, LoadError, Pill, RefreshButton, type PillTone } from "./states";
import { InviteDialog, MemberDialog, memberName } from "./team-dialogs";
import type { useRemote } from "./use-remote";

export type TeamRemote = ReturnType<typeof useRemote<TeamResponse>>;

const LOAD_ERROR = "Gagal memuat tim.";
const ROLE_ORDER: Role[] = ["OWNER", "ADMIN", "EDITOR", "VIEWER"];
const ROLE_TONE: Record<Role, PillTone> = { OWNER: "solid", ADMIN: "accent", EDITOR: "success", VIEWER: "neutral" };

/** Tindakan yang menunggu konfirmasi. */
type Pending = { kind: "remove"; member: MemberRow } | { kind: "reset"; member: MemberRow } | { kind: "revoke"; invite: InviteRow };

/** "Semua akun" atau "3 akun: @a, @b +1 lainnya". */
function scopeText(all: boolean, ids: string[], byId: Map<string, PublishAccountDTO>): string {
  if (all) return "Semua akun";
  const names = ids.flatMap((id) => {
    const a = byId.get(id);
    return a ? [accountHandle(a)] : [];
  });
  if (names.length === 0) return `${ids.length} akun`;
  const rest = ids.length - Math.min(2, names.length);
  return `${ids.length} akun: ${names.slice(0, 2).join(", ")}${rest > 0 ? ` +${rest} lainnya` : ""}`;
}

interface TeamTabProps {
  /** Data tim dimuat di halaman karena tab Audit ikut memakainya untuk nama anggota. */
  team: TeamRemote;
  /** Akses pengguna sendiri berubah: profil (peran) perlu dimuat ulang. */
  onSelfChanged: () => void;
}

/** Tab Tim: anggota beserta peran dan lingkup akunnya, undangan yang menunggu, dan tautan sekali tampil. */
export function TeamTab({ team, onSelfChanged }: TeamTabProps) {
  const { data, error, status, loading, refreshing, reload, mutate } = team;
  const accounts = usePublishAccounts();
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [link, setLink] = useState<OneTimeLink | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Tab atau halaman yang disembunyikan (Activity) tidak boleh kembali dengan dialog terbuka; tautan
  // sekali tampil juga tidak boleh tertinggal di memori.
  useLayoutEffect(
    () => () => {
      setInviting(false);
      setEditing(null);
      setPending(null);
      setLink(null);
      setNotice(null);
    },
    []
  );

  const byId = useMemo(() => new Map(accounts.accounts.map((a) => [a.id, a])), [accounts.accounts]);
  const memberEmails = useMemo(
    () => new Set((data?.members ?? []).flatMap((m) => (m.email ? [m.email.toLowerCase()] : []))),
    [data?.members]
  );

  if (loading || (!data && !error)) return <ListSkeleton label="Memuat tim" rows={4} />;
  if (!data) return <LoadError message={error ?? LOAD_ERROR} status={status} onRetry={reload} />;

  const me = data.me;

  /** Tautan lengkap hanya dirakit di sini dan hanya disimpan di state dialog. */
  const showLink = (kind: OneTimeLink["kind"], who: string, res: { path: string; expiresAt: string }) =>
    setLink({
      kind,
      who,
      url: `${window.location.origin}${res.path}`,
      expiresAt: res.expiresAt,
      // Dibulatkan ke menit terdekat supaya "72 jam" tidak menjadi "71 jam 59 menit" karena jeda jaringan.
      ttl: durationText(Date.parse(res.expiresAt) - Date.now() + 30_000),
    });

  const openPending = (next: Pending) => {
    setPendingError(null);
    setPending(next);
  };

  const runPending = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setPendingError(null);
    try {
      if (pending.kind === "remove") {
        const { member } = pending;
        await removeMember(member.id);
        mutate((d) => ({ ...d, members: d.members.filter((m) => m.id !== member.id) }));
        setNotice(`${memberName(member)} dikeluarkan dari workspace.`);
      } else if (pending.kind === "revoke") {
        const { invite } = pending;
        await revokeInvite(invite.id);
        mutate((d) => ({ ...d, invites: d.invites.filter((i) => i.id !== invite.id) }));
        setNotice(`Undangan untuk ${invite.email} dicabut.`);
      } else {
        const res = await createResetLink(pending.member.id);
        showLink("reset", memberName(pending.member), res);
      }
      setPending(null);
    } catch (e) {
      // Pesan server (mis. "Workspace harus punya minimal satu Pemilik aktif.") ditampilkan apa adanya.
      setPendingError(errorText(e, "Tindakan gagal. Coba lagi."));
    } finally {
      setBusy(false);
    }
  };

  const confirmCopy =
    pending?.kind === "remove"
      ? {
          title: `Keluarkan ${memberName(pending.member)}?`,
          body: "Aksesnya ke workspace ini langsung dicabut. Akun penggunanya tidak dihapus dan bisa diundang lagi kapan saja.",
          label: "Ya, keluarkan",
          icon: <UserMinus className="w-4 h-4" />,
          danger: true,
        }
      : pending?.kind === "reset"
        ? {
            title: "Buat tautan reset password?",
            body: `Tautan untuk ${memberName(pending.member)} sekali pakai, cepat kedaluwarsa, dan hanya ditampilkan sekali. Password lamanya tetap berlaku sampai tautan dipakai.`,
            label: "Buat tautan",
            icon: <KeyRound className="w-4 h-4" />,
            danger: false,
          }
        : pending?.kind === "revoke"
          ? {
              title: "Cabut undangan ini?",
              body: `Tautan undangan untuk ${pending.invite.email} langsung tidak berlaku.`,
              label: "Ya, cabut",
              icon: <MailX className="w-4 h-4" />,
              danger: true,
            }
          : null;

  return (
    <div className="space-y-6">
      {(error || notice) && (
        <div className="space-y-3">
          {error && (
            <Banner tone="danger">
              Gagal menyegarkan data: {error}{" "}
              <button type="button" onClick={reload} className="underline font-semibold cursor-pointer">
                Coba lagi
              </button>
            </Banner>
          )}
          {notice && (
            <Banner tone="success" onClose={() => setNotice(null)}>
              {notice}
            </Banner>
          )}
        </div>
      )}

      <section aria-label="Anggota" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-fg">
            Anggota <span className="font-semibold text-muted tabular-nums">({data.members.length})</span>
          </h3>
          <div className="flex items-center gap-2 ml-auto">
            <RefreshButton onClick={reload} busy={refreshing} />
            <button type="button" onClick={() => setInviting(true)} className={BTN_PRIMARY}>
              <UserPlus className="w-4 h-4" />
              Undang
            </button>
          </div>
        </div>

        <ul className="card divide-y divide-line">
          {data.members.map((m) => {
            const name = memberName(m);
            const isSelf = m.id === me.userId;
            // Sama dengan aturan server: hanya Pemilik yang boleh mengatur Pemilik.
            const manageable = me.role === "OWNER" || m.role !== "OWNER";
            return (
              <li key={m.id} className="p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <AccountAvatar name={name} size="w-9 h-9" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-fg break-words min-w-0">{name}</span>
                      <Pill tone={ROLE_TONE[m.role]}>{ROLE_LABELS[m.role]}</Pill>
                      {isSelf && <Pill>Anda</Pill>}
                      {!m.isActive && <Pill tone="danger">Nonaktif</Pill>}
                    </div>
                    <p className="text-xs text-muted break-all">
                      @{m.username}
                      {m.email ? ` · ${m.email}` : ""}
                    </p>
                    <p className="text-xs text-muted">
                      {scopeText(m.accountScope === "SEMUA", m.accountIds, byId)}
                      {" · "}
                      {m.lastLoginAt ? `Terakhir masuk ${formatDateWib(m.lastLoginAt)}` : "Belum pernah masuk"}
                      {m.google ? " · Masuk dengan Google" : ""}
                    </p>
                  </div>
                </div>

                {manageable ? (
                  <div className="flex items-center justify-end gap-1 shrink-0 -mr-2 -mb-2 sm:m-0">
                    <button
                      type="button"
                      onClick={() => setEditing(m)}
                      aria-label={`Ubah akses ${name}`}
                      className={cn(
                        ICON_BTN,
                        "gap-1.5 sm:w-auto sm:px-3.5 sm:rounded-full sm:border sm:border-line-strong sm:text-[13px] sm:font-semibold sm:text-fg sm:hover:border-accent sm:hover:text-accent sm:hover:bg-transparent"
                      )}
                    >
                      <UserCog className="w-[18px] h-[18px] sm:w-4 sm:h-4" />
                      <span className="max-sm:sr-only">Ubah akses</span>
                    </button>
                    {!isSelf && (
                      <>
                        <button
                          type="button"
                          onClick={() => openPending({ kind: "reset", member: m })}
                          aria-label={`Buat tautan reset password untuk ${name}`}
                          title="Buat tautan reset password"
                          className={ICON_BTN}
                        >
                          <KeyRound className="w-[18px] h-[18px]" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openPending({ kind: "remove", member: m })}
                          aria-label={`Keluarkan ${name}`}
                          title="Keluarkan dari workspace"
                          className={cn(ICON_BTN, "hover:text-danger hover:bg-danger-soft")}
                        >
                          <UserMinus className="w-[18px] h-[18px]" />
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-faint sm:max-w-[11rem] sm:text-right">Hanya Pemilik yang bisa mengatur Pemilik.</p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Undangan menunggu" className="space-y-3">
        <h3 className="text-base font-bold text-fg">
          Undangan menunggu <span className="font-semibold text-muted tabular-nums">({data.invites.length})</span>
        </h3>
        {data.invites.length === 0 ? (
          <div className="card p-6 text-center">
            <p className="text-sm font-semibold text-fg">Tidak ada undangan yang menunggu.</p>
            <p className="mt-1 text-sm text-muted">Undang anggota lewat email; tautannya Anda kirim sendiri ke orangnya.</p>
          </div>
        ) : (
          <ul className="card divide-y divide-line">
            {data.invites.map((inv) => (
              <li key={inv.id} className="p-4 flex items-start gap-3">
                <span className="w-9 h-9 rounded-full bg-subtle text-muted flex items-center justify-center shrink-0" aria-hidden>
                  <Mail className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold text-fg break-all min-w-0">{inv.email}</span>
                    <Pill tone={ROLE_TONE[inv.role]}>{ROLE_LABELS[inv.role]}</Pill>
                    {inv.expired && <Pill tone="danger">Kedaluwarsa</Pill>}
                  </div>
                  <p className="text-xs text-muted">
                    {scopeText(inv.accountIds.length === 0, inv.accountIds, byId)}
                    {" · "}
                    {inv.expired ? "Tautan tidak berlaku lagi" : `Berlaku sampai ${formatWibFull(new Date(inv.expiresAt))}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openPending({ kind: "revoke", invite: inv })}
                  aria-label={`Cabut undangan untuk ${inv.email}`}
                  title="Cabut undangan"
                  className={cn(ICON_BTN, "-mr-2 -mt-1 hover:text-danger hover:bg-danger-soft")}
                >
                  <MailX className="w-[18px] h-[18px]" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="card group">
        <summary className="min-h-12 px-4 flex items-center justify-between gap-3 text-sm font-semibold text-fg cursor-pointer rounded-2xl list-none [&::-webkit-details-marker]:hidden">
          Apa beda tiap peran?
          <ChevronDown className="w-4 h-4 text-muted shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <dl className="px-4 pb-4 space-y-2.5">
          {ROLE_ORDER.map((r) => (
            <div key={r} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
              <dt className="sm:w-24 shrink-0">
                <Pill tone={ROLE_TONE[r]}>{ROLE_LABELS[r]}</Pill>
              </dt>
              <dd className="text-[13px] text-muted leading-relaxed">{ROLE_HINTS[r]}</dd>
            </div>
          ))}
        </dl>
      </details>

      {inviting && (
        <InviteDialog
          accounts={accounts}
          memberEmails={memberEmails}
          onClose={() => setInviting(false)}
          onInvited={(res) => {
            setInviting(false);
            showLink("invite", res.email, res);
            // Server mengganti undangan lama untuk email yang sama; daftar lokal mengikuti tanpa fetch ulang.
            mutate((d) => ({ ...d, invites: [res.invite, ...d.invites.filter((i) => i.email !== res.invite.email)] }));
          }}
        />
      )}

      {editing && (
        <MemberDialog
          key={editing.id}
          member={editing}
          myRole={me.role}
          isSelf={editing.id === me.userId}
          accounts={accounts}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            const target = editing;
            mutate((d) => ({
              ...d,
              me: target.id === d.me.userId ? { ...d.me, role: next.role } : d.me,
              members: d.members.map((m) =>
                m.id === target.id
                  ? { ...m, role: next.role, accountScope: next.accountIds === null ? "SEMUA" : "PILIHAN", accountIds: next.accountIds ?? [] }
                  : m
              ),
            }));
            setNotice(`Akses ${memberName(target)} diperbarui.`);
            setEditing(null);
            if (target.id === me.userId) onSelfChanged();
          }}
        />
      )}

      <ConfirmModal
        open={!!confirmCopy}
        onClose={() => setPending(null)}
        onConfirm={runPending}
        busy={busy}
        error={pendingError}
        variant={confirmCopy?.danger ? "danger" : "primary"}
        title={confirmCopy?.title ?? ""}
        confirmLabel={confirmCopy?.label ?? ""}
        confirmIcon={confirmCopy?.icon}
      >
        <p className="text-sm text-fg leading-relaxed">{confirmCopy?.body}</p>
      </ConfirmModal>

      <OneTimeLinkModal link={link} onClose={() => setLink(null)} />
    </div>
  );
}
