"use client";

import React, { useLayoutEffect, useState } from "react";
import { Bot, ExternalLink, FileText, RotateCcw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { adminContentAction, listAdminContent } from "@/lib/admin-client";
import type { PostItemDTO, PostStatusKey, PostsResponse, PostsSummaryDTO } from "@/lib/content-types";
import { formatWibFull } from "@/lib/scheduling";
import { AccountAvatar, PostStatusChip } from "@/components/content/post-status-chip";
import { ConfirmModal } from "@/components/autopilot/confirm-modal";
import { Banner, ListSkeleton, LoadMoreButton } from "@/components/autopilot/shared";
import { errorText, formatInt } from "@/components/settings/format";
import { BTN_OUTLINE, EmptyState, Pill, RefreshButton } from "@/components/settings/states";
import { usePaged } from "@/components/settings/use-remote";
import { AdminLoadError, FilterChips, RefreshError, SEARCH_DEBOUNCE_MS, SearchField, useAdmin, useDebounced, type ChipOption } from "./shared";
import { Panel, StatStrip } from "./ui";

const LOAD_ERROR = "Gagal memuat antrean konten.";

type Scope = "upcoming" | "history";
const SCOPES: ChipOption<Scope>[] = [
  { value: "upcoming", label: "Antrean" },
  { value: "history", label: "Riwayat" },
];

type StatusFilter = "ALL" | PostStatusKey;
const STATUS_BY_SCOPE: Record<Scope, ChipOption<StatusFilter>[]> = {
  upcoming: [
    { value: "ALL", label: "Semua" },
    { value: "SCHEDULED", label: "Terjadwal" },
    { value: "QUEUED", label: "Mengantre" },
    { value: "PROCESSING", label: "Diproses" },
  ],
  history: [
    { value: "ALL", label: "Semua" },
    { value: "PUBLISHED", label: "Terbit" },
    { value: "FAILED", label: "Gagal" },
  ],
};

type Pending = { kind: "cancel" | "retry"; post: PostItemDTO };

/**
 * Modul Konten: antrean dan riwayat posting Threads semua tenant. Admin bisa memantau kegagalan dan
 * worker yang tertinggal, lalu membatalkan jadwal atau mengirim ulang posting dashboard yang gagal.
 */
export function ContentTab() {
  const { guard, rev, invalidate, can } = useAdmin();
  const manage = can("konten.kelola");
  const [scope, setScope] = useState<Scope>("upcoming");
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [text, setText] = useState("");
  const account = useDebounced(text, SEARCH_DEBOUNCE_MS).trim().replace(/^@/, "");
  const accountOk = account === "" || /^[A-Za-z0-9_.]{1,60}$/.test(account);

  const list = usePaged<PostItemDTO, PostsResponse>(
    accountOk ? `konten:${rev.konten}:${scope}:${filter}:${account}` : null,
    (cursor, signal) => guard(listAdminContent({ scope, status: filter === "ALL" ? null : filter, account: account || undefined, cursor }, signal)),
    (p) => p.dispatchId,
    LOAD_ERROR
  );
  const { items, data, error, status, loading, refreshing, reload, mutate, nextCursor, loadMore, loadingMore, moreError } = list;
  // Ringkasan hanya dikirim untuk halaman pertama; simpan yang terakhir supaya tidak berkedip saat paginasi.
  const [summary, setSummary] = useState<PostsSummaryDTO | null>(null);
  if (data?.summary && data.summary !== summary) setSummary(data.summary);

  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useLayoutEffect(
    () => () => {
      setPending(null);
      setNotice(null);
    },
    []
  );

  const run = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setPendingError(null);
    try {
      await guard(adminContentAction(pending.kind, pending.post.id));
      if (pending.kind === "cancel") {
        mutate((d) => ({ ...d, items: d.items.filter((p) => p.id !== pending.post.id) }));
        setNotice("Jadwal posting dibatalkan dan dihapus dari antrean.");
      } else {
        mutate((d) => ({ ...d, items: d.items.filter((p) => p.id !== pending.post.id) }));
        setNotice("Posting dikirim ulang ke antrean. Cek tab Antrean untuk memantaunya.");
      }
      invalidate(["konten", "ringkasan"]);
      setPending(null);
    } catch (e) {
      setPendingError(errorText(e, "Tindakan gagal. Coba lagi."));
    } finally {
      setBusy(false);
    }
  };

  const filtered = filter !== "ALL" || account !== "";

  return (
    <div className="space-y-5">
      {summary && (
        <Panel>
          <StatStrip
            items={[
              { label: "Terjadwal hari ini", value: formatInt(summary.scheduledToday), hint: "Semua tenant" },
              { label: "Antre tertahan", value: formatInt(summary.queuedLate), hint: "> 3 menit di antrean", tone: summary.queuedLate > 0 ? "warning" : "neutral" },
              { label: "Terbit 7 hari", value: formatInt(summary.published7d), tone: summary.published7d > 0 ? "success" : "neutral" },
              { label: "Gagal 7 hari", value: formatInt(summary.failed7d), tone: summary.failed7d > 0 ? "danger" : "neutral" },
            ]}
          />
        </Panel>
      )}
      {summary && summary.queuedLate > 0 && (
        <Banner tone="danger">
          {formatInt(summary.queuedLate)} posting mengantre lebih dari 3 menit. Kemungkinan worker penerbit (threads-publisher) sedang mati atau tertahan.
        </Banner>
      )}

      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <FilterChips
          ariaLabel="Antrean atau riwayat"
          options={SCOPES}
          value={scope}
          onChange={(next) => {
            setScope(next);
            setFilter("ALL");
          }}
        />
        <div className="hidden lg:block w-px h-6 bg-line" />
        <FilterChips ariaLabel="Filter status posting" options={STATUS_BY_SCOPE[scope]} value={filter} onChange={setFilter} />
      </div>
      <div className="flex items-center gap-2">
        <SearchField label="Saring per akun Threads" value={text} onChange={setText} placeholder="Saring per username akun, mis. sukashawarma" />
        <RefreshButton onClick={reload} busy={refreshing} disabled={loading} />
      </div>
      {!accountOk && <p className="text-xs font-medium text-danger">Username hanya boleh huruf, angka, titik, dan garis bawah.</p>}

      {data && <RefreshError error={error} onRetry={reload} />}
      {notice && (
        <Banner tone="success" onClose={() => setNotice(null)}>
          {notice}
        </Banner>
      )}

      {!accountOk ? null : loading ? (
        <ListSkeleton label="Memuat antrean konten" rows={4} />
      ) : !data ? (
        <AdminLoadError message={error ?? LOAD_ERROR} status={status} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<FileText className="w-6 h-6" />}
          title={filtered ? "Tidak ada posting yang cocok." : scope === "upcoming" ? "Antrean kosong." : "Belum ada riwayat posting."}
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
                Hapus filter
              </button>
            ) : undefined
          }
        >
          {scope === "upcoming" && !filtered ? "Semua posting terjadwal sudah diproses." : undefined}
        </EmptyState>
      ) : (
        <>
          <ul className="card divide-y divide-line">
            {items.map((p) => (
              <li key={p.dispatchId} className="p-4 flex items-start gap-3">
                <AccountAvatar name={p.account.displayName} src={p.account.avatarUrl} size="w-9 h-9" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold text-fg">{p.account.username ? `@${p.account.username}` : p.account.displayName}</span>
                    {p.outletNama && <span className="text-xs text-muted">· {p.outletNama}</span>}
                    <PostStatusChip status={p.status} />
                    {p.autopilot && (
                      <Pill tone="accent" icon={<Bot className="w-3.5 h-3.5 shrink-0" />}>
                        Autopilot
                      </Pill>
                    )}
                    {!p.mine && <Pill>SukaPost</Pill>}
                  </div>
                  <p className="text-sm text-fg leading-relaxed line-clamp-3 whitespace-pre-line break-words">{p.text}</p>
                  <p className="text-xs text-muted">
                    {formatWibFull(new Date(p.tayangPada))}
                    {p.releaseUrl && (
                      <>
                        {" · "}
                        <a href={p.releaseUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
                          Lihat di Threads <ExternalLink className="w-3 h-3" />
                        </a>
                      </>
                    )}
                  </p>
                  {p.pesanError && <p className="text-xs font-medium text-danger break-words">Galat: {p.pesanError}</p>}
                </div>
                {manage && (p.cancellable || p.retryable) && (
                  <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                    {p.retryable && (
                      <button type="button" onClick={() => (setPendingError(null), setPending({ kind: "retry", post: p }))} className={cn(BTN_OUTLINE, "h-9 px-3")}>
                        <RotateCcw className="w-3.5 h-3.5" />
                        Kirim ulang
                      </button>
                    )}
                    {p.cancellable && (
                      <button
                        type="button"
                        onClick={() => (setPendingError(null), setPending({ kind: "cancel", post: p }))}
                        className={cn(BTN_OUTLINE, "h-9 px-3 hover:border-danger hover:text-danger")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Batalkan
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {moreError && <Banner tone="danger">{moreError}</Banner>}
          {nextCursor && <LoadMoreButton onClick={() => void loadMore()} loading={loadingMore} />}
        </>
      )}

      <ConfirmModal
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={run}
        busy={busy}
        error={pendingError}
        variant={pending?.kind === "cancel" ? "danger" : "primary"}
        title={pending?.kind === "cancel" ? "Batalkan jadwal posting ini?" : "Kirim ulang posting ini?"}
        confirmLabel={pending?.kind === "cancel" ? "Ya, batalkan" : "Ya, kirim ulang"}
        confirmIcon={pending?.kind === "cancel" ? <Trash2 className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
      >
        <p className="text-sm text-fg leading-relaxed">
          {pending?.kind === "cancel"
            ? `Posting untuk @${pending.post.account.username ?? "akun"} dihapus dari antrean dan tidak akan tayang. Pemilik workspace melihatnya hilang dari jadwal mereka. Tindakan tercatat atas nama Anda.`
            : "Posting dimasukkan lagi ke antrean dan diambil worker dalam beberapa menit. Pastikan penyebab gagalnya sudah beres."}
        </p>
        {pending && <p className="mt-3 rounded-xl bg-subtle p-3 text-[13px] text-muted line-clamp-4 whitespace-pre-line">{pending.post.text}</p>}
      </ConfirmModal>
    </div>
  );
}
