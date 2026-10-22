"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Heart,
  ImageOff,
  ImagePlus,
  Images,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  RotateCw,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { creditLine, type PostMedia, type PostMediaItem } from "@/lib/post-media";
import { changeIdeaMedia, fetchIdeaPreview, type IdeaMediaAction } from "@/lib/radar-client";
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

/** Ukuran tampil gambar dari metadata item; 4:5 bila tidak diketahui (posting lama tanpa metadata). */
const dims = (i: PostMediaItem): { width: number; height: number } =>
  i.width > 0 && i.height > 0 ? { width: i.width, height: i.height } : { width: 1080, height: 1350 };

/**
 * Satu gambar dari tautan sumbernya (situs berita / Wikimedia), tanpa proxy dan tanpa salinan di server kita.
 * `no-referrer` supaya situs berita yang menolak hotlink dari domain lain tetap mau menyajikannya. Bila gambar
 * sumber hilang/diblokir, yang tampil kotak netral (bukan ikon gambar rusak) dengan ukuran yang sama.
 */
function SourceImage({ item, alt, className }: { item: PostMediaItem; alt: string; className: string }) {
  const [failed, setFailed] = useState(false);
  const d = dims(item);
  if (failed) {
    return (
      <div
        role="img"
        aria-label="Gambar sumber tidak bisa dimuat"
        style={{ aspectRatio: `${d.width} / ${d.height}` }}
        className={cn(className, "flex flex-col items-center justify-center gap-1.5 p-3 text-center text-xs text-muted")}
      >
        <ImageOff className="w-5 h-5 text-faint" aria-hidden />
        <span>Gambar sumber tidak bisa dimuat</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- gambar dari situs sumber; next/image akan memproksikannya lewat server
    <img
      src={item.sourceUrl}
      alt={alt}
      {...d}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

/**
 * Gambar postingan: satu gambar (rasio asli, tinggi maks ~420px) atau carousel geser dengan penanda "1/3".
 * Lebar/tinggi eksplisit dari metadata mencegah tata letak melompat; gambar dimuat malas langsung dari sumbernya.
 */
export function PostMediaView({ media, compact = false, className }: { media: PostMedia; compact?: boolean; className?: string }) {
  const [index, setIndex] = useState(0);
  const items = media.items;
  if (items.length === 0) return null;

  if (items.length === 1) {
    const it = items[0];
    return (
      <SourceImage
        // Kunci = URL sumber: setelah "Ganti gambar", status gagal-muat gambar lama tidak terbawa.
        key={it.sourceUrl}
        item={it}
        alt={it.articleTitle ?? "Gambar postingan"}
        className={cn(
          "block max-w-full h-auto rounded-xl border border-line bg-subtle object-cover",
          compact ? "max-h-40" : "max-h-[420px]",
          className
        )}
      />
    );
  }

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const left = el.scrollLeft;
    let best = 0;
    let gap = Infinity;
    Array.from(el.children).forEach((c, i) => {
      const d = Math.abs((c as HTMLElement).offsetLeft - el.offsetLeft - left);
      if (d < gap) {
        gap = d;
        best = i;
      }
    });
    if (best !== index) setIndex(best);
  };

  return (
    <div className={cn("relative", className)}>
      <div
        onScroll={onScroll}
        className="flex gap-2 overflow-x-auto snap-x snap-mandatory overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label={`Carousel ${items.length} gambar`}
      >
        {items.map((it, i) => (
          <SourceImage
            key={`${i}:${it.sourceUrl}`}
            item={it}
            alt={it.articleTitle ?? `Gambar ${i + 1} dari ${items.length}`}
            className={cn(
              "snap-start shrink-0 w-auto max-w-[85%] rounded-xl border border-line bg-subtle object-cover",
              compact ? "h-28" : "h-[260px]"
            )}
          />
        ))}
      </div>
      <span className="pointer-events-none absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums">
        {index + 1}/{items.length}
      </span>
    </div>
  );
}

/** Baris kredit sumber gambar (teks sama dengan `creditLine`, yang ditambahkan ke postingan saat terbit). */
export function MediaCredit({ media, className }: { media: PostMedia; className?: string }) {
  if (!creditLine(media)) return null;
  const seen = new Set<string>();
  const credits = media.items.filter((i) => {
    const name = i.credit.trim();
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
  return (
    <p className={cn("text-[13px] text-muted break-words", className)}>
      <span aria-hidden>📷 </span>
      <span className="sr-only">Sumber gambar: </span>
      {credits.map((c, i) => (
        <React.Fragment key={c.credit}>
          {i > 0 && " · "}
          {c.articleUrl ? (
            <a href={c.articleUrl} target="_blank" rel="noopener noreferrer" className="hover:underline hover:text-accent">
              {c.credit.trim()}
            </a>
          ) : (
            c.credit.trim()
          )}
        </React.Fragment>
      ))}
    </p>
  );
}

/** Kartu postingan bergaya Threads: avatar + garis utas, nama, waktu, teks, gambar, topik, dan baris aksi. */
export function ThreadsPostCard({
  handle,
  avatarUrl,
  name,
  text,
  topicTag,
  meta,
  media,
}: {
  handle: string;
  avatarUrl: string | null;
  name: string;
  text: string;
  topicTag?: string | null;
  meta: string;
  media?: PostMedia | null;
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
          {media && media.items.length > 0 && (
            <>
              <MediaCredit media={media} className="mt-1.5" />
              <PostMediaView media={media} className="mt-2" />
            </>
          )}
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
  initialMedia = null,
  kind,
  postAt,
  canGenerate,
}: {
  ideaId: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  initial: string | null;
  /** Gambar preview (atau gambar posting untuk ide terpakai) dari daftar ide; tanpa fetch tambahan. */
  initialMedia?: PostMedia | null;
  kind: "POSTING" | "PREVIEW" | null;
  postAt: string | null;
  canGenerate: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<Preview | null>(initial ? { text: initial, topicTag: null, at: null } : null);
  const [media, setMedia] = useState<PostMedia | null>(initialMedia);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState<IdeaMediaAction | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const mediaCtrlRef = useRef<AbortController | null>(null);

  const generate = (regenerate: boolean) => {
    ctrlRef.current?.abort();
    mediaCtrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setLoading(true);
    setError(null);
    setMediaError(null);
    return limited(() => fetchIdeaPreview(ideaId, regenerate, ctrl.signal))
      .then((res) => {
        setPreview({ text: res.preview.text, topicTag: res.preview.topicTag, at: res.preview.at });
        setMedia(res.preview.media ?? null);
      })
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
  useEffect(
    () => () => {
      ctrlRef.current?.abort();
      mediaCtrlRef.current?.abort();
    },
    []
  );

  const changeMedia = (action: IdeaMediaAction) => {
    mediaCtrlRef.current?.abort();
    const ctrl = new AbortController();
    mediaCtrlRef.current = ctrl;
    setMediaBusy(action);
    setMediaError(null);
    return changeIdeaMedia(ideaId, action, ctrl.signal)
      .then((res) => setMedia(res.media))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setMediaError(errorText(e, "Gambar belum bisa diubah. Coba lagi."));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setMediaBusy(null);
      });
  };

  const isPost = kind === "POSTING";
  const canMedia = canGenerate && !isPost && !!preview && !loading;
  const MEDIA_BTN =
    "h-8 px-3 rounded-full border border-line-strong text-xs font-semibold text-fg hover:border-accent hover:text-accent inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
  return (
    <div ref={ref} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted">{isPost ? "Postingan dari ide ini" : "Preview postingan"}</p>
        {canGenerate && !isPost && preview && (
          <button
            type="button"
            onClick={() => void generate(true)}
            disabled={loading || mediaBusy !== null}
            className="h-7 px-2.5 rounded-full text-xs font-semibold text-muted hover:text-accent hover:bg-subtle inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
            Tulis ulang
          </button>
        )}
      </div>

      {preview ? (
        <div className={cn("transition-opacity", (loading || mediaBusy === "ganti") && "opacity-50")} aria-busy={loading || mediaBusy !== null}>
          <ThreadsPostCard
            handle={handle}
            name={name}
            avatarUrl={avatarUrl}
            text={preview.text}
            topicTag={preview.topicTag}
            meta={isPost && postAt ? timeLabel(postAt) : "draf"}
            media={media}
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
      {canMedia && (
        <div className="flex flex-wrap gap-2">
          {media ? (
            <>
              <button type="button" onClick={() => void changeMedia("ganti")} disabled={mediaBusy !== null} className={MEDIA_BTN}>
                {mediaBusy === "ganti" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Images className="w-3.5 h-3.5" />}
                {mediaBusy === "ganti" ? "Mencari gambar…" : "Ganti gambar"}
              </button>
              <button type="button" onClick={() => void changeMedia("hapus")} disabled={mediaBusy !== null} className={MEDIA_BTN}>
                {mediaBusy === "hapus" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageOff className="w-3.5 h-3.5" />}
                Tanpa gambar
              </button>
            </>
          ) : (
            <button type="button" onClick={() => void changeMedia("ganti")} disabled={mediaBusy !== null} className={MEDIA_BTN}>
              {mediaBusy === "ganti" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
              {mediaBusy === "ganti" ? "Mencari gambar…" : "Tambah gambar"}
            </button>
          )}
        </div>
      )}
      {mediaError && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft text-danger p-2.5 text-xs font-medium">
          <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" />
          <span className="min-w-0 flex-1 break-words">{mediaError}</span>
        </p>
      )}
      {!isPost && preview && (
        <p className="text-[11px] text-muted">
          Autopilot memakai teks {media ? "dan gambar " : ""}ini saat menulis slot dengan ide ini, selama lolos pemeriksaan.
        </p>
      )}
    </div>
  );
}
