"use client";

import React, { useMemo, useRef, useState } from "react";
import { AlertCircle, CalendarClock, Info, Loader2, Send, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { ContentApiError, createPosts, newIdempotencyKey, recommend } from "@/lib/content-client";
import type { BestHourDTO, PublishAccountDTO, PublishLimitsDTO } from "@/lib/content-types";
import { MAX_RECOMMEND_ACCOUNTS } from "@/lib/content-config";
import { formatWibFull } from "@/lib/scheduling";
import { AccountPicker } from "./account-picker";
import { ModalButton, ModalShell } from "./modal-shell";
import { PostTextField, checkPostText, type PostTextState } from "./post-text-field";
import { PublishConfirmModal } from "./publish-confirm-modal";
import { SchedulePicker, type ScheduleValue } from "./schedule-picker";

interface ComposerModalProps {
  open: boolean;
  onClose: () => void;
  accounts: PublishAccountDTO[];
  publishEnabled: boolean;
  limits: PublishLimitsDTO | null;
  onCreated: (count: number, mode: "now" | "schedule") => void;
}

const EMPTY: PostTextState = { text: "", topic: "" };

/** Pembuat postingan manual (dengan bantuan AI) untuk satu atau banyak akun, maksimal 10 per kirim. */
export function ComposerModal({ open, onClose, accounts, publishEnabled, limits, onCreated }: ComposerModalProps) {
  const max = limits?.maxBatchItems ?? 10;
  const [ids, setIds] = useState<string[]>([]);
  const [variation, setVariation] = useState(false);
  const [shared, setShared] = useState<PostTextState>(EMPTY);
  const [per, setPer] = useState<Record<string, PostTextState>>({});
  const [schedule, setSchedule] = useState<ScheduleValue>({ mode: "at", at: null });
  const [hours, setHours] = useState<BestHourDTO[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);
  const keyRef = useRef<{ sig: string; key: string } | null>(null);

  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const selected = ids.map((id) => byId.get(id)).filter((a): a is PublishAccountDTO => !!a);
  const multi = selected.length > 1;
  const usePer = variation && multi;

  const textFor = (id: string): PostTextState => (usePer ? (per[id] ?? EMPTY) : shared);

  const checks = selected.map((a) => ({ a, c: checkPostText(textFor(a.id), a.outletNama) }));
  const firstError = checks.find((x) => !x.c.valid);
  const publishAt = schedule.mode === "now" ? "now" : schedule.at;
  const canContinue = publishEnabled && selected.length > 0 && !firstError && !!publishAt && !busy;

  const reset = () => {
    setIds([]);
    setVariation(false);
    setShared(EMPTY);
    setPer({});
    setSchedule({ mode: "at", at: null });
    setHours([]);
    setAiError(null);
    setError(null);
    setConfirm(false);
    keyRef.current = null;
  };

  const close = () => {
    if (busy) return;
    onClose();
  };

  const assist = async () => {
    if (selected.length === 0) {
      setAiError("Pilih akun tujuan dulu supaya AI meniru gaya akun tersebut.");
      return;
    }
    const targets = usePer ? selected : selected.slice(0, 1);
    if (targets.length > MAX_RECOMMEND_ACCOUNTS) {
      setAiError(`Bantuan AI per akun maksimal ${MAX_RECOMMEND_ACCOUNTS} akun sekali jalan.`);
      return;
    }
    setAiBusy(true);
    setAiError(null);
    try {
      const res = await recommend({
        accountIds: targets.map((a) => a.id),
        brief: (usePer ? shared.text : textFor(targets[0].id).text).trim().slice(0, 600),
        count: 1,
      });
      if (res.drafts.length === 0) {
        setAiError(res.message ?? "AI belum menghasilkan draf yang layak. Coba lagi.");
        return;
      }
      if (usePer) {
        setPer((prev) => {
          const next = { ...prev };
          for (const d of res.drafts) next[d.threadsAccountId] = { text: d.text, topic: d.topicTag ?? "" };
          return next;
        });
      } else {
        const d = res.drafts[0];
        setShared({ text: d.text, topic: d.topicTag ?? "" });
      }
      const first = res.drafts[0];
      setHours(first.bestHours);
      if (schedule.mode === "at" && !schedule.at) setSchedule({ mode: "at", at: first.suggestedAt });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Gagal meminta bantuan AI.");
    } finally {
      setAiBusy(false);
    }
  };

  const submit = async () => {
    if (!publishAt) return;
    const items = checks.map(({ a, c }) => ({
      threadsAccountId: a.id,
      text: textFor(a.id).text,
      topicTag: c.topicTag,
      publishAt,
      aiModel: null,
      aiEdited: false,
    }));
    const sig = JSON.stringify(items);
    if (keyRef.current?.sig !== sig) keyRef.current = { sig, key: newIdempotencyKey() };

    setBusy(true);
    setError(null);
    try {
      const res = await createPosts(keyRef.current.key, items);
      const mode = publishAt === "now" ? "now" : "schedule";
      reset();
      onCreated(res.posts.length, mode);
    } catch (e) {
      const err = e instanceof ContentApiError ? e : null;
      setError({ message: err?.message ?? "Gagal memasukkan postingan ke antrean.", details: err?.details });
    } finally {
      setBusy(false);
    }
  };

  const segment = (active: boolean) =>
    cn(
      "h-8 px-3.5 rounded-full text-[13px] font-semibold transition-colors cursor-pointer",
      active ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
    );

  return (
    <>
      <ModalShell
        open={open && !confirm}
        onClose={close}
        busy={busy}
        size="lg"
        title="Buat postingan"
        description="Tulis sendiri atau minta AI meniru gaya akun. Tidak ada yang terkirim sebelum Anda mengonfirmasi."
        footer={
          <>
            <ModalButton onClick={close} disabled={busy}>
              Batal
            </ModalButton>
            <ModalButton
              variant="primary"
              disabled={!canContinue}
              onClick={() => {
                setError(null);
                setConfirm(true);
              }}
            >
              {schedule.mode === "now" ? <Send className="w-4 h-4" /> : <CalendarClock className="w-4 h-4" />}
              {schedule.mode === "now" ? "Lanjut posting" : "Lanjut jadwalkan"}
            </ModalButton>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Akun tujuan</p>
            <AccountPicker accounts={accounts} value={ids} onChange={setIds} multiple max={max} placeholder="Pilih satu atau lebih akun" />
          </div>

          {multi && (
            <div className="space-y-2">
              <div role="tablist" aria-label="Mode teks" className="inline-flex p-1 rounded-full bg-subtle">
                <button type="button" role="tab" aria-selected={!variation} onClick={() => setVariation(false)} className={segment(!variation)}>
                  Teks sama
                </button>
                <button type="button" role="tab" aria-selected={variation} onClick={() => setVariation(true)} className={segment(variation)}>
                  Variasi per akun
                </button>
              </div>
              {!variation && (
                <p className="flex items-start gap-2 text-xs text-muted leading-relaxed">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  Teks identik ke banyak akun berisiko dianggap spam. Pakai {"{nama_cabang}"} di teks agar tiap cabang unik, atau pilih Variasi per akun.
                </p>
              )}
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">
                {usePer ? "Ide / arahan untuk AI" : "Isi postingan"}
              </p>
              <button
                type="button"
                onClick={assist}
                disabled={aiBusy || busy}
                className="h-9 px-3.5 rounded-full text-[13px] font-semibold inline-flex items-center gap-1.5 bg-accent-soft text-accent hover:bg-accent hover:text-on-accent transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {aiBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Bantu AI
              </button>
            </div>
            {aiError && (
              <p role="alert" className="text-[13px] font-medium text-danger">
                {aiError}
              </p>
            )}

            <PostTextField
              value={shared}
              onChange={setShared}
              outletNama={selected[0]?.outletNama ?? null}
              disabled={busy}
              rows={usePer ? 3 : 6}
              placeholder={usePer ? "Tulis ide singkat, lalu klik Bantu AI untuk membuat versi tiap akun." : undefined}
            />

            {usePer &&
              selected.map((a) => (
                <div key={a.id} className="rounded-xl border border-line p-3 space-y-2">
                  <p className="text-xs font-semibold text-accent">@{a.username ?? a.displayName}</p>
                  <PostTextField
                    value={per[a.id] ?? EMPTY}
                    onChange={(v) => setPer((prev) => ({ ...prev, [a.id]: v }))}
                    outletNama={a.outletNama}
                    disabled={busy}
                    rows={4}
                    placeholder="Teks untuk akun ini"
                  />
                </div>
              ))}
          </div>

          <div>
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Waktu posting</p>
            <SchedulePicker value={schedule} onChange={setSchedule} bestHours={hours} disabled={busy} />
          </div>

          {!publishEnabled && (
            <p className="flex items-start gap-2 rounded-xl bg-subtle text-muted p-3 text-[13px] font-medium">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              Fitur posting belum diaktifkan oleh pemilik dashboard.
            </p>
          )}
          {firstError && selected.length > 0 && (firstError.c.length > 0 || shared.text || per[firstError.a.id]?.text) && (
            <p role="alert" className="flex items-start gap-2 text-[13px] font-medium text-danger">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {selected.length > 1 ? `@${firstError.a.username ?? firstError.a.displayName}: ` : ""}
              {firstError.c.error}
            </p>
          )}
        </div>
      </ModalShell>

      <PublishConfirmModal
        open={open && confirm}
        onClose={() => !busy && setConfirm(false)}
        onConfirm={submit}
        mode={schedule.mode === "now" ? "now" : "schedule"}
        busy={busy}
        error={error?.message ?? null}
        details={error?.details}
        targets={selected.map((a) => ({
          username: a.username ?? a.displayName,
          text: textFor(a.id).text.trim(),
          whenLabel: schedule.mode === "at" && schedule.at ? formatWibFull(new Date(schedule.at)) : undefined,
        }))}
      />
    </>
  );
}
