/**
 * Eksekusi otomatis dari prompt: draf AI langsung dimasukkan ke antrean posting (sekarang atau
 * terjadwal) tanpa klik per draf. Semua pagar tetap lewat `createPosts` (saklar CONTENT_PUBLISH_ENABLED,
 * kesiapan akun, validasi teks Threads, kuota harian, jarak minimal, teks duplikat, idempotensi).
 * Tiap draf diantrekan terpisah supaya satu draf bermasalah tidak menggagalkan yang lain, dan hasilnya
 * dilaporkan per draf. Pembatalan tetap tersedia lewat DELETE /api/content/posts/:id.
 */
import { SCHEDULE_MIN_LEAD_MS } from "./content-config";
import type { PublishIntent } from "./content-intent";
import type { ContentDraft, QueueResultDTO } from "./content-types";
import { wibAt, wibParts } from "./scheduling";
import { createPosts } from "./threads-publish";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Jeda aman di atas batas minimal agar jadwal tidak ditolak karena jam server bergeser. */
const LEAD_MS = SCHEDULE_MIN_LEAD_MS + 60_000;

export type QueueResult = QueueResultDTO;

/** Nilai `publishAt` untuk satu draf: "now", atau jam saran draf pada hari yang diminta (WIB). */
export function publishAtFor(suggestedAt: string, intent: PublishIntent, now = new Date()): string {
  if (intent.mode === "now") return "now";
  const suggested = new Date(suggestedAt);
  let at = suggested;
  if (intent.dayOffset !== null || intent.hourWib !== null) {
    const p = wibParts(suggested);
    at = wibAt(now, intent.dayOffset ?? 0, intent.hourWib ?? p.h, intent.hourWib !== null ? 0 : p.min);
  }
  let ms = at.getTime();
  while (ms < now.getTime() + LEAD_MS) ms += DAY_MS;
  return new Date(ms).toISOString();
}

/** Masukkan satu draf ke antrean. `key` unik per draf per perintah (aman diulang). */
export async function queueDraft(
  userId: string,
  draft: Pick<ContentDraft, "threadsAccountId" | "text" | "topicTag" | "suggestedAt" | "model">,
  intent: PublishIntent,
  key: string,
  now = new Date()
): Promise<QueueResult> {
  try {
    const res = await createPosts(
      {
        userId,
        idempotencyKey: key,
        partial: true,
        autoReschedule: true,
        items: [
          {
            threadsAccountId: draft.threadsAccountId,
            text: draft.text,
            topicTag: draft.topicTag,
            publishAt: publishAtFor(draft.suggestedAt, intent, now),
            aiModel: draft.model.slice(0, 80),
            aiEdited: false,
          },
        ],
      },
      now
    );
    if (!res.ok) return { ok: false, error: res.error };
    const post = res.posts[0];
    if (!post) return { ok: false, error: res.skipped?.[0]?.error ?? "Tidak masuk antrean." };
    // Bila "sekarang" bentrok lalu digeser, posting itu menjadi terjadwal.
    const mode = post.rescheduledFrom ? "schedule" : intent.mode;
    return { ok: true, postId: post.postId, at: post.tayangPada, mode, ...(post.rescheduledFrom ? { rescheduledFrom: post.rescheduledFrom } : {}) };
  } catch (err) {
    console.error("[auto-publish]", err instanceof Error ? err.message : err);
    return { ok: false, error: "Gagal memasukkan ke antrean. Coba lagi." };
  }
}
