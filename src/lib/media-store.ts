/**
 * Gambar postingan di sisi server: unduh + periksa + olah gambar sumber (foto berita / Wikimedia Commons),
 * berkas SEMENTARA di Supabase Storage (bucket publik MEDIA_BUCKET, dipakai penerbit saat posting lalu
 * dihapus), dan catatan anti-duplikat gambar per akun (tabel "MediaUse", sql/037_media_use.sql).
 * Hanya untuk server (service role key).
 */
import { MEDIA_BUCKET, MEDIA_MIN_SOURCE_WIDTH, MEDIA_WIDTH } from "./post-media";
import { db, rpc, sqlTs } from "./supabase";

/** Batas objek per panggilan hapus Storage. */
const REMOVE_CHUNK = 1000;

/** Batas unduh satu gambar sumber. */
export const IMAGE_TIMEOUT_MS = 10_000;
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** Rasio lebar/tinggi di luar rentang ini biasanya banner atau infografis panjang. */
const MAX_ASPECT = 2.5;
const MIN_ASPECT = 0.4;
/** Format sumber yang diterima (pasti bisa diolah dan wajar untuk foto). */
const SOURCE_FORMATS = new Set(["jpeg", "png", "webp"]);

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
/** Wikimedia mewajibkan User-Agent yang menjelaskan aplikasi dan kontaknya. */
export const wikiUa = (): string =>
  `BotThreadsMediaFinder/1.0 (${process.env.APP_URL || "https://github.com/rendydev404"}; pencari foto ilustrasi) node-fetch`;

const isWikimediaHost = (url: string): boolean => {
  try {
    return /(^|\.)wikimedia\.org$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

/* ------------------------------------------------------------------ unduh + olah */

/** Baca badan biner; null bila melebihi `maxBytes` (gambar terpotong pasti rusak). */
async function readBinary(res: Response, maxBytes: number): Promise<Buffer | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) return null;
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}

/**
 * Unduh gambar sumber (https, maks 8 MB, batas waktu). Header sama untuk pencari gambar dan penerbit
 * (tanpa Referer), jadi gambar yang lolos saat dicari juga bisa diunduh saat posting. Null bila gagal.
 */
export async function downloadSourceImage(url: string, signal?: AbortSignal, timeoutMs = IMAGE_TIMEOUT_MS): Promise<Buffer | null> {
  if (!/^https:\/\//.test(url)) return null;
  const timeout = AbortSignal.timeout(Math.max(1, timeoutMs));
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": isWikimediaHost(url) ? wikiUa() : BROWSER_UA,
        Accept: "image/webp,image/jpeg,image/png,image/*;q=0.8",
      },
      redirect: "follow",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store",
    });
    const type = res.headers.get("content-type") ?? "";
    const len = Number(res.headers.get("content-length") ?? 0);
    if (!res.ok || (type && !/^image\/|octet-stream/i.test(type)) || /svg/i.test(type) || len > IMAGE_MAX_BYTES) {
      res.body?.cancel().catch(() => {});
      return null;
    }
    return await readBinary(res, IMAGE_MAX_BYTES);
  } catch {
    return null;
  }
}

/** Ukuran setelah orientasi EXIF, bila gambar JPEG/PNG/WebP cukup lebar dan rasionya wajar; null bila tidak. */
export async function probeImage(input: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(input, { limitInputPixels: 60_000_000 }).metadata();
    if (!meta.format || !SOURCE_FORMATS.has(meta.format)) return null;
    const width = meta.autoOrient?.width ?? meta.width ?? 0;
    const height = meta.autoOrient?.height ?? meta.height ?? 0;
    if (width < MEDIA_MIN_SOURCE_WIDTH || height <= 0) return null;
    const ratio = width / height;
    return ratio > MAX_ASPECT || ratio < MIN_ASPECT ? null : { width, height };
  } catch {
    return null;
  }
}

export interface Jpeg {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Gambar sumber -> JPEG lebar MEDIA_WIDTH (tidak diperbesar), kualitas 80, tanpa metadata, orientasi EXIF
 * diterapkan, latar transparan menjadi putih. Null bila rusak, terlalu sempit, atau rasionya ekstrem.
 */
export async function toJpeg(input: Buffer): Promise<Jpeg | null> {
  try {
    if (!(await probeImage(input))) return null;
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(input, { limitInputPixels: 60_000_000 })
      .rotate()
      .resize({ width: MEDIA_WIDTH, withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 80, progressive: true })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

/** Unduh + olah satu gambar sumber untuk diunggah sementara; null bila tidak bisa diunduh/diolah. */
export async function loadSourceJpeg(url: string, signal?: AbortSignal, timeoutMs = IMAGE_TIMEOUT_MS): Promise<Jpeg | null> {
  const buf = await downloadSourceImage(url, signal, timeoutMs);
  return buf ? toJpeg(buf) : null;
}

/* ------------------------------------------------------------------ storage */

/** Unggah JPEG ke bucket media (menimpa objek di path yang sama) dan kembalikan URL publiknya. */
export async function uploadMediaImage(path: string, jpeg: Buffer): Promise<string> {
  const bucket = db().storage.from(MEDIA_BUCKET);
  const { error } = await bucket.upload(path, jpeg, {
    contentType: "image/jpeg",
    // Berkas sementara (dihapus setelah terbit): cache CDN singkat supaya tidak tersaji lama setelah dihapus.
    cacheControl: "600",
    upsert: true,
  });
  if (error) throw new Error(`Storage: ${error.message}`);
  return bucket.getPublicUrl(path).data.publicUrl;
}

/** Hapus beberapa objek sekaligus (per 1.000). Objek yang sudah tidak ada diabaikan; galat lain dilempar. */
export async function deleteMediaFiles(paths: string[]): Promise<void> {
  const unique = [...new Set(paths.filter((p) => typeof p === "string" && p.length > 0))];
  for (let i = 0; i < unique.length; i += REMOVE_CHUNK) {
    const { error } = await db().storage.from(MEDIA_BUCKET).remove(unique.slice(i, i + REMOVE_CHUNK));
    if (error && !/not.?found/i.test(error.message)) throw new Error(`Storage: ${error.message}`);
  }
}

/* ------------------------------------------------------------------ anti-duplikat */

/** imageKey di `keys` yang sudah dipakai akun ini sejak `since`. */
export async function mediaUsedKeys(accountId: string, keys: string[], since: Date): Promise<Set<string>> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (!unique.length) return new Set();
  const used = await rpc<string[] | null>("dash_media_used", { p_account: accountId, p_keys: unique, p_since: sqlTs(since) });
  return new Set(used ?? []);
}

/** Catat pemakaian gambar oleh akun ini (upsert waktu pakai). */
export async function rememberMediaUse(accountId: string, keys: string[], now: Date = new Date()): Promise<void> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (!unique.length) return;
  await rpc<null>("dash_media_remember", { p_account: accountId, p_keys: unique, p_now: sqlTs(now) });
}
