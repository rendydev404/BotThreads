"use client";

import React, { memo, useCallback, useLayoutEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, Ban, CheckCircle2, Clock, Lightbulb, Loader2, Pin, PinOff, Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { actOnIdea, listIdeas } from "@/lib/radar-client";
import {
  IDEA_STATUS_LABEL,
  hookLabel,
  type IdeaAction,
  type IdeaListResponse,
  type IdeaScoreDetail,
  type IdeaStatus,
} from "@/lib/radar-types";
import { ConfirmModal } from "@/components/autopilot/confirm-modal";
import { Dropdown, type DropdownOption } from "@/components/autopilot/dropdown";
import {
  Banner,
  HandleText,
  ListSkeleton,
  LoadMoreButton,
  Segmented,
  accountHandle,
  type SegmentedOption,
} from "@/components/autopilot/shared";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { usePublishAccounts } from "@/components/content/use-publish-accounts";
import { errorStatus, errorText, formatDateWib, toScore100 } from "@/components/settings/format";
import { usePaged } from "@/components/settings/use-remote";
import {
  BTN,
  BTN_DANGER,
  BTN_OUTLINE,
  BTN_PRIMARY,
  EmptyState,
  LoadFailure,
  NotInstalled,
  RefreshButton,
  SourceChip,
  useNotice,
  without,
} from "./shared";

type Idea = IdeaListResponse["items"][number];
type View = "ready" | "used" | "dropped";
/** Hasil tindakan: berhasil, ide ternyata sudah tidak tersedia (409), atau gagal. */
type ActResult = "ok" | "gone" | "error";

const ALL_ACCOUNTS = "all";

const VIEW_OPTIONS: SegmentedOption<View>[] = [
  { value: "ready", label: "Siap dipakai" },
  { value: "used", label: "Terpakai" },
  { value: "dropped", label: "Tidak dipakai" },
];

const STATUS_STYLE: Record<IdeaStatus, { cls: string; Icon: React.ComponentType<{ className?: string }> }> = {
  BARU: { cls: "bg-accent-soft text-accent", Icon: Sparkles },
  DIPAKAI: { cls: "bg-success-soft text-success", Icon: CheckCircle2 },
  DITOLAK: { cls: "bg-danger-soft text-danger", Icon: Ban },
  KEDALUWARSA: { cls: "bg-subtle text-muted", Icon: Clock },
};

const SCORE_PARTS: { key: Exclude<keyof IdeaScoreDetail, "alasan">; label: string; hint: string }[] = [
  { key: "sinyal", label: "Tren", hint: "Seberapa viral tren yang dirujuk" },
  { key: "viral", label: "Potensi viral", hint: "Peluang memancing balasan dan repost di Threads" },
  { key: "kebaruan", label: "Kebaruan", hint: "Beda dari postingan dan ide sebelumnya" },
  { key: "kecocokan", label: "Kecocokan", hint: "Kecocokan dengan akun ini" },
  { key: "kinerja", label: "Kinerja", hint: "Kinerja pola serupa di akun ini (50 = belum ada data)" },
];

const CHIP = "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-semibold whitespace-nowrap";

/* ------------------------------------------------------------------ kartu ide */

interface IdeaCardProps {
  idea: Idea;
  avatarUrl: string | null;
  canEdit: boolean;
  busy: IdeaAction | undefined;
  error: string | undefined;
  onAct: (idea: Idea, action: IdeaAction) => void;
  onReject: (idea: Idea) => void;
}

const IdeaCard = memo(function IdeaCard({ idea, avatarUrl, canEdit, busy, error, onAct, onReject }: IdeaCardProps) {
  const { cls, Icon } = STATUS_STYLE[idea.status] ?? STATUS_STYLE.KEDALUWARSA;
  const score = toScore100(idea.score);
  const hook = hookLabel(idea.formulaHook);
  const working = busy !== undefined;
  const parts = SCORE_PARTS.filter((p) => typeof idea.scoreDetail[p.key] === "number");

  return (
    <li className="card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AccountAvatar name={idea.account.displayName} src={avatarUrl} size="w-9 h-9" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-fg leading-tight break-words">
            <HandleText account={idea.account} />
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className={cn(CHIP, cls)}>
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {IDEA_STATUS_LABEL[idea.status] ?? idea.status}
            </span>
            {idea.pinned && idea.status === "BARU" && (
              <span className={cn(CHIP, "bg-warning-soft text-warning")}>
                <Pin className="w-3.5 h-3.5 shrink-0" />
                Dipakai berikutnya
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 w-12 h-12 rounded-xl bg-accent-soft text-accent flex flex-col items-center justify-center leading-none">
          <span className="text-lg font-bold tabular-nums" aria-hidden>
            {score}
          </span>
          <span className="mt-0.5 text-[10px] font-semibold" aria-hidden>
            skor
          </span>
          <span className="sr-only">Skor {score} dari 100</span>
        </div>
      </div>

      <div>
        <p className="text-[15px] font-semibold text-fg leading-snug break-words">{idea.topik}</p>
        {idea.sudut && (
          <p className="mt-1 text-sm text-muted leading-relaxed break-words">
            <span className="font-semibold text-fg">Sudut:</span> {idea.sudut}
          </p>
        )}
        {idea.scoreDetail.alasan && (
          <p className="mt-1 text-sm text-muted leading-relaxed break-words">
            <span className="font-semibold text-fg">Kenapa bisa ramai:</span> {idea.scoreDetail.alasan}
          </p>
        )}
      </div>

      {(hook || idea.pilar) && (
        <div className="flex flex-wrap gap-1.5">
          {hook && (
            <span className={cn(CHIP, "bg-subtle text-fg")}>
              <span className="font-medium text-muted">Pembuka:</span>
              {hook}
            </span>
          )}
          {idea.pilar && (
            <span className={cn(CHIP, "bg-subtle text-fg max-w-full")}>
              <span className="shrink-0 font-medium text-muted">Pilar:</span>
              <span className="min-w-0 truncate">{idea.pilar}</span>
            </span>
          )}
        </div>
      )}

      {parts.length > 0 && (
        <div role="group" aria-label="Rincian skor (0 sampai 100)">
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5">
            {parts.map((p) => {
              const value = toScore100(idea.scoreDetail[p.key]);
              return (
                <div key={p.key} title={p.hint}>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-xs font-medium text-muted">{p.label}</dt>
                    <dd className="text-xs font-bold text-fg tabular-nums">{value}</dd>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-subtle overflow-hidden" aria-hidden>
                    <div className="h-full rounded-full bg-accent" style={{ width: `${value}%` }} />
                  </div>
                </div>
              );
            })}
          </dl>
        </div>
      )}

      {idea.signals.length > 0 && (
        <div className="rounded-xl bg-subtle p-3">
          <p className="text-xs font-semibold text-muted">Tren rujukan</p>
          <ul className="mt-2 space-y-2">
            {idea.signals.map((s) => (
              <li key={s.id} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2">
                <SourceChip source={s.source} className="self-start bg-surface" />
                <span className="min-w-0 text-[13px] text-fg leading-relaxed break-words">{s.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted">
        Dibuat {formatDateWib(idea.createdAt)}
        {idea.status === "BARU" && ` · berlaku sampai ${formatDateWib(idea.expiresAt)}`}
        {idea.status === "KEDALUWARSA" && ` · kedaluwarsa ${formatDateWib(idea.expiresAt)}`}
        {idea.status === "DIPAKAI" && " · sudah ditulis autopilot menjadi posting"}
      </p>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft text-danger p-2.5 text-[13px] font-medium">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </p>
      )}

      {canEdit && idea.status === "BARU" && (
        <div className="flex flex-col sm:flex-row gap-2">
          {idea.pinned ? (
            <button type="button" onClick={() => onAct(idea, "unpin")} disabled={working} className={cn(BTN, BTN_OUTLINE)}>
              {busy === "unpin" ? <Loader2 className="w-4 h-4 animate-spin" /> : <PinOff className="w-4 h-4" />}
              Lepas sematan
            </button>
          ) : (
            <button type="button" onClick={() => onAct(idea, "pin")} disabled={working} className={cn(BTN, BTN_PRIMARY)}>
              {busy === "pin" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pin className="w-4 h-4" />}
              Pakai berikutnya
            </button>
          )}
          <button type="button" onClick={() => onReject(idea)} disabled={working} className={cn(BTN, BTN_DANGER)}>
            {busy === "reject" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
            Jangan dipakai
          </button>
        </div>
      )}
    </li>
  );
});

/* ------------------------------------------------------------------ tab */

interface IdeasTabProps {
  /** Editor ke atas (peran minimal route tindakan ide). */
  canEdit: boolean;
  onForbidden: () => void;
}

export function IdeasTab({ canEdit, onForbidden }: IdeasTabProps) {
  const [view, setView] = useState<View>("ready");
  /** "all" atau id akun Threads. */
  const [account, setAccount] = useState(ALL_ACCOUNTS);
  const [busy, setBusy] = useState<Record<string, IdeaAction>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rejectTarget, setRejectTarget] = useState<Idea | null>(null);
  const { notice, show: showNotice, clear: clearNotice } = useNotice();
  // Cache modul 30 detik yang juga dipakai halaman lain; gagal memuatnya hanya mengosongkan saringan akun.
  const { accounts } = usePublishAccounts();

  const accountId = account === ALL_ACCOUNTS ? null : account;
  const list = usePaged<Idea, IdeaListResponse>(
    `ideas:${view}:${account}`,
    (cursor, signal) => listIdeas({ view, accountId, cursor }, signal),
    (i) => i.id,
    "Gagal memuat bank ide."
  );
  const { data, items, mutate, reload } = list;

  // Tab atau halaman yang disembunyikan tidak boleh kembali dengan dialog konfirmasi masih terbuka.
  useLayoutEffect(() => () => setRejectTarget(null), []);

  const accountOptions = useMemo<DropdownOption<string>[]>(
    () => [
      { value: ALL_ACCOUNTS, label: "Semua akun" },
      ...accounts.map((a) => ({ value: a.id, label: accountHandle(a), hint: a.outletNama ?? undefined })),
    ],
    [accounts]
  );
  const avatarById = useMemo(() => new Map(accounts.map((a) => [a.id, a.avatarUrl])), [accounts]);

  const act = useCallback(
    async (idea: Idea, action: IdeaAction): Promise<ActResult> => {
      const id = idea.id;
      const drop = () => mutate((d) => ({ ...d, items: d.items.filter((i) => i.id !== id) }));
      setBusy((prev) => ({ ...prev, [id]: action }));
      setErrors((prev) => without(prev, id));
      try {
        await actOnIdea(id, action);
        // Daftar diperbarui secara lokal; tidak ada fetch ulang setelah tindakan.
        if (action === "reject") {
          drop();
          showNotice("success", `Ide untuk ${accountHandle(idea.account)} ditandai jangan dipakai.`);
        } else {
          const pinned = action === "pin";
          mutate((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, pinned } : i)) }));
        }
        return "ok";
      } catch (e) {
        const status = errorStatus(e);
        if (status === 409) {
          // Ide sudah dipakai atau berubah di server: cukup buang kartunya dari daftar.
          drop();
          showNotice("danger", `${accountHandle(idea.account)}: ${errorText(e, "Ide ini tidak tersedia lagi.")}`);
          return "gone";
        }
        if (status === 403) onForbidden();
        setErrors((prev) => ({ ...prev, [id]: errorText(e, "Tindakan gagal. Coba lagi.") }));
        return "error";
      } finally {
        setBusy((prev) => without(prev, id));
      }
    },
    [mutate, onForbidden, showNotice]
  );

  const onAct = useCallback((idea: Idea, action: IdeaAction) => void act(idea, action), [act]);
  const onReject = useCallback((idea: Idea) => {
    // Galat tindakan sebelumnya pada kartu ini tidak boleh ikut tampil di dialog konfirmasi.
    setErrors((prev) => without(prev, idea.id));
    setRejectTarget(idea);
  }, []);

  const filtered = accountId !== null;
  const rejecting = rejectTarget ? busy[rejectTarget.id] === "reject" : false;

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center gap-2.5">
        {/* `fit`: lebar segmen mengikuti labelnya, supaya ketiganya muat utuh di layar 360px. */}
        <Segmented ariaLabel="Status ide" options={VIEW_OPTIONS} value={view} onChange={setView} fit className="lg:w-[24rem]" />
        <div className="flex items-center gap-2 lg:ml-auto">
          <Dropdown<string>
            ariaLabel="Saring akun"
            value={account}
            options={accountOptions}
            onChange={setAccount}
            icon={<Users className="w-4 h-4 text-muted shrink-0" />}
            className="flex-1 min-w-0 lg:flex-none lg:w-64"
          />
          <RefreshButton onClick={reload} busy={list.refreshing} disabled={list.loading} />
        </div>
      </div>

      {notice && (
        <Banner tone={notice.tone} onClose={clearNotice}>
          {notice.text}
        </Banner>
      )}

      {list.loading ? (
        <ListSkeleton label="Memuat bank ide" />
      ) : !data ? (
        <LoadFailure status={list.status} message={list.error ?? "Gagal memuat bank ide."} onRetry={reload} />
      ) : !data.installed ? (
        <NotInstalled />
      ) : (
        <>
          {list.error && <Banner tone="danger">Gagal menyegarkan: {list.error}</Banner>}
          {items.length === 0 ? (
            <EmptyState
              icon={<Lightbulb className="w-6 h-6" />}
              title={
                view === "ready"
                  ? "Belum ada ide yang siap dipakai."
                  : view === "used"
                    ? "Belum ada ide yang dipakai."
                    : "Tidak ada ide yang ditolak atau kedaluwarsa."
              }
            >
              {view === "ready" && (
                <p>
                  Autopilot memantau apa yang sedang viral, lalu AI menyusun ide untuk akun yang autopilotnya
                  menyala. Ide baru muncul di sini dengan sendirinya. Mode tiap akun diatur di halaman{" "}
                  <Link href="/autopilot" className="font-semibold text-accent hover:underline">
                    Autopilot
                  </Link>
                  .
                </p>
              )}
              {view === "used" && <p>Ide pindah ke sini setelah autopilot menulis posting darinya.</p>}
              {view === "dropped" && (
                <p>Ide yang ditandai Jangan dipakai, atau yang lewat masa berlakunya sebelum sempat dipakai, tercatat di sini.</p>
              )}
              {filtered && <p>Saringan akun sedang aktif. Pilih Semua akun untuk melihat ide akun lain.</p>}
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {items.map((idea) => (
                <IdeaCard
                  key={idea.id}
                  idea={idea}
                  avatarUrl={avatarById.get(idea.accountId) ?? null}
                  canEdit={canEdit}
                  busy={busy[idea.id]}
                  error={errors[idea.id]}
                  onAct={onAct}
                  onReject={onReject}
                />
              ))}
            </ul>
          )}
          {list.moreError && <Banner tone="danger">{list.moreError}</Banner>}
          {list.nextCursor && <LoadMoreButton onClick={() => void list.loadMore()} loading={list.loadingMore} />}
        </>
      )}

      <ConfirmModal
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        onConfirm={() => {
          const target = rejectTarget;
          // Gagal selain 409: dialog tetap terbuka dan menampilkan galatnya.
          if (target) void act(target, "reject").then((result) => result !== "error" && setRejectTarget(null));
        }}
        busy={rejecting}
        error={rejectTarget ? errors[rejectTarget.id] : null}
        variant="danger"
        title="Jangan pakai ide ini?"
        confirmLabel="Ya, jangan dipakai"
        confirmIcon={<Ban className="w-4 h-4" />}
      >
        {rejectTarget && (
          <>
            <p className="text-sm text-fg leading-relaxed">
              Autopilot tidak akan menulis posting dari ide ini untuk {accountHandle(rejectTarget.account)}. Ide yang sudah
              ditandai tidak bisa dikembalikan.
            </p>
            <p className="mt-2.5 rounded-xl bg-subtle p-3 text-[13px] text-muted leading-relaxed break-words line-clamp-3">
              {rejectTarget.topik}
            </p>
          </>
        )}
      </ConfirmModal>
    </div>
  );
}
