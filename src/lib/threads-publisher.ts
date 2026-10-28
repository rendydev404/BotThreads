/**
 * Penerbit Threads milik dashboard: menerbitkan antrean "PostDispatch" (publisher THREADS, source
 * DASHBOARD_AI) di database BotThreads. Dipanggil penjadwal tiap menit lewat /api/internal/publisher/tick.
 *
 * Alurnya sama dengan worker auto-suka (threads-publisher.service.ts), dua tahap:
 * 1. Dispatch jatuh tempo -> buat media container di Threads (TEXT, IMAGE, atau CAROUSEL: item dulu lalu
 *    induknya; sql/036), simpan id-nya. Postingan bergambar hanya menyimpan tautan gambar asal: gambar diunduh,
 *    diolah (JPEG 1080), dicatat path-nya di posting, lalu diunggah SEMENTARA ke bucket media di
 *    "tmp/<postId>/<n>.jpg" (sql/040) dan URL publiknya dipakai container. Gambar sumber yang hilang dibuang:
 *    carousel menyusut, dan tanpa gambar sama sekali postingan terbit sebagai teks tanpa baris kredit.
 * 2. Container FINISHED -> threads_publish -> TERBIT. Postingan teks biasanya langsung FINISHED, jadi
 *    tahap 2 dicoba di putaran yang sama; gambar sering baru siap di putaran berikutnya.
 * Bila proses mati setelah publish tetapi sebelum database diperbarui, status container menjadi PUBLISHED
 * dan putaran berikutnya menandainya TERBIT: tidak ada postingan ganda.
 * 3. Balasan pertama berisi link untuk postingan affiliate autopilot yang sudah terbit (sql/019).
 *
 * Berkas sementara dihapus begitu hasil akhirnya TERBIT atau GAGAL (database ikut mengosongkan kolomnya);
 * yang tertinggal (proses mati, storage galat) disapu media-cleanup.ts.
 *
 * Klaim, transisi status, dan penutupan posting dikerjakan fungsi SQL (sql/022_threads_publisher.sql, sql/040).
 */
import { isPublishEnabled } from "./content-config";
import { runBuzzerQueue } from "./buzzer-service";
import { runMediaCleanup } from "./media-cleanup";
import { deleteMediaFiles, loadSourceJpeg, uploadMediaImage } from "./media-store";
import { MEDIA_TMP_PREFIX } from "./post-media";
import { db, rpc, sqlTs, toDate } from "./supabase";
import { firstValidTopic, charLength, THREADS_MAX_TEXT } from "./threads-text";
import { runReplies } from "./threads-replies";
import { runReplyPolling } from "./threads-reply-poll";
import { decryptThreadsToken, encryptThreadsToken } from "./threads-token";

const API = "https://graph.threads.net/v1.0";
const GRAPH = "https://graph.threads.net";
const FETCH_TIMEOUT_MS = 15_000;
/** Kunci dispatch lebih tua dari ini dianggap proses yang mati, boleh diambil ulang. */
const STALE_LOCK_MS = 10 * 60 * 1000;
/** Postingan yang belum diproses lebih dari ini setelah jam tayangnya tidak diterbitkan lagi. */
const EXPIRE_AFTER_MS = 2 * 60 * 60 * 1000;
const BATCH = 25;
const CONCURRENCY = 5;
/** Percobaan ulang untuk galat sementara (jaringan, 5xx) sebelum ditandai GAGAL. */
const MAX_RETRY = 3;
/** Pemeriksaan status container sebelum menyerah (satu per menit). */
const MAX_PROCESSING_CHECKS = 20;
/** Perpanjang token bila masa berlakunya tersisa kurang dari ini (dan token berumur minimal sehari). */
const REFRESH_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const AFFILIATE_BATCH = 5;
const AFFILIATE_RETRY_MS = 5 * 60 * 1000;
const BRANCH_TAG = /{nama_(?:cabang|outlet)}/g;
/** Batas waktu putaran sampai balas komentar berhenti mengambil pekerjaan baru. */
const REPLIES_BUDGET_MS = 45_000;
/** Polling komentar selesai lebih dulu supaya komentar yang ditemukan sempat dibalas di putaran yang sama. */
const REPLY_POLL_BUDGET_MS = 25_000;
/** Dispatch bergambar baru mulai menyiapkan gambar bila putaran belum berjalan selama ini (batas route 60 detik). */
const MEDIA_START_BUDGET_MS = 30_000;
/** Dispatch yang menyiapkan gambar bersamaan (maks 4 gambar per dispatch: unduh + sharp + unggah; hemat memori). */
const MEDIA_CONCURRENCY = 2;

/* ------------------------------------------------------------------ Threads API */

export class ThreadsApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number
  ) {
    super(message);
    this.name = "ThreadsApiError";
  }

  /** Token dicabut/kedaluwarsa (OAuthException 190): akun harus dihubungkan ulang. */
  get isAuthError(): boolean {
    return this.code === 190 || this.status === 401;
  }
}

async function graph<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; error_user_msg?: string; code?: number } };
  if (!res.ok || body?.error) {
    const e = body?.error ?? {};
    throw new ThreadsApiError(e.error_user_msg || e.message || `Threads API error (${res.status})`, res.status, e.code);
  }
  return body;
}

type ContainerStatus = "FINISHED" | "PUBLISHED" | "IN_PROGRESS" | "ERROR" | "EXPIRED";

/** Panggilan Threads API yang dipakai penerbit dan balas komentar. */
export const threads = {
  async createText(userId: string, token: string, text: string, extra: Record<string, string> = {}): Promise<string> {
    const body = new URLSearchParams({ access_token: token, media_type: "TEXT", text, ...extra });
    return (await graph<{ id: string }>(`${API}/${userId}/threads`, { method: "POST", body })).id;
  },
  /** Container satu gambar; Threads mengunduh `imageUrl` (harus publik, https). */
  async createImage(userId: string, token: string, imageUrl: string, text: string, extra: Record<string, string> = {}): Promise<string> {
    const body = new URLSearchParams({ access_token: token, media_type: "IMAGE", image_url: imageUrl, ...(text ? { text } : {}), ...extra });
    return (await graph<{ id: string }>(`${API}/${userId}/threads`, { method: "POST", body })).id;
  },
  /** Item carousel (tanpa teks); id-nya dipakai sebagai `children` container carousel. */
  async createCarouselItem(userId: string, token: string, imageUrl: string): Promise<string> {
    const body = new URLSearchParams({ access_token: token, media_type: "IMAGE", image_url: imageUrl, is_carousel_item: "true" });
    return (await graph<{ id: string }>(`${API}/${userId}/threads`, { method: "POST", body })).id;
  },
  async createCarousel(userId: string, token: string, childIds: string[], text: string, extra: Record<string, string> = {}): Promise<string> {
    const body = new URLSearchParams({ access_token: token, media_type: "CAROUSEL", children: childIds.join(","), ...(text ? { text } : {}), ...extra });
    return (await graph<{ id: string }>(`${API}/${userId}/threads`, { method: "POST", body })).id;
  },
  status(containerId: string, token: string) {
    return graph<{ status: ContainerStatus; error_message?: string }>(
      `${API}/${containerId}?${new URLSearchParams({ fields: "status,error_message", access_token: token })}`
    );
  },
  async publish(userId: string, token: string, containerId: string): Promise<string> {
    const body = new URLSearchParams({ access_token: token, creation_id: containerId });
    return (await graph<{ id: string }>(`${API}/${userId}/threads_publish`, { method: "POST", body })).id;
  },
  async repost(mediaId: string, token: string): Promise<string> {
    const body = new URLSearchParams({ access_token: token });
    return (await graph<{ id: string }>(`${API}/${mediaId}/repost`, { method: "POST", body })).id;
  },
  async permalink(mediaId: string, token: string): Promise<string | null> {
    try {
      const r = await graph<{ permalink?: string }>(`${API}/${mediaId}?${new URLSearchParams({ fields: "permalink", access_token: token })}`);
      return r.permalink ?? null;
    } catch {
      return null;
    }
  },
  refresh(token: string) {
    return graph<{ access_token: string; expires_in?: number }>(
      `${GRAPH}/refresh_access_token?${new URLSearchParams({ grant_type: "th_refresh_token", access_token: token })}`
    );
  },
};

/* ------------------------------------------------------------------ data */

export interface AccountRow {
  id: string;
  threadsUserId: string;
  accessToken: string;
  accessExpiresAt: string;
  needsReconnect: boolean;
  updatedAt: string | null;
}

interface ClaimedDispatch {
  id: string;
  postId: string;
  containerId: string | null;
  attempts: number;
  caption: string | null;
  hashtags: string[];
  mediaType: string | null;
  /** Tautan gambar asal (sql/036, PostMediaItem.sourceUrl); kosong untuk postingan teks. */
  mediaUrls: string[];
  /** Path berkas sementara yang tercatat di posting (sql/040); kosong bila belum ada. */
  mediaPaths?: string[];
  outletNama: string | null;
  account: AccountRow | null;
}

/** `containerId` ikut disimpan bila container dibuat pada langkah yang sama. */
type Outcome =
  | { kind: "CONTAINER"; containerId: string }
  | { kind: "TERBIT"; mediaId: string | null; url: string | null; containerId?: string }
  | { kind: "GAGAL"; error: string; containerId?: string }
  | { kind: "ULANG"; error?: string; containerId?: string }
  /** Belum dikerjakan (sisa waktu putaran kurang): kunci dilepas tanpa menambah percobaan (sql/040). */
  | { kind: "TUNDA"; containerId?: string };

const result = (id: string, o: Outcome, now: Date): Promise<string> => {
  const { kind, ...patch } = o;
  return rpc<string>("dash_pub_result", { p_id: id, p_outcome: kind, p_patch: patch, p_now: sqlTs(now) });
};

export const markReconnect = (accountId: string, now: Date) =>
  rpc("dash_pub_token", { p_id: accountId, p_token: null, p_expires: null, p_reconnect: true, p_now: sqlTs(now) }).catch(() => undefined);

/** Token akses yang masih berlaku, diperpanjang bila hampir habis. Null = akun harus dihubungkan ulang. */
export async function accessTokenFor(account: AccountRow, now: Date): Promise<string | null> {
  if (account.needsReconnect) return null;
  const expires = toDate(account.accessExpiresAt).getTime();
  if (expires <= now.getTime()) {
    await markReconnect(account.id, now);
    return null;
  }
  const token = decryptThreadsToken(account.accessToken);
  const oldEnough = !account.updatedAt || now.getTime() - toDate(account.updatedAt).getTime() > DAY_MS;
  if (expires - now.getTime() < REFRESH_BEFORE_MS && oldEnough) {
    try {
      const r = await threads.refresh(token);
      await rpc("dash_pub_token", {
        p_id: account.id,
        p_token: encryptThreadsToken(r.access_token),
        p_expires: sqlTs(new Date(now.getTime() + (r.expires_in || 60 * 86_400) * 1000)),
        p_reconnect: false,
        p_now: sqlTs(now),
      });
      return r.access_token;
    } catch (err) {
      // Token lama masih berlaku; coba perpanjang lagi di putaran berikutnya.
      console.warn(`[publisher] gagal memperpanjang token ${account.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return token;
}

/** Teks siap terbit: tag cabang diganti nama cabang. */
export function postText(caption: string | null, outletNama: string | null): string {
  return (caption ?? "").replace(BRANCH_TAG, outletNama ?? "").trim();
}

/* ------------------------------------------------------------------ satu dispatch */

/** Galat sementara dicoba lagi sampai batas; galat token langsung GAGAL dan akun ditandai hubungkan ulang. */
async function onError(d: ClaimedDispatch, err: unknown, limit: number, now: Date): Promise<Outcome> {
  const message = err instanceof Error ? err.message : "Gagal menerbitkan ke Threads.";
  if (err instanceof ThreadsApiError && err.isAuthError) {
    if (d.account) await markReconnect(d.account.id, now);
    return { kind: "GAGAL", error: "Sesi Threads tidak berlaku lagi. Hubungkan ulang akun Threads ini." };
  }
  return d.attempts + 1 >= limit ? { kind: "GAGAL", error: message } : { kind: "ULANG", error: message };
}

/** Batas jumlah item carousel dari Threads API (produk sendiri membatasi lebih ketat, lihat post-media.ts). */
const CAROUSEL_API_MIN = 2;
const CAROUSEL_API_MAX = 20;

/** Pesan galat bila jenis/jumlah/URL media tidak bisa diterbitkan; null bila sah. */
export function mediaError(mediaType: string, urls: string[]): string | null {
  if (mediaType === "TEXT") return null;
  if (mediaType !== "IMAGE" && mediaType !== "CAROUSEL") return `Jenis media ${mediaType} tidak didukung penerbit dashboard.`;
  if (mediaType === "IMAGE" && urls.length !== 1) return `Postingan gambar butuh tepat 1 gambar (ada ${urls.length}).`;
  if (mediaType === "CAROUSEL" && (urls.length < CAROUSEL_API_MIN || urls.length > CAROUSEL_API_MAX)) {
    return `Carousel butuh ${CAROUSEL_API_MIN}-${CAROUSEL_API_MAX} gambar (ada ${urls.length}).`;
  }
  if (urls.some((u) => !/^https:\/\/\S+$/.test(u))) return "URL gambar harus https.";
  return null;
}

/** Teks tanpa baris kredit foto ("📷 ...") di akhir, untuk postingan bergambar yang terpaksa terbit sebagai teks. */
export function withoutCredit(text: string): string {
  const lines = text.trim().split("\n");
  if (!lines.at(-1)?.trim().startsWith("📷 ")) return text.trim();
  return lines.slice(0, -1).join("\n").trim();
}

/** Path berkas sementara gambar ke-n (urutan di mediaUrls, stabil antar percobaan) milik satu posting. */
export const tmpMediaPath = (postId: string, n: number): string => `${MEDIA_TMP_PREFIX}/${postId}/${n}.jpg`;

let mediaActive = 0;
const mediaWaiting: (() => void)[] = [];

/** Batasi dispatch yang menyiapkan gambar bersamaan; giliran diserahkan langsung ke yang menunggu. */
async function withMediaSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (mediaActive < MEDIA_CONCURRENCY) mediaActive++;
  else await new Promise<void>((resolve) => mediaWaiting.push(resolve));
  try {
    return await fn();
  } finally {
    const next = mediaWaiting.shift();
    if (next) next();
    else mediaActive--;
  }
}

interface StagedMedia {
  type: "TEXT" | "IMAGE" | "CAROUSEL";
  /** URL publik berkas sementara, urut sesuai gambar asal. */
  imageUrls: string[];
}

/**
 * Siapkan gambar postingan: unduh + olah semua sumber sejajar, catat path sementaranya di posting SEBELUM
 * diunggah (`tmp` ikut diisi supaya pemanggil bisa menghapusnya), lalu unggah. Sumber yang gagal dibuang;
 * galat database/storage dilempar (dicoba ulang seperti galat sementara lain).
 */
async function stageMedia(d: ClaimedDispatch, mediaType: "IMAGE" | "CAROUSEL", sources: string[], tmp: string[]): Promise<StagedMedia> {
  const started = Date.now();
  const jpegs = await Promise.all(sources.map((url) => loadSourceJpeg(url)));
  const ok = jpegs.flatMap((j, n) => (j ? [{ n, data: j.data }] : []));
  const type: StagedMedia["type"] =
    ok.length === 0 ? "TEXT" : mediaType === "CAROUSEL" && ok.length >= CAROUSEL_API_MIN ? "CAROUSEL" : "IMAGE";
  if (ok.length < sources.length) {
    console.warn(
      `[publisher] posting ${d.postId}: ${sources.length - ok.length}/${sources.length} gambar sumber tidak bisa diunduh/diolah, terbit sebagai ${type}.`
    );
  }
  if (!ok.length) return { type, imageUrls: [] };

  const paths = ok.map((o) => tmpMediaPath(d.postId, o.n));
  const recorded = await rpc<boolean | null>("dash_pub_media_tmp", { p_post: d.postId, p_paths: paths });
  if (!recorded) throw new Error("Posting tidak lagi menunggu terbit.");
  tmp.push(...paths);
  const imageUrls = await Promise.all(ok.map((o, i) => uploadMediaImage(paths[i], o.data)));
  console.info(`[publisher] posting ${d.postId}: ${ok.length} gambar disiapkan dalam ${Date.now() - started} ms`);
  return { type, imageUrls };
}

/** Hapus berkas sementara posting (hanya path "tmp/..."); galat hanya dicatat, sisanya disapu media-cleanup. */
async function dropTmpFiles(postId: string, paths: string[]): Promise<void> {
  const list = [...new Set(paths.filter((p) => typeof p === "string" && p.startsWith(`${MEDIA_TMP_PREFIX}/`)))];
  if (!list.length) return;
  await deleteMediaFiles(list).catch((err) =>
    console.warn(`[publisher] berkas sementara posting ${postId} belum terhapus:`, err instanceof Error ? err.message : err)
  );
}

/** Terbitkan container yang sudah dibuat; null = masih diproses Threads (sudah dicatat ULANG). */
async function publishContainer(d: ClaimedDispatch, userId: string, token: string, containerId: string): Promise<Outcome> {
  const { status, error_message } = await threads.status(containerId, token);
  if (status === "FINISHED") {
    const mediaId = await threads.publish(userId, token, containerId);
    return { kind: "TERBIT", mediaId, url: await threads.permalink(mediaId, token) };
  }
  if (status === "PUBLISHED") return { kind: "TERBIT", mediaId: null, url: null };
  if (status === "ERROR" || status === "EXPIRED") {
    return { kind: "GAGAL", error: error_message || `Threads menolak postingan (status ${status}).` };
  }
  if (d.attempts + 1 >= MAX_PROCESSING_CHECKS) return { kind: "GAGAL", error: "Threads terlalu lama memproses postingan." };
  return { kind: "ULANG" };
}

function statMediaType(raw: string | null): string {
  const m = (raw ?? "").toUpperCase();
  if (m === "VIDEO") return "VIDEO";
  if (m === "CAROUSEL" || m === "CAROUSEL_ALBUM") return "CAROUSEL_ALBUM";
  if (m === "IMAGE" || m === "PHOTO") return "IMAGE";
  return "TEXT_POST";
}

/** `mediaDeadlineMs`: setelah waktu ini dispatch bergambar yang belum punya container ditunda (TUNDA). */
export async function processDispatch(d: ClaimedDispatch, now: Date, mediaDeadlineMs = Infinity): Promise<Outcome["kind"]> {
  /** Path sementara yang dicatat pada langkah ini (selain yang sudah tercatat sebelum klaim). */
  const tmp: string[] = [];
  const finish = async (o: Outcome) => {
    const r = await result(d.id, o, now);
    // Catat langsung ke ThreadsPostStat supaya halaman /posts tidak menampilkan "(Tidak ada caption teks)"
    // bila worker sinkronisasi metrik menyentuh baris ini sebelum pengumpul insight harian berjalan.
    if (r === "OK" && o.kind === "TERBIT" && o.mediaId && d.account) {
      await Promise.resolve(
        db()
          .from("ThreadsPostStat")
          .upsert(
            {
              threadsAccountId: d.account.id,
              mediaId: o.mediaId,
              mediaType: statMediaType(d.mediaType),
              text: postText(d.caption, d.outletNama).slice(0, THREADS_MAX_TEXT),
              permalink: o.url,
              isQuote: false,
              postedAt: sqlTs(now),
              updatedAt: sqlTs(now),
            },
            { onConflict: "mediaId" }
          )
      ).catch(() => undefined);
    }
    // Hasil akhir: database sudah mengosongkan kolom gambar, berkasnya dihapus sekarang.
    if (r === "OK" && (o.kind === "TERBIT" || o.kind === "GAGAL")) await dropTmpFiles(d.postId, [...(d.mediaPaths ?? []), ...tmp]);
    return o.kind;
  };
  if (!d.account) return finish({ kind: "GAGAL", error: "Akun Threads belum terhubung ke postingan ini." });

  let token: string | null;
  try {
    token = await accessTokenFor(d.account, now);
  } catch (err) {
    // Kunci enkripsi tidak cocok atau token rusak: mengulang tidak akan membantu.
    console.error(`[publisher] token ${d.account.id}:`, err instanceof Error ? err.message : err);
    return finish({ kind: "GAGAL", error: "Token Threads tidak bisa dibaca. Hubungkan ulang akun Threads ini." });
  }
  if (!token) return finish({ kind: "GAGAL", error: "Sesi Threads kedaluwarsa. Hubungkan ulang akun Threads ini." });
  const userId = d.account.threadsUserId;

  // Tahap 2: container sudah ada.
  if (d.containerId) {
    try {
      return finish(await publishContainer(d, userId, token, d.containerId));
    } catch (err) {
      return finish(await onError(d, err, 5, now));
    }
  }

  // Tahap 1: buat container.
  const mediaType = d.mediaType ?? "TEXT";
  const urls = d.mediaUrls ?? [];
  const invalid = mediaError(mediaType, urls);
  if (invalid) return finish({ kind: "GAGAL", error: invalid });
  let text = postText(d.caption, d.outletNama);
  // Gambar boleh tanpa teks; postingan teks tidak.
  if (!text && mediaType === "TEXT") return finish({ kind: "GAGAL", error: "Teks postingan kosong." });
  if (charLength(text) > THREADS_MAX_TEXT) {
    return finish({ kind: "GAGAL", error: `Teks ${charLength(text)} karakter. Threads maksimal ${THREADS_MAX_TEXT} karakter.` });
  }
  const topic = firstValidTopic(d.hashtags);
  const extra: Record<string, string> = topic ? { topic_tag: topic } : {};

  // Gambar: unduh dari sumber dan unggah sementara (URL publik untuk Threads).
  let kind = mediaType;
  let imageUrls: string[] = [];
  if (mediaType === "IMAGE" || mediaType === "CAROUSEL") {
    let staged: StagedMedia | null;
    try {
      staged = await withMediaSlot(() => (Date.now() > mediaDeadlineMs ? Promise.resolve(null) : stageMedia(d, mediaType, urls, tmp)));
    } catch (err) {
      return finish(await onError(d, err, MAX_RETRY, now));
    }
    if (!staged) return finish({ kind: "TUNDA" });
    kind = staged.type;
    imageUrls = staged.imageUrls;
    if (kind === "TEXT") {
      // Foto sumber sudah tidak ada: terbit sebagai teks, tanpa kredit foto yang tidak lagi relevan.
      text = withoutCredit(text);
      if (!text) return finish({ kind: "GAGAL", error: "Gambar sumber tidak bisa diunduh dan postingan tidak punya teks." });
    }
  }

  let containerId: string;
  try {
    if (kind === "IMAGE") {
      containerId = await threads.createImage(userId, token, imageUrls[0], text, extra);
    } else if (kind === "CAROUSEL") {
      // Item dibuat berurutan lalu container induknya; hanya id induk yang disimpan. Bila gagal di tengah,
      // putaran berikutnya membuat semuanya ulang: item yatim tidak pernah terbit dan kedaluwarsa sendiri
      // di Threads setelah 24 jam.
      const children: string[] = [];
      for (const url of imageUrls) children.push(await threads.createCarouselItem(userId, token, url));
      containerId = await threads.createCarousel(userId, token, children, text, extra);
    } else {
      containerId = await threads.createText(userId, token, text, extra);
    }
  } catch (err) {
    return finish(await onError(d, err, MAX_RETRY, now));
  }

  // Teks biasanya langsung FINISHED: terbitkan selagi dispatch masih dikunci. Gambar sering masih
  // IN_PROGRESS. Bila belum siap atau ada galat, container disimpan dan tahap 2 menyelesaikannya di
  // putaran berikutnya (PUBLISHED = sudah tayang).
  try {
    const o = await publishContainer(d, userId, token, containerId);
    return finish(o.kind === "ULANG" ? { kind: "CONTAINER", containerId } : { ...o, containerId });
  } catch (err) {
    console.warn(`[publisher] terbit langsung ${d.id} ditunda:`, err instanceof Error ? err.message : err);
    return finish({ kind: "CONTAINER", containerId });
  }
}

/* ------------------------------------------------------------------ affiliate */

interface AffiliateJob {
  id: string;
  text: string;
  mediaId: string;
  threadsAccountId: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Balasan pertama berisi link affiliate untuk postingan autopilot yang sudah terbit. */
async function sendAffiliateReplies(now: Date, counts: Record<string, number>): Promise<void> {
  let jobs: AffiliateJob[];
  try {
    jobs = await rpc<AffiliateJob[]>("dash_aff_reply_due", { p_now: sqlTs(now), p_limit: AFFILIATE_BATCH });
  } catch (err) {
    // Affiliate belum dipasang (sql/019): lewati tanpa membanjiri log.
    if (!/dash_aff_reply_due|PGRST202|42883/.test(err instanceof Error ? err.message : "")) {
      console.error("[publisher] affiliate:", err instanceof Error ? err.message : err);
    }
    return;
  }
  for (const job of jobs ?? []) {
    const done = (replyId: string | null, error: string | null, retryAt: Date | null) =>
      rpc("dash_aff_reply_done", {
        p_id: job.id,
        p_reply_id: replyId,
        p_error: error,
        p_retry_at: retryAt ? sqlTs(retryAt) : null,
        p_now: sqlTs(new Date()),
      }).catch(() => undefined);
    try {
      const account = await rpc<AccountRow | null>("dash_pub_account", { p_id: job.threadsAccountId });
      if (!account) {
        await done(null, "Akun Threads tidak ditemukan.", null);
        continue;
      }
      const token = await accessTokenFor(account, now);
      if (!token) {
        await done(null, "Sesi Threads kedaluwarsa. Hubungkan ulang akun Threads.", null);
        continue;
      }
      const containerId = await threads.createText(account.threadsUserId, token, job.text, { reply_to_id: job.mediaId });
      for (let i = 0; i < 5; i++) {
        const { status, error_message } = await threads.status(containerId, token);
        if (status === "FINISHED") break;
        if (status === "ERROR" || status === "EXPIRED") throw new ThreadsApiError(`Container balasan ${status}: ${error_message ?? "-"}`, 400, -1);
        await sleep(3000);
      }
      await done(await threads.publish(account.threadsUserId, token, containerId), null, null);
      counts.balasanAffiliate = (counts.balasanAffiliate ?? 0) + 1;
    } catch (err) {
      const auth = err instanceof ThreadsApiError && err.isAuthError;
      if (auth) await markReconnect(job.threadsAccountId, now);
      await done(null, err instanceof Error ? err.message : "Gagal mengirim balasan affiliate.", auth ? null : new Date(Date.now() + AFFILIATE_RETRY_MS));
    }
  }
}

/* ------------------------------------------------------------------ putaran */

export interface PublisherResult {
  ok: boolean;
  skipped?: string;
  ms: number;
  counts: Record<string, number>;
}

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const run = async () => {
    while (next < items.length) await worker(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

export async function runPublisher(opts: { now?: Date } = {}): Promise<PublisherResult> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const counts: Record<string, number> = {};
  if (!isPublishEnabled()) return { ok: true, skipped: "Saklar posting mati.", ms: 0, counts };

  const jobs = await rpc<ClaimedDispatch[]>("dash_pub_claim", {
    p_now: sqlTs(now),
    p_stale_before: sqlTs(new Date(now.getTime() - STALE_LOCK_MS)),
    p_expire_before: sqlTs(new Date(now.getTime() - EXPIRE_AFTER_MS)),
    p_limit: BATCH,
  });
  counts.diklaim = jobs.length;

  // Satu akun dikerjakan berurutan (batas laju Threads per akun); akun berbeda berjalan bersamaan.
  const byAccount = new Map<string, ClaimedDispatch[]>();
  for (const j of jobs) {
    const key = j.account?.id ?? j.id;
    byAccount.set(key, [...(byAccount.get(key) ?? []), j]);
  }
  await pool([...byAccount.values()], CONCURRENCY, async (list) => {
    for (const d of list) {
      try {
        const kind = await processDispatch(d, now, started + MEDIA_START_BUDGET_MS);
        counts[kind] = (counts[kind] ?? 0) + 1;
      } catch (err) {
        // Galat database: kunci dibiarkan, diambil ulang setelah STALE_LOCK_MS.
        counts.galat = (counts.galat ?? 0) + 1;
        console.error(`[publisher] dispatch ${d.id}:`, err instanceof Error ? err.message : err);
      }
    }
  });

  await sendAffiliateReplies(now, counts);
  // Cadangan webhook (sql/044): ambil komentar baru di postingan 3 hari terakhir, jadwal makin jarang.
  await runReplyPolling(now, started + REPLY_POLL_BUDGET_MS, counts).catch((err) => {
    counts.pollingGalat = (counts.pollingGalat ?? 0) + 1;
    console.error("[publisher] polling komentar:", err instanceof Error ? err.message : err);
  });
  // Balas komentar otomatis (sql/023); dibatasi waktu supaya putaran selesai sebelum batas route 60 detik.
  await runReplies(now, started + REPLIES_BUDGET_MS, counts);
  // Antrean pengerahan buzzer lintas-niche (sql/029).
  await runBuzzerQueue({ now, deadlineMs: started + REPLIES_BUDGET_MS, counts });
  // Sapu berkas gambar sementara yang tertinggal (sql/040).
  await runMediaCleanup(now, counts, started + REPLIES_BUDGET_MS);
  const ms = Date.now() - started;
  if (Object.keys(counts).length > 1 || jobs.length) console.info(`[publisher] ${ms} ms ${JSON.stringify(counts)}`);
  return { ok: true, ms, counts };
}
