"use client";

import React, { useLayoutEffect, useState } from "react";
import { Ban, KeyRound, LogOut, Pencil, ShieldCheck, UserCheck, UserPlus, Users } from "lucide-react";
import {
  adminResetLink,
  banUser,
  forceLogoutUser,
  listAdminUsers,
  unbanUser,
} from "@/lib/admin-client";
import { ADMIN_USER_STATUS_LABEL, type AdminUserDTO, type AdminUserListResponse, type AdminUserStatus } from "@/lib/admin-types";
import { ROLE_LABELS } from "@/lib/team-client";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { ConfirmModal } from "@/components/autopilot/confirm-modal";
import { Banner, ListSkeleton, LoadMoreButton, durationText } from "@/components/autopilot/shared";
import { errorText, formatDateWib } from "@/components/settings/format";
import { OneTimeLinkModal, type OneTimeLink } from "@/components/settings/one-time-link-modal";
import { BTN_OUTLINE, BTN_PRIMARY, EmptyState, RefreshButton } from "@/components/settings/states";
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
import { CreateUserDialog, EditUserDialog, RoleDialog } from "./user-dialogs";

const LOAD_ERROR = "Gagal memuat daftar pengguna.";

type StatusFilter = "ALL" | AdminUserStatus;
const STATUS_FILTERS: ChipOption<StatusFilter>[] = [
  { value: "ALL", label: "Semua" },
  ...(["AKTIF", "STAF", "DIBLOKIR", "NONAKTIF"] as AdminUserStatus[]).map((s) => ({ value: s, label: ADMIN_USER_STATUS_LABEL[s] })),
];

/** Tindakan yang menunggu konfirmasi (blokir punya dialog sendiri karena wajib beralasan). */
type Pending = { kind: "unban" | "logout" | "reset"; user: AdminUserDTO };

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

/** Status akun ringkas: titik berwarna + label. */
function UserStatus({ user }: { user: AdminUserDTO }) {
  const [label, dot, text] = user.bannedAt
    ? [ADMIN_USER_STATUS_LABEL.DIBLOKIR, "bg-danger", "text-danger"]
    : !user.isActive
      ? [ADMIN_USER_STATUS_LABEL.NONAKTIF, "bg-warning", "text-warning"]
      : [ADMIN_USER_STATUS_LABEL.AKTIF, "bg-success", "text-fg"];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  );
}

/** Tab Pengguna: cari dan saring semua pengguna platform, lalu blokir, atur peran super admin, atau bantu masuk lagi. */
export function UsersTab() {
  const { guard, rev, invalidate, can, isSuper } = useAdmin();
  const manage = can("pengguna.kelola");
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
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUserDTO | null>(null);
  const [roleFor, setRoleFor] = useState<AdminUserDTO | null>(null);

  // Tab atau halaman yang disembunyikan (Activity) tidak boleh kembali dengan dialog terbuka; tautan
  // sekali tampil juga tidak boleh tertinggal di memori.
  useLayoutEffect(
    () => () => {
      setBanning(null);
      setPending(null);
      setLink(null);
      setNotice(null);
      setCreating(false);
      setEditing(null);
      setRoleFor(null);
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
    const actions: MenuAction[] = [
      { key: "edit", label: "Ubah profil", icon: <Pencil className="w-4 h-4" />, onSelect: () => setEditing(u) },
    ];
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
    if (isSuper) {
      actions.push({
        key: "role",
        label: u.platformRole || u.superadmin ? "Ubah peran admin" : "Jadikan staf admin",
        icon: <ShieldCheck className="w-4 h-4" />,
        onSelect: () => setRoleFor(u),
        disabledReason: self
          ? "Peran Anda sendiri hanya bisa diubah Super Admin lain."
          : !u.isActive && !u.platformRole && !u.superadmin
            ? banned
              ? "Akun ini diblokir. Buka blokirnya dulu."
              : "Akun ini nonaktif. Aktifkan dulu."
            : null,
      });
    }
    actions.push(
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
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <FilterChips ariaLabel="Filter status pengguna" options={STATUS_FILTERS} value={filter} onChange={setFilter} />
        <div className="flex items-center gap-2 lg:ml-auto">
          <SearchField label="Cari pengguna" value={text} onChange={setText} placeholder="Cari nama, username, atau email" className="lg:w-72 lg:flex-none" />
          <RefreshButton onClick={reload} busy={refreshing} disabled={loading} />
          {manage && (
            <button type="button" onClick={() => setCreating(true)} className={BTN_PRIMARY}>
              <UserPlus className="w-4 h-4" />
              <span className="hidden sm:inline">Buat pengguna</span>
            </button>
          )}
        </div>
      </div>

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
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-subtle/60 text-xs text-muted">
                  <th scope="col" className="text-left font-medium px-4 py-2.5">Pengguna</th>
                  <th scope="col" className="text-left font-medium px-4 py-2.5 w-40">Status</th>
                  <th scope="col" className="text-left font-medium px-4 py-2.5 hidden lg:table-cell">Workspace</th>
                  <th scope="col" className="text-left font-medium px-4 py-2.5 hidden md:table-cell w-44">Terakhir masuk</th>
                  {manage && <th scope="col" className="w-12"><span className="sr-only">Tindakan</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((u) => {
                  const name = memberName(u);
                  const ws = u.workspaces[0];
                  const more = u.workspaces.length - 1;
                  return (
                    <tr key={u.id} className="align-top hover:bg-subtle/40 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <AccountAvatar name={name} size="w-8 h-8" />
                          <div className="min-w-0">
                            <p className="font-medium text-fg truncate">
                              {name}
                              {u.id === meId && <span className="ml-1.5 text-xs font-normal text-muted">(Anda)</span>}
                            </p>
                            <p className="text-xs text-muted truncate" title={u.email ?? undefined}>
                              @{u.username}
                              {u.email ? ` · ${u.email}` : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1.5">
                          <UserStatus user={u} />
                          {(u.platformRole || u.superadmin) && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-accent">
                              <ShieldCheck className="w-3.5 h-3.5" />
                              {u.roleNama ?? ADMIN_USER_STATUS_LABEL.SUPERADMIN}
                            </span>
                          )}
                        </div>
                        {u.bannedAt && u.bannedReason && (
                          <p className="mt-1 text-xs text-danger line-clamp-2 max-w-48" title={u.bannedReason}>
                            {u.bannedReason}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {ws ? (
                          <p className="text-fg truncate max-w-64">
                            {ws.nama}
                            <span className="text-muted"> · {ROLE_LABELS[ws.role] ?? ws.role}</span>
                            {more > 0 && <span className="ml-1.5 text-xs text-muted">+{more}</span>}
                          </p>
                        ) : (
                          <span className="text-faint">Belum ada</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <p className="text-fg">{u.lastLoginAt ? formatDateWib(u.lastLoginAt) : <span className="text-faint">Belum pernah</span>}</p>
                        <p className="text-xs text-muted">
                          Gabung {formatDateWib(u.createdAt)}
                          {u.google ? " · Google" : ""}
                        </p>
                      </td>
                      {manage && (
                        <td className="pr-2 py-2 text-right">
                          <ActionMenu label={`Tindakan untuk ${name}`} actions={actionsFor(u)} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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

      {creating && (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onCreated={(username) => {
            setCreating(false);
            setNotice(`Akun @${username} dibuat. Kirim username dan password awalnya ke pengguna lewat saluran aman.`);
            invalidate(["pengguna", "ringkasan", "audit", "akses"]);
          }}
        />
      )}
      {editing && (
        <EditUserDialog
          key={editing.id}
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            patch(editing.id, next);
            setNotice(`Profil ${memberName({ ...editing, ...next })} disimpan.`);
            invalidate(["audit"]);
            setEditing(null);
          }}
        />
      )}
      {roleFor && (
        <RoleDialog
          key={roleFor.id}
          user={roleFor}
          onClose={() => setRoleFor(null)}
          onSaved={(role) => {
            patch(roleFor.id, { platformRole: role.id, roleNama: role.id ? role.nama : null, superadmin: role.id === "SUPERADMIN" });
            setNotice(role.id ? `${memberName(roleFor)} sekarang ${role.nama}.` : `${memberName(roleFor)} bukan staf admin lagi.`);
            invalidate(["ringkasan", "audit", "akses"]);
            setRoleFor(null);
          }}
        />
      )}
    </div>
  );
}
