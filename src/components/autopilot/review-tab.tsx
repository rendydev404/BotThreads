"use client";

import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, Check, ClipboardCheck, Clock, Loader2, RefreshCw, RotateCw, ShoppingBag, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { actOnSlot, listAutopilotSlots } from "@/lib/autopilot-client";
import type { AutopilotAccountDTO, SlotAction, SlotListResponse, SlotStatus } from "@/lib/autopilot-types";
import { ContentApiError } from "@/lib/content-client";
import { parseTopicTag } from "@/lib/threads-text";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { PostTextField, checkPostText, type PostTextState } from "@/components/content/post-text-field";
import { MediaCredit, PostMediaView } from "@/components/radar/threads-preview";
import { fitsWithCredit } from "@/lib/post-media";
import { ConfirmModal } from "./confirm-modal";
import { useT } from "@/components/i18n/lang-provider";
import { tr } from "@/lib/i18n/core";
import { Banner, ListSkeleton, LoadMoreButton, SlotKindChip, accountHandle, apiErrorText, durationText, slotReasonText, wibFullText } from "./shared";

type Item = SlotListResponse["items"][number];
type ReviewAction = Extract<SlotAction, "approve" | "reject" | "rewrite">;

/** Draf yang belum disetujui sampai 15 menit sebelum tayang dilewati (REVIEW_CUTOFF_MS di server). */
const CUTOFF_MS = 15 * 60_000;
const NOTICE_MS = 7000;

/** Status slot setelah tindakan berhasil (cermin autopilot-writer), untuk memperbarui ringkasan secara lokal. */
const NEXT_STATUS: Record<ReviewAction, SlotStatus> = {
  approve: "TERANTRE",
  reject: "DIRENCANAKAN",
  rewrite: "DIRENCANAKAN",
};

/**
 * Isian pengguna untuk satu draf. `base` = teks draf saat mulai diedit: bila draf di server berganti
 * (mis. ditulis ulang AI), isian lama tidak lagi berlaku dan kartu kembali menampilkan draf terbaru.
 */
interface EditState {
  value: PostTextState;
  base: PostTextState;
}

interface Loaded {
  fetched: boolean;
  tick: number;
  items: Item[];
  nextCursor: string | null;
  error: string | null;
}

const BTN =
  "h-10 px-4 rounded-full text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

/* ------------------------------------------------------------------ kartu draf */

interface ReviewCardProps {
  item: Item;
  outletNama: string | null;
  edit: EditState | undefined;
  busy: ReviewAction | undefined;
  error: string | undefined;
  nowMs: number | null;
  publishEnabled: boolean;
  onEdit: (id: string, edit: EditState) => void;
  /** `edit` = isian kartu saat tombol ditekan (hanya dipakai untuk Setujui). */
  onAct: (item: Item, action: ReviewAction, edit?: PostTextState) => void;
  onReject: (item: Item) => void;
}

const ReviewCard = memo(function ReviewCard({
  item,
  outletNama,
  edit,
  busy,
  error,
  nowMs,
  publishEnabled,
  onEdit,
  onAct,
  onReject,
}: ReviewCardProps) {
  const t = useT();
  const draft = item.draft;
  const original = useMemo<PostTextState>(() => ({ text: draft?.text ?? "", topic: draft?.topicTag ?? "" }), [draft]);
  const current = edit && edit.base.text === original.text && edit.base.topic === original.topic ? edit.value : undefined;
  const value = current ?? original;
  const check = checkPostText(value, outletNama);
  const edited = value.text !== original.text || value.topic !== original.topic;
  const working = busy !== undefined;

  const left = nowMs === null ? null : Date.parse(item.slotAt) - CUTOFF_MS - nowMs;
  const urgent = left !== null && left < 60 * 60_000;

  return (
    <li className="card p-4 space-y-3">
      <div className="flex items-center gap-2.5">
        <AccountAvatar name={item.account.displayName} src={item.account.avatarUrl} size="w-8 h-8" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="flex items-center gap-2">
            <span className="min-w-0 text-sm font-semibold text-fg truncate">{accountHandle(item.account)}</span>
            <SlotKindChip kind={item.kind} className="shrink-0" />
          </p>
          <p className="mt-0.5 text-xs font-medium text-muted">{t("Tayang {when}", { when: wibFullText(new Date(item.slotAt)) })}</p>
        </div>
      </div>

      <p className={cn("flex items-start gap-1.5 text-xs font-medium", urgent ? "text-warning" : "text-muted")}>
        <Clock className="w-3.5 h-3.5 mt-px shrink-0" />
        <span>
          {left === null
            ? t("Dilewati otomatis bila belum disetujui 15 menit sebelum tayang.")
            : left > 0
              ? t("Dilewati otomatis bila belum disetujui 15 menit sebelum tayang (sisa {left}).", { left: durationText(left) })
              : t("Dilewati otomatis bila belum disetujui 15 menit sebelum tayang (batas waktunya sudah lewat).")}
        </span>
      </p>

      {draft ? (
        <PostTextField
          value={value}
          onChange={(next) => onEdit(item.id, { value: next, base: original })}
          outletNama={outletNama}
          disabled={working}
          rows={5}
        />
      ) : (
        <p className="rounded-xl bg-subtle p-3 text-sm text-muted">{t("Draf tidak tersedia. Minta AI menulis ulang atau tolak slot ini.")}</p>
      )}

      {draft && (
        <div className="space-y-2">
          {edited && <p className="text-xs font-medium text-accent">{t("Teks sudah Anda ubah; versi ini yang akan diposting.")}</p>}
          {draft.media && draft.media.items.length > 0 && (
            <div className="space-y-1.5">
              <PostMediaView media={draft.media} compact />
              {fitsWithCredit(value.text, draft.media) ? (
                <MediaCredit media={draft.media} className="text-xs" />
              ) : (
                <p className="text-xs font-medium text-warning">
                  {t(
                    "Teks + keterangan sumber gambar melebihi batas Threads, jadi postingan ini terbit tanpa gambar. Pendekkan teks untuk menyertakan gambarnya."
                  )}
                </p>
              )}
            </div>
          )}
          {draft.rationale && <p className="text-xs text-muted leading-relaxed">{t("Alasan AI:")} {draft.rationale}</p>}
          {draft.affiliate && (
            <div className="rounded-xl border border-warning/40 bg-warning-soft/40 p-3 space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-warning">
                <ShoppingBag className="w-3.5 h-3.5 shrink-0" />
                {t("Affiliate:")} {draft.affiliate.nama}
              </p>
              <p className="text-xs text-muted">{t("Balasan pertama, dikirim otomatis 1-3 menit setelah terbit:")}</p>
              <p className="rounded-lg bg-surface p-2.5 text-[13px] text-fg whitespace-pre-line break-words">{draft.affiliate.replyText}</p>
            </div>
          )}
          {draft.checks.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label={t("Hasil pemeriksaan draf")}>
              {draft.checks.map((c) => (
                <li
                  key={c.key}
                  title={c.detail && t(c.detail)}
                  className={cn(
                    "inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs font-semibold",
                    c.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
                  )}
                >
                  {c.ok ? <Check className="w-3 h-3 shrink-0" /> : <X className="w-3 h-3 shrink-0" />}
                  {t(c.label)}
                  <span className="sr-only">
                    {c.ok ? ` (${t("lolos")})` : ` (${t("tidak lolos")})`}
                    {c.detail ? `: ${t(c.detail)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {/* Rincian pemeriksaan yang gagal ditampilkan langsung: `title` tidak terbaca di layar sentuh. */}
          {draft.checks
            .filter((c) => !c.ok && c.detail)
            .map((c) => (
              <p key={c.key} className="text-xs font-medium text-danger">
                {t(c.label)}: {c.detail && t(c.detail)}
              </p>
            ))}
        </div>
      )}
      {item.reason && <p className="text-xs text-muted leading-relaxed">{t("Kenapa jam ini:")} {slotReasonText(item.reason)}</p>}

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft text-danger p-2.5 text-[13px] font-medium">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onAct(item, "approve", current)}
          disabled={working || !draft || !check.valid || !publishEnabled}
          title={!publishEnabled ? t("Saklar posting dashboard sedang mati") : undefined}
          className={cn(BTN, "basis-full sm:basis-auto bg-accent text-on-accent hover:bg-accent-hover")}
        >
          {busy === "approve" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {t("Setujui")}
        </button>
        <button
          type="button"
          onClick={() => onAct(item, "rewrite")}
          disabled={working}
          className={cn(BTN, "flex-1 sm:flex-none border border-line-strong text-fg hover:border-accent hover:text-accent")}
        >
          {busy === "rewrite" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
          {t("Tulis ulang")}
        </button>
        <button
          type="button"
          onClick={() => onReject(item)}
          disabled={working}
          className={cn(BTN, "flex-1 sm:flex-none border border-danger/50 text-danger hover:bg-danger-soft")}
        >
          {busy === "reject" ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
          {t("Tolak")}
        </button>
      </div>
    </li>
  );
});

/* ------------------------------------------------------------------ tab */

interface ReviewTabProps {
  accounts: AutopilotAccountDTO[];
  publishEnabled: boolean;
  /** Tindakan berhasil: ringkasan (lencana tab, garis waktu) diperbarui secara lokal. */
  onResolved: (slotId: string, status: SlotStatus) => void;
  /** Draf ternyata sudah berubah di server: ringkasan perlu diambil ulang sekali. */
  onStale: () => void;
}

export function ReviewTab({ accounts, publishEnabled, onResolved, onStale }: ReviewTabProps) {
  const t = useT();
  const [loaded, setLoaded] = useState<Loaded>({ fetched: false, tick: 0, items: [], nextCursor: null, error: null });
  const [tick, setTick] = useState(0);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [busy, setBusy] = useState<Record<string, ReviewAction>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Item | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Kapan tiap slot selesai ditangani: respons daftar yang dimulai sebelumnya tidak boleh memunculkannya lagi. */
  const handledAt = useRef(new Map<string, number>());

  // Halaman pertama diambil saat tab dibuka (dan tiap kali dibuka lagi); `tick` untuk tombol Segarkan.
  useEffect(() => {
    const ctrl = new AbortController();
    const startedAt = Date.now();
    listAutopilotSlots({ view: "review" }, ctrl.signal)
      .then((res) => {
        if (ctrl.signal.aborted) return;
        const items = res.items.filter((i) => (handledAt.current.get(i.id) ?? 0) < startedAt);
        setLoaded({ fetched: true, tick, items, nextCursor: res.nextCursor, error: null });
        setNowMs(Date.now());
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setLoaded((prev) => ({
          ...prev,
          fetched: true,
          tick,
          error: e instanceof Error ? apiErrorText(e.message) : tr("Gagal memuat draf."),
        }));
      });
    return () => ctrl.abort();
  }, [tick]);

  // Hitung mundur batas tinjauan; "sekarang" disimpan di state, bukan dibaca saat render.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  // Tab atau halaman yang disembunyikan tidak boleh kembali dengan dialog konfirmasi masih terbuka.
  useLayoutEffect(() => () => setRejectTarget(null), []);

  const showNotice = useCallback((tone: "success" | "danger", text: string) => {
    setNotice({ tone, text });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  const outletById = useMemo(() => new Map(accounts.map((a) => [a.id, a.outletNama])), [accounts]);

  const dropItem = useCallback((id: string) => {
    handledAt.current.set(id, Date.now());
    setLoaded((prev) => ({ ...prev, items: prev.items.filter((i) => i.id !== id) }));
    setEdits((prev) => {
      if (!(id in prev)) return prev;
      const { [id]: gone, ...rest } = prev;
      void gone;
      return rest;
    });
  }, []);

  const clearBusy = useCallback((id: string) => {
    setBusy((prev) => {
      const { [id]: gone, ...rest } = prev;
      void gone;
      return rest;
    });
  }, []);

  const act = useCallback(
    async (item: Item, action: ReviewAction, edit?: PostTextState): Promise<boolean> => {
      const id = item.id;
      const handle = accountHandle(item.account);
      setBusy((prev) => ({ ...prev, [id]: action }));
      setErrors((prev) => {
        if (!(id in prev)) return prev;
        const { [id]: gone, ...rest } = prev;
        void gone;
        return rest;
      });
      try {
        // Teks (dan topik) hanya dikirim bila memang diubah; tanpa itu server memakai draf aslinya.
        const payload: { text?: string; topicTag?: string | null } = {};
        if (action === "approve" && edit && item.draft) {
          if (edit.text !== item.draft.text) payload.text = edit.text;
          const topic = parseTopicTag(edit.topic);
          if (topic.ok && topic.tag !== (item.draft.topicTag ?? null)) payload.topicTag = topic.tag;
        }
        await actOnSlot(id, action, Object.keys(payload).length ? payload : undefined);
        dropItem(id);
        onResolved(id, NEXT_STATUS[action]);
        showNotice(
          "success",
          action === "approve"
            ? tr("Draf {handle} disetujui dan dijadwalkan untuk {when}.", { handle, when: wibFullText(new Date(item.slotAt)) })
            : action === "rewrite"
              ? tr("Draf {handle} akan ditulis ulang oleh AI.", { handle })
              : tr("Draf {handle} ditolak. AI menulis draf baru dengan ide lain untuk jam yang sama.", { handle })
        );
        return true;
      } catch (e) {
        if (e instanceof ContentApiError && e.status === 409) {
          // Kartu sudah usang: buang, lalu ambil ulang daftar dan ringkasan supaya sesuai keadaan server.
          dropItem(id);
          showNotice("danger", `${handle}: ${apiErrorText(e.message)}`);
          setTick((n) => n + 1);
          onStale();
        } else {
          setErrors((prev) => ({ ...prev, [id]: e instanceof ContentApiError ? apiErrorText(e.message) : tr("Tindakan gagal. Coba lagi.") }));
        }
        return false;
      } finally {
        clearBusy(id);
      }
    },
    [clearBusy, dropItem, onResolved, onStale, showNotice]
  );

  const onEdit = useCallback((id: string, edit: EditState) => setEdits((prev) => ({ ...prev, [id]: edit })), []);
  const onAct = useCallback(
    (item: Item, action: ReviewAction, edit?: PostTextState) => void act(item, action, edit),
    [act]
  );
  const onReject = useCallback((item: Item) => setRejectTarget(item), []);

  const loadMore = async () => {
    if (!loaded.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await listAutopilotSlots({ view: "review", cursor: loaded.nextCursor });
      const handled = new Set(handledAt.current.keys());
      setLoaded((prev) => {
        const seen = new Set(prev.items.map((i) => i.id));
        const fresh = res.items.filter((i) => !seen.has(i.id) && !handled.has(i.id));
        return { ...prev, items: [...prev.items, ...fresh], nextCursor: res.nextCursor };
      });
    } catch (e) {
      showNotice("danger", e instanceof Error ? apiErrorText(e.message) : tr("Gagal memuat halaman berikutnya."));
    } finally {
      setLoadingMore(false);
    }
  };

  const refreshing = loaded.fetched && loaded.tick !== tick;
  const rejecting = rejectTarget ? busy[rejectTarget.id] === "reject" : false;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <p className="text-sm text-muted">
          {t("Draf dari akun bermode Tinjau dulu. Setujui supaya tayang pada jamnya, atau ubah dulu teksnya.")}
        </p>
        <button
          type="button"
          onClick={() => setTick((n) => n + 1)}
          disabled={!loaded.fetched || refreshing}
          className="self-end sm:self-auto shrink-0 h-10 px-3.5 rounded-full border border-line-strong text-[13px] font-semibold text-fg inline-flex items-center gap-1.5 hover:border-accent hover:text-accent transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
          {t("Segarkan")}
        </button>
      </div>

      {!publishEnabled && (
        <Banner tone="info">{t("Saklar posting dashboard sedang mati, jadi draf belum bisa disetujui.")}</Banner>
      )}
      {notice && (
        <Banner tone={notice.tone} onClose={() => setNotice(null)}>
          {notice.text}
        </Banner>
      )}

      {!loaded.fetched ? (
        <ListSkeleton label="Memuat draf yang menunggu tinjauan" />
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
            <ClipboardCheck className="w-6 h-6" />
          </div>
          <p className="mt-4 text-sm font-semibold text-fg">{t("Tidak ada draf yang menunggu tinjauan.")}</p>
        </div>
      ) : (
        <>
          {loaded.error && <Banner tone="danger">{loaded.error}</Banner>}
          <ul className="space-y-3">
            {loaded.items.map((item) => (
              <ReviewCard
                key={item.id}
                item={item}
                outletNama={outletById.get(item.accountId) ?? null}
                edit={edits[item.id]}
                busy={busy[item.id]}
                error={errors[item.id]}
                nowMs={nowMs}
                publishEnabled={publishEnabled}
                onEdit={onEdit}
                onAct={onAct}
                onReject={onReject}
              />
            ))}
          </ul>
          {loaded.nextCursor && <LoadMoreButton onClick={loadMore} loading={loadingMore} />}
        </>
      )}

      <ConfirmModal
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        onConfirm={() => {
          const target = rejectTarget;
          if (target) void act(target, "reject").then(() => setRejectTarget(null));
        }}
        busy={rejecting}
        variant="danger"
        title={t("Tolak dan ganti ide?")}
        confirmLabel={t("Ya, ganti ide")}
        confirmIcon={<X className="w-4 h-4" />}
      >
        {rejectTarget && (
          <p className="text-sm text-fg leading-relaxed">
            {t(
              "Jam tayang {when} untuk {handle} tetap dipakai. AI membuang draf ini dan menulis draf baru dengan ide lain, lalu draf barunya masuk lagi ke sini untuk Anda tinjau.",
              { when: wibFullText(new Date(rejectTarget.slotAt)), handle: accountHandle(rejectTarget.account) }
            )}
          </p>
        )}
      </ConfirmModal>
    </div>
  );
}
