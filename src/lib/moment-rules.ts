/**
 * Momen kalender bawaan (gajian, tanggal tua, akhir pekan, awal pekan). Satu definisi dipakai server
 * (sinyal radar harian) dan klien (tab Momen), supaya aturan dan tampilannya tidak pernah berbeda.
 * Murni, tanpa impor server: aman dipakai di komponen "use client".
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MomentRule {
  key: string;
  title: string;
  /** Konteks untuk AI dan keterangan di UI. */
  summary: string;
  /** Kapan momen ini berulang, untuk ditampilkan. */
  rule: string;
  score: number;
  /**
   * Rentang yang berulang: tanggal dalam bulan (1-31) atau hari dalam pekan (0 = Minggu).
   * `from` boleh lebih besar dari `to` bila rentangnya melewati batas (25 -> 2, Jumat -> Minggu).
   */
  span: { unit: "bulan" | "pekan"; from: number; to: number };
}

export const BUILTIN_MOMENT_RULES: readonly MomentRule[] = [
  {
    key: "gajian",
    title: "Tanggal gajian",
    summary: "Akhir dan awal bulan: orang baru gajian, lebih longgar untuk jajan dan traktiran.",
    rule: "Setiap tanggal 25 sampai tanggal 2",
    score: 0.65,
    span: { unit: "bulan", from: 25, to: 2 },
  },
  {
    key: "tanggal-tua",
    title: "Tanggal tua",
    summary: "Menjelang gajian: dompet menipis, konten hemat dan relate soal bertahan sampai gajian.",
    rule: "Setiap tanggal 19 sampai 24",
    score: 0.55,
    span: { unit: "bulan", from: 19, to: 24 },
  },
  {
    key: "akhir-pekan",
    title: "Akhir pekan",
    summary: "Jumat sampai Minggu: rencana nongkrong, kumpul keluarga, dan makan di luar.",
    rule: "Setiap Jumat sampai Minggu",
    score: 0.55,
    span: { unit: "pekan", from: 5, to: 0 },
  },
  {
    key: "awal-pekan",
    title: "Awal pekan",
    summary: "Senin: kembali kerja atau sekolah, butuh semangat dan hiburan ringan.",
    rule: "Setiap Senin",
    score: 0.45,
    span: { unit: "pekan", from: 1, to: 1 },
  },
];

const inSpan = (v: number, from: number, to: number): boolean => (from <= to ? v >= from && v <= to : v >= from || v <= to);

/** Berlaku pada tanggal `d` (1-31) dan hari `dow` (0 = Minggu)? */
export const momentRuleActive = (rule: MomentRule, d: number, dow: number): boolean =>
  inSpan(rule.span.unit === "bulan" ? d : dow, rule.span.from, rule.span.to);

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const keyOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * Rentang yang sedang berjalan pada `today` ("YYYY-MM-DD"), atau rentang berikutnya bila hari ini di
 * luar rentang. Null bila kunci hari tidak valid.
 */
export function momentRuleRange(rule: MomentRule, today: string): { mulai: string; selesai: string } | null {
  const hit = DAY_KEY.exec(today);
  if (!hit) return null;
  const y = Number(hit[1]);
  const m = Number(hit[2]) - 1;
  const d = Number(hit[3]);
  const at = Date.UTC(y, m, d);
  if (Number.isNaN(at)) return null;
  const { unit, from, to } = rule.span;

  if (unit === "pekan") {
    const dow = new Date(at).getUTCDay();
    // Sedang berjalan: mundur ke hari mulainya; di luar rentang: maju ke hari mulai berikutnya.
    const start = inSpan(dow, from, to) ? at - ((dow - from + 7) % 7) * DAY_MS : at + ((from - dow + 7) % 7) * DAY_MS;
    return { mulai: keyOf(start), selesai: keyOf(start + ((to - from + 7) % 7) * DAY_MS) };
  }

  // Date.UTC merapikan sendiri bulan di luar 0-11 (-1 = Desember tahun lalu, 12 = Januari tahun depan).
  const day = (month: number, date: number): string => keyOf(Date.UTC(y, month, date));
  if (from <= to) {
    const month = d > to ? m + 1 : m;
    return { mulai: day(month, from), selesai: day(month, to) };
  }
  // Melewati akhir bulan: sampai tanggal `to`, rentangnya dimulai bulan lalu.
  const month = d <= to ? m - 1 : m;
  return { mulai: day(month, from), selesai: day(month + 1, to) };
}
