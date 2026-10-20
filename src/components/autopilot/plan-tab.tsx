"use client";

import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarRange, ExternalLink, Flame, Lightbulb, PenLine, RefreshCw, RotateCw, ShoppingBag, Sparkles, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchAutopilotPlan } from "@/lib/autopilot-client";
import type { AutopilotOverviewResponse, AutopilotSlotDTO, PlanItemDTO, PlanViewResponse } from "@/lib/autopilot-types";
import { charLength, clipChars } from "@/lib/threads-text";
import { AccountFilterSelect } from "@/components/dashboard/account-filter-select";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { SourceChip } from "@/components/radar/shared";
import { Banner, ListSkeleton, Segmented, SlotKindChip, SlotStatusChip, accountHandle, timeOf, type SegmentedOption } from "./shared";

type DayKey = "today" | "tomorrow";

const DAY_OPTIONS: SegmentedOption<DayKey>[] = [
  { value: "today", label: "Hari ini" },
  { value: "tomorrow", label: "Besok" },
];

const EXCERPT_CHARS = 180;
/** Rencana yang dimuat kurang dari ini dipakai ulang saat kembali ke filter yang sama (tanpa fetch). */
const FRESH_MS = 60_000;
const CHIP = "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-semibold whitespace-nowrap";

const KIND_BADGE: Record<PlanItemDTO["kind"], { label: string; cls: string; Icon: React.ComponentType<{ className?: string }> }> = {
  DRAF: { label: "Draf AI", cls: "bg-success-soft text-success", Icon: PenLine },
  IDE: { label: "Perkiraan topik", cls: "bg-accent-soft text-accent", Icon: Lightbulb },
  PROMO: { label: "Giliran promo", cls: "bg-warning-soft text-warning", Icon: Tag },
  AFFILIATE: { label: "Giliran affiliate", cls: "bg-warning-soft text-warning", Icon: ShoppingBag },
  BEBAS: { label: "Topik dipilih saat menulis", cls: "bg-subtle text-muted", Icon: Sparkles },
};

interface CacheEntry {
  at: number;
  /** Tanda status slot hari itu saat dimuat; berubah = ada slot yang baru ditulis/terbit. */
  sig: string;
  res: PlanViewResponse;
}

/* ------------------------------------------------------------------ kartu slot */

interface PlanRowProps {
  slot: AutopilotSlotDTO;
  item: PlanItemDTO;
  account: { username: string | null; displayName: string; avatarUrl: string | null } | undefined;
}

const PlanRow = memo(function PlanRow({ slot, item, account }: PlanRowProps) {
  const [open, setOpen] = useState(false);
  const badge = KIND_BADGE[item.kind];
  const text = item.text ?? "";
  const long = charLength(text) > EXCERPT_CHARS;
  const trending = item.signals.some((s) => s.source !== "JARINGAN" && s.source !== "MANUAL");

  return (
    <li className="p-4 grid sm:grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
      {/* Layar kecil: jam di atas isi (kolom kiri menyempitkan teks); sm ke atas: kolom jam di kiri. */}
      <div className="pt-0.5 flex items-baseline gap-1.5 sm:block">
        <p className="text-base font-bold text-fg tabular-nums leading-none">{timeOf(slot.slotAt)}</p>
        <p className="sm:mt-1 text-[11px] font-medium text-faint">WIB</p>
      </div>

      <div className="min-w-0 space-y-2.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          {account && (
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <AccountAvatar name={account.displayName} src={account.avatarUrl} size="w-5 h-5" />
              <span className="text-[13px] font-semibold text-fg truncate max-w-[14rem]">{accountHandle(account)}</span>
            </span>
          )}
          <SlotStatusChip status={slot.status} />
          <SlotKindChip kind={slot.kind} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn(CHIP, badge.cls)}>
            <badge.Icon className="w-3.5 h-3.5 shrink-0" />
            {badge.label}
          </span>
          {trending && (
            <span className={cn(CHIP, "bg-danger-soft text-danger")}>
              <Flame className="w-3.5 h-3.5 shrink-0" />
              Menumpang tren
            </span>
          )}
          {item.viral !== null && (
            <span className={cn(CHIP, "bg-subtle text-fg")} title="Peluang memancing balasan dan repost di Threads menurut perencana AI">
              <span className="font-medium text-muted">Potensi viral</span>
              <span className="tabular-nums">{item.viral}</span>
            </span>
          )}
        </div>

        {item.topik ? (
          <p className="text-[15px] font-semibold text-fg leading-snug break-words">{item.topik}</p>
        ) : item.kind === "BEBAS" && !text ? (
          <p className="text-sm text-muted">
            {item.tentative
              ? "Bank ide akun ini sedang kosong. AI memilih topik dari gaya akun dan tren terbaru saat menulis."
              : "Slot ini tidak sempat ditulis."}
          </p>
        ) : null}

        {text && (
          <div className="rounded-xl border border-line bg-surface p-3">
            <p className="text-sm text-fg leading-relaxed whitespace-pre-wrap break-words">
              {open || !long ? text : `${clipChars(text, EXCERPT_CHARS).trimEnd()}...`}
            </p>
            {long && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="-mb-2 h-10 inline-flex items-center text-[13px] font-semibold text-accent hover:underline cursor-pointer"
              >
                {open ? "Ringkas" : "Selengkapnya"}
              </button>
            )}
          </div>
        )}

        {(item.alasan || item.sudut) && (
          <div className="space-y-1">
            {item.alasan && (
              <p className="text-sm text-muted leading-relaxed break-words">
                <span className="font-semibold text-fg">Kenapa bisa ramai:</span> {item.alasan}
              </p>
            )}
            {item.sudut && (
              <p className="text-sm text-muted leading-relaxed break-words">
                <span className="font-semibold text-fg">Sudut:</span> {item.sudut}
              </p>
            )}
          </div>
        )}

        {(item.hook || item.pilar) && (
          <div className="flex flex-wrap gap-1.5">
            {item.hook && (
              <span className={cn(CHIP, "bg-subtle text-fg")}>
                <span className="font-medium text-muted">Pembuka:</span>
                {item.hook}
              </span>
            )}
            {item.pilar && (
              <span className={cn(CHIP, "bg-subtle text-fg max-w-full")}>
                <span className="shrink-0 font-medium text-muted">Kategori:</span>
                <span className="min-w-0 truncate">{item.pilar}</span>
              </span>
            )}
          </div>
        )}

        {item.signals.length > 0 && (
          <ul className="space-y-1.5" aria-label="Tren rujukan">
            {item.signals.map((s, i) => (
              <li key={`${s.source}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                <SourceChip source={s.source} />
                {s.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 text-[13px] font-medium text-fg hover:text-accent hover:underline inline-flex items-center gap-1 break-words"
                  >
                    {clipChars(s.title, 90)}
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                ) : (
                  <span className="min-w-0 text-[13px] font-medium text-fg break-words">{clipChars(s.title, 90)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
});

/* ------------------------------------------------------------------ tab */

interface PlanTabProps {
  data: AutopilotOverviewResponse;
  /** Tab sedang terlihat: fetch hanya terjadi saat ini benar. */
  active: boolean;
}

/**
 * Rencana posting: tiap slot hari ini/besok beserta isinya. Slot yang sudah ditulis menampilkan draf;
 * yang belum menampilkan perkiraan topik dari bank ide dan tren yang ditumpanginya.
 *
 * Fetch hanya saat tab terlihat. Hasil disimpan per (hari, akun) selama 60 detik, dan dimuat ulang bila
 * status slot hari itu di ringkasan (yang sudah dipolling halaman) berubah, jadi tidak ada polling sendiri.
 */
export function PlanTab({ data, active }: PlanTabProps) {
  const [day, setDay] = useState<DayKey>("today");
  /** "all" atau username (format AccountFilterSelect). */
  const [account, setAccount] = useState("all");
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ key: string; res: PlanViewResponse | null; error: string | null; loading: boolean }>({
    key: "",
    res: null,
    error: null,
    loading: false,
  });
  const cache = useRef(new Map<string, CacheEntry>());
  const lastTick = useRef(0);

  const filterAccounts = useMemo(
    () =>
      data.accounts
        .filter((a) => a.username)
        .map((a) => ({ id: a.id, username: a.username, displayName: a.outletNama ?? a.displayName, avatarUrl: a.avatarUrl })),
    [data.accounts]
  );
  const accountId = useMemo(
    () => (account === "all" ? null : (data.accounts.find((a) => a.username?.toLowerCase() === account.toLowerCase())?.id ?? null)),
    [data.accounts, account]
  );
  const accountsById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts]);

  const dayKey = day === "today" ? data.today : data.tomorrow;
  const daySlots = useMemo(
    () =>
      data.slots
        .filter((s) => s.dayKey === dayKey && (!accountId || s.accountId === accountId))
        .sort((a, b) => a.slotAt.localeCompare(b.slotAt) || a.id.localeCompare(b.id)),
    [data.slots, dayKey, accountId]
  );
  // Tanda status slot: berubah saat slot ditulis, diantre, atau terbit (dari polling ringkasan).
  const sig = useMemo(() => daySlots.map((s) => `${s.id}:${s.status}`).join(","), [daySlots]);
  const key = `${day}|${accountId ?? "all"}`;

  useEffect(() => {
    if (!active) return;
    const forced = tick !== lastTick.current;
    lastTick.current = tick;
    const hit = cache.current.get(key);
    if (!forced && hit && hit.sig === sig && Date.now() - hit.at < FRESH_MS) {
      setState({ key, res: hit.res, error: null, loading: false });
      return;
    }
    const ctrl = new AbortController();
    setState((prev) => ({ key, res: prev.key === key ? prev.res : (hit?.res ?? null), error: null, loading: true }));
    fetchAutopilotPlan({ day, accountId }, ctrl.signal)
      .then((res) => {
        if (ctrl.signal.aborted) return;
        cache.current.set(key, { at: Date.now(), sig, res });
        setState({ key, res, error: null, loading: false });
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setState((prev) => ({ ...prev, key, error: e instanceof Error ? e.message : "Gagal memuat rencana.", loading: false }));
      });
    return () => ctrl.abort();
  }, [active, key, sig, day, accountId, tick]);

  const items = state.key === key ? state.res?.items : undefined;
  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.slotId, i])), [items]);
  const rows = daySlots.filter((s) => byId.has(s.id));
  const stats = useMemo(() => {
    const list = items ?? [];
    return {
      written: list.filter((i) => i.kind === "DRAF").length,
      trending: list.filter((i) => i.signals.some((s) => s.source !== "JARINGAN" && s.source !== "MANUAL")).length,
    };
  }, [items]);
  const firstLoad = !items && !state.error;

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center gap-2.5">
        <div className="flex-1 min-w-0">
          <AccountFilterSelect
            accounts={filterAccounts}
            selectedAccount={account}
            onSelectAccount={setAccount}
            totalAccounts={filterAccounts.length}
          />
        </div>
        <div className="flex items-center gap-2.5">
          <Segmented ariaLabel="Hari rencana" options={DAY_OPTIONS} value={day} onChange={setDay} className="w-full lg:w-52" />
          <button
            type="button"
            onClick={() => setTick((t) => t + 1)}
            disabled={state.loading}
            className="shrink-0 h-10 px-3.5 rounded-full border border-line-strong text-[13px] font-semibold text-fg inline-flex items-center gap-1.5 hover:border-accent hover:text-accent transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", state.loading && items && "animate-spin")} />
            Segarkan
          </button>
        </div>
      </div>

      <Banner tone="info">
        Slot yang belum ditulis menampilkan perkiraan topik dari bank ide; ide yang menumpang tren didahulukan. Teksnya ditulis AI sekitar 90
        menit sebelum tayang (6 jam untuk mode Tinjau dulu) supaya tetap mengikuti tren terbaru.
      </Banner>

      {firstLoad ? (
        <ListSkeleton label="Memuat rencana posting" />
      ) : state.error && !items ? (
        <div role="alert" className="card p-8 text-center">
          <AlertTriangle className="w-8 h-8 text-danger mx-auto" />
          <p className="mt-3 text-sm font-semibold text-fg">{state.error}</p>
          <button
            type="button"
            onClick={() => setTick((t) => t + 1)}
            className="mt-4 h-10 px-5 rounded-full bg-accent text-on-accent text-sm font-semibold inline-flex items-center gap-2 cursor-pointer hover:bg-accent-hover"
          >
            <RotateCw className="w-4 h-4" />
            Coba lagi
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
            <CalendarRange className="w-6 h-6" />
          </div>
          <p className="mt-4 text-sm font-semibold text-fg">Belum ada slot {day === "today" ? "hari ini" : "besok"}.</p>
          <p className="mt-1 text-sm text-muted">
            Nyalakan autopilot di tab Akun. Jadwal hari ini dan besok disusun otomatis dalam beberapa menit.
          </p>
        </div>
      ) : (
        <>
          {state.error && <Banner tone="danger">{state.error}</Banner>}
          <p className="text-sm text-muted">
            <span className="font-semibold text-fg tabular-nums">{rows.length}</span> slot ·{" "}
            <span className="font-semibold text-fg tabular-nums">{stats.written}</span> sudah ditulis ·{" "}
            <span className="font-semibold text-fg tabular-nums">{stats.trending}</span> menumpang tren
          </p>
          <ul className="card divide-y divide-line">
            {rows.map((s) => (
              <PlanRow key={s.id} slot={s} item={byId.get(s.id)!} account={accountsById.get(s.accountId)} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
