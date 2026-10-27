"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownCircle,
  Bell,
  CheckCheck,
  Clock,
  Database,
  ExternalLink,
  Inbox,
  Loader2,
  PauseCircle,
  RotateCw,
  TimerOff,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchNotifications, markNotificationsRead } from "@/lib/notification-client";
import type { NotificationDTO, NotificationKind } from "@/lib/notification-types";
import { formatWibFull } from "@/lib/scheduling";
import { usePopover } from "./use-popover";
import { useT } from "@/components/i18n/lang-provider";

const POLL_MS = 60_000;
/** Membuka dropdown dalam selang ini setelah fetch terakhir tidak memicu fetch baru. */
const FRESH_MS = 5_000;

const KIND_STYLE: Record<NotificationKind, { Icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  VIRAL: { Icon: TrendingUp, cls: "bg-success-soft text-success" },
  AKUN_DIJEDA: { Icon: PauseCircle, cls: "bg-warning-soft text-warning" },
  MODE_DITURUNKAN: { Icon: ArrowDownCircle, cls: "bg-warning-soft text-warning" },
  PENERBIT_TELAT: { Icon: Clock, cls: "bg-danger-soft text-danger" },
  PENJADWAL: { Icon: TimerOff, cls: "bg-danger-soft text-danger" },
};
const FALLBACK_STYLE = { Icon: Bell, cls: "bg-subtle text-muted" };

interface BellState {
  /** Sudah ada jawaban pertama dari server (berhasil atau gagal). */
  loaded: boolean;
  installed: boolean;
  unread: number;
  items: NotificationDTO[];
  nextCursor: string | null;
  /** Jumlah halaman yang sudah dimuat; lebih dari satu berarti pengguna menekan "Muat lagi". */
  pages: number;
  error: string | null;
}

const INITIAL: BellState = { loaded: false, installed: true, unread: 0, items: [], nextCursor: null, pages: 0, error: null };

/** Tautan dalam aplikasi ("/autopilot?tab=tinjau"), tautan luar https, atau tanpa tautan. */
function linkKind(tautan: string | null): "internal" | "external" | "none" {
  if (!tautan) return "none";
  if (tautan.startsWith("/") && !tautan.startsWith("//") && !tautan.includes("\\")) return "internal";
  if (tautan.startsWith("https://")) return "external";
  return "none";
}

/**
 * Lonceng notifikasi: satu fetch saat tampil, lalu tiap 60 detik HANYA selama tab browser terlihat.
 * Daftar dimuat ulang saat dropdown dibuka. Bila tabel notifikasi belum dipasang, polling berhenti.
 */
export function NotificationBell() {
  const t = useT();
  const { open, setOpen, rootRef, triggerRef } = usePopover();
  const [state, setState] = useState<BellState>(INITIAL);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const ctrlRef = useRef<AbortController | null>(null);
  const lastOkRef = useRef(0);
  const installedRef = useRef(true);

  const refresh = useCallback((): Promise<void> => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    return fetchNotifications(null, ctrl.signal)
      .then(
        (res) => {
          if (ctrl.signal.aborted) return;
          lastOkRef.current = Date.now();
          installedRef.current = res.installed;
          setState((prev) => {
            // Halaman lanjutan yang sudah dimuat dipertahankan; halaman pertama diganti data terbaru.
            if (prev.pages > 1) {
              const fresh = new Set(res.items.map((i) => i.id));
              return {
                ...prev,
                loaded: true,
                installed: res.installed,
                unread: res.unread,
                items: [...res.items, ...prev.items.filter((i) => !fresh.has(i.id))],
                error: null,
              };
            }
            return { loaded: true, installed: res.installed, unread: res.unread, items: res.items, nextCursor: res.nextCursor, pages: 1, error: null };
          });
        },
        (e: unknown) => {
          if (ctrl.signal.aborted) return;
          setState((prev) => ({ ...prev, loaded: true, error: e instanceof Error ? e.message : "Gagal memuat notifikasi." }));
        }
      )
      .finally(() => {
        if (ctrlRef.current === ctrl) ctrlRef.current = null;
      });
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer !== undefined) return;
      // Putaran dilewati bila permintaan sebelumnya belum selesai atau fiturnya belum dipasang.
      timer = setInterval(() => {
        if (!ctrlRef.current && installedRef.current) void refresh();
      }, POLL_MS);
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        stop();
        return;
      }
      if (!ctrlRef.current && installedRef.current && Date.now() - lastOkRef.current > POLL_MS) void refresh();
      start();
    };

    void refresh();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      ctrlRef.current?.abort();
      ctrlRef.current = null;
    };
  }, [refresh]);

  const reloadList = () => {
    setActionError(null);
    setRefreshing(true);
    void refresh().finally(() => setRefreshing(false));
  };

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (ctrlRef.current || Date.now() - lastOkRef.current < FRESH_MS) return;
    reloadList();
  };

  const markRead = (n: NotificationDTO) => {
    if (n.dibaca) return;
    setState((prev) => ({
      ...prev,
      unread: Math.max(0, prev.unread - 1),
      items: prev.items.map((i) => (i.id === n.id ? { ...i, dibaca: true } : i)),
    }));
    // Gagal menandai tidak mengganggu navigasi; polling berikutnya menyelaraskan lagi.
    markNotificationsRead([n.id]).catch(() => undefined);
  };

  const markAll = async () => {
    if (markingAll) return;
    setMarkingAll(true);
    setActionError(null);
    try {
      await markNotificationsRead();
      setState((prev) => ({ ...prev, unread: 0, items: prev.items.map((i) => (i.dibaca ? i : { ...i, dibaca: true })) }));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Gagal menandai notifikasi.");
    } finally {
      setMarkingAll(false);
    }
  };

  const loadMore = async () => {
    if (!state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setActionError(null);
    try {
      const res = await fetchNotifications(state.nextCursor);
      setState((prev) => {
        const seen = new Set(prev.items.map((i) => i.id));
        return {
          ...prev,
          unread: res.unread,
          items: [...prev.items, ...res.items.filter((i) => !seen.has(i.id))],
          nextCursor: res.nextCursor,
          pages: prev.pages + 1,
        };
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Gagal memuat notifikasi berikutnya.");
    } finally {
      setLoadingMore(false);
    }
  };

  const onItem = (n: NotificationDTO) => {
    markRead(n);
    setOpen(false);
  };

  const badge = state.unread > 9 ? "9+" : String(state.unread);

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={state.unread > 0 ? t("Notifikasi, {n} belum dibaca", { n: state.unread }) : t("Notifikasi")}
        className={cn(
          "relative w-10 h-10 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center transition-colors cursor-pointer",
          open ? "bg-subtle text-fg" : "text-muted hover:text-fg hover:bg-subtle"
        )}
      >
        <Bell className="w-[18px] h-[18px]" />
        {state.unread > 0 && (
          <span
            aria-hidden
            className="absolute top-1 right-0.5 sm:top-0.5 sm:right-0 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-on-accent text-[10px] font-bold leading-none inline-flex items-center justify-center ring-2 ring-surface tabular-nums"
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("Notifikasi")}
          className="fixed inset-x-3 top-[4.25rem] sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-96 max-h-[calc(100dvh-10rem)] sm:max-h-[32rem] flex flex-col bg-surface rounded-xl shadow-pop border border-line z-50 animate-[pop-in_150ms_ease-out]"
        >
          <div className="flex items-center justify-between gap-3 pl-4 pr-2 h-12 shrink-0 border-b border-line">
            <h2 className="font-semibold text-sm text-fg flex items-center gap-2">
              {t("Notifikasi")}
              {refreshing && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted" aria-label={t("Memuat")} />}
            </h2>
            {state.unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                disabled={markingAll}
                className="h-10 px-2 rounded-lg text-xs text-accent font-semibold inline-flex items-center gap-1.5 hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {markingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
                {t("Tandai semua dibaca")}
              </button>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {actionError && (
              <p role="alert" className="m-3 flex items-start gap-2 rounded-lg bg-danger-soft text-danger p-2.5 text-[13px] font-medium">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                {t(actionError)}
              </p>
            )}

            {!state.loaded ? (
              <div className="p-4 space-y-4" aria-busy="true" aria-label={t("Memuat notifikasi")}>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex gap-3 animate-pulse">
                    <div className="w-8 h-8 rounded-lg bg-subtle shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-2/3 rounded bg-subtle" />
                      <div className="h-3 w-full rounded bg-subtle" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !state.installed ? (
              <div className="px-5 py-8 text-center">
                <div className="mx-auto w-10 h-10 rounded-xl bg-warning-soft text-warning flex items-center justify-center">
                  <Database className="w-5 h-5" />
                </div>
                <p className="mt-3 text-sm font-semibold text-fg">{t("Notifikasi belum dipasang.")}</p>
                <p className="mt-1 text-[13px] text-muted">
                  {t("Pemilik dashboard perlu menjalankan")}{" "}
                  <code className="px-1 py-0.5 rounded bg-subtle text-fg text-xs font-semibold break-all">sql/007_autopilot_learning.sql</code> {t("di Supabase.")}
                </p>
              </div>
            ) : state.error && state.items.length === 0 ? (
              <div role="alert" className="px-5 py-8 text-center">
                <AlertTriangle className="w-7 h-7 text-danger mx-auto" />
                <p className="mt-2 text-sm font-semibold text-fg">{t(state.error)}</p>
                <button
                  type="button"
                  onClick={reloadList}
                  disabled={refreshing}
                  className="mt-3 h-10 px-4 rounded-full bg-accent text-on-accent text-[13px] font-semibold inline-flex items-center gap-2 cursor-pointer hover:bg-accent-hover disabled:opacity-60"
                >
                  <RotateCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
                  {t("Coba lagi")}
                </button>
              </div>
            ) : state.items.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <div className="mx-auto w-10 h-10 rounded-xl bg-subtle text-muted flex items-center justify-center">
                  <Inbox className="w-5 h-5" />
                </div>
                <p className="mt-3 text-sm font-semibold text-fg">{t("Belum ada notifikasi.")}</p>
                <p className="mt-1 text-[13px] text-muted">{t("Posting viral, akun yang dijeda, dan masalah penjadwal akan muncul di sini.")}</p>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {state.items.map((n) => {
                  const { Icon, cls } = KIND_STYLE[n.jenis] ?? FALLBACK_STYLE;
                  const kind = linkKind(n.tautan);
                  const body = (
                    <>
                      <span className={cn("w-8 h-8 rounded-lg shrink-0 flex items-center justify-center", cls)}>
                        <Icon className="w-4 h-4" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className={cn("block text-sm text-fg break-words", n.dibaca ? "font-medium" : "font-bold")}>{n.judul}</span>
                        {n.isi && <span className="mt-0.5 block text-[13px] text-muted break-words line-clamp-3">{n.isi}</span>}
                        <span className="mt-1 flex items-center gap-1.5 text-xs text-faint tabular-nums">
                          {formatWibFull(new Date(n.createdAt))}
                          {kind === "external" && <ExternalLink className="w-3 h-3" aria-label={t("Membuka tab baru")} />}
                        </span>
                      </span>
                      <span className="w-2 shrink-0 pt-1.5">
                        {!n.dibaca && (
                          <>
                            <span className="block w-2 h-2 rounded-full bg-accent" aria-hidden />
                            <span className="sr-only">{t("Belum dibaca")}</span>
                          </>
                        )}
                      </span>
                    </>
                  );
                  const rowCls = cn(
                    "w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-subtle",
                    !n.dibaca && "bg-accent-soft/40"
                  );
                  return (
                    <li key={n.id}>
                      {kind === "internal" ? (
                        <Link href={n.tautan as string} onClick={() => onItem(n)} className={rowCls}>
                          {body}
                        </Link>
                      ) : kind === "external" ? (
                        <a href={n.tautan as string} target="_blank" rel="noopener noreferrer" onClick={() => onItem(n)} className={rowCls}>
                          {body}
                        </a>
                      ) : (
                        <button type="button" onClick={() => markRead(n)} className={cn(rowCls, n.dibaca ? "cursor-default" : "cursor-pointer")}>
                          {body}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {state.loaded && state.installed && state.items.length > 0 && state.nextCursor && (
              <div className="p-3 flex justify-center border-t border-line">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="h-10 px-5 rounded-full border border-line-strong text-[13px] font-semibold text-fg hover:border-accent hover:text-accent transition-colors cursor-pointer inline-flex items-center gap-2 disabled:opacity-60"
                >
                  {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {t("Muat lagi")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
