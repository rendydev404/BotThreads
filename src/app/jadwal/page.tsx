"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Bot,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  Pencil,
  Plus,
  RotateCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ContentApiError, cancelPost, cancelPosts, listPosts, retryPost } from "@/lib/content-client";
import type { PostItemDTO, PostStatusKey, PostsSummaryDTO } from "@/lib/content-types";
import { clipChars } from "@/lib/threads-text";
import { formatWibFull, wibDayKey, wibParts } from "@/lib/scheduling";
import { AccountFilterSelect } from "@/components/dashboard/account-filter-select";
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal";
import { ComposerModal } from "@/components/content/composer-modal";
import { EditPostModal } from "@/components/content/edit-post-modal";
import { AccountAvatar, PostStatusChip } from "@/components/content/post-status-chip";
import { usePostStatusPoll } from "@/components/content/use-post-status-poll";
import { usePublishAccounts } from "@/components/content/use-publish-accounts";

type Scope = "upcoming" | "history";

const STATUS_FILTERS: Record<Scope, { key: PostStatusKey | null; label: string }[]> = {
  upcoming: [
    { key: null, label: "Semua" },
    { key: "SCHEDULED", label: "Terjadwal" },
    { key: "QUEUED", label: "Mengantre" },
    { key: "PROCESSING", label: "Diproses" },
  ],
  history: [
    { key: null, label: "Semua" },
    { key: "PUBLISHED", label: "Terbit" },
    { key: "FAILED", label: "Gagal" },
  ],
};

interface Loaded {
  key: string;
  items: PostItemDTO[];
  nextCursor: string | null;
  summary: PostsSummaryDTO | null;
  error: string | null;
  /** Waktu server-klien saat data diambil (untuk label Hari ini/Besok tanpa Date.now() saat render). */
  loadedAt: string;
}

const EMPTY: Loaded = { key: "", items: [], nextCursor: null, summary: null, error: null, loadedAt: "1970-01-01T00:00:00.000Z" };

const dayHeading = (iso: string, todayKey: string): string => {
  const d = new Date(iso);
  const key = wibDayKey(d);
  const today = new Date(todayKey + "T00:00:00Z").getTime();
  const diff = Math.round((new Date(key + "T00:00:00Z").getTime() - today) / 86_400_000);
  const base = new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(d);
  if (diff === 0) return `Hari ini, ${base}`;
  if (diff === 1) return `Besok, ${base}`;
  if (diff === -1) return `Kemarin, ${base}`;
  return base;
};

const timeOf = (iso: string): string => {
  const p = wibParts(new Date(iso));
  return `${String(p.h).padStart(2, "0")}.${String(p.min).padStart(2, "0")}`;
};

function SummaryCard({ label, value, tone }: { label: string; value: number | string; tone?: "danger" | "success" | "accent" }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold tabular-nums",
          tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : tone === "accent" ? "text-accent" : "text-fg"
        )}
      >
        {value}
      </p>
    </div>
  );
}

const ICON_BTN =
  "h-8 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-fg hover:bg-subtle transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted";

export default function JadwalPage() {
  const { accounts, publishEnabled, limits, loading: accountsLoading, error: accountsError } = usePublishAccounts();

  const [scope, setScope] = useState<Scope>("upcoming");
  const [account, setAccount] = useState("all");
  const [status, setStatus] = useState<PostStatusKey | null>(null);
  const [includeAll, setIncludeAll] = useState(false);
  const [tick, setTick] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>(EMPTY);
  const [loadingMore, setLoadingMore] = useState(false);

  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<PostItemDTO | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PostItemDTO | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCancelling, setBulkCancelling] = useState(false);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const queryKey = `${scope}|${account}|${status ?? ""}|${includeAll ? 1 : 0}`;
  const loading = loaded.key !== queryKey;

  const showNotice = useCallback((tone: "success" | "error", text: string) => {
    setNotice({ tone, text });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 7000);
  }, []);

  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  // Muat halaman pertama; `tick` menyegarkan tanpa mengosongkan daftar.
  useEffect(() => {
    const ctrl = new AbortController();
    listPosts({ scope, account, status, all: includeAll }, ctrl.signal)
      .then((res) =>
        setLoaded({
          key: queryKey,
          items: res.items,
          nextCursor: res.nextCursor,
          summary: res.summary ?? null,
          error: null,
          loadedAt: new Date().toISOString(),
        })
      )
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setLoaded((prev) => ({
          ...prev,
          key: queryKey,
          items: prev.key === queryKey ? prev.items : [],
          error: e instanceof Error ? e.message : "Gagal memuat jadwal.",
        }));
      });
    return () => ctrl.abort();
  }, [scope, account, status, includeAll, tick, queryKey]);

  // Penyegaran ringan tiap 60 detik saat tab terlihat (jadwal bergeser jadi Mengantre).
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const activeIds = useMemo(
    () => loaded.items.filter((i) => i.status === "QUEUED" || i.status === "PROCESSING").map((i) => i.id).slice(0, 20),
    [loaded.items]
  );
  const polled = usePostStatusPoll(activeIds);
  const items = useMemo(() => loaded.items.map((i) => polled[i.id] ?? i), [loaded.items, polled]);

  const todayKey = useMemo(() => wibDayKey(new Date(loaded.loadedAt)), [loaded.loadedAt]);
  const groups = useMemo(() => {
    const map = new Map<string, PostItemDTO[]>();
    for (const it of items) {
      const k = wibDayKey(new Date(it.tayangPada));
      const list = map.get(k);
      if (list) list.push(it);
      else map.set(k, [it]);
    }
    return [...map.entries()];
  }, [items]);

  const loadMore = async () => {
    if (!loaded.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await listPosts({ scope, account, status, all: includeAll, cursor: loaded.nextCursor });
      setLoaded((prev) => {
        const seen = new Set(prev.items.map((i) => i.dispatchId));
        return { ...prev, items: [...prev.items, ...res.items.filter((i) => !seen.has(i.dispatchId))], nextCursor: res.nextCursor };
      });
    } catch (e) {
      showNotice("error", e instanceof Error ? e.message : "Gagal memuat halaman berikutnya.");
    } finally {
      setLoadingMore(false);
    }
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await cancelPost(cancelTarget.id);
      const id = cancelTarget.id;
      setLoaded((prev) => ({ ...prev, items: prev.items.filter((i) => i.id !== id) }));
      setTick((t) => t + 1);
      setCancelTarget(null);
      showNotice("success", "Postingan dibatalkan dan dihapus dari antrean.");
    } catch (e) {
      setCancelTarget(null);
      showNotice("error", e instanceof ContentApiError ? e.message : "Gagal membatalkan postingan.");
      setTick((t) => t + 1);
    } finally {
      setCancelling(false);
    }
  };

  const confirmBulkCancel = async () => {
    if (selectedIds.size === 0) return;
    setBulkCancelling(true);
    try {
      const idsArray = Array.from(selectedIds);
      await cancelPosts(idsArray);
      
      setLoaded((prev) => ({ ...prev, items: prev.items.filter((i) => !selectedIds.has(i.id)) }));
      setSelectedIds(new Set());
      setTick((t) => t + 1);
      setShowBulkConfirm(false);
      showNotice("success", `${idsArray.length} postingan dibatalkan dan dihapus dari antrean.`);
    } catch (e) {
      setShowBulkConfirm(false);
      showNotice("error", e instanceof ContentApiError ? e.message : "Gagal membatalkan postingan yang dipilih.");
      setTick((t) => t + 1);
    } finally {
      setBulkCancelling(false);
    }
  };

  const retry = async (it: PostItemDTO) => {
    setRetryingId(it.id);
    try {
      await retryPost(it.id);
      showNotice("success", "Postingan dikirim ulang ke antrean penerbit.");
      setTick((t) => t + 1);
    } catch (e) {
      showNotice("error", e instanceof ContentApiError ? e.message : "Gagal mengirim ulang.");
    } finally {
      setRetryingId(null);
    }
  };

  const changeScope = (next: Scope) => {
    if (next === scope) return;
    setScope(next);
    setStatus(null);
    setSelectedIds(new Set());
  };

  const filterAccounts = useMemo(
    () =>
      accounts
        .filter((a) => a.username)
        .map((a) => ({ id: a.id, username: a.username, displayName: a.outletNama ?? a.displayName, avatarUrl: a.avatarUrl })),
    [accounts]
  );

  const summary = loaded.summary;
  const readyCount = accounts.filter((a) => a.ready).length;
  const emptyPrompt = encodeURIComponent("Buat 3 draf postingan untuk besok");

  return (
    <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto w-full pb-28 md:pb-10 space-y-5">
      {/* Judul halaman + aksi */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-fg">Jadwal Konten</h2>
          <p className="text-sm text-muted">Kelola postingan Threads yang dibuat dari dashboard. Semua waktu dalam WIB.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <AccountFilterSelect
            accounts={filterAccounts}
            selectedAccount={account}
            onSelectAccount={setAccount}
            totalAccounts={filterAccounts.length}
          />
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            disabled={accountsLoading || accounts.length === 0}
            className="h-14 px-5 rounded-xl bg-accent text-on-accent text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-[18px] h-[18px]" />
            Buat postingan
          </button>
        </div>
      </div>

      {/* Banner status */}
      {notice && (
        <div
          role="status"
          className={cn(
            "flex items-start gap-2.5 rounded-xl p-3.5 text-sm font-medium",
            notice.tone === "success" ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
          )}
        >
          {notice.tone === "success" ? <CheckCircle2 className="w-[18px] h-[18px] mt-0.5 shrink-0" /> : <AlertTriangle className="w-[18px] h-[18px] mt-0.5 shrink-0" />}
          <span className="flex-1">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Tutup pemberitahuan" className="shrink-0 cursor-pointer opacity-70 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {!accountsLoading && !publishEnabled && !accountsError && (
        <div className="flex items-start gap-2.5 rounded-xl bg-subtle text-muted p-3.5 text-sm font-medium">
          <Info className="w-[18px] h-[18px] mt-0.5 shrink-0" />
          Fitur posting belum diaktifkan oleh pemilik dashboard. Anda masih bisa melihat jadwal yang ada.
        </div>
      )}
      {accountsError && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-danger-soft text-danger p-3.5 text-sm font-medium">
          <AlertTriangle className="w-[18px] h-[18px] mt-0.5 shrink-0" />
          {accountsError}
        </div>
      )}
      {summary && summary.queuedLate > 0 && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-warning-soft text-warning p-3.5 text-sm font-medium">
          <AlertTriangle className="w-[18px] h-[18px] mt-0.5 shrink-0" />
          Penerbit belum memproses {summary.queuedLate} postingan. Periksa worker Threads di SukaPost.
        </div>
      )}

      {/* Ringkasan */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Terjadwal hari ini" value={summary ? summary.scheduledToday : "-"} tone="accent" />
        <SummaryCard label="Terbit 7 hari" value={summary ? summary.published7d : "-"} tone="success" />
        <SummaryCard label="Gagal 7 hari" value={summary ? summary.failed7d : "-"} tone={summary && summary.failed7d > 0 ? "danger" : undefined} />
        <SummaryCard label="Akun siap diposting" value={accountsLoading ? "-" : `${readyCount}/${accounts.length}`} />
      </div>

      {/* Tab + filter */}
      <div className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4 border-b border-line">
          <div role="tablist" aria-label="Jenis jadwal" className="flex gap-6">
            {(
              [
                { key: "upcoming", label: "Terjadwal" },
                { key: "history", label: "Riwayat" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={scope === t.key}
                onClick={() => changeScope(t.key)}
                className={cn(
                  "relative pb-3 text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer",
                  scope === t.key ? "text-accent" : "text-muted hover:text-fg"
                )}
              >
                {t.label}
                {scope === t.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />}
              </button>
            ))}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={includeAll}
            onClick={() => setIncludeAll((v) => !v)}
            className="pb-3 inline-flex items-center gap-2 text-[13px] font-medium text-muted hover:text-fg cursor-pointer"
          >
            <span className={cn("relative w-9 h-5 rounded-full transition-colors", includeAll ? "bg-accent" : "bg-line-strong")} aria-hidden>
              <span className={cn("absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-surface transition-transform", includeAll && "translate-x-4")} />
            </span>
            <span className="hidden sm:inline">Tampilkan juga dari SukaPost</span>
            <span className="sm:hidden">SukaPost</span>
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {STATUS_FILTERS[scope].map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => {
                setStatus(f.key);
                setSelectedIds(new Set());
              }}
              aria-pressed={status === f.key}
              className={cn(
                "shrink-0 h-8 px-3.5 rounded-full border text-[13px] font-semibold transition-colors cursor-pointer",
                status === f.key ? "bg-accent text-on-accent border-accent" : "bg-surface text-muted border-line-strong hover:border-accent hover:text-accent"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Daftar */}
      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Memuat jadwal">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="h-4 w-1/3 rounded bg-subtle" />
              <div className="mt-3 h-3 w-full rounded bg-subtle" />
              <div className="mt-2 h-3 w-2/3 rounded bg-subtle" />
            </div>
          ))}
        </div>
      ) : loaded.error && items.length === 0 ? (
        <div role="alert" className="card p-8 text-center">
          <AlertTriangle className="w-8 h-8 text-danger mx-auto" />
          <p className="mt-3 text-sm font-semibold text-fg">{loaded.error}</p>
          <button
            type="button"
            onClick={() => setTick((t) => t + 1)}
            className="mt-4 h-10 px-5 rounded-full bg-accent text-on-accent text-sm font-semibold inline-flex items-center gap-2 cursor-pointer hover:bg-accent-hover"
          >
            <RotateCw className="w-4 h-4" />
            Coba lagi
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
            <CalendarClock className="w-6 h-6" />
          </div>
          <h3 className="mt-4 text-base font-bold text-fg">{scope === "upcoming" ? "Belum ada jadwal" : "Belum ada riwayat"}</h3>
          <p className="mt-1 text-sm text-muted max-w-sm mx-auto">
            {scope === "upcoming"
              ? "Minta asisten AI menyusun draf berdasarkan performa akun, atau tulis postingan sendiri."
              : "Postingan yang sudah terbit atau gagal akan muncul di sini."}
          </p>
          {scope === "upcoming" && (
            <div className="mt-5 flex flex-col sm:flex-row gap-2 justify-center">
              <Link
                href={`/prompt-studio?prompt=${emptyPrompt}`}
                className="h-10 px-5 rounded-full bg-accent text-on-accent text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-accent-hover transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                Minta draf dari AI
              </Link>
              <button
                type="button"
                onClick={() => setComposerOpen(true)}
                disabled={accounts.length === 0}
                className="h-10 px-5 rounded-full border border-line-strong text-sm font-semibold text-fg inline-flex items-center justify-center gap-2 hover:border-accent hover:text-accent transition-colors cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                Tulis sendiri
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {scope === "upcoming" && items.some(i => i.cancellable) && (
            <div className="flex items-center justify-between p-3 bg-surface border border-line rounded-xl">
              <div className="flex items-center gap-3 ml-1">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-line-strong text-accent focus:ring-accent cursor-pointer"
                  checked={items.filter((i) => i.cancellable).every((i) => selectedIds.has(i.id)) && items.some((i) => i.cancellable)}
                  onChange={(e) => {
                    const cancellableIds = items.filter((i) => i.cancellable).map((i) => i.id);
                    if (e.target.checked) {
                      setSelectedIds(new Set([...selectedIds, ...cancellableIds]));
                    } else {
                      const next = new Set(selectedIds);
                      cancellableIds.forEach((id) => next.delete(id));
                      setSelectedIds(next);
                    }
                  }}
                />
                <span className="text-sm font-semibold text-fg">
                  {selectedIds.size > 0 ? `${selectedIds.size} dipilih` : "Pilih semua"}
                </span>
              </div>
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setShowBulkConfirm(true)}
                  className="h-8 px-3 rounded-lg bg-danger-soft text-danger text-[13px] font-semibold inline-flex items-center gap-1.5 hover:bg-danger hover:text-white transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Batalkan ({selectedIds.size})
                </button>
              )}
            </div>
          )}
          {groups.map(([key, list]) => (
            <section key={key} aria-label={dayHeading(list[0].tayangPada, todayKey)}>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{dayHeading(list[0].tayangPada, todayKey)}</h3>
              <ul className="card divide-y divide-line overflow-hidden">
                {list.map((it) => (
                  <li key={it.dispatchId} className="p-4 flex items-start gap-3 relative">
                    {it.cancellable && (
                      <div className="pt-0.5">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-line-strong text-accent focus:ring-accent cursor-pointer"
                          checked={selectedIds.has(it.id)}
                          onChange={(e) => {
                            const next = new Set(selectedIds);
                            if (e.target.checked) next.add(it.id);
                            else next.delete(it.id);
                            setSelectedIds(next);
                          }}
                        />
                      </div>
                    )}
                    <div className="w-12 shrink-0 pt-0.5 text-sm font-bold text-fg tabular-nums">{timeOf(it.tayangPada)}</div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                        <AccountAvatar name={it.account.displayName} src={it.account.avatarUrl} size="w-6 h-6" />
                        <span className="text-[13px] font-semibold text-fg truncate max-w-[14rem]">
                          @{it.account.username ?? it.account.displayName}
                        </span>
                        <PostStatusChip status={it.status} />
                        {it.autopilot && (
                          <span className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-xs font-semibold whitespace-nowrap bg-subtle text-muted">
                            <Bot className="w-3.5 h-3.5" />
                            Autopilot
                          </span>
                        )}
                        {!it.mine && (
                          <span className="h-6 px-2 rounded-full bg-subtle text-muted text-xs font-semibold inline-flex items-center">SukaPost</span>
                        )}
                      </div>
                      <p className="text-sm text-fg leading-relaxed whitespace-pre-wrap break-words">{clipChars(it.text, 280)}</p>
                      {it.topicTag && <p className="text-xs font-medium text-muted">#{it.topicTag}</p>}
                      {it.status === "FAILED" && it.pesanError && (
                        <p className="flex items-start gap-2 rounded-lg bg-danger-soft text-danger p-2.5 text-[13px] font-medium">
                          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                          {it.pesanError}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-1 -ml-2.5">
                        {it.editable && (
                          <button type="button" onClick={() => setEditing(it)} disabled={!publishEnabled} className={ICON_BTN}>
                            <Pencil className="w-3.5 h-3.5" />
                            Ubah
                          </button>
                        )}
                        {it.cancellable && (
                          <button type="button" onClick={() => setCancelTarget(it)} disabled={!publishEnabled} className={cn(ICON_BTN, "hover:text-danger")}>
                            <Trash2 className="w-3.5 h-3.5" />
                            Batalkan
                          </button>
                        )}
                        {it.retryable && (
                          <button type="button" onClick={() => retry(it)} disabled={!publishEnabled || retryingId === it.id} className={ICON_BTN}>
                            {retryingId === it.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                            Kirim ulang
                          </button>
                        )}
                        {it.releaseUrl && (
                          <a href={it.releaseUrl} target="_blank" rel="noopener noreferrer" className={cn(ICON_BTN, "text-accent hover:text-accent")}>
                            <ExternalLink className="w-3.5 h-3.5" />
                            Lihat di Threads
                          </a>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {loaded.nextCursor && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="h-10 px-6 rounded-full border border-line-strong text-sm font-semibold text-fg hover:border-accent hover:text-accent transition-colors cursor-pointer inline-flex items-center gap-2 disabled:opacity-60"
              >
                {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                Muat lebih banyak
              </button>
            </div>
          )}
        </div>
      )}

      <ComposerModal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        accounts={accounts}
        publishEnabled={publishEnabled}
        limits={limits}
        onCreated={(count, mode) => {
          setComposerOpen(false);
          setScope("upcoming");
          setStatus(null);
          setTick((t) => t + 1);
          showNotice(
            "success",
            mode === "now"
              ? `${count} postingan masuk antrean dan akan tayang dalam sekitar 30 detik.`
              : `${count} postingan dijadwalkan.`
          );
        }}
      />

      <EditPostModal
        post={editing}
        onClose={() => setEditing(null)}
        onSaved={(post) => {
          setEditing(null);
          if (post) setLoaded((prev) => ({ ...prev, items: prev.items.map((i) => (i.id === post.id ? post : i)) }));
          setTick((t) => t + 1);
          showNotice("success", "Perubahan disimpan.");
        }}
      />

      <DeleteConfirmModal
        isOpen={cancelTarget !== null}
        onClose={() => !cancelling && setCancelTarget(null)}
        onConfirm={confirmCancel}
        isDeleting={cancelling}
        tableName='ScheduledPost + PostDispatch (antrean Threads)'
        recordIdentifier={cancelTarget ? `@${cancelTarget.account.username ?? cancelTarget.account.displayName} | ${formatWibFull(new Date(cancelTarget.tayangPada))}` : ""}
        description={cancelTarget ? `Postingan "${clipChars(cancelTarget.text, 90)}" dibatalkan dan baris antreannya dihapus. Tidak ada yang diposting.` : undefined}
      />

      <DeleteConfirmModal
        isOpen={showBulkConfirm}
        onClose={() => !bulkCancelling && setShowBulkConfirm(false)}
        onConfirm={confirmBulkCancel}
        isDeleting={bulkCancelling}
        tableName='ScheduledPost + PostDispatch (antrean Threads)'
        recordIdentifier={`${selectedIds.size} Postingan Terpilih`}
        description={`Anda yakin ingin membatalkan ${selectedIds.size} postingan sekaligus? Postingan akan dihapus dari antrean dan tidak akan diposting ke Threads.`}
      />
    </div>
  );
}
