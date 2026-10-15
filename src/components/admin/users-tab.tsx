"use client";

import React, { useLayoutEffect, useState } from "react";
import { Ban, KeyRound, LogOut, ShieldCheck, ShieldOff, UserCheck, Users } from "lucide-react";
import {
  adminResetLink,
  banUser,
  forceLogoutUser,
  grantSuperAdmin,
  listAdminUsers,
  revokeSuperAdmin,
  unbanUser,
} from "@/lib/admin-client";
import { ADMIN_USER_STATUS_LABEL, type AdminUserDTO, type AdminUserListResponse, type AdminUserStatus } from "@/lib/admin-types";
import { ROLE_LABELS } from "@/lib/team-client";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { ConfirmModal } from "@/components/autopilot/confirm-modal";
import { Banner, ListSkeleton, LoadMoreButton, durationText } from "@/components/autopilot/shared";
import { errorText, formatDateWib } from "@/components/settings/format";
import { OneTimeLinkModal, type OneTimeLink } from "@/components/settings/one-time-link-modal";
import { BTN_OUTLINE, EmptyState, Pill, RefreshButton } from "@/components/settings/states";
import { memberName } from "@/components/settings/team-dialogs";
import { usePaged } from "@/components/settings/use-remote";
import {
  ActionMenu,
  AdminLoadError,
  FilterChips,
  ReasonDialog,
  RefreshError,
  SEARCH_DEBOUNCE_MS,
  SearchField,
  useAdmin,
  useDebounced,
  type ChipOption,
  type MenuAction,
} from "./shared";

const LOAD_ERROR = "Gagal memuat daftar pengguna.";
/** Workspace yang langsung tampil per pengguna; sisanya diringkas. */
const WORKSPACES_SHOWN = 4;

type StatusFilter = "ALL" | AdminUserStatus;
const STATUS_FILTERS: ChipOption<StatusFilter>[] = [
  { value: "ALL", label: "Semua" },
  ...(["AKTIF", "DIBLOKIR", "NONAKTIF", "SUPERADMIN"] as AdminUserStatus[]).map((s) => ({ value: s, label: ADMIN_USER_STATUS_LABEL[s] })),
];

/** Tindakan yang menunggu konfirmasi (blokir punya dialog sendiri karena wajib beralasan). */
type Pending = { kind: "unban" | "grant" | "revoke" | "logout" | "reset"; user: AdminUserDTO };

interface ConfirmCopy {
  title: string;
  body: string;
  label: string;
  icon: React.ReactNode;
  danger: boolean;
}

function confirmCopy({ kind, user }: Pending, self: boolean): ConfirmCopy {
  const name = memberName(user);
  switch (kind) {
    case "unban":
      return user.bannedAt
        ? {
            title: `Buka blokir ${name}?`,
            body: "Akunnya aktif lagi dan ia bisa masuk seperti biasa. Keanggotaan workspace dan perannya tidak berubah.",
            label: "Ya, buka blokir",
            icon: <UserCheck className="w-4 h-4" />,
            danger: false,
          }
        : {
            title: `Aktifkan kembali ${name}?`,
            body: "Akunnya aktif lagi dan ia bisa masuk seperti biasa. Keanggotaan workspace dan perannya tidak berubah.",
            label: "Ya, aktifkan",
            icon: <UserCheck className="w-4 h-4" />,
            danger: false,
          };
    case "grant":
      return {
        title: `Jadikan ${name} super admin?`,
        body: "Super admin bisa melihat dan mengubah semua pengguna dan workspace di platform: memblokir pengguna, menangguhkan workspace, memindahkan sumber akun, mengubah saklar sistem, serta memberi dan mencabut peran super admin, termasuk milik Anda.",
        label: "Ya, beri peran",
        icon: <ShieldCheck className="w-4 h-4" />,
        danger: true,
      };
    case "revoke":
      return {
        title: self ? "Cabut peran super admin Anda sendiri?" : `Cabut peran super admin ${name}?`,
        body: self
          ? "Panel ini langsung tertutup untuk Anda dan hanya super admin lain yang bisa mengembalikan peran itu. Akun dan keanggotaan workspace Anda tidak berubah."
          : "Ia langsung kehilangan akses ke panel super admin. Akun dan keanggotaan workspace-nya tidak berubah.",
        label: "Ya, cabut peran",
        icon: <ShieldOff className="w-4 h-4" />,
        danger: true,
      };
    case "logout":
      return {
        title: self ? "Keluarkan akun Anda dari semua perangkat?" : `Keluarkan ${name} dari semua perangkat?`,
        body: self
          ? "Semua sesi Anda langsung berakhir, termasuk di perangkat ini, dan Anda harus masuk lagi. Password tidak berubah."
          : "Semua sesinya langsung berakhir dan ia harus masuk lagi. Password tidak berubah.",
        label: "Ya, keluarkan",
        icon: <LogOut className="w-4 h-4" />,
        danger: true,
      };
    case "reset":
      return {
        title: "Buat tautan reset password?",
        body: `Tautan untuk ${name} sekali pakai, berlaku 60 menit, dan hanya ditampilkan sekali. Password lamanya tetap berlaku sampai tautan dipakai.`,
        label: "Buat tautan",
        icon: <KeyRound className="w-4 h-4" />,
        danger: false,
      };
  }
}

/** Tab Pengguna: cari dan saring semua pengguna platform, lalu blokir, atur peran super admin, atau bantu masuk lagi. */
export function UsersTab() {
  const { guard, rev, invalidate, reloadMe } = useAdmin();
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const q = useDebounced(text, SEARCH_DEBOUNCE_MS).trim();
  const list = usePaged<AdminUserDTO, AdminUserListResponse>(
    `pengguna:${rev.pengguna}:${filter}:${q}`,
    (cursor, signal) => guard(listAdminUsers({ q, status: filter === "ALL" ? null : filter, cursor }, signal)),
    (u) => u.id,
    LOAD_ERROR
  );
  const { items, data, error, status, loading, refreshing, reload, mutate, nextCursor, loadMore, loadingMore, moreError } = list;

  const [banning, setBanning] = useState<AdminUserDTO | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [link, setLink] = useState<OneTimeLink | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Tab atau halaman yang disembunyikan (Activity) tidak boleh kembali dengan dialog terbuka; tautan
  // sekali tampil juga tidak boleh tertinggal di memori.
  useLayoutEffect(
    () => () => {
      setBanning(null);
      setPending(null);
      setLink(null);
      setNotice(null);
    },
    []
  );

  const meId = data?.me ?? null;
  const filtered = filter !== "ALL" || q !== "";

  const patch = (id: string, part: Partial<AdminUserDTO>) =>
    mutate((d) => ({ ...d, items: d.items.map((u) => (u.id === id ? { ...u, ...part } : u)) }));

  const openPending = (next: Pending) => {
    setPendingError(null);
    setPending(next);
  };

  const ban = async (user: AdminUserDTO, reason: string) => {
    await guard(banUser(user.id, reason));
    // Sama dengan server: akun dinonaktifkan dan alasannya disimpan.
    patch(user.id, { isActive: false, bannedAt: new Date().toISOString(), bannedReason: reason });
    invalidate(["ringkasan", "audit"]);
    setNotice(`${memberName(user)} diblokir. Semua sesinya sudah berakhir.`);
    setBanning(null);
  };

  const runPending = async () => {
    if (!pending || busy) return;
    const { kind, user } = pending;
    const name = memberName(user);
    setBusy(true);
    setPendingError(null);
    try {
      if (kind === "unban") {
        await guard(unbanUser(user.id));
        patch(user.id, { isActive: true, bannedAt: null, bannedReason: null });
        setNotice(`${name} aktif lagi.`);
      } else if (kind === "grant") {
        await guard(grantSuperAdmin(user.id));
        patch(user.id, { superadmin: true });
        setNotice(`${name} sekarang super admin.`);
      } else if (kind === "revoke") {
        await guard(revokeSuperAdmin(user.id));
        patch(user.id, { superadmin: false });
        setNotice(`Peran super admin ${name} dicabut.`);
        // Peran sendiri dicabut: profil dimuat ulang dan halaman menutup panelnya.
        if (user.id === meId) reloadMe();
      } else if (kind === "logout") {
        await guard(forceLogoutUser(user.id));
        if (user.id === meId) {
          // Sesi ini ikut gugur: muat ulang supaya langsung diarahkan ke halaman masuk.
          window.location.reload();
          return;
        }
        setNotice(`${name} dikeluarkan dari semua perangkat.`);
      } else {
        const res = await guard(adminResetLink(user.id));
        // Tautan lengkap hanya dirakit di sini dan hanya disimpan di state dialog.
        setLink({
          kind: "reset",
          who: name,
          url: `${window.location.origin}${res.path}`,
          expiresAt: res.expiresAt,
          // Dibulatkan ke menit terdekat supaya "60 menit" tidak menjadi "59 menit" karena jeda jaringan.
          ttl: durationText(Date.parse(res.expiresAt) - Date.now() + 30_000),
        });
      }
      invalidate(["ringkasan", "audit"]);
      setPending(null);
    } catch (e) {
      // Penolakan server (mis. super admin terakhir tidak bisa dicabut) ditampilkan apa adanya.
      setPendingError(errorText(e, "Tindakan gagal. Coba lagi."));
    } finally {
      setBusy(false);
    }
  };

  /** Tindakan yang pasti ditolak server dimatikan di sini beserta alasannya. */
  const actionsFor = (u: AdminUserDTO): MenuAction[] => {
    const self = u.id === meId;
    const banned = !!u.bannedAt;
    const actions: MenuAction[] = [];
    if (!u.isActive) {
      actions.push({
        key: "unban",
        label: banned ? "Buka blokir" : "Aktifkan kembali",
        icon: <UserCheck className="w-4 h-4" />,
        onSelect: () => openPending({ kind: "unban", user: u }),
      });
    }
    if (!banned) {
      actions.push({
        key: "ban",
        label: "Blokir",
        icon: <Ban className="w-4 h-4" />,
        danger: true,
        onSelect: () => setBanning(u),
        disabledReason: self
          ? "Anda tidak bisa memblokir akun sendiri."
          : u.superadmin
            ? "Super admin tidak bisa diblokir. Cabut dulu peran super adminnya."
            : null,
      });
    }
    actions.push(
      u.superadmin
        ? {
            key: "revoke",
            label: "Cabut super admin",
            icon: <ShieldOff className="w-4 h-4" />,
            danger: true,
            onSelect: () => openPending({ kind: "revoke", user: u }),
          }
        : {
            key: "grant",
            label: "Beri super admin",
            icon: <ShieldCheck className="w-4 h-4" />,
            onSelect: () => openPending({ kind: "grant", user: u }),
            disabledReason: u.isActive ? null : banned ? "Akun ini diblokir. Buka blokirnya dulu." : "Akun ini nonaktif. Aktifkan dulu.",
          },
      {
        key: "logout",
        label: "Keluarkan dari semua perangkat",
        icon: <LogOut className="w-4 h-4" />,
        onSelect: () => openPending({ kind: "logout", user: u }),
      },
      {
        key: "reset",
        label: "Buat tautan reset password",
        icon: <KeyRound className="w-4 h-4" />,
        onSelect: () => openPending({ kind: "reset", user: u }),
      }
    );
    return actions;
  };

  const copy = pending ? confirmCopy(pending, pending.user.id === meId) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <SearchField label="Cari pengguna" value={text} onChange={setText} placeholder="Cari nama, username, atau email" />
        <RefreshButton onClick={reload} busy={refreshing} disabled={loading} />
      </div>
      <FilterChips ariaLabel="Filter status pengguna" options={STATUS_FILTERS} value={filter} onChange={setFilter} />

      {data && <RefreshError error={error} onRetry={reload} />}
      {notice && (
        <Banner tone="success" onClose={() => setNotice(null)}>
          {notice}
        </Banner>
      )}

      {loading ? (
        <ListSkeleton label="Memuat daftar pengguna" rows={4} />
      ) : !data ? (
        <AdminLoadError message={error ?? LOAD_ERROR} status={status} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Users className="w-6 h-6" />}
          title={filtered ? "Tidak ada pengguna yang cocok." : "Belum ada pengguna."}
          action={
            filtered ? (
              <button
                type="button"
                onClick={() => {
                  setText("");
                  setFilter("ALL");
                }}
                className={BTN_OUTLINE}
              >
                Hapus pencarian dan filter
              </button>
            ) : undefined
          }
        >
          {filtered ? "Coba kata kunci lain atau ganti filter statusnya." : undefined}
        </EmptyState>
      ) : (
        <>
          <ul className="card divide-y divide-line">
            {items.map((u) => {
              const name = memberName(u);
              const more = u.workspaces.length - WORKSPACES_SHOWN;
              return (
                <li key={u.id} className="p-4 flex items-start gap-3">
                  <AccountAvatar name={name} size="w-9 h-9" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-fg break-words min-w-0">{name}</span>
                      {u.superadmin && (
                        <Pill tone="solid" icon={<ShieldCheck className="w-3.5 h-3.5 shrink-0" />}>
                          {ADMIN_USER_STATUS_LABEL.SUPERADMIN}
                        </Pill>
                      )}
                      {u.bannedAt ? (
                        <Pill tone="danger">{ADMIN_USER_STATUS_LABEL.DIBLOKIR}</Pill>
                      ) : !u.isActive ? (
                        <Pill tone="warning">{ADMIN_USER_STATUS_LABEL.NONAKTIF}</Pill>
                      ) : (
                        !u.superadmin && <Pill tone="success">{ADMIN_USER_STATUS_LABEL.AKTIF}</Pill>
                      )}
                      {u.id === meId && <Pill>Anda</Pill>}
                      {u.google && <Pill tone="accent">Google</Pill>}
                    </div>
                    <p className="text-xs text-muted break-all">
                      @{u.username}
                      {u.email ? ` · ${u.email}` : ""}
                    </p>
                    <p className="text-xs text-muted">
                      {u.lastLoginAt ? `Terakhir masuk ${formatDateWib(u.lastLoginAt)}` : "Belum pernah masuk"}
                      {" · "}
                      Bergabung {formatDateWib(u.createdAt)}
                    </p>
                    {u.bannedAt && (
                      <p className="text-xs font-medium text-danger break-words">
                        Diblokir {formatDateWib(u.bannedAt)}
                        {u.bannedReason ? `: ${u.bannedReason}` : ""}
                      </p>
                    )}
                    {u.workspaces.length === 0 ? (
                      <p className="text-xs text-faint">Belum menjadi anggota workspace mana pun.</p>
                    ) : (
                      <ul aria-label={`Workspace ${name}`} className="flex flex-wrap gap-1.5 pt-0.5">
                        {u.workspaces.slice(0, WORKSPACES_SHOWN).map((w) => (
                          <li key={w.workspaceId} className="min-w-0 max-w-full">
                            <Pill>
                              {w.nama} · {ROLE_LABELS[w.role] ?? w.role}
                            </Pill>
                          </li>
                        ))}
                        {more > 0 && (
                          <li className="h-6 inline-flex items-center text-xs text-muted">+{more} lainnya</li>
                        )}
                      </ul>
                    )}
                  </div>
                  <div className="-mr-2 -mt-1.5">
                    <ActionMenu label={`Tindakan untuk ${name}`} actions={actionsFor(u)} />
                  </div>
                </li>
              );
            })}
          </ul>
          {moreError && <Banner tone="danger">{moreError}</Banner>}
          {nextCursor && <LoadMoreButton onClick={() => void loadMore()} loading={loadingMore} />}
        </>
      )}

      {banning && (
        <ReasonDialog
          key={banning.id}
          title={`Blokir ${memberName(banning)}?`}
          description={banning.email ?? `@${banning.username}`}
          consequence="Akunnya dinonaktifkan dan semua sesinya langsung berakhir. Ia tidak bisa masuk lagi sampai blokirnya dibuka."
          confirmLabel="Ya, blokir"
          confirmIcon={<Ban className="w-4 h-4" />}
          placeholder="Contoh: menyalahgunakan akun untuk spam"
          onClose={() => setBanning(null)}
          onSubmit={(reason) => ban(banning, reason)}
        />
      )}

      <ConfirmModal
        open={!!copy}
        onClose={() => setPending(null)}
        onConfirm={runPending}
        busy={busy}
        error={pendingError}
        variant={copy?.danger ? "danger" : "primary"}
        title={copy?.title ?? ""}
        confirmLabel={copy?.label ?? ""}
        confirmIcon={copy?.icon}
      >
        <p className="text-sm text-fg leading-relaxed">{copy?.body}</p>
      </ConfirmModal>

      <OneTimeLinkModal link={link} onClose={() => setLink(null)} />
    </div>
  );
}
