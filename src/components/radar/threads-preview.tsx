"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Heart, Loader2, MessageCircle, MoreHorizontal, Repeat2, RotateCw, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchIdeaPreview } from "@/lib/radar-client";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { errorText } from "@/components/settings/format";

/** Antrean penulisan preview: paling banyak 2 panggilan AI bersamaan walau banyak kartu terlihat sekaligus. */
const MAX_PARALLEL = 2;
let running = 0;
const waiting: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

const timeLabel = (iso: string): string =>
  new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

/** Kartu postingan bergaya Threads: avatar + garis utas, nama, waktu, teks, topik, dan baris aksi. */
export function ThreadsPostCard({
  handle,
  avatarUrl,
  name,
  text,
  topicTag,
  meta,
}: {
  handle: string;
  avatarUrl: string | null;
  name: string;
  text: string;
  topicTag?: string | null;
  meta: string;
}) {
  return (
    <article className="rounded-2xl border border-line bg-surface px-4 pt-3.5 pb-3" aria-label={`Preview postingan ${handle}`}>
      <div className="flex gap-3">
        <div className="flex flex-col items-center shrink-0">
          <AccountAvatar name={name} src={avatarUrl} size="w-9 h-9" />
          <span className="mt-2 w-0.5 flex-1 min-h-4 rounded-full bg-line" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[15px] font-semibold text-fg truncate">{handle.replace(/^@/, "")}</span>
            {topicTag && (
              <>
                <span className="text-faint" aria-hidden>
                  ›
                </span>
                <span className="text-[15px] text-muted truncate">{topicTag}</span>
              </>
            )}
            <span className="text-[15px] text-faint shrink-0">· {meta}</span>
            <MoreHorizontal className="ml-auto w-5 h-5 text-faint shrink-0" aria-hidden />
          </div>
          <p className="mt-0.5 text-[15px] leading-[1.45] text-fg whitespace-pre-line break-words">{text}</p>
          <div className="mt-2.5 -ml-2 flex items-center gap-1 text-fg" aria-hidden>
            {[Heart, MessageCircle, Repeat2, Send].map((Icon, i) => (
              <span key={i} className="w-9 h-9 rounded-full inline-flex items-center justify-center">
                <Icon className="w-[19px] h-[19px]" strokeWidth={1.75} />
              </span>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

type Preview = { text: string; topicTag: string | null; at: string | null };

/**
 * Preview postingan dari satu ide. Bila belum ada, AI menulisnya saat kartu pertama kali terlihat (sekali,
 * lalu tersimpan di server). Ide yang sudah terpakai menampilkan teks posting yang sebenarnya.
 */
export function IdeaPostPreview({
  ideaId,
  handle,
  name,
  avatarUrl,
  initial,
  kind,
  postAt,
  canGenerate,
}: {
  ideaId: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  initial: string | null;
  kind: "POSTING" | "PREVIEW" | null;
  postAt: string | null;
  canGenerate: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<Preview | null>(initial ? { text: initial, topicTag: null, at: null } : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);

  const generate = (regenerate: boolean) => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setLoading(true);
    setError(null);
    return limited(() => fetchIdeaPreview(ideaId, regenerate, ctrl.signal))
      .then((res) => setPreview({ text: res.preview.text, topicTag: res.preview.topicTag, at: res.preview.at }))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(errorText(e, "Preview belum bisa ditulis. Coba lagi."));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
  };

  // Tulis preview hanya untuk kartu yang benar-benar terlihat (hemat panggilan AI), sekali per kartu.
  const needs = !preview && canGenerate;
  useEffect(() => {
    if (!needs) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        void generate(false);
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
    // Hanya saat kartu dipasang: percobaan ulang setelah galat lewat tombol "Coba lagi".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => ctrlRef.current?.abort(), []);

  const isPost = kind === "POSTING";
  return (
    <div ref={ref} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted">{isPost ? "Postingan dari ide ini" : "Preview postingan"}</p>
        {canGenerate && !isPost && preview && (
          <button
            type="button"
            onClick={() => void generate(true)}
            disabled={loading}
            className="h-7 px-2.5 rounded-full text-xs font-semibold text-muted hover:text-accent hover:bg-subtle inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
            Tulis ulang
          </button>
        )}
      </div>

      {preview ? (
        <div className={cn("transition-opacity", loading && "opacity-50")}>
          <ThreadsPostCard
            handle={handle}
            name={name}
            avatarUrl={avatarUrl}
            text={preview.text}
            topicTag={preview.topicTag}
            meta={isPost && postAt ? timeLabel(postAt) : "draf"}
          />
        </div>
      ) : loading || (canGenerate && !error) ? (
        <div className="rounded-2xl border border-line bg-surface px-4 py-3.5" aria-busy="true">
          <div className="flex gap-3">
            <AccountAvatar name={name} src={avatarUrl} size="w-9 h-9" />
            <div className="flex-1 space-y-2 pt-1 animate-pulse">
              <div className="h-3 w-28 rounded bg-subtle" />
              <div className="h-3 w-full rounded bg-subtle" />
              <div className="h-3 w-5/6 rounded bg-subtle" />
              <div className="h-3 w-2/3 rounded bg-subtle" />
            </div>
          </div>
          <p className="mt-2 text-xs text-muted inline-flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            AI menulis preview dengan gaya {handle}…
          </p>
        </div>
      ) : error ? (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft text-danger p-3 text-[13px] font-medium">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          {canGenerate && (
            <button type="button" onClick={() => void generate(false)} className="underline font-semibold cursor-pointer shrink-0">
              Coba lagi
            </button>
          )}
        </p>
      ) : (
        <p className="rounded-xl bg-subtle p-3 text-xs text-muted">Belum ada preview untuk ide ini.</p>
      )}
      {!isPost && preview && (
        <p className="text-[11px] text-muted">Autopilot memakai teks ini saat menulis slot dengan ide ini, selama lolos pemeriksaan.</p>
      )}
    </div>
  );
}
