"use client";

import React, { useId, useLayoutEffect, useState } from "react";
import { Check, Eye, Loader2, Lock, Pencil, Plus, Save, ShieldCheck, Trash2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { deleteAdminRole, fetchAdminRoles, saveAdminRole } from "@/lib/admin-client";
import { PERM_CATALOG, ROLE_ID_PATTERN, hasPerm, type AdminRoleDTO, type AdminRolesResponse, type AdminStaffDTO } from "@/lib/admin-perms";
import type { AdminUserDTO } from "@/lib/admin-types";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { ConfirmModal } from "@/components/autopilot/confirm-modal";
import { Banner, ListSkeleton } from "@/components/autopilot/shared";
import { FormError, TextAreaField, TextField } from "@/components/settings/fields";
import { errorText, formatDateWib } from "@/components/settings/format";
import { BTN_OUTLINE, BTN_PRIMARY, ICON_BTN, NotInstalled, Pill, RefreshButton } from "@/components/settings/states";
import { memberName } from "@/components/settings/team-dialogs";
import { useRemote } from "@/components/settings/use-remote";
import { AdminLoadError, RefreshError, useAdmin } from "./shared";
import { RoleDialog } from "./user-dialogs";

const LOAD_ERROR = "Gagal memuat peran admin.";
type Level = "none" | "lihat" | "kelola";

const levelOf = (izin: string[], module: string): Level =>
  hasPerm(izin, `${module}.kelola` as never) ? "kelola" : hasPerm(izin, `${module}.lihat` as never) ? "lihat" : "none";

function LevelCell({ level }: { level: Level }) {
  if (level === "kelola")
    return (
      <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-success-soft text-success text-[11px] font-semibold">
        <Check className="w-3 h-3" />
        Kelola
      </span>
    );
  if (level === "lihat")
    return (
      <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-accent-soft text-accent text-[11px] font-semibold">
        <Eye className="w-3 h-3" />
        Lihat
      </span>
    );
  return <span className="text-faint text-sm" aria-label="Tidak ada akses">–</span>;
}

/* ------------------------------------------------------------------ editor peran */

function RoleEditor({ role, onClose, onSaved }: { role: AdminRoleDTO | null; onClose: () => void; onSaved: (nama: string) => void }) {
  const { guard } = useAdmin();
  const formId = useId();
  const [id, setId] = useState(role?.id ?? "");
  const [nama, setNama] = useState(role?.nama ?? "");
  const [deskripsi, setDeskripsi] = useState(role?.deskripsi ?? "");
  const [levels, setLevels] = useState<Record<string, Level>>(() =>
    Object.fromEntries(PERM_CATALOG.map((m) => [m.module, role ? levelOf(role.izin, m.module) : "none"]))
  );
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const code = id.trim().toUpperCase().replace(/\s+/g, "_");
  const izin = PERM_CATALOG.flatMap((m) => {
    const l = levels[m.module];
    if (l === "kelola" && m.kelola) return [`${m.module}.lihat`, `${m.module}.kelola`];
    return l === "lihat" || l === "kelola" ? [`${m.module}.lihat`] : [];
  });
  const errors = {
    id: ROLE_ID_PATTERN.test(code) ? null : "2-32 karakter: huruf, angka, atau garis bawah, diawali huruf.",
    nama: nama.trim().length >= 2 ? null : "Nama peran minimal 2 karakter.",
    izin: izin.length > 0 ? null : "Pilih minimal satu modul.",
  };

  const submit = async () => {
    setSubmitted(true);
    if (busy || Object.values(errors).some(Boolean)) return;
    setBusy(true);
    setFailure(null);
    try {
      await guard(saveAdminRole({ id: code, nama: nama.trim(), deskripsi: deskripsi.trim() || null, izin }));
      onSaved(nama.trim());
    } catch (e) {
      setFailure(errorText(e, "Gagal menyimpan peran. Coba lagi."));
      setBusy(false);
    }
  };

  const setAll = (l: Level) => setLevels(Object.fromEntries(PERM_CATALOG.map((m) => [m.module, l === "kelola" && !m.kelola ? "lihat" : l])));

  return (
    <ModalShell
      open
      onClose={onClose}
      busy={busy}
      size="lg"
      title={role ? `Ubah peran ${role.nama}` : "Buat peran admin"}
      description="Tentukan modul yang bisa dibuka (Lihat) dan diubah (Kelola) oleh pemegang peran ini."
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            Batal
          </ModalButton>
          <ModalButton variant="primary" type="submit" form={formId} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {busy ? "Menyimpan..." : "Simpan peran"}
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
        className="space-y-4"
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <TextField label="Nama peran" data-autofocus value={nama} onChange={setNama} maxLength={60} placeholder="Moderator Konten" error={submitted ? errors.nama : null} disabled={busy} />
          <TextField
            label="Kode"
            value={role ? role.id : id}
            onChange={setId}
            maxLength={32}
            placeholder="MODERATOR"
            autoCapitalize="characters"
            spellCheck={false}
            hint={role ? "Kode tidak bisa diubah." : "Huruf besar, tanpa spasi."}
            error={submitted && !role ? errors.id : null}
            disabled={busy || !!role}
          />
        </div>
        <TextAreaField label="Deskripsi (opsional)" rows={2} value={deskripsi} onChange={setDeskripsi} maxLength={300} placeholder="Untuk siapa peran ini dan apa tugasnya." disabled={busy} />

        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-[13px] font-semibold text-fg">Hak akses per modul</p>
            <div className="flex gap-1.5 text-xs">
              <button type="button" onClick={() => setAll("none")} className="px-2 h-7 rounded-md text-muted hover:text-fg hover:bg-subtle cursor-pointer">
                Kosongkan
              </button>
              <button type="button" onClick={() => setAll("lihat")} className="px-2 h-7 rounded-md text-muted hover:text-fg hover:bg-subtle cursor-pointer">
                Semua lihat
              </button>
              <button type="button" onClick={() => setAll("kelola")} className="px-2 h-7 rounded-md text-muted hover:text-fg hover:bg-subtle cursor-pointer">
                Semua kelola
              </button>
            </div>
          </div>
          <ul className="rounded-xl border border-line divide-y divide-line">
            {PERM_CATALOG.map((m) => {
              const current = levels[m.module];
              const opts: { value: Level; label: string }[] = [
                { value: "none", label: "Tidak ada" },
                { value: "lihat", label: "Lihat" },
                ...(m.kelola ? [{ value: "kelola" as Level, label: "Kelola" }] : []),
              ];
              return (
                <li key={m.module} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-fg">{m.label}</p>
                    <p className="text-xs text-muted">{current === "kelola" ? m.kelola : m.lihat}</p>
                  </div>
                  <div role="radiogroup" aria-label={`Akses ${m.label}`} className="inline-flex p-0.5 rounded-lg bg-subtle shrink-0">
                    {opts.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={current === o.value}
                        disabled={busy}
                        onClick={() => setLevels((prev) => ({ ...prev, [m.module]: o.value }))}
                        className={cn(
                          "h-8 px-3 rounded-md text-xs font-semibold transition-colors cursor-pointer",
                          current === o.value ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
          {submitted && errors.izin && <p className="mt-1.5 text-xs font-medium text-danger">{errors.izin}</p>}
          <p className="mt-2 text-xs text-muted">
            Mengatur peran admin hanya bisa dilakukan Super Admin dan tidak bisa diberikan ke peran lain.
          </p>
        </div>
        <FormError message={failure} />
      </form>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ halaman */

/** Bentuk minimal pengguna untuk dialog peran (dari daftar staf). */
const asUser = (s: AdminStaffDTO): AdminUserDTO => ({
  id: s.id,
  username: s.username,
  email: s.email,
  name: s.name,
  isActive: s.isActive,
  superadmin: s.platformRole === "SUPERADMIN",
  platformRole: s.platformRole,
  roleNama: s.roleNama,
  bannedAt: null,
  bannedReason: null,
  lastLoginAt: s.lastLoginAt,
  createdAt: s.lastLoginAt ?? new Date(0).toISOString(),
  google: false,
  workspaces: [],
});

export function AccessTab() {
  const { guard, rev, invalidate, meId } = useAdmin();
  const remote = useRemote<AdminRolesResponse>(`akses:${rev.akses}`, (signal) => guard(fetchAdminRoles(signal)), LOAD_ERROR);
  const { data, error, status, loading, refreshing, reload } = remote;
  const [editing, setEditing] = useState<{ role: AdminRoleDTO | null } | null>(null);
  const [deleting, setDeleting] = useState<AdminRoleDTO | null>(null);
  const [roleFor, setRoleFor] = useState<AdminStaffDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useLayoutEffect(
    () => () => {
      setEditing(null);
      setDeleting(null);
      setRoleFor(null);
      setNotice(null);
    },
    []
  );

  const done = (message: string) => {
    setNotice(message);
    invalidate(["akses", "audit", "pengguna"]);
    reload();
  };

  const remove = async () => {
    if (!deleting || busy) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await guard(deleteAdminRole(deleting.id));
      setDeleting(null);
      done(`Peran ${deleting.nama} dihapus.`);
    } catch (e) {
      setDeleteError(errorText(e, "Gagal menghapus peran."));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <ListSkeleton label="Memuat peran admin" rows={3} />;
  if (!data) return <AdminLoadError message={error ?? LOAD_ERROR} status={status} onRetry={reload} />;

  const roles = data.roles;

  return (
    <div className="space-y-6">
      <RefreshError error={error} onRetry={reload} />
      {notice && (
        <Banner tone="success" onClose={() => setNotice(null)}>
          {notice}
        </Banner>
      )}
      {!data.installed && <NotInstalled title="Peran admin selain Super Admin belum tersedia." file="sql/014_admin_rbac.sql" />}

      {/* Peran */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold text-fg">Peran admin</h2>
            <p className="text-sm text-muted">Setiap staf memegang satu peran. Izin berlaku paling lambat 30 detik setelah diubah.</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <RefreshButton onClick={reload} busy={refreshing} />
            {data.installed && (
              <button type="button" onClick={() => setEditing({ role: null })} className={BTN_PRIMARY}>
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Buat peran</span>
              </button>
            )}
          </div>
        </div>
        <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {roles.map((r) => (
            <li key={r.id} className="card p-4 flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <span className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", r.sistem ? "bg-accent text-on-accent" : "bg-accent-soft text-accent")}>
                  {r.sistem ? <ShieldCheck className="w-[18px] h-[18px]" /> : <Users className="w-[18px] h-[18px]" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-fg">{r.nama}</p>
                  <p className="text-[11px] font-mono text-faint">{r.id}</p>
                </div>
                {!r.sistem && (
                  <div className="flex -mr-2 -mt-1">
                    <button type="button" onClick={() => setEditing({ role: r })} aria-label={`Ubah ${r.nama}`} className={ICON_BTN}>
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => (setDeleteError(null), setDeleting(r))} aria-label={`Hapus ${r.nama}`} className={cn(ICON_BTN, "hover:text-danger hover:bg-danger-soft")}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              {r.deskripsi && <p className="text-[13px] text-muted leading-relaxed">{r.deskripsi}</p>}
              <div className="mt-auto flex items-center gap-2 text-xs text-muted">
                <Pill>{r.anggota} staf</Pill>
                {r.sistem ? (
                  <Pill tone="accent" icon={<Lock className="w-3 h-3" />}>
                    Semua izin
                  </Pill>
                ) : (
                  <Pill>{PERM_CATALOG.filter((m) => levelOf(r.izin, m.module) !== "none").length} modul</Pill>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Matriks izin */}
      <section className="space-y-3">
        <div>
          <h2 className="text-[15px] font-semibold text-fg">Matriks hak akses</h2>
          <p className="text-sm text-muted">Lihat = buka dan baca. Kelola = juga mengubah. Server menegakkan aturan yang sama.</p>
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="text-left font-semibold text-muted text-xs px-4 py-3 sticky left-0 bg-surface">
                  Modul
                </th>
                {roles.map((r) => (
                  <th key={r.id} scope="col" className="text-center font-semibold text-fg text-xs px-3 py-3 whitespace-nowrap">
                    {r.nama}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {PERM_CATALOG.map((m) => (
                <tr key={m.module} className="hover:bg-subtle/60">
                  <th scope="row" className="text-left font-medium text-fg px-4 py-2.5 sticky left-0 bg-surface whitespace-nowrap">
                    {m.label}
                  </th>
                  {roles.map((r) => (
                    <td key={r.id} className="text-center px-3 py-2.5">
                      <LevelCell level={levelOf(r.izin, m.module)} />
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="hover:bg-subtle/60">
                <th scope="row" className="text-left font-medium text-fg px-4 py-2.5 sticky left-0 bg-surface whitespace-nowrap">
                  Peran & Hak Akses
                </th>
                {roles.map((r) => (
                  <td key={r.id} className="text-center px-3 py-2.5">
                    <LevelCell level={r.id === "SUPERADMIN" ? "kelola" : "none"} />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Staf */}
      <section className="space-y-3">
        <div>
          <h2 className="text-[15px] font-semibold text-fg">Staf platform</h2>
          <p className="text-sm text-muted">Untuk menjadikan pengguna lain staf, buka modul Pengguna lalu pilih &quot;Jadikan staf admin&quot;.</p>
        </div>
        <ul className="card divide-y divide-line">
          {data.staff.map((s) => (
            <li key={s.id} className="p-4 flex items-center gap-3">
              <AccountAvatar name={memberName(s)} size="w-9 h-9" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-fg">{memberName(s)}</span>
                  {s.id === meId && <Pill>Anda</Pill>}
                  {!s.isActive && <Pill tone="warning">Nonaktif</Pill>}
                </div>
                <p className="text-xs text-muted truncate">
                  @{s.username}
                  {s.email ? ` · ${s.email}` : ""} · {s.lastLoginAt ? `terakhir masuk ${formatDateWib(s.lastLoginAt)}` : "belum pernah masuk"}
                </p>
              </div>
              <Pill tone={s.platformRole === "SUPERADMIN" ? "solid" : "accent"}>{s.roleNama}</Pill>
              {s.id !== meId && (
                <button type="button" onClick={() => setRoleFor(s)} className={cn(BTN_OUTLINE, "h-9 px-3 hidden sm:inline-flex")}>
                  Ubah
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {editing && (
        <RoleEditor
          key={editing.role?.id ?? "baru"}
          role={editing.role}
          onClose={() => setEditing(null)}
          onSaved={(nama) => {
            setEditing(null);
            done(`Peran ${nama} disimpan.`);
          }}
        />
      )}
      {roleFor && (
        <RoleDialog
          key={roleFor.id}
          user={asUser(roleFor)}
          onClose={() => setRoleFor(null)}
          onSaved={(role) => {
            setRoleFor(null);
            done(role.id ? `${memberName(roleFor)} sekarang ${role.nama}.` : `${memberName(roleFor)} bukan staf admin lagi.`);
          }}
        />
      )}
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        busy={busy}
        error={deleteError}
        variant="danger"
        title={`Hapus peran ${deleting?.nama ?? ""}?`}
        confirmLabel="Ya, hapus"
        confirmIcon={<Trash2 className="w-4 h-4" />}
      >
        <p className="text-sm text-fg leading-relaxed">
          {deleting && deleting.anggota > 0
            ? `Peran ini masih dipegang ${deleting.anggota} staf. Pindahkan mereka ke peran lain dulu.`
            : "Peran yang tidak dipegang siapa pun akan dihapus permanen."}
        </p>
      </ConfirmModal>
    </div>
  );
}
