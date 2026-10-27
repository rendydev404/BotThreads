"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, History, RefreshCw, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { listAutopilotSlots } from "@/lib/autopilot-client";
import type { AutopilotAccountDTO, SlotListResponse } from "@/lib/autopilot-types";
import { charLength, clipChars } from "@/lib/threads-text";
import { AccountFilterSelect } from "@/components/dashboard/account-filter-select";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { useT } from "@/components/i18n/lang-provider";
import { tr } from "@/lib/i18n/core";
import { Banner, ListSkeleton, LoadMoreButton, SlotKindChip, SlotStatusChip, accountHandle, apiErrorText, wibFullText } from "./shared";

type Item = SlotListResponse["items"][number];

const EXCERPT_CHARS = 140;

interface Loaded {
  key: string;
  tick: number;
  items: Item[];
  nextCursor: string | null;
  error: string | null;
}

export function HistoryTab({ accounts }: { accounts: AutopilotAccountDTO[] }) {
  const t = useT();
  /** "all" atau username (format yang dipakai AccountFilterSelect). */
  const [account, setAccount] = useState("all");
  const [tick, setTick] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>({ key: "", tick: 0, items: [], nextCursor: null, error: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const filterAccounts = useMemo(
    () =>
      accounts
        .filter((a) => a.username)
        .map((a) => ({ id: a.id, username: a.username, displayName: a.outletNama ?? a.displayName, avatarUrl: a.avatarUrl })),
    [accounts]
  );
  const accountId = useMemo(
    () => (account === "all" ? null : (accounts.find((a) => a.username?.toLowerCase() === account.toLowerCase())?.id ?? null)),
    [accounts, account]
  );

  const queryKey = accountId ?? "all";
  const loading = loaded.key !== queryKey;
  const refreshing = !loading && loaded.tick !== tick;

  // Halaman pertama: saat tab dibuka, saat filter akun berubah, atau saat Segarkan ditekan.
  useEffect(() => {
    const ctrl = new AbortController();
    listAutopilotSlots({ view: "history", accountId }, ctrl.signal)
      .then((res) => {
        if (ctrl.signal.aborted) return;
        setLoaded({ key: queryKey, tick, items: res.items, nextCursor: res.nextCursor, error: null });
        setMoreError(null);
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setLoaded((prev) => ({
          key: queryKey,
          tick,
          items: prev.key === queryKey ? prev.items : [],
          nextCursor: prev.key === queryKey ? prev.nextCursor : null,
          error: e instanceof Error ? apiErrorText(e.message) : tr("Gagal memuat riwayat."),
        }));
      });
    return () => ctrl.abort();
  }, [accountId, queryKey, tick]);

  const loadMore = async () => {
    if (!loaded.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const res = await listAutopilotSlots({ view: "history", accountId, cursor: loaded.nextCursor });
      setLoaded((prev) => {
        if (prev.key !== queryKey) return prev;
        const seen = new Set(prev.items.map((i) => i.id));
        return { ...prev, items: [...prev.items, ...res.items.filter((i) => !seen.has(i.id))], nextCursor: res.nextCursor };
      });
    } catch (e) {
      setMoreError(e instanceof Error ? apiErrorText(e.message) : tr("Gagal memuat halaman berikutnya."));
    } finally {
      setLoadingMore(false);
    }
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <AccountFilterSelect
          accounts={filterAccounts}
          selectedAccount={account}
          onSelectAccount={setAccount}
          totalAccounts={filterAccounts.length}
        />
        <button
          type="button"
          onClick={() => setTick((n) => n + 1)}
          disabled={loading || refreshing}
          className="self-end sm:self-auto shrink-0 h-10 px-3.5 rounded-full border border-line-strong text-[13px] font-semibold text-fg inline-flex items-center gap-1.5 hover:border-accent hover:text-accent transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
          {t("Segarkan")}
        </button>
      </div>

      {loading ? (
        <ListSkeleton label="Memuat riwayat autopilot" />
      ) : loaded.error && loaded.items.length === 0 ? (
        <div role="alert" className="card p-8 text-center">
          <AlertTriangle className="w-8 h-8 text-danger mx-auto" />
          <p className="mt-3 text-sm font-semibold text-fg">{loaded.error}</p>
          <button
            type="button"
            onClick={() => setTick((n) => n + 1)}
            className="mt-4 h-10 px-5 rounded-full bg-accent text-on-accent text-sm font-semibold inline-flex items-center gap-2 cursor-pointer hover:bg-accent-hover"
          >
            <RotateCw className="w-4 h-4" />
            {t("Coba lagi")}
          </button>
        </div>
      ) : loaded.items.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
            <History className="w-6 h-6" />
          </div>
          <p className="mt-4 text-sm font-semibold text-fg">{t("Belum ada riwayat autopilot.")}</p>
          <p className="mt-1 text-sm text-muted">{t("Slot yang sudah terjadwal, terbit, gagal, atau dilewati akan muncul di sini.")}</p>
        </div>
      ) : (
        <>
          {loaded.error && <Banner tone="danger">{loaded.error}</Banner>}
          <ul className="card divide-y divide-line">
            {loaded.items.map((item) => {
              const text = item.draft?.text ?? "";
              const long = charLength(text) > EXCERPT_CHARS;
              const open = expanded.has(item.id);
              const notes = [item.skipReason, item.lastError].filter((v, i, list): v is string => !!v && list.indexOf(v) === i);
              return (
                <li key={item.id} className="p-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                    <span className="text-[13px] font-bold text-fg tabular-nums">{wibFullText(new Date(item.slotAt))}</span>
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <AccountAvatar name={item.account.displayName} src={item.account.avatarUrl} size="w-5 h-5" />
                      <span className="text-[13px] font-semibold text-fg truncate max-w-[12rem]">{accountHandle(item.account)}</span>
                    </span>
                    <SlotStatusChip status={item.status} />
                    <SlotKindChip kind={item.kind} />
                  </div>

                  {text ? (
                    <div>
                      <p className="text-sm text-fg leading-relaxed whitespace-pre-wrap break-words">
                        {open || !long ? text : `${clipChars(text, EXCERPT_CHARS).trimEnd()}...`}
                      </p>
                      {long && (
                        <button
                          type="button"
                          onClick={() => toggle(item.id)}
                          aria-expanded={open}
                          className="-mb-2 h-10 inline-flex items-center text-[13px] font-semibold text-accent hover:underline cursor-pointer"
                        >
                          {open ? t("Ringkas") : t("Selengkapnya")}
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-faint">{t("Belum ada draf untuk slot ini.")}</p>
                  )}

                  {notes.map((note) => (
                    <p
                      key={note}
                      className={cn(
                        "flex items-start gap-1.5 text-[13px] font-medium",
                        note === item.lastError ? "text-danger" : "text-muted"
                      )}
                    >
                      {note === item.lastError && <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
                      {t(note)}
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
          {moreError && <Banner tone="danger">{moreError}</Banner>}
          {loaded.nextCursor && <LoadMoreButton onClick={loadMore} loading={loadingMore} />}
        </>
      )}
    </div>
  );
}
