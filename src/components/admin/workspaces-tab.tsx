"use client";

import React, { useId, useLayoutEffect, useState } from "react";
import { Building2, ChevronDown, CirclePause, CirclePlay, Gem, Loader2, Save, UserCog, UserMinus, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { listAdminWorkspaces, setWorkspaceMember, suspendWorkspace, unsuspendWorkspace } from "@/lib/admin-client";
import type { AdminWorkspaceDTO, AdminWorkspaceListResponse } from "@/lib/admin-types";
import { wibDayKey } from "@/lib/scheduling";
import { ROLE_HINTS, ROLE_LABELS, type Role } from "@/lib/team-client";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { ConfirmModal } from "@/components/autopilot/confirm-modal";
import { Dropdown, type DropdownOption } from "@/components/autopilot/dropdown";
import { Banner, ListSkeleton, LoadMoreButton } from "@/components/autopilot/shared";
import { ControlLabel, FormError, TextField } from "@/components/settings/fields";
import { errorText, formatDateWib, formatInt } from "@/components/settings/format";
import { BTN_OUTLINE, EmptyState, ICON_BTN, Pill, RefreshButton, type PillTone } from "@/components/settings/states";
import { usePaged } from "@/components/settings/use-remote";
import { AdminLoadError, type PlansRemote, ReasonDialog, RefreshError, SEARCH_DEBOUNCE_MS, SearchField, useAdmin, useDebounced } from "./shared";
import { WorkspacePlanDialog } from "./workspace-plan-dialog";

const LOAD_ERROR = "Gagal memuat daftar workspace.";
const ROLES: Role[] = ["OWNER", "ADMIN", "EDITOR", "VIEWER"];
const ROLE_TONE: Record<Role, PillTone> = { OWNER: "solid", ADMIN: "accent", EDITOR: "success", VIEWER: "neutral" };
const ROLE_OPTIONS: DropdownOption<Role>[] = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r], hint: ROLE_HINTS[r] }));
/** Batas panjang isian "email atau username" di server. */
const IDENTIFIER_MIN = 3;
const IDENTIFIER_MAX = 254;

type Member = AdminWorkspaceDTO["members"][number];

/** Anggota yang cocok dengan isian "email atau username" (aturan pencocokan server: tanpa beda huruf besar-kecil). */
const findMember = (ws: AdminWorkspaceDTO, identifier: string): Member | null => {
  const key = identifier.trim().toLowerCase();
  return ws.members.find((m) => m.username.toLowerCase() === key || m.email?.toLowerCase() === key || m.id === identifier.trim()) ?? null;
};

/* ------------------------------------------------------------------ dialog anggota */

interface MemberDialogProps {
  workspace: AdminWorkspaceDTO;
  /** Anggota yang perannya diubah; null = tambah lewat email atau username. */
  member: Member | null;
  onClose: () => void;
  onSaved: (identifier: string, role: Role) => void;
}

function MemberDialog({ workspace, member, onClose, onSaved }: MemberDialogProps) {
  const { guard } = useAdmin();
  const [identifier, setIdentifier] = useState(member?.username ?? "");
  // Bawaan peran terendah: akses lebih tinggi harus dipilih dengan sadar.
  const [role, setRole] = useState<Role>(member?.role ?? "VIEWER");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const formId = useId();

  const clean = identifier.trim();
  const existing = member ?? findMember(workspace, clean);
  const identifierError = clean.length >= IDENTIFIER_MIN ? null : "Isi email atau username pengguna.";
  const unchanged = !!existing && existing.role === role;

  const submit = async () => {
    setSubmitted(true);
    if (busy || identifierError) return;
    if (unchanged) {
      onClose();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await guard(setWorkspaceMember(workspace.id, clean, role));
      onSaved(clean, role);
    } catch (e) {
      // Penolakan server (mis. pengguna tidak ditemukan) ditampilkan apa adanya.
      setFailure(errorText(e, "Gagal menyimpan anggota. Coba lagi."));
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      busy={busy}
      title={member ? "Ubah peran anggota" : "Tambah atau ubah anggota"}
      description={`Workspace ${workspace.nama}`}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            Batal
          </ModalButton>
          <ModalButton variant="primary" type="submit" form={formId} disabled={busy || (!!member && unchanged)}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {busy ? "Menyimpan..." : existing ? "Simpan peran" : "Tambahkan"}
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
          label="Email atau username"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          data-autofocus={member ? undefined : true}
          value={identifier}
          onChange={(v) => {
            setIdentifier(v);
            setFailure(null);
          }}
          maxLength={IDENTIFIER_MAX}
          placeholder="nama@contoh.com atau username"
          error={submitted ? identifierError : null}
          hint={
            member
              ? undefined
              : existing
                ? `Sudah menjadi anggota sebagai ${ROLE_LABELS[existing.role]}. Menyimpan akan mengganti perannya.`
                : "Pengguna harus sudah punya akun. Anggota baru langsung bisa mengakses semua akun Threads di workspace ini."
          }
          disabled={busy || !!member}
        />

        <div>
          <ControlLabel>Peran</ControlLabel>
          <Dropdown
            ariaLabel="Peran"
            value={role}
            options={ROLE_OPTIONS}
            onChange={(next) => {
              setRole(next);
              setFailure(null);
            }}
            disabled={busy}
          />
          <p className="mt-1.5 text-xs text-muted leading-relaxed">{ROLE_HINTS[role]}</p>
        </div>

        <FormError message={failure} />
      </form>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ tab */

/** Tindakan yang menunggu konfirmasi (menangguhkan punya dialog sendiri karena wajib beralasan). */
type Pending = { kind: "unsuspend"; ws: AdminWorkspaceDTO } | { kind: "remove"; ws: AdminWorkspaceDTO; member: Member };

/** Tab Workspace: semua workspace dashboard beserta anggotanya; tangguhkan, pulihkan, atur paket, dan atur anggota. */
export function WorkspacesTab({ plans }: { plans?: PlansRemote }) {
  const { guard, rev, invalidate } = useAdmin();
  const [text, setText] = useState("");
  const q = useDebounced(text, SEARCH_DEBOUNCE_MS).trim();
  const list = usePaged<AdminWorkspaceDTO, AdminWorkspaceListResponse>(
    `workspace:${rev.workspace}:${q}`,
    (cursor, signal) => guard(listAdminWorkspaces({ q, cursor }, signal)),
    (w) => w.id,
    LOAD_ERROR
  );
  const { items, data, error, status, loading, refreshing, reload, mutate, nextCursor, loadMore, loadingMore, moreError } = list;

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [suspending, setSuspending] = useState<AdminWorkspaceDTO | null>(null);
  const [editing, setEditing] = useState<{ ws: AdminWorkspaceDTO; member: Member | null } | null>(null);
  const [planningWs, setPlanningWs] = useState<AdminWorkspaceDTO | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const planItems = plans?.data?.items ?? [];
  const defaultPlan = planItems.find((p) => p.bawaan) ?? null;

  // Tab atau halaman yang disembunyikan (Activity) tidak boleh kembali dengan dialog atau pesan lama.
  useLayoutEffect(
    () => () => {
      setSuspending(null);
      setEditing(null);
      setPlanningWs(null);
      setPending(null);
      setNotice(null);
    },
    []
  );

  const patch = (id: string, fn: (ws: AdminWorkspaceDTO) => AdminWorkspaceDTO) =>
    mutate((d) => ({ ...d, items: d.items.map((w) => (w.id === id ? fn(w) : w)) }));

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /**
   * Muat ulang satu workspace saja (anggota baru: server tidak mengembalikan barisnya). Halaman yang
   * sudah dimuat tetap utuh; bila barisnya tidak ditemukan, seluruh daftar disegarkan.
   */
  const refreshOne = async (ws: AdminWorkspaceDTO) => {
    try {
      const res = await guard(listAdminWorkspaces({ q: ws.nama }));
      const fresh = res.items.find((w) => w.id === ws.id);
      if (fresh) patch(ws.id, () => fresh);
      else reload();
    } catch {
      reload();
    }
  };

  const suspend = async (ws: AdminWorkspaceDTO, reason: string) => {
    await guard(suspendWorkspace(ws.id, reason));
    patch(ws.id, (w) => ({ ...w, suspendedAt: new Date().toISOString(), suspendedReason: reason, autopilotAktif: false }));
    invalidate(["ringkasan", "audit"]);
    setNotice(`Workspace ${ws.nama} ditangguhkan.`);
    setSuspending(null);
  };

  const openPending = (next: Pending) => {
    setPendingError(null);
    setPending(next);
  };

  const runPending = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setPendingError(null);
    try {
      if (pending.kind === "unsuspend") {
        const { ws } = pending;
        await guard(unsuspendWorkspace(ws.id));
        patch(ws.id, (w) => ({ ...w, suspendedAt: null, suspendedReason: null }));
        invalidate(["ringkasan", "audit"]);
        setNotice(`Workspace ${ws.nama} dipulihkan.`);
      } else {
        const { ws, member } = pending;
        await guard(setWorkspaceMember(ws.id, member.username, null));
        patch(ws.id, (w) => {
          const members = w.members.filter((m) => m.id !== member.id);
          return { ...w, members, anggota: members.length };
        });
        invalidate(["ringkasan", "audit", "pengguna"]);
        setNotice(`@${member.username} dikeluarkan dari ${ws.nama}.`);
      }
      setPending(null);
    } catch (e) {
      setPendingError(errorText(e, "Tindakan gagal. Coba lagi."));
    } finally {
      setBusy(false);
    }
  };

  const onMemberSaved = (identifier: string, role: Role) => {
    if (!editing) return;
    const { ws } = editing;
    const known = editing.member ?? findMember(ws, identifier);
    if (known) {
      patch(ws.id, (w) => ({ ...w, members: w.members.map((m) => (m.id === known.id ? { ...m, role } : m)) }));
      setNotice(`Peran @${known.username} di ${ws.nama} menjadi ${ROLE_LABELS[role]}.`);
    } else {
      setExpanded((prev) => new Set(prev).add(ws.id));
      setNotice(`${identifier} ditambahkan ke ${ws.nama} sebagai ${ROLE_LABELS[role]}.`);
      void refreshOne(ws);
    }
    invalidate(["ringkasan", "audit", "pengguna"]);
    setEditing(null);
  };

  const copy =
    pending?.kind === "unsuspend"
      ? {
          title: `Pulihkan workspace ${pending.ws.nama}?`,
          body: "Anggotanya langsung bisa membuka workspace ini lagi dan saklar autopilotnya kembali ke posisi sebelum ditangguhkan.",
          label: "Ya, pulihkan",
          icon: <CirclePlay className="w-4 h-4" />,
          danger: false,
        }
      : pending?.kind === "remove"
        ? {
            title: `Keluarkan @${pending.member.username}?`,
            body: `Aksesnya ke workspace ${pending.ws.nama} langsung dicabut. Akun penggunanya tidak dihapus dan bisa ditambahkan lagi kapan saja.`,
            label: "Ya, keluarkan",
            icon: <UserMinus className="w-4 h-4" />,
            danger: true,
          }
        : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <SearchField label="Cari workspace" value={text} onChange={setText} placeholder="Cari nama workspace" />
        <RefreshButton onClick={reload} busy={refreshing} disabled={loading} />
      </div>

      {data && <RefreshError error={error} onRetry={reload} />}
      {notice && (
        <Banner tone="success" onClose={() => setNotice(null)}>
          {notice}
        </Banner>
      )}

      {loading ? (
        <ListSkeleton label="Memuat daftar workspace" rows={4} />
      ) : !data ? (
        <AdminLoadError message={error ?? LOAD_ERROR} status={status} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Building2 className="w-6 h-6" />}
          title={q ? "Tidak ada workspace yang cocok." : "Belum ada workspace."}
          action={
            q ? (
              <button type="button" onClick={() => setText("")} className={BTN_OUTLINE}>
                Hapus pencarian
              </button>
            ) : undefined
          }
        >
          {q ? "Pencarian hanya mencocokkan nama workspace." : "Workspace muncul setelah ada pengguna yang mendaftar atau diundang."}
        </EmptyState>
      ) : (
        <>
          <ul className="card divide-y divide-line">
            {items.map((ws) => {
              const open = expanded.has(ws.id);
              const panelId = `admin-ws-anggota-${ws.id}`;
              const assignedPlan = ws.planId ? planItems.find((p) => p.id === ws.planId) : null;
              const planExpired = Boolean(ws.planBerakhir && Date.parse(ws.planBerakhir) < Date.now());
              return (
                <li key={ws.id} className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="w-9 h-9 rounded-full bg-subtle text-muted flex items-center justify-center shrink-0" aria-hidden>
                      <Building2 className="w-4 h-4" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-semibold text-fg break-words min-w-0">{ws.nama}</span>
                        {ws.planId ? (
                          <Pill tone={planExpired ? "danger" : "accent"}>
                            Paket {assignedPlan?.nama ?? ws.planId}
                            {planExpired ? " (Habis)" : ""}
                          </Pill>
                        ) : defaultPlan ? (
                          <Pill tone="neutral">Paket {defaultPlan.nama} (Bawaan)</Pill>
                        ) : null}
                        {ws.suspendedAt && <Pill tone="danger">Ditangguhkan</Pill>}
                      </div>
                      <p className="text-[11px] font-mono text-faint break-all">{ws.id}</p>
                      <p className="text-xs text-muted">
                        {formatInt(ws.anggota)} anggota · {formatInt(ws.akun)} akun Threads · {formatInt(ws.autopilotAkun)} akun autopilot aktif
                        {ws.planId && ws.planBerakhir ? ` · Berlaku s/d ${formatDateWib(ws.planBerakhir)}` : ""}
                      </p>
                      {ws.suspendedAt && (
                        <p className="text-xs font-medium text-danger break-words">
                          Ditangguhkan {formatDateWib(ws.suspendedAt)}
                          {ws.suspendedReason ? `: ${ws.suspendedReason}` : ""}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => toggle(ws.id)} aria-expanded={open} aria-controls={panelId} className={BTN_OUTLINE}>
                      Anggota ({formatInt(ws.members.length)})
                      <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlanningWs(ws)}
                      aria-label={`Atur paket workspace ${ws.nama}`}
                      className={BTN_OUTLINE}
                    >
                      <Gem className="w-3.5 h-3.5" />
                      Atur paket
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing({ ws, member: null })}
                      aria-label={`Tambah atau ubah anggota ${ws.nama}`}
                      className={BTN_OUTLINE}
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      Tambah anggota
                    </button>
                    {ws.suspendedAt ? (
                      <button
                        type="button"
                        onClick={() => openPending({ kind: "unsuspend", ws })}
                        aria-label={`Pulihkan workspace ${ws.nama}`}
                        className={BTN_OUTLINE}
                      >
                        <CirclePlay className="w-3.5 h-3.5" />
                        Pulihkan
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setSuspending(ws)}
                        aria-label={`Tangguhkan workspace ${ws.nama}`}
                        className={cn(BTN_OUTLINE, "hover:border-danger hover:text-danger")}
                      >
                        <CirclePause className="w-3.5 h-3.5" />
                        Tangguhkan
                      </button>
                    )}
                  </div>

                  {open && (
                    <div id={panelId} className="rounded-xl bg-subtle px-3">
                      {ws.members.length === 0 ? (
                        <p className="py-3 text-[13px] text-muted">
                          Belum ada anggota. Akun Threads di workspace ini belum terlihat siapa pun sampai ada anggota yang ditambahkan.
                        </p>
                      ) : (
                        <ul aria-label={`Anggota ${ws.nama}`} className="divide-y divide-line">
                          {ws.members.map((m) => (
                            <li key={m.id} className="py-2 flex items-center gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-semibold text-fg break-all">@{m.username}</p>
                                {m.email && <p className="text-xs text-muted break-all">{m.email}</p>}
                              </div>
                              <Pill tone={ROLE_TONE[m.role] ?? "neutral"} className="shrink-0">
                                {ROLE_LABELS[m.role] ?? m.role}
                              </Pill>
                              <div className="flex items-center shrink-0 -mr-2">
                                <button
                                  type="button"
                                  onClick={() => setEditing({ ws, member: m })}
                                  aria-label={`Ubah peran @${m.username} di ${ws.nama}`}
                                  title="Ubah peran"
                                  className={cn(ICON_BTN, "hover:bg-surface")}
                                >
                                  <UserCog className="w-[18px] h-[18px]" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openPending({ kind: "remove", ws, member: m })}
                                  aria-label={`Keluarkan @${m.username} dari ${ws.nama}`}
                                  title="Keluarkan dari workspace"
                                  className={cn(ICON_BTN, "hover:text-danger hover:bg-danger-soft")}
                                >
                                  <UserMinus className="w-[18px] h-[18px]" />
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {moreError && <Banner tone="danger">{moreError}</Banner>}
          {nextCursor && <LoadMoreButton onClick={() => void loadMore()} loading={loadingMore} />}
        </>
      )}

      {suspending && (
        <ReasonDialog
          key={suspending.id}
          title={`Tangguhkan workspace ${suspending.nama}?`}
          consequence="Semua anggotanya langsung kehilangan akses ke workspace ini dan autopilotnya berhenti sampai workspace dipulihkan."
          confirmLabel="Ya, tangguhkan"
          confirmIcon={<CirclePause className="w-4 h-4" />}
          placeholder="Contoh: tagihan belum dibayar"
          onClose={() => setSuspending(null)}
          onSubmit={(reason) => suspend(suspending, reason)}
        />
      )}

      {editing && (
        <MemberDialog
          key={`${editing.ws.id}:${editing.member?.id ?? "baru"}`}
          workspace={editing.ws}
          member={editing.member}
          onClose={() => setEditing(null)}
          onSaved={onMemberSaved}
        />
      )}

      {planningWs && (
        <WorkspacePlanDialog
          key={planningWs.id}
          workspace={planningWs}
          plans={planItems}
          today={wibDayKey(new Date())}
          onClose={() => setPlanningWs(null)}
          onSaved={(planId, until) => {
            patch(planningWs.id, (w) => ({ ...w, planId, planBerakhir: until }));
            plans?.reload();
            invalidate(["ringkasan", "audit", "paket"]);
            setNotice(`Paket workspace ${planningWs.nama} diperbarui.`);
            setPlanningWs(null);
          }}
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
    </div>
  );
}
