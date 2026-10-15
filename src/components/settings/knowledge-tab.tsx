"use client";

import React, { useLayoutEffect, useMemo, useState } from "react";
import { AtSign, BookOpen, CalendarClock, Globe, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { deleteKnowledge, listKnowledge } from "@/lib/radar-client";
import {
  KNOWLEDGE_KIND_HINT,
  KNOWLEDGE_KIND_LABEL,
  type KnowledgeDTO,
  type KnowledgeKind,
  type KnowledgeListResponse,
} from "@/lib/radar-types";
import { wibDayKey } from "@/lib/scheduling";
import { usePublishAccounts } from "@/components/content/use-publish-accounts";
import { ConfirmModal } from "@/components/autopilot/confirm-modal";
import { Banner, ListSkeleton, LoadMoreButton, accountHandle } from "@/components/autopilot/shared";
import { dayDiff } from "./day-field";
import { errorText, formatDateWib, formatDayKey } from "./format";
import { KIND_STYLE, KNOWLEDGE_KINDS, KnowledgeDialog } from "./knowledge-dialog";
import { BTN_PRIMARY, EmptyState, ICON_BTN, LoadError, NotInstalled, Pill, RefreshButton, type PillTone } from "./states";
import { useRemote } from "./use-remote";

type KindFilter = "ALL" | KnowledgeKind;

const LOAD_ERROR = "Gagal memuat pengetahuan.";
/** Baris yang dirender sekaligus; sisanya lewat "Muat lagi" (data sudah di memori, tanpa permintaan baru). */
const PAGE = 30;
/** Batas baris `dash_kb_list` di server. */
const SERVER_CAP = 500;
const EXCERPT_CHARS = 180;
const TERMS_SHOWN = 12;
/** Promo yang berakhir dalam sekian hari ditandai supaya sempat diperpanjang. */
const SOON_DAYS = 3;

/** Lencana masa berlaku: berakhir (tidak dipakai AI lagi), segera berakhir, atau masih lama. */
function expiryOf(until: string | null, today: string | null): { tone: PillTone; text: string; expired: boolean } | null {
  if (!until) return null;
  const left = dayDiff(today, until);
  if (left === null) return { tone: "neutral", text: `Sampai ${formatDayKey(until)}`, expired: false };
  if (left < 0) return { tone: "danger", text: `Berakhir ${formatDayKey(until)}`, expired: true };
  if (left === 0) return { tone: "warning", text: "Berakhir hari ini", expired: false };
  if (left <= SOON_DAYS) return { tone: "warning", text: `Berakhir ${left} hari lagi`, expired: false };
  return { tone: "neutral", text: `Sampai ${formatDayKey(until)}`, expired: false };
}

interface KnowledgeTabProps {
  /** Editor ke atas boleh menambah, mengubah, dan menghapus. */
  canEdit: boolean;
  /** Pengguna dibatasi ke akun tertentu: butir "semua akun" hanya bisa ia baca. */
  accountScoped: boolean;
}

/** Tab Pengetahuan: fakta, produk, promo, dan larangan yang wajib dipatuhi AI saat menulis. */
export function KnowledgeTab({ canEdit, accountScoped }: KnowledgeTabProps) {
  const { data, error, status, loadedAt, loading, refreshing, reload, mutate } = useRemote<KnowledgeListResponse>(
    "knowledge",
    listKnowledge,
    LOAD_ERROR
  );
  const accounts = usePublishAccounts();
  const [kind, setKind] = useState<KindFilter>("ALL");
  const [shown, setShown] = useState(PAGE);
  const [dialog, setDialog] = useState<{ item: KnowledgeDTO | null; today: string } | null>(null);
  const [removing, setRemoving] = useState<KnowledgeDTO | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Tab atau halaman yang disembunyikan (Activity) tidak boleh kembali dengan dialog atau pesan lama.
  useLayoutEffect(
    () => () => {
      setDialog(null);
      setRemoving(null);
      setNotice(null);
    },
    []
  );

  const byId = useMemo(() => new Map(accounts.accounts.map((a) => [a.id, a])), [accounts.accounts]);
  const counts = useMemo(() => {
    const c: Record<KindFilter, number> = { ALL: 0, FAKTA: 0, PRODUK: 0, PROMO: 0, LARANGAN: 0 };
    for (const item of data?.items ?? []) {
      c.ALL += 1;
      c[item.jenis] += 1;
    }
    return c;
  }, [data?.items]);
  const items = useMemo(
    () => (kind === "ALL" ? (data?.items ?? []) : (data?.items ?? []).filter((i) => i.jenis === kind)),
    [data?.items, kind]
  );

  if (loading) return <ListSkeleton label="Memuat pengetahuan" rows={4} />;
  if (!data) return <LoadError message={error ?? LOAD_ERROR} status={status} onRetry={reload} />;
  if (!data.installed) return <NotInstalled title="Knowledge base belum dipasang." file="sql/006_autopilot_radar.sql" />;

  // "Hari ini" (WIB) diambil dari saat data diterima, bukan dari jam saat render.
  const today = loadedAt ? wibDayKey(new Date(loadedAt)) : null;

  const pickKind = (next: KindFilter) => {
    setKind(next);
    setShown(PAGE);
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirmRemove = async () => {
    if (!removing || removeBusy) return;
    const target = removing;
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await deleteKnowledge(target.id);
      mutate((d) => ({ ...d, items: d.items.filter((i) => i.id !== target.id) }));
      setNotice(`Butir "${target.judul}" dihapus.`);
      setRemoving(null);
    } catch (e) {
      setRemoveError(errorText(e, "Gagal menghapus butir. Coba lagi."));
    } finally {
      setRemoveBusy(false);
    }
  };

  const addButton = canEdit ? (
    <button type="button" onClick={() => setDialog({ item: null, today: wibDayKey(new Date()) })} className={BTN_PRIMARY}>
      <Plus className="w-4 h-4" />
      Tambah butir
    </button>
  ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted max-w-xl">
          Yang AI wajib tahu dan patuhi. Harga dan promo di posting hanya boleh berasal dari sini.
        </p>
        <div className="flex items-center gap-2 ml-auto">
          <RefreshButton onClick={reload} busy={refreshing} />
          {addButton}
        </div>
      </div>

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
      {accounts.error && (
        <Banner tone="warning">
          Daftar akun gagal dimuat, jadi nama akun belum tampil: {accounts.error}{" "}
          <button type="button" onClick={accounts.reload} className="underline font-semibold cursor-pointer">
            Coba lagi
          </button>
        </Banner>
      )}
      {!canEdit && <Banner tone="info">Anda melihat pengetahuan dalam mode baca saja. Editor ke atas yang bisa mengubahnya.</Banner>}

      {/* Filter jenis: baris chip yang bisa digulir mendatar di layar sempit. */}
      <div
        role="group"
        aria-label="Filter jenis butir"
        className="-mx-4 px-4 -my-1 py-1 md:-mx-1 md:px-1 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {(["ALL", ...KNOWLEDGE_KINDS] as KindFilter[]).map((k) => {
          const active = kind === k;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={active}
              onClick={() => pickKind(k)}
              className={cn(
                "shrink-0 h-10 px-3.5 rounded-full border text-[13px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer",
                active ? "bg-accent border-accent text-on-accent" : "bg-surface border-line-strong text-fg hover:border-accent hover:text-accent"
              )}
            >
              {k === "ALL" ? "Semua" : KIND_STYLE[k].short}
              <span className={cn("tabular-nums", active ? "opacity-80" : "text-muted")}>{counts[k]}</span>
            </button>
          );
        })}
      </div>
      {kind !== "ALL" && (
        <p className="text-[13px] text-muted">
          <span className="font-semibold text-fg">{KNOWLEDGE_KIND_LABEL[kind]}.</span> {KNOWLEDGE_KIND_HINT[kind]}
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="w-6 h-6" />}
          title={kind === "ALL" ? "Belum ada butir pengetahuan." : `Belum ada butir ${KNOWLEDGE_KIND_LABEL[kind].toLowerCase()}.`}
          action={addButton}
        >
          {canEdit
            ? "Tambahkan fakta brand, daftar harga, promo yang sedang berjalan, dan kata terlarang supaya AI tidak mengarang."
            : "Butir yang ditambahkan Editor atau Admin akan muncul di sini."}
        </EmptyState>
      ) : (
        <>
          <ul className="card divide-y divide-line">
            {items.slice(0, shown).map((item) => {
              const { tone, short, Icon } = KIND_STYLE[item.jenis];
              const account = item.accountId ? byId.get(item.accountId) : null;
              const expiry = expiryOf(item.berlakuSampai, today);
              // Butir tingkat workspace hanya bisa diubah pengguna tanpa pembatasan akun (aturan server).
              const editable = canEdit && (!accountScoped || item.accountId !== null);
              const open = expanded.has(item.id);
              const terms = item.jenis === "LARANGAN" ? item.isi.split("\n") : null;
              const long = terms ? terms.length > TERMS_SHOWN : item.isi.length > EXCERPT_CHARS;
              return (
                <li key={item.id} className="p-4">
                  <div className="flex items-start gap-2">
                    <div className={cn("flex-1 min-w-0 flex flex-wrap items-center gap-1.5", editable && "pt-2")}>
                      <Pill tone={tone} icon={<Icon className="w-3.5 h-3.5 shrink-0" />}>
                        {short}
                      </Pill>
                      <Pill
                        icon={item.accountId ? <AtSign className="w-3.5 h-3.5 shrink-0" /> : <Globe className="w-3.5 h-3.5 shrink-0" />}
                      >
                        {item.accountId ? (account ? accountHandle(account).slice(1) : "satu akun") : "Semua akun"}
                      </Pill>
                      {expiry && (
                        <Pill tone={expiry.tone} icon={<CalendarClock className="w-3.5 h-3.5 shrink-0" />}>
                          {expiry.text}
                        </Pill>
                      )}
                    </div>
                    {editable && (
                      <div className="flex shrink-0 -mr-2">
                        <button
                          type="button"
                          onClick={() => setDialog({ item, today: wibDayKey(new Date()) })}
                          aria-label={`Ubah butir ${item.judul}`}
                          title="Ubah"
                          className={ICON_BTN}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRemoveError(null);
                            setRemoving(item);
                          }}
                          aria-label={`Hapus butir ${item.judul}`}
                          title="Hapus"
                          className={cn(ICON_BTN, "hover:text-danger hover:bg-danger-soft")}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  <p className={cn("mt-2 text-sm font-semibold break-words", expiry?.expired ? "text-muted" : "text-fg")}>{item.judul}</p>
                  {terms ? (
                    <ul aria-label="Kata atau frasa terlarang" className="mt-1.5 flex flex-wrap gap-1.5">
                      {(open ? terms : terms.slice(0, TERMS_SHOWN)).map((term, i) => (
                        <li key={i} className="px-2.5 py-1 rounded-lg bg-subtle text-[13px] text-fg break-all">
                          {term}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={cn("mt-1 text-sm leading-relaxed break-words", expiry?.expired ? "text-muted" : "text-fg")}>
                      {open || !long ? item.isi : `${item.isi.slice(0, EXCERPT_CHARS).trimEnd()}...`}
                    </p>
                  )}
                  {long && (
                    <button
                      type="button"
                      onClick={() => toggle(item.id)}
                      aria-expanded={open}
                      className="-mb-2 h-10 inline-flex items-center text-[13px] font-semibold text-accent hover:underline cursor-pointer"
                    >
                      {open ? "Ringkas" : terms ? `Tampilkan ${terms.length - TERMS_SHOWN} lainnya` : "Selengkapnya"}
                    </button>
                  )}
                  <p className="mt-1.5 text-xs text-faint">
                    {expiry?.expired ? "Sudah berakhir, tidak dipakai AI lagi. " : ""}
                    Diperbarui {formatDateWib(item.updatedAt)}
                  </p>
                </li>
              );
            })}
          </ul>
          {items.length > shown && <LoadMoreButton onClick={() => setShown((n) => n + PAGE)} loading={false} />}
          {data.items.length >= SERVER_CAP && (
            <p className="text-xs text-muted text-center">Menampilkan {SERVER_CAP} butir pertama. Hapus butir lama supaya sisanya terlihat.</p>
          )}
        </>
      )}

      {dialog && (
        <KnowledgeDialog
          key={dialog.item?.id ?? "baru"}
          item={dialog.item}
          defaultKind={kind === "ALL" ? "FAKTA" : kind}
          today={dialog.today}
          accounts={accounts.accounts}
          accountsLoading={accounts.loading}
          accountScoped={accountScoped}
          onClose={() => setDialog(null)}
          onSaved={(saved, created) => {
            // Butir baru tampil paling atas; butir yang diubah tetap di tempatnya.
            mutate((d) => ({
              ...d,
              items: created ? [saved, ...d.items] : d.items.map((i) => (i.id === saved.id ? saved : i)),
            }));
            if (kind !== "ALL" && kind !== saved.jenis) pickKind(saved.jenis);
            setNotice(created ? `Butir "${saved.judul}" ditambahkan.` : `Butir "${saved.judul}" diperbarui.`);
            setDialog(null);
          }}
        />
      )}

      <ConfirmModal
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={confirmRemove}
        busy={removeBusy}
        error={removeError}
        variant="danger"
        title="Hapus butir ini?"
        confirmLabel="Ya, hapus"
        confirmIcon={<Trash2 className="w-4 h-4" />}
      >
        <p className="text-sm text-fg leading-relaxed">
          <span className="font-semibold break-words">{removing?.judul}</span> tidak lagi dipakai AI saat menulis. Tindakan ini tidak bisa
          dibatalkan.
        </p>
      </ConfirmModal>
    </div>
  );
}
