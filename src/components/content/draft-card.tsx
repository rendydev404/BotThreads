"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CalendarClock,
  Check,
  Copy,
  ExternalLink,
  Info,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ContentApiError, createPosts, newIdempotencyKey, recommend } from "@/lib/content-client";
import type { BestHourDTO, ContentDraft, PostStatusKey } from "@/lib/content-types";
import { useT } from "@/components/i18n/lang-provider";
import { AccountPicker } from "./account-picker";
import { AccountAvatar, PostStatusChip } from "./post-status-chip";
import { PostTextField, checkPostText, tContentMessage, type PostTextState } from "./post-text-field";
import { PublishConfirmModal } from "./publish-confirm-modal";
import { SchedulePicker, useWibFormat, type ScheduleValue } from "./schedule-picker";
import { usePostStatusPoll } from "./use-post-status-poll";
import { usePublishAccounts } from "./use-publish-accounts";

interface Sent {
  postId: string;
  at: string;
  mode: "now" | "schedule";
  /** Jam semula bila sistem menggesernya karena bentrok. */
  movedFrom?: string;
}

interface DraftMeta {
  rationale: string;
  angle: string;
  model: string;
  suggestedAt: string;
  bestHours: BestHourDTO[];
}

const metaOf = (d: ContentDraft): DraftMeta => ({
  rationale: d.rationale,
  angle: d.angle,
  model: d.model,
  suggestedAt: d.suggestedAt,
  bestHours: d.bestHours,
});

const SECONDARY_BTN =
  "h-10 px-4 rounded-full text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 border border-line-strong bg-surface text-fg hover:border-accent hover:text-accent transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-line-strong disabled:hover:text-fg";

/**
 * Kartu draf AI: bisa diedit, dipindah akun, dijadwalkan, atau diposting sekarang. Tidak ada aksi
 * otomatis; antrean baru terisi setelah pengguna mengonfirmasi lewat modal.
 */
export function DraftCard({ draft, index }: { draft: ContentDraft; index?: number }) {
  const t = useT();
  const wib = useWibFormat();
  const { accounts, publishEnabled, loading } = usePublishAccounts();
  const [accountId, setAccountId] = useState(draft.threadsAccountId);
  const [fields, setFields] = useState<PostTextState>({ text: draft.text, topic: draft.topicTag ?? "" });
  const [schedule, setSchedule] = useState<ScheduleValue>({ mode: "at", at: draft.suggestedAt });
  const [meta, setMeta] = useState<DraftMeta>(metaOf(draft));
  const [original, setOriginal] = useState(draft.text);
  const [pending, setPending] = useState<"now" | "schedule" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const keyRef = useRef<{ sig: string; key: string } | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const account = useMemo(() => accounts.find((a) => a.id === accountId) ?? null, [accounts, accountId]);
  const check = checkPostText(fields, account?.outletNama ?? null);
  const polled = usePostStatusPoll(sent?.mode === "now" ? [sent.postId] : []);
  const live = sent ? polled[sent.postId] : undefined;

  const username = account?.username ?? draft.username ?? t("akun");
  const accountReady = !!account?.ready;
  const canSubmit = publishEnabled && accountReady && check.valid && !busy && !loading;
  const aiEdited = fields.text.trim() !== original.trim();

  const bestHours = accountId === draft.threadsAccountId ? meta.bestHours : [];

  const openConfirm = (mode: "now" | "schedule") => {
    setError(null);
    setPending(mode);
  };

  const submit = async () => {
    if (!pending || !account) return;
    const publishAt = pending === "now" ? "now" : schedule.mode === "at" ? schedule.at : null;
    if (!publishAt) {
      setError({ message: "Pilih jam tayang dulu." });
      return;
    }
    // Kunci idempotensi tetap sama untuk permintaan identik (aman dicoba ulang), baru bila isi berubah.
    const sig = JSON.stringify([accountId, fields.text.trim(), check.topicTag, publishAt]);
    if (keyRef.current?.sig !== sig) keyRef.current = { sig, key: newIdempotencyKey() };

    setBusy(true);
    setError(null);
    try {
      // Jam masih jam saran AI (atau "sekarang"): bentrok diselesaikan sistem dengan menggeser ke slot
      // kosong terdekat. Jam yang dipilih sendiri oleh pengguna tetap dicek ketat.
      const autoReschedule = pending === "now" || publishAt === meta.suggestedAt;
      const res = await createPosts(keyRef.current.key, [
        {
          threadsAccountId: accountId,
          text: fields.text,
          topicTag: check.topicTag,
          publishAt,
          aiModel: meta.model,
          aiEdited,
        },
      ], { autoReschedule });
      const created = res.posts[0];
      setSent({
        postId: created.postId,
        at: created.tayangPada,
        mode: created.rescheduledFrom ? "schedule" : pending,
        movedFrom: created.rescheduledFrom,
      });
      setPending(null);
    } catch (e) {
      const err = e instanceof ContentApiError ? e : null;
      setError({ message: err?.message ?? "Gagal memasukkan postingan ke antrean.", details: err?.details });
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    setRegenerating(true);
    setRegenError(null);
    try {
      const res = await recommend({ accountIds: [accountId], count: 1, avoid: fields.text });
      const next = res.drafts[0];
      if (!next) {
        setRegenError(res.message ?? "Belum ada versi lain yang layak. Coba lagi.");
        return;
      }
      setFields({ text: next.text, topic: next.topicTag ?? "" });
      setOriginal(next.text);
      setMeta(metaOf(next));
      setSchedule({ mode: "at", at: next.suggestedAt });
      setError(null);
    } catch (e) {
      setRegenError(e instanceof Error ? e.message : "Gagal membuat versi lain.");
    } finally {
      setRegenerating(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fields.text);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard tidak tersedia */
    }
  };

  /* ----------------------------------------------------------- tampilan setelah dikirim */
  if (sent) {
    const status: PostStatusKey = live?.status ?? (sent.mode === "now" ? "QUEUED" : "SCHEDULED");
    return (
      <div className="card p-4 space-y-3" aria-live="polite">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <AccountAvatar name={account?.displayName ?? username} src={account?.avatarUrl} size="w-7 h-7" />
            <span className="text-sm font-semibold text-fg truncate">@{username}</span>
          </div>
          <PostStatusChip status={status} />
        </div>
        <p className="text-sm text-fg whitespace-pre-wrap break-words">{fields.text.trim()}</p>
        {sent.movedFrom && (
          <p className="flex items-start gap-2 rounded-xl bg-accent-soft text-accent p-3 text-[13px] font-medium">
            <Sparkles className="w-4 h-4 mt-0.5 shrink-0" />
            {t("Digeser otomatis dari {from} ke {to} supaya tidak bentrok dengan postingan lain di akun ini.", {
              from: wib.full(new Date(sent.movedFrom)),
              to: wib.full(new Date(sent.at)),
            })}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5" />
            {sent.mode === "now" && status !== "SCHEDULED"
              ? t("Diposting sekarang")
              : t("Tayang {when}", { when: wib.full(new Date(live?.tayangPada ?? sent.at)) })}
          </span>
          {live?.releaseUrl && (
            <a
              href={live.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-semibold text-accent hover:underline"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {t("Lihat di Threads")}
            </a>
          )}
          <Link href="/jadwal" className="font-semibold text-accent hover:underline">
            {t("Buka Jadwal Konten")}
          </Link>
        </div>
        {status === "FAILED" && live?.pesanError && (
          <p className="flex items-start gap-2 rounded-xl bg-danger-soft text-danger p-3 text-[13px] font-medium">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {tContentMessage(t, live.pesanError)}
          </p>
        )}
      </div>
    );
  }

  /* ----------------------------------------------------------- tampilan draf */
  return (
    <div className="card p-4 space-y-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-48">
          {accounts.length > 0 ? (
            <AccountPicker accounts={accounts} value={[accountId]} onChange={(ids) => setAccountId(ids[0] ?? accountId)} compact />
          ) : (
            <div className="flex items-center gap-2 h-10">
              <AccountAvatar name={username} size="w-6 h-6" />
              <span className="text-sm font-semibold text-fg truncate">@{username}</span>
            </div>
          )}
        </div>
        <span className="inline-flex items-center h-7 px-2.5 rounded-full bg-accent-soft text-accent text-xs font-semibold max-w-full truncate">
          {index ? `${t("Draf {n}", { n: index })} · ` : ""}
          {meta.angle}
        </span>
      </div>

      {meta.rationale && (
        <p className="flex items-start gap-2 text-xs text-muted leading-relaxed">
          <Sparkles className="w-3.5 h-3.5 mt-0.5 text-accent shrink-0" />
          {meta.rationale}
        </p>
      )}

      <PostTextField value={fields} onChange={setFields} outletNama={account?.outletNama ?? null} disabled={busy} rows={5} />

      <SchedulePicker
        value={schedule}
        onChange={setSchedule}
        bestHours={bestHours}
        suggestedAt={meta.suggestedAt}
        allowNow={false}
        disabled={busy}
      />

      {account && !account.ready && (
        <p className="flex items-start gap-2 rounded-xl bg-warning-soft text-warning p-3 text-[13px] font-medium">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {t("Akun ini belum siap diposting. Pilih akun lain.")}
        </p>
      )}
      {!loading && !publishEnabled && (
        <p className="flex items-start gap-2 rounded-xl bg-subtle text-muted p-3 text-[13px] font-medium">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          {t("Fitur posting belum diaktifkan oleh pemilik dashboard. Draf tetap bisa disalin atau diedit.")}
        </p>
      )}
      {regenError && (
        <p role="alert" className="text-[13px] font-medium text-danger">
          {tContentMessage(t, regenError)}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => openConfirm("now")}
          className="h-10 px-5 rounded-full text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 bg-accent text-on-accent hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
          {t("Posting sekarang")}
        </button>
        <button
          type="button"
          disabled={!canSubmit || schedule.mode !== "at" || !schedule.at}
          onClick={() => openConfirm("schedule")}
          className={SECONDARY_BTN}
        >
          <CalendarClock className="w-4 h-4" />
          {t("Jadwalkan")}
        </button>
        <button type="button" onClick={copy} className={SECONDARY_BTN}>
          {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
          {copied ? t("Tersalin") : t("Salin")}
        </button>
        <button type="button" onClick={regenerate} disabled={regenerating || busy} className={cn(SECONDARY_BTN)}>
          {regenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {t("Buat ulang")}
        </button>
      </div>

      <PublishConfirmModal
        open={pending !== null}
        onClose={() => !busy && setPending(null)}
        onConfirm={submit}
        mode={pending ?? "now"}
        busy={busy}
        error={error?.message ?? null}
        details={error?.details}
        targets={[
          {
            username,
            text: fields.text.trim(),
            whenLabel:
              pending === "schedule" && schedule.mode === "at" && schedule.at
                ? wib.full(new Date(schedule.at))
                : undefined,
          },
        ]}
      />
    </div>
  );
}
