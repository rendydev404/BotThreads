"use client";

import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Link2, Link2Off, Unplug } from "lucide-react";
import { cn } from "@/lib/utils";
import { linkAdminSource, listAdminSources, listAdminWorkspaces } from "@/lib/admin-client";
import type { AdminSourceDTO, AdminSourceListResponse, AdminWorkspaceDTO, AdminWorkspaceListResponse } from "@/lib/admin-types";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { ConfirmModal } from "@/components/autopilot/confirm-modal";
import { Banner, ListSkeleton } from "@/components/autopilot/shared";
import { FormError } from "@/components/settings/fields";
import { errorText, formatInt } from "@/components/settings/format";
import { BTN_OUTLINE, EmptyState, Pill, RefreshButton } from "@/components/settings/states";
import { useRemote } from "@/components/settings/use-remote";
import {
  AdminLoadError,
  FilterChips,
  RefreshError,
  SEARCH_DEBOUNCE_MS,
  SearchField,
  useAdmin,
  useDebounced,
  type ChipOption,
} from "./shared";

const LOAD_ERROR = "Gagal memuat sumber akun.";
const PICKER_ERROR = "Gagal memuat daftar workspace.";
const LEADER_HINT =
  "Workspace ini memimpin kelompok yang masih menaungi workspace SukaPost lain, jadi tidak bisa dipindah atau dilepas. Pindahkan dulu workspace lain yang menumpang padanya.";

type Filter = "ALL" | "UNLINKED" | "LINKED";

/**
 * Hitung ulang penanda pemimpin setelah tautan berubah, dengan aturan yang sama seperti server:
 * pemimpin = ditautkan ke dirinya sendiri dan masih ada workspace lain yang menumpang padanya.
 */
const withLeaders = (items: AdminSourceDTO[]): AdminSourceDTO[] =>
  items.map((s) => ({
    ...s,
    pemimpin: s.tenantId === s.workspaceId && items.some((o) => o.tenantId === s.workspaceId && o.workspaceId !== s.workspaceId),
  }));

/* ------------------------------------------------------------------ pemilih workspace tujuan */

interface Target {
  id: string;
  nama: string;
}

interface LinkDialogProps {
  source: AdminSourceDTO;
  onClose: () => void;
  /** Tujuan dipilih; akibatnya dikonfirmasi di dialog berikutnya. */
  onPick: (target: Target) => void;
}

/** Dropdown workspace dashboard yang bisa dicari (pencarian dikerjakan server, hasil pertama saja yang dimuat). */
function LinkDialog({ source, onClose, onPick }: LinkDialogProps) {
  const { guard } = useAdmin();
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<Target | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const q = useDebounced(text, SEARCH_DEBOUNCE_MS).trim();
  const { data, error, loading, reload } = useRemote<AdminWorkspaceListResponse>(
    `tujuan:${q}`,
    (signal) => guard(listAdminWorkspaces({ q }, signal)),
    PICKER_ERROR
  );
  const moving = source.tenantId !== null;

  const options = (): HTMLElement[] => [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])') ?? [])];

  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const items = options();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : e.key === "ArrowDown" ? Math.min(items.length - 1, at + 1) : Math.max(0, at - 1);
    items[next]?.focus();
  };

  const renderOption = (ws: AdminWorkspaceDTO) => {
    const current = ws.id === source.tenantId;
    const active = selected?.id === ws.id;
    return (
      <button
        key={ws.id}
        type="button"
        role="option"
        aria-selected={active}
        aria-disabled={current || undefined}
        onClick={() => !current && setSelected({ id: ws.id, nama: ws.nama })}
        className={cn(
          "w-full min-h-11 px-3 py-2 rounded-lg flex items-center gap-2.5 text-left text-sm transition-colors",
          current ? "cursor-not-allowed opacity-60" : "cursor-pointer",
          active ? "bg-accent-soft text-accent" : "text-fg",
          !active && !current && "hover:bg-subtle"
        )}
      >
        <span className="flex-1 min-w-0">
          <span className="block font-medium break-words">{ws.nama}</span>
          <span className={cn("block text-xs", active ? "text-accent" : "text-muted")}>
            {current
              ? "Tautan saat ini"
              : `${formatInt(ws.anggota)} anggota · ${formatInt(ws.akun)} akun${ws.suspendedAt ? " · ditangguhkan" : ""}${
                  ws.anggota === 0 ? " · belum ada yang bisa melihat akunnya" : ""
                }`}
          </span>
        </span>
        {active && <Check className="w-4 h-4 shrink-0" />}
      </button>
    );
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      title={moving ? "Pindahkan sumber akun" : "Tautkan sumber akun"}
      description={`${source.nama} · ${formatInt(source.akun)} akun Threads`}
      footer={
        <>
          <ModalButton onClick={onClose}>Batal</ModalButton>
          <ModalButton variant="primary" disabled={!selected} onClick={() => selected && onPick(selected)}>
            Lanjut
            <ArrowRight className="w-4 h-4" />
          </ModalButton>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-fg leading-relaxed">
          {moving
            ? `Pilih workspace dashboard tujuan. Saat ini akunnya tampil di ${source.tenantNama ?? source.tenantId}.`
            : "Pilih workspace dashboard tempat akun dari sumber ini akan tampil."}
        </p>

        <div
          onKeyDown={(e) => {
            // Panah bawah dari kotak cari pindah ke hasil pertama.
            if (e.key === "ArrowDown" && e.target instanceof HTMLInputElement) {
              e.preventDefault();
              options()[0]?.focus();
            }
          }}
        >
          <SearchField label="Cari workspace tujuan" value={text} onChange={setText} placeholder="Cari nama workspace" modalAutofocus />
        </div>

        <div
          ref={listRef}
          role="listbox"
          aria-label="Workspace dashboard tujuan"
          aria-busy={loading || undefined}
          onKeyDown={onListKey}
          className="max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-line p-1"
        >
          {loading ? (
            <div className="p-2 space-y-2 animate-pulse" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 rounded-lg bg-subtle" />
              ))}
            </div>
          ) : !data ? (
            <div className="p-2 space-y-2">
              <FormError message={error ?? PICKER_ERROR} />
              <button type="button" onClick={reload} className={BTN_OUTLINE}>
                Coba lagi
              </button>
            </div>
          ) : data.items.length === 0 ? (
            <p className="px-3 py-4 text-[13px] text-muted text-center">
              {q ? "Tidak ada workspace yang cocok dengan pencarian ini." : "Belum ada workspace dashboard."}
            </p>
          ) : (
            data.items.map(renderOption)
          )}
        </div>

        {data?.nextCursor && (
          <p className="text-xs text-muted">
            Menampilkan {formatInt(data.items.length)} workspace pertama. Ketik nama untuk mempersempit.
          </p>
        )}
        <p role="status" aria-live="polite" className="text-[13px] text-muted">
          {selected ? (
            <>
              Tujuan: <span className="font-semibold text-fg break-words">{selected.nama}</span>
            </>
          ) : (
            "Belum ada tujuan yang dipilih."
          )}
        </p>
      </div>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ tab */

/** Tindakan yang menunggu konfirmasi; `target: null` = lepas tautan. */
interface Pending {
  source: AdminSourceDTO;
  target: Target | null;
}

function confirmCopy({ source, target }: Pending) {
  const count = `${formatInt(source.akun)} akun Threads`;
  const from = source.tenantNama ?? source.tenantId;
  // Tenant efektif sebuah sumber tanpa tautan adalah dirinya sendiri; akun hanya "pindah" bila tenant itu berubah.
  const moves = (source.tenantId ?? source.workspaceId) !== (target?.id ?? source.workspaceId);
  const reset = moves
    ? " Autopilot untuk akun yang ikut pindah dimatikan dan slot yang masih direncanakan dibuang, jadi tujuan mulai dari keadaan bersih."
    : " Akunnya tetap berada di workspace yang sama, jadi autopilot dan slotnya tidak berubah.";
  if (!target) {
    return {
      title: `Lepas tautan ${source.nama}?`,
      body: `${count} di dalamnya tidak lagi tampil di workspace ${from}.${reset}`,
      label: "Ya, lepas tautan",
      icon: <Link2Off className="w-4 h-4" />,
    };
  }
  if (source.tenantId === null) {
    return {
      title: `Tautkan ${source.nama} ke ${target.nama}?`,
      body: `${count} di dalamnya langsung tampil di workspace ${target.nama}.${reset}`,
      label: "Ya, tautkan",
      icon: <Link2 className="w-4 h-4" />,
    };
  }
  return {
    title: `Pindahkan ${source.nama} ke ${target.nama}?`,
    body: `${count} di dalamnya pindah dari workspace ${from} ke ${target.nama}, dan anggota ${from} tidak lagi melihatnya.${reset}`,
    label: "Ya, pindahkan",
    icon: <ArrowRight className="w-4 h-4" />,
  };
}

/** Tab Sumber akun: tautkan workspace SukaPost (tempat akun Threads berada) ke workspace dashboard. */
export function SourcesTab() {
  const { guard, rev, invalidate, can } = useAdmin();
  const manage = can("sumber.kelola");
  const { data, error, status, loading, refreshing, reload, mutate } = useRemote<AdminSourceListResponse>(
    `sumber:${rev.sumber}`,
    (signal) => guard(listAdminSources(signal)),
    LOAD_ERROR
  );
  const [filter, setFilter] = useState<Filter>("ALL");
  const [linking, setLinking] = useState<AdminSourceDTO | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Tab atau halaman yang disembunyikan (Activity) tidak boleh kembali dengan dialog atau pesan lama.
  useLayoutEffect(
    () => () => {
      setLinking(null);
      setPending(null);
      setNotice(null);
    },
    []
  );

  const all = data?.items;
  const stats = useMemo(() => {
    const unlinked = (all ?? []).filter((s) => s.tenantId === null);
    return { total: all?.length ?? 0, unlinked: unlinked.length, accounts: unlinked.reduce((n, s) => n + s.akun, 0) };
  }, [all]);
  const items = useMemo(
    () => (filter === "ALL" ? (all ?? []) : (all ?? []).filter((s) => (s.tenantId === null) === (filter === "UNLINKED"))),
    [all, filter]
  );

  if (loading) return <ListSkeleton label="Memuat sumber akun" rows={4} />;
  if (!data) return <AdminLoadError message={error ?? LOAD_ERROR} status={status} onRetry={reload} />;

  const filters: ChipOption<Filter>[] = [
    { value: "ALL", label: "Semua", count: stats.total },
    { value: "UNLINKED", label: "Belum ditautkan", count: stats.unlinked },
    { value: "LINKED", label: "Sudah ditautkan", count: stats.total - stats.unlinked },
  ];

  const openPending = (next: Pending) => {
    setPendingError(null);
    setPending(next);
  };

  const runPending = async () => {
    if (!pending || busy) return;
    const { source, target } = pending;
    setBusy(true);
    setPendingError(null);
    try {
      await guard(linkAdminSource(source.workspaceId, target?.id ?? null));
      mutate((d) => ({
        ...d,
        items: withLeaders(
          d.items.map((s) => (s.workspaceId === source.workspaceId ? { ...s, tenantId: target?.id ?? null, tenantNama: target?.nama ?? null } : s))
        ),
      }));
      // Jumlah akun tiap workspace ikut berubah, jadi tab Workspace memuat ulang saat dibuka.
      invalidate(["ringkasan", "audit", "workspace"]);
      setNotice(target ? `${source.nama} sekarang ditautkan ke ${target.nama}.` : `Tautan ${source.nama} dilepas.`);
      setPending(null);
    } catch (e) {
      // Penolakan server (mis. workspace pemimpin kelompok) ditampilkan apa adanya.
      setPendingError(errorText(e, "Tindakan gagal. Coba lagi."));
    } finally {
      setBusy(false);
    }
  };

  const copy = pending ? confirmCopy(pending) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-[13px] text-muted max-w-2xl">Akun Threads baru tampil di workspace dashboard setelah sumbernya (workspace SukaPost) ditautkan.</p>
        <div className="ml-auto sm:ml-0">
          <RefreshButton onClick={reload} busy={refreshing} />
        </div>
      </div>

      <RefreshError error={error} onRetry={reload} />
      {notice && (
        <Banner tone="success" onClose={() => setNotice(null)}>
          {notice}
        </Banner>
      )}
      {stats.unlinked > 0 && (
        <Banner tone="warning">
          {formatInt(stats.unlinked)} sumber berisi {formatInt(stats.accounts)} akun Threads belum ditautkan, jadi akunnya belum tampil
          di workspace dashboard mana pun.
        </Banner>
      )}

      {stats.total === 0 ? (
        <EmptyState icon={<Unplug className="w-6 h-6" />} title="Belum ada sumber akun.">
          Workspace SukaPost muncul di sini setelah punya akun Threads.
        </EmptyState>
      ) : (
        <>
          <FilterChips ariaLabel="Filter tautan sumber" options={filters} value={filter} onChange={setFilter} />
          {items.length === 0 ? (
            <div className="card p-6 text-center">
              <p className="text-sm font-semibold text-fg">
                {filter === "UNLINKED" ? "Semua sumber sudah ditautkan." : "Belum ada sumber yang ditautkan."}
              </p>
            </div>
          ) : (
            <ul className="card divide-y divide-line">
              {items.map((s) => {
                const linked = s.tenantId !== null;
                const hintId = `admin-sumber-pemimpin-${s.workspaceId}`;
                return (
                  <li key={s.workspaceId} className="p-4 flex flex-col gap-3 lg:flex-row lg:items-center">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <span
                        className={cn(
                          "w-9 h-9 rounded-full flex items-center justify-center shrink-0",
                          linked ? "bg-subtle text-muted" : "bg-warning-soft text-warning"
                        )}
                        aria-hidden
                      >
                        {linked ? <Link2 className="w-4 h-4" /> : <Link2Off className="w-4 h-4" />}
                      </span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-semibold text-fg break-words min-w-0">{s.nama}</span>
                          {!linked && <Pill tone="warning">Belum ditautkan</Pill>}
                          {s.pemimpin && <Pill tone="accent">Pemimpin kelompok</Pill>}
                        </div>
                        <p className="text-[11px] font-mono text-faint break-all">{s.workspaceId}</p>
                        <p className="text-xs text-muted break-words">
                          {formatInt(s.akun)} akun Threads
                          {linked && (
                            <>
                              {" · "}Ditautkan ke <span className="font-semibold text-fg">{s.tenantNama ?? s.tenantId}</span>
                              {s.tenantId === s.workspaceId ? " (workspace ini sendiri)" : ""}
                            </>
                          )}
                        </p>
                        {s.pemimpin && (
                          <p id={hintId} className="text-xs text-muted leading-relaxed">
                            {LEADER_HINT}
                          </p>
                        )}
                      </div>
                    </div>
                    {manage && (
                    <div className="flex flex-wrap items-center gap-2 shrink-0 lg:justify-end">
                      <button
                        type="button"
                        onClick={() => setLinking(s)}
                        disabled={s.pemimpin}
                        aria-label={`${linked ? "Pindahkan" : "Tautkan"} ${s.nama}`}
                        aria-describedby={s.pemimpin ? hintId : undefined}
                        className={BTN_OUTLINE}
                      >
                        {linked ? <ArrowRight className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
                        {linked ? "Pindahkan" : "Tautkan"}
                      </button>
                      {linked && (
                        <button
                          type="button"
                          onClick={() => openPending({ source: s, target: null })}
                          disabled={s.pemimpin}
                          aria-label={`Lepas tautan ${s.nama}`}
                          aria-describedby={s.pemimpin ? hintId : undefined}
                          className={cn(BTN_OUTLINE, "hover:border-danger hover:text-danger")}
                        >
                          <Link2Off className="w-3.5 h-3.5" />
                          Lepas tautan
                        </button>
                      )}
                    </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {linking && (
        <LinkDialog
          key={linking.workspaceId}
          source={linking}
          onClose={() => setLinking(null)}
          onPick={(target) => {
            const source = linking;
            setLinking(null);
            openPending({ source, target });
          }}
        />
      )}

      <ConfirmModal
        open={!!copy}
        onClose={() => setPending(null)}
        onConfirm={runPending}
        busy={busy}
        error={pendingError}
        variant="danger"
        title={copy?.title ?? ""}
        confirmLabel={copy?.label ?? ""}
        confirmIcon={copy?.icon}
      >
        <p className="text-sm text-fg leading-relaxed">{copy?.body}</p>
      </ConfirmModal>
    </div>
  );
}
