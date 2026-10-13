/**
 * Konfigurasi fitur posting Threads dari dashboard. Dibaca saat dipanggil (bukan saat import)
 * supaya perubahan env di Coolify berlaku tanpa menyentuh kode, dan mudah diuji.
 *
 * Env:
 * - CONTENT_PUBLISH_ENABLED        "true" untuk membuka jalur tulis (default: mati, kill switch FR-11)
 * - CONTENT_PUBLISH_TEST_ACCOUNTS  daftar id/username akun yang diizinkan selama uji (kosong = semua)
 * - CONTENT_MAX_POSTS_PER_DAY      batas posting dashboard per akun per hari WIB (default 6)
 * - CONTENT_MIN_GAP_MINUTES        jarak minimal antar posting per akun (default 0 = tanpa batas)
 */

/** Maksimal item dalam satu permintaan membuat posting. */
export const MAX_BATCH_ITEMS = 10;
/** Maksimal akun per permintaan rekomendasi. */
export const MAX_RECOMMEND_ACCOUNTS = 5;
/** Maksimal draf per akun per permintaan rekomendasi. */
export const MAX_RECOMMEND_COUNT = 5;

/** Jadwal harus minimal sekian menit ke depan (memberi waktu worker). */
export const SCHEDULE_MIN_LEAD_MS = 2 * 60 * 1000;
/** Jadwal paling jauh sekian hari ke depan. */
export const SCHEDULE_MAX_LEAD_MS = 60 * 24 * 60 * 60 * 1000;
/** Slot saran harus minimal sekian menit ke depan. */
export const SLOT_MIN_LEAD_MS = 10 * 60 * 1000;
/** Postingan tidak bisa diedit bila tayang kurang dari ini (worker hampir mengambilnya). */
export const EDIT_LOCK_MS = 60 * 1000;
/** Status "Mengantre" lebih lama dari ini dianggap worker terlambat. */
export const WORKER_LATE_MS = 3 * 60 * 1000;
/** Jendela idempotency key. */
export const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;
/** Jendela deteksi teks duplikat per akun. */
export const DUPLICATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Sumber ScheduledPost untuk posting dari dashboard (tidak memicu alur bot Telegram). */
export const DASHBOARD_SOURCE = "DASHBOARD_AI";

const intEnv = (name: string, fallback: number, min: number, max: number): number => {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Kill switch: jalur tulis hanya terbuka bila env bernilai tepat "true". */
export const isPublishEnabled = (): boolean =>
  process.env.CONTENT_PUBLISH_ENABLED === "true";

/** Daftar akun uji (id atau username, huruf kecil); null = tanpa pembatasan. */
export function publishTestAccounts(): string[] | null {
  const list = (process.env.CONTENT_PUBLISH_TEST_ACCOUNTS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
  return list.length ? list : null;
}

export const maxPostsPerDay = (): number => intEnv("CONTENT_MAX_POSTS_PER_DAY", 6, 1, 50);
export const minGapMinutes = (): number => intEnv("CONTENT_MIN_GAP_MINUTES", 0, 0, 24 * 60);
