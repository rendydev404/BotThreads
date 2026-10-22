/**
 * Preview postingan dari satu ide bank ide (tab Ide di Radar). Ditulis AI sekali saat ide pertama kali dilihat,
 * disimpan di ide itu, lalu dipakai ulang: tampilan berikutnya tidak memanggil AI lagi, dan autopilot memakai
 * teks yang sama lebih dulu saat menulis slot dengan ide ini (tetap melewati gerbang dan kritikus).
 *
 * Gambar (foto berita / Wikimedia Commons) ikut dipilih setelah teksnya jadi, bila pengaturan gambar akun
 * mengizinkan. Gambar menempel pada ide: autopilot memakainya untuk slot dengan ide ini. Gagal mencari gambar
 * tidak pernah menggagalkan preview teks. Yang disimpan hanya tautan gambar asal (tanpa berkas di storage),
 * jadi mengganti/menghapus gambar cukup mengubah data ide.
 */
import { runGate } from "./autopilot-gate";
import { editCandidates } from "./content-ai";
import { imageAllowed } from "./media-policy";
import { pickIdeaMedia } from "./news-image";
import { fitsWithCredit, parsePostMedia, type PostMedia } from "./post-media";
import { getPublishAccountMap } from "./publish-accounts";
import { ideaPreviewSource, saveIdeaPreview, setIdeaMedia, type IdeaPreview, type IdeaPreviewSource } from "./radar-store";
import type { RequestCtx } from "./request-ctx";
import type { Failure } from "./threads-publish";

const failure = (status: number, error: string): Failure => ({ ok: false, status, error });

/** Batas waktu mencari gambar untuk preview otomatis (route preview dibatasi 60 detik termasuk tulis AI). */
export const MEDIA_BUDGET_MS = 25_000;
/** Batas waktu tombol Ganti/Tambah gambar. */
const MEDIA_ACTION_MS = 50_000;
/** Sisa waktu minimal sebelum batas route supaya pencarian gambar masih layak dicoba. */
const ROUTE_BUDGET_MS = 55_000;
const MIN_MEDIA_MS = 5_000;

/** Jalankan `fn` dengan batas waktu; abort dari `outer` atau habisnya waktu membatalkan keduanya. */
async function withTimeout<T>(ms: number, outer: AbortSignal | undefined, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const timeout = AbortSignal.timeout(ms);
  const signal = outer ? AbortSignal.any([outer, timeout]) : timeout;
  let onAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("Pencarian gambar dibatalkan atau melewati batas waktu."));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    // Pencari gambar yang tidak menghormati signal tetap tidak boleh menahan respons.
    return await Promise.race([fn(signal), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

type MediaSource = Pick<IdeaPreviewSource, "id" | "accountId" | "topik" | "sudut"> & { workspaceId?: string | null };

/**
 * Gambar untuk preview otomatis: hanya bila diizinkan pengaturan akun dan teks + kredit masih muat.
 * Tidak pernah melempar; galat/timeout = tanpa gambar.
 */
async function autoMedia(ctx: RequestCtx, idea: MediaSource, text: string, ms: number, signal?: AbortSignal): Promise<PostMedia | null> {
  if (ms < MIN_MEDIA_MS || signal?.aborted) return null;
  let media: PostMedia | null = null;
  try {
    if (!(await imageAllowed(idea.accountId))) return null;
    media = parsePostMedia(
      await withTimeout(ms, signal, (s) =>
        pickIdeaMedia({
          workspaceId: idea.workspaceId ?? ctx.workspaceId ?? "",
          accountId: idea.accountId,
          ideaId: idea.id,
          topik: idea.topik,
          sudut: idea.sudut,
          text,
          signal: s,
        })
      )
    );
  } catch (err) {
    console.warn(`[idea-media] ide ${idea.id}: gambar dilewati:`, err instanceof Error ? err.message : err);
    return null;
  }
  return media && fitsWithCredit(text, media) ? media : null;
}

export async function ideaPreview(
  ctx: RequestCtx,
  id: string,
  opts: { regenerate: boolean; signal?: AbortSignal },
  now = new Date()
): Promise<{ ok: true; preview: IdeaPreview } | Failure> {
  const started = Date.now();
  const idea = await ideaPreviewSource(id, ctx.workspaceId, ctx.accountIds);
  if (!idea) return failure(404, "Ide tidak ditemukan.");
  if (idea.preview && !opts.regenerate) return { ok: true, preview: idea.preview };
  if (idea.status !== "BARU") return failure(409, "Ide ini sudah tidak siap dipakai, jadi preview-nya tidak ditulis ulang.");

  const account = (await getPublishAccountMap([idea.accountId])).get(idea.accountId);
  if (!account) return failure(404, "Akun Threads ide ini tidak ditemukan.");

  // Contoh gaya dari korpus workspace ide (blok CONTOH GAYA THREADS + POLA LAYOUT); kandidat yang menyalin
  // frasa contoh sudah dibuang editCandidates, jadi preview yang tersimpan juga lolos anti-jiplak autopilot.
  const res = await editCandidates(
    {
      account,
      text: idea.preview?.text ?? "",
      action: "idea",
      idea: { topik: idea.topik, sudut: idea.sudut },
      workspaceId: idea.workspaceId ?? ctx.workspaceId ?? undefined,
      signal: opts.signal,
    },
    now
  );
  if (!res.ok) return failure(502, res.error);
  // Versi yang lolos pemeriksaan klaim (tanpa sumber fakta: paling ketat) didahulukan, supaya preview yang
  // dilihat pengguna adalah versi yang nanti juga lolos saat autopilot menulis slotnya.
  const best =
    res.result.candidates.find((c) => runGate({ text: c.text, sources: [], peers: [] }).ok) ?? res.result.candidates[0];

  const budget = Math.min(MEDIA_BUDGET_MS, ROUTE_BUDGET_MS - (Date.now() - started));
  const media = await autoMedia(ctx, idea, best.text, budget, opts.signal);

  const preview: IdeaPreview = {
    text: best.text,
    topicTag: best.topicTag ?? null,
    model: res.result.model,
    at: now.toISOString(),
    media,
  };
  // Ide yang berubah status selagi ditulis tidak tersimpan; preview tetap dikembalikan apa adanya.
  await saveIdeaPreview(id, preview, now);
  return { ok: true, preview };
}

export type IdeaMediaAction = "ganti" | "hapus";

/**
 * Ganti gambar preview ide (cari gambar lain, atau tambah bila belum ada) atau hapus gambarnya.
 * Hanya untuk ide BARU yang sudah punya preview. Gambar lama tetap dipakai bila pengganti tidak ditemukan.
 */
export async function ideaMedia(
  ctx: RequestCtx,
  id: string,
  action: IdeaMediaAction,
  opts: { signal?: AbortSignal } = {},
  now = new Date()
): Promise<{ ok: true; media: PostMedia | null } | Failure> {
  const idea = await ideaPreviewSource(id, ctx.workspaceId, ctx.accountIds);
  if (!idea) return failure(404, "Ide tidak ditemukan.");
  if (idea.status !== "BARU") return failure(409, "Ide ini sudah tidak siap dipakai, jadi gambarnya tidak bisa diubah.");
  if (!idea.preview?.text) return failure(409, "Preview ide ini belum ditulis. Tunggu preview-nya muncul dulu.");
  const current = parsePostMedia(idea.preview.media);

  if (action === "hapus") {
    const res = await setIdeaMedia(id, null, now);
    if (!res.ok) return failure(409, "Ide ini sudah tidak siap dipakai, jadi gambarnya tidak bisa diubah.");
    return { ok: true, media: null };
  }

  let found: PostMedia | null;
  try {
    found = parsePostMedia(
      await withTimeout(MEDIA_ACTION_MS, opts.signal, (s) =>
        pickIdeaMedia({
          workspaceId: idea.workspaceId ?? ctx.workspaceId ?? "",
          accountId: idea.accountId,
          ideaId: idea.id,
          topik: idea.topik,
          sudut: idea.sudut,
          text: idea.preview!.text,
          exclude: current?.items.map((i) => i.imageKey) ?? [],
          force: true,
          signal: s,
        })
      )
    );
  } catch (err) {
    console.warn(`[idea-media] ide ${id}: ganti gambar gagal:`, err instanceof Error ? err.message : err);
    return failure(502, current ? "Gambar lain belum bisa dicari. Gambar lama tetap dipakai." : "Gambar belum bisa dicari. Coba lagi.");
  }
  if (!found) {
    return failure(
      422,
      current
        ? "Belum ada gambar lain yang cocok untuk ide ini. Gambar lama tetap dipakai."
        : "Belum ada gambar yang cocok untuk ide ini."
    );
  }
  if (!fitsWithCredit(idea.preview.text, found)) {
    return failure(422, "Teks preview terlalu panjang untuk ditambah keterangan sumber gambar. Tulis ulang preview-nya dulu.");
  }
  const res = await setIdeaMedia(id, found, now);
  if (!res.ok) return failure(409, "Ide ini sudah tidak siap dipakai, jadi gambarnya tidak bisa diubah.");
  return { ok: true, media: found };
}
