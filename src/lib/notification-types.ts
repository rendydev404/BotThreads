/**
 * Tipe bersama server dan klien untuk notifikasi dashboard dan ringkasan performa autopilot.
 */

export type NotificationKind = "VIRAL" | "AKUN_DIJEDA" | "MODE_DITURUNKAN" | "PENERBIT_TELAT" | "PENJADWAL";

export interface NotificationDTO {
  id: string;
  jenis: NotificationKind;
  judul: string;
  isi: string | null;
  /** Tautan dalam aplikasi ("/autopilot") atau postingan Threads (https). */
  tautan: string | null;
  accountId: string | null;
  /** ISO UTC */
  createdAt: string;
  dibaca: boolean;
}

export interface NotificationListResponse {
  success: true;
  /** Tabel notifikasi sudah dibuat (sql/007_autopilot_learning.sql). */
  installed: boolean;
  items: NotificationDTO[];
  nextCursor: string | null;
  /** Belum dibaca dalam 30 hari terakhir. */
  unread: number;
}

export type PerformanceDimKey = "formulaHook" | "pilar" | "jam" | "jenisSlot";

export const PERFORMANCE_DIM_LABEL: Record<PerformanceDimKey, string> = {
  formulaHook: "Formula pembuka",
  pilar: "Pilar konten",
  jam: "Jam tayang",
  jenisSlot: "Jenis slot",
};

export interface PerformanceResponse {
  success: true;
  installed: boolean;
  /** Per kategori: jumlah posting, kelipatan views terhadap kebiasaan akun (1 = seperti biasanya), rata-rata views. */
  dims: { dim: PerformanceDimKey; val: string; label: string; n: number; multiplier: number; avgViews: number }[];
  /** Posting autopilot dibanding posting lain pada akun yang sama, 30 hari terakhir. */
  autopilot: { n: number; avgViews: number; medianViews: number };
  lainnya: { n: number; avgViews: number; medianViews: number };
  viral: {
    postId: string;
    accountId: string;
    username: string | null;
    views: number;
    baseline: number;
    postedAt: string;
  }[];
}

export interface HealthRunDTO {
  id: string;
  startedAt: string;
  durasiMs: number;
  hitung: Record<string, number>;
  error: string | null;
}

export interface HealthResponse {
  success: true;
  installed: boolean;
  runs: HealthRunDTO[];
  /** Jam server saat balasan dibuat (ISO): umur tick dihitung dari sini, bukan dari jam perangkat. */
  serverNow: string;
  /** Tick lebih tua dari ini berarti penjadwal kemungkinan mati. */
  staleAfterMs: number;
  /** Saklar posting dashboard (CONTENT_PUBLISH_ENABLED) saat ini. */
  publishEnabled: boolean;
  /** Ringkasan 24 jam terakhir dari riwayat tick. */
  last24h: { ticks: number; errors: number; putaranAi: number; diantre: number; dilewati: number; avgMs: number };
}
