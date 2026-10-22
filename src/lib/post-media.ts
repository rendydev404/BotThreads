/**
 * Kontrak bersama postingan bergambar (single image / carousel) dari foto berita atau Wikimedia Commons.
 * Dipakai pencari gambar (news-image), preview ide, autopilot, pembuat antrean, dan penerbit Threads.
 * Murni tanpa I/O supaya bisa diimpor dari server maupun klien.
 *
 * Berkas gambar TIDAK disimpan: yang disimpan hanya tautan gambar asal (`sourceUrl`). Preview menampilkan
 * gambar langsung dari sumbernya; penerbit mengunduh + mengolahnya saat posting, mengunggahnya sementara ke
 * bucket MEDIA_BUCKET (Threads butuh URL publik JPEG/PNG), lalu menghapusnya begitu postingan terbit.
 * Riwayat postingan mengambil gambar dari Threads API, bukan dari penyimpanan kita.
 */
import { charLength, THREADS_MAX_TEXT } from "./threads-text";

/** Bucket Supabase Storage publik untuk berkas SEMENTARA saat posting (dihapus setelah terbit). */
export const MEDIA_BUCKET = "threads-media";
/** Awalan path berkas sementara: `tmp/<postId>/<n>.jpg`. */
export const MEDIA_TMP_PREFIX = "tmp";
/** Batas carousel produk ini (Threads sendiri mengizinkan 2-20 item). */
export const CAROUSEL_MAX = 4;
export const CAROUSEL_MIN = 2;
/** Lebar hasil olahan gambar sebelum diunggah. */
export const MEDIA_WIDTH = 1080;
/** Gambar sumber lebih sempit dari ini dibuang (logo, thumbnail). */
export const MEDIA_MIN_SOURCE_WIDTH = 600;

export type PostMediaType = "IMAGE" | "CAROUSEL";
export type MediaSourceKind = "NEWS" | "WIKIMEDIA";

export interface PostMediaItem {
  /** URL https gambar asal (og:image artikel / berkas Wikimedia). Ditampilkan langsung di preview. */
  sourceUrl: string;
  /** Domain/nama sumber untuk kredit, mis. "kompas.com" atau "Wikimedia Commons". */
  credit: string;
  sourceKind: MediaSourceKind;
  /** Tautan artikel/halaman berkas asal (null bila tidak ada). */
  articleUrl: string | null;
  articleTitle: string | null;
  /** Kunci unik gambar asal (hash URL gambar sumber) untuk anti-duplikat per akun. */
  imageKey: string;
  width: number;
  height: number;
}

export interface PostMedia {
  type: PostMediaType;
  items: PostMediaItem[];
}

/** Baris kredit di akhir teks, mis. "📷 kompas.com · detik.com". Kosong bila tanpa media. */
export function creditLine(media: PostMedia | null | undefined): string {
  if (!media?.items.length) return "";
  const names = [...new Set(media.items.map((i) => i.credit.trim()).filter(Boolean))];
  return names.length ? `📷 ${names.join(" · ")}` : "";
}

/** Teks siap terbit dengan baris kredit (tidak ditambahkan dua kali). */
export function withCredit(text: string, media: PostMedia | null | undefined): string {
  const line = creditLine(media);
  const body = text.trim();
  if (!line || body.endsWith(line)) return body;
  return `${body}\n\n${line}`;
}

/** Teks + kredit masih muat dalam batas Threads. */
export const fitsWithCredit = (text: string, media: PostMedia | null | undefined): boolean =>
  charLength(withCredit(text, media)) <= THREADS_MAX_TEXT;

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Validasi media dari JSON (database/permintaan); null bila tidak sah. */
export function parsePostMedia(raw: unknown): PostMedia | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { type?: unknown; items?: unknown };
  if (r.type !== "IMAGE" && r.type !== "CAROUSEL") return null;
  if (!Array.isArray(r.items)) return null;
  const items: PostMediaItem[] = [];
  for (const it of r.items) {
    if (!it || typeof it !== "object") return null;
    const i = it as Record<string, unknown>;
    if (!isStr(i.sourceUrl) || !/^https:\/\//.test(i.sourceUrl) || !isStr(i.credit) || !isStr(i.imageKey)) return null;
    if (i.sourceKind !== "NEWS" && i.sourceKind !== "WIKIMEDIA") return null;
    items.push({
      sourceUrl: i.sourceUrl,
      credit: i.credit.slice(0, 60),
      sourceKind: i.sourceKind,
      articleUrl: isStr(i.articleUrl) ? i.articleUrl : null,
      articleTitle: isStr(i.articleTitle) ? i.articleTitle.slice(0, 200) : null,
      imageKey: i.imageKey,
      width: Number(i.width) || 0,
      height: Number(i.height) || 0,
    });
  }
  if (r.type === "IMAGE" && items.length !== 1) return null;
  if (r.type === "CAROUSEL" && (items.length < CAROUSEL_MIN || items.length > CAROUSEL_MAX)) return null;
  return { type: r.type, items };
}
