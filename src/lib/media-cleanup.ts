/**
 * Penyapu berkas gambar sementara yang tertinggal di bucket "threads-media" (sql/040), dipanggil tiap putaran
 * penerbit. Normalnya penerbit menghapus berkas "tmp/<postId>/<n>.jpg" begitu postingan TERBIT/GAGAL; yang
 * tersisa (proses mati di tengah jalan, storage galat saat menghapus, posting dibatalkan) disapu di sini.
 * Database memilih berkas "tmp/..." yang lebih tua dari 2 jam dan tidak dipegang posting yang masih
 * diterbitkan; modul ini hanya menghapusnya. Paling banyak 50 berkas per putaran, berhenti di batas waktu,
 * galat hanya dicatat (tidak pernah dilempar).
 */
import { rpc, sqlTs } from "@/lib/supabase";
import { deleteMediaFiles } from "./media-store";

/** Berkas sementara lebih muda dari ini tidak disentuh (mungkin baru diunggah penerbit yang sedang berjalan). */
export const TMP_MIN_AGE_MS = 2 * 60 * 60 * 1000;
/** Berkas paling banyak per putaran. */
export const CLEANUP_MAX_PATHS = 50;

export async function runMediaCleanup(now: Date, counts: Record<string, number>, deadlineMs: number): Promise<void> {
  if (Date.now() >= deadlineMs) return;
  try {
    const paths = await rpc<string[] | null>("dash_media_tmp_orphans", {
      p_before: sqlTs(new Date(now.getTime() - TMP_MIN_AGE_MS)),
      p_limit: CLEANUP_MAX_PATHS,
    });
    const list = (paths ?? []).slice(0, CLEANUP_MAX_PATHS);
    if (!list.length || Date.now() >= deadlineMs) return;
    await deleteMediaFiles(list);
    counts.mediaDihapus = (counts.mediaDihapus ?? 0) + list.length;
  } catch (err) {
    counts.mediaGalat = (counts.mediaGalat ?? 0) + 1;
    console.error("[media-cleanup]", err instanceof Error ? err.message : err);
  }
}
