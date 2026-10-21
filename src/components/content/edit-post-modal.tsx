"use client";

import React, { useState } from "react";
import { AlertCircle, Loader2, RotateCcw, Save } from "lucide-react";
import { ContentApiError, patchPost } from "@/lib/content-client";
import type { PostItemDTO } from "@/lib/content-types";
import { AiAssist } from "./ai-assist";
import { ModalButton, ModalShell } from "./modal-shell";
import { PostTextField, checkPostText, type PostTextState } from "./post-text-field";
import { SchedulePicker, type ScheduleValue } from "./schedule-picker";

interface EditPostModalProps {
  /** null = tertutup. Komponen di-remount per posting lewat `key` supaya state selalu segar. */
  post: PostItemDTO | null;
  onClose: () => void;
  onSaved: (post: PostItemDTO | null) => void;
}

/** Ubah teks, topik, atau jadwal posting yang belum diproses worker. */
export function EditPostModal({ post, onClose, onSaved }: EditPostModalProps) {
  if (!post) return null;
  return <EditForm key={post.id} post={post} onClose={onClose} onSaved={onSaved} />;
}

function EditForm({ post, onClose, onSaved }: { post: PostItemDTO; onClose: () => void; onSaved: EditPostModalProps["onSaved"] }) {
  const [fields, setFields] = useState<PostTextState>({ text: post.text, topic: post.topicTag ?? "" });
  const [schedule, setSchedule] = useState<ScheduleValue>({ mode: "at", at: post.tayangPada });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Versi AI terakhir yang dipakai; dikirim saat simpan supaya AI belajar dari ubahan pengguna setelahnya. */
  const [aiBase, setAiBase] = useState<string | null>(null);

  const check = checkPostText(fields, post.outletNama);
  const timeChanged = schedule.mode === "at" && schedule.at !== post.tayangPada;
  const textChanged = fields.text.trim() !== post.text.trim();
  const topicChanged = (check.topicTag ?? "") !== (post.topicTag ?? "");
  const dirty = timeChanged || textChanged || topicChanged;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: { text?: string; topicTag?: string | null; publishAt?: string } = {};
      if (textChanged) body.text = fields.text;
      if (topicChanged) body.topicTag = check.topicTag;
      if (timeChanged && schedule.mode === "at" && schedule.at) body.publishAt = schedule.at;
      const res = await patchPost(post.id, { ...body, ...(textChanged && aiBase ? { aiBase } : {}) });
      onSaved(res.post);
    } catch (e) {
      setError(e instanceof ContentApiError ? e.message : "Gagal menyimpan perubahan.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      busy={busy}
      size="lg"
      title="Ubah jadwal posting"
      description={`@${post.account.username ?? post.account.displayName}`}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            Batal
          </ModalButton>
          <ModalButton variant="primary" onClick={save} disabled={busy || !dirty || !check.valid}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Simpan perubahan
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        <PostTextField value={fields} onChange={setFields} outletNama={post.outletNama} disabled={busy} rows={6} />
        {aiBase !== null && (
          <p className="msg-in -mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <span className="font-semibold text-success">Versi AI dipakai.</span>
            Ubah lagi sesuka Anda, AI akan belajar dari ubahan itu.
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setFields({ text: post.text, topic: post.topicTag ?? "" });
                setAiBase(null);
              }}
              className="inline-flex items-center gap-1 font-semibold text-accent hover:underline cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" /> Kembalikan teks awal
            </button>
          </p>
        )}
        {post.id && (
          <AiAssist
            postId={post.id}
            handle={post.account.username ?? post.account.displayName}
            text={fields.text}
            disabled={busy}
            onApply={(text, topicTag) => {
              setFields({ text, topic: topicTag ?? fields.topic });
              setAiBase(text);
            }}
          />
        )}
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Jadwal tayang</p>
          <SchedulePicker value={schedule} onChange={setSchedule} allowNow={false} disabled={busy} />
        </div>
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft text-danger p-3 text-[13px] font-medium">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </p>
        )}
      </div>
    </ModalShell>
  );
}
