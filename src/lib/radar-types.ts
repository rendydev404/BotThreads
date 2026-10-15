/**
 * Tipe bersama server dan klien untuk radar tren, bank ide, dan knowledge base. Tanpa import server.
 */

export type SignalSource = "JARINGAN" | "GTRENDS" | "WEB" | "THREADS_SEARCH" | "MOMEN" | "MANUAL";

export const SIGNAL_SOURCE_LABEL: Record<SignalSource, string> = {
  JARINGAN: "Pemenang jaringan",
  GTRENDS: "Tren pencarian",
  WEB: "Tren web",
  THREADS_SEARCH: "Pencarian Threads",
  MOMEN: "Momen kalender",
  MANUAL: "Inspirasi manual",
};

export interface SignalDTO {
  id: string;
  source: SignalSource;
  title: string;
  summary: string | null;
  url: string | null;
  rank: number | null;
  /** 0..1 */
  score: number;
  accountId: string | null;
  /** ISO UTC */
  capturedAt: string;
  expiresAt: string;
  /** Boleh dihapus pengguna (hanya inspirasi manual milik workspace). */
  removable: boolean;
}

export interface SignalListResponse {
  success: true;
  /** Tabel radar sudah dibuat (sql/006_autopilot_radar.sql). */
  installed: boolean;
  items: SignalDTO[];
  nextCursor: string | null;
  /** ISO UTC pengambilan terakhir per sumber. */
  lastCapture: Partial<Record<SignalSource, string>>;
}

/** Tujuh formula pembuka yang terbukti memancing balasan; dipilih AI per ide. */
export const HOOK_FORMULAS = [
  { key: "pengakuan", label: "Pengakuan jujur", hint: "buka dengan pengakuan yang jujur dan tidak terduga" },
  { key: "pertanyaan", label: "Pertanyaan terbuka", hint: "pertanyaan tanpa jawaban benar yang memancing pendapat" },
  { key: "salah-kaprah", label: "Salah kaprah", hint: "luruskan anggapan umum yang ternyata keliru" },
  { key: "cerita", label: "Cerita dan pelajaran", hint: "cerita singkat yang ditutup satu pelajaran" },
  { key: "daftar", label: "Daftar pendek", hint: "tiga sampai empat hal singkat yang bikin pembaca mengangguk" },
  { key: "opini", label: "Opini berbeda", hint: "pendapat ringan yang berbeda dari kebanyakan orang, tanpa menyerang" },
  { key: "sebelum-sesudah", label: "Sebelum dan sesudah", hint: "bandingkan keadaan dulu dan sekarang" },
] as const;
export type HookFormula = (typeof HOOK_FORMULAS)[number]["key"];

export const hookLabel = (key: string | null | undefined): string | null =>
  HOOK_FORMULAS.find((f) => f.key === key)?.label ?? null;

export type IdeaStatus = "BARU" | "DIPAKAI" | "DITOLAK" | "KEDALUWARSA";

export const IDEA_STATUS_LABEL: Record<IdeaStatus, string> = {
  BARU: "Siap dipakai",
  DIPAKAI: "Sudah dipakai",
  DITOLAK: "Ditolak",
  KEDALUWARSA: "Kedaluwarsa",
};

export interface IdeaScoreDetail {
  /** Kekuatan sinyal rujukan (0..1). */
  sinyal: number;
  /** Kebaruan terhadap postingan dan ide sebelumnya (0..1). */
  kebaruan: number;
  /** Kecocokan dengan akun menurut perencana (0..1). */
  kecocokan: number;
  /** Kinerja historis kombinasi sudut/formula/pilar di akun ini (0..1, 0,5 = belum ada data). */
  kinerja: number;
}

export interface IdeaDTO {
  id: string;
  accountId: string;
  topik: string;
  sudut: string | null;
  formulaHook: string | null;
  pilar: string | null;
  score: number;
  scoreDetail: Partial<IdeaScoreDetail>;
  status: IdeaStatus;
  pinned: boolean;
  usedBySlot: string | null;
  expiresAt: string;
  createdAt: string;
  signals: { id: string; source: SignalSource; title: string }[];
}

export interface IdeaListResponse {
  success: true;
  installed: boolean;
  items: (IdeaDTO & { account: { username: string | null; displayName: string } })[];
  nextCursor: string | null;
}

export type IdeaAction = "pin" | "unpin" | "reject";

export type KnowledgeKind = "FAKTA" | "PRODUK" | "PROMO" | "LARANGAN";

export const KNOWLEDGE_KIND_LABEL: Record<KnowledgeKind, string> = {
  FAKTA: "Fakta brand",
  PRODUK: "Produk dan harga",
  PROMO: "Promo berjalan",
  LARANGAN: "Kata atau topik terlarang",
};

export const KNOWLEDGE_KIND_HINT: Record<KnowledgeKind, string> = {
  FAKTA: "Alamat, jam buka, cerita brand. AI boleh mengutipnya.",
  PRODUK: "Nama menu dan harga. Harga di posting wajib berasal dari sini.",
  PROMO: "Promo yang sedang berjalan beserta tanggal berakhirnya. Promo hanya ditulis bila ada di sini.",
  LARANGAN: "Satu kata atau frasa per baris. Draf yang memuatnya ditolak otomatis.",
};

export const KNOWLEDGE_TITLE_MAX = 80;
export const KNOWLEDGE_BODY_MAX = 600;

export interface KnowledgeDTO {
  id: string;
  /** null = berlaku untuk semua akun. */
  accountId: string | null;
  jenis: KnowledgeKind;
  judul: string;
  isi: string;
  /** "YYYY-MM-DD" atau null (tanpa batas). */
  berlakuSampai: string | null;
  updatedAt: string;
}

export interface KnowledgeListResponse {
  success: true;
  installed: boolean;
  items: KnowledgeDTO[];
}

export interface MomentDTO {
  id: string;
  nama: string;
  /** "YYYY-MM-DD" */
  mulai: string;
  selesai: string;
  catatan: string | null;
}

export interface MomentListResponse {
  success: true;
  installed: boolean;
  items: MomentDTO[];
}

export const MANUAL_SIGNAL_MAX = 600;
export const MOMENT_NAME_MAX = 80;
/** Rentang momen paling lama, dalam selisih hari mulai-selesai. */
export const MOMENT_MAX_SPAN_DAYS = 60;
export const MOMENT_NOTE_MAX = 300;
