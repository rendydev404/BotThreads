/**
 * Logika jadwal murni (tanpa I/O): zona waktu WIB, jam terbaik, slot kosong, dan aturan
 * anti-spam. Semua fungsi menerima `now` sebagai argumen supaya deterministik dan mudah diuji.
 * Waktu disimpan UTC; tampilan & input memakai WIB (Asia/Jakarta, UTC+7 tanpa DST).
 */
import {
  SCHEDULE_MAX_LEAD_MS,
  SCHEDULE_MIN_LEAD_MS,
  SLOT_MIN_LEAD_MS,
} from "./content-config";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const WIB_OFFSET_MS = 7 * HOUR_MS;

/** Slot bawaan (jam WIB) bila akun belum punya data jam terbaik. */
export const DEFAULT_SLOT_HOURS = [11, 15, 19];

const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const pad2 = (n: number) => String(n).padStart(2, "0");

export interface WibParts {
  y: number;
  m: number; // 0-11
  d: number;
  h: number;
  min: number;
  dow: number; // 0 = Minggu
}

export function wibParts(date: Date): WibParts {
  const w = new Date(date.getTime() + WIB_OFFSET_MS);
  return {
    y: w.getUTCFullYear(),
    m: w.getUTCMonth(),
    d: w.getUTCDate(),
    h: w.getUTCHours(),
    min: w.getUTCMinutes(),
    dow: w.getUTCDay(),
  };
}

/** Tanggal WIB (hari ke-`dayOffset` dari `now`) pukul `hour`:`minute`, dalam UTC. */
export function wibAt(now: Date, dayOffset: number, hour: number, minute = 0): Date {
  const p = wibParts(now);
  return new Date(Date.UTC(p.y, p.m, p.d + dayOffset, hour, minute) - WIB_OFFSET_MS);
}

/** Awal hari WIB (00:00) yang memuat `date`, dalam UTC. */
export const startOfWibDay = (date: Date): Date => wibAt(date, 0, 0, 0);

/** Kunci hari WIB "YYYY-MM-DD". */
export function wibDayKey(date: Date): string {
  const p = wibParts(date);
  return `${p.y}-${pad2(p.m + 1)}-${pad2(p.d)}`;
}

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Selisih hari (WIB) dari hari `now` ke kunci "YYYY-MM-DD"; null bila format salah. */
export function dayOffsetFromKey(now: Date, key: string): number | null {
  const m = DAY_KEY.exec(key);
  if (!m) return null;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - WIB_OFFSET_MS;
  return Math.round((target - startOfWibDay(now).getTime()) / DAY_MS);
}

/** "Senin 12.00 WIB" */
export function formatWibLabel(date: Date): string {
  const p = wibParts(date);
  return `${DAY_NAMES[p.dow]} ${pad2(p.h)}.${pad2(p.min)} WIB`;
}

/** "13 Okt 2026, 12.00 WIB" */
export function formatWibFull(date: Date): string {
  const p = wibParts(date);
  return `${p.d} ${MONTH_SHORT[p.m]} ${p.y}, ${pad2(p.h)}.${pad2(p.min)} WIB`;
}

/* ------------------------------------------------------------------ jam terbaik */

export interface BestHour {
  h: number;
  /** Rata-rata views (berbobot waktu) postingan pada jam ini (WIB). */
  avgViews: number;
  posts: number;
}

export interface HourRow {
  hour: number;
  n: number;
  avg: number;
  w?: number;
}

/** Minimal postingan per jam supaya jam itu dipertimbangkan. */
const BEST_MIN_POSTS = 2;
/** Bobot penyusutan ke rata-rata akun: jam dengan sedikit postingan tidak langsung menang. */
const BEST_PRIOR = 3;

/**
 * Pilih jam terbaik dari ringkasan per jam: rata-rata berbobot (Bayesian) ke rata-rata akun, jadi
 * satu postingan viral tidak membuat jamnya otomatis terpilih. Port dari rankBestHours auto-suka.
 */
export function rankBestHours(rows: HourRow[], limit = 3): BestHour[] {
  const eligible = rows.filter((r) => r.n >= BEST_MIN_POSTS).map((r) => ({ ...r, w: r.w ?? r.n }));
  const total = eligible.reduce((s, r) => s + r.w, 0);
  if (!total) return [];
  const mean = eligible.reduce((s, r) => s + r.avg * r.w, 0) / total;
  return eligible
    .map((r) => ({
      h: r.hour,
      avgViews: r.avg,
      posts: r.n,
      score: (r.avg * r.w + mean * BEST_PRIOR) / (r.w + BEST_PRIOR),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ h, avgViews, posts }) => ({ h, avgViews, posts }));
}

/** Rata-rata views keseluruhan (berbobot) dari semua jam, untuk pembanding "Nx views akun". */
export function overallAverage(rows: HourRow[]): number {
  const total = rows.reduce((s, r) => s + (r.w ?? r.n), 0);
  if (!total) return 0;
  return rows.reduce((s, r) => s + r.avg * (r.w ?? r.n), 0) / total;
}

/** Kelipatan jam terhadap rata-rata akun (1 desimal); null bila tidak ada pembanding. */
export function hourMultiplier(avgViews: number, overall: number): number | null {
  if (!overall || overall <= 0) return null;
  return Math.round((avgViews / overall) * 10) / 10;
}

/* ------------------------------------------------------------------ slot & aturan */

export interface SlotLimits {
  minGapMs: number;
  maxPerDay: number;
}

/** Ada waktu terisi yang lebih dekat dari `minGapMs` ke `t`? */
export function hasGapConflict(t: number, takenMs: number[], minGapMs: number): boolean {
  if (minGapMs <= 0) return takenMs.includes(t);
  return takenMs.some((x) => Math.abs(x - t) < minGapMs);
}

export interface SlotQuery {
  now: Date;
  /** Jam WIB yang dipertimbangkan, urut prioritas. */
  hours: number[];
  takenMs: number[];
  minGapMs: number;
  /** Mulai mencari dari hari ke-N (WIB) dari hari ini. */
  startDay?: number;
  horizonDays?: number;
  /** Menit pada jam yang dicari (default 0 = jam bulat). */
  minute?: number;
  /** Kunci hari WIB ("YYYY-MM-DD") yang kuota hariannya sudah penuh; dilewati. */
  fullDays?: ReadonlySet<string>;
}

/** Slot pertama (jam WIB, default jam bulat) ≥ now + 10 menit yang tidak bentrok; null bila tidak ketemu. */
export function findSlot(q: SlotQuery): Date | null {
  const min = q.now.getTime() + SLOT_MIN_LEAD_MS;
  const horizon = q.horizonDays ?? 7;
  const start = Math.max(0, q.startDay ?? 0);
  // Per hari urut jam naik supaya hasil selalu slot terdekat; prioritas antar-hari tetap kronologis.
  const hours = [...new Set(q.hours)].sort((a, b) => a - b);
  for (let day = start; day < start + horizon; day++) {
    for (const h of hours) {
      const t = wibAt(q.now, day, h, q.minute ?? 0);
      if (t.getTime() < min || q.fullDays?.has(wibDayKey(t))) continue;
      if (!hasGapConflict(t.getTime(), q.takenMs, q.minGapMs)) return t;
    }
  }
  return null;
}

/** Hari WIB yang sudah memuat `maxPerDay` posting dashboard (kuota harian habis). */
export function fullDayKeys(dashboardTimesMs: number[], maxPerDay: number): Set<string> {
  const count = new Map<string, number>();
  for (const ms of dashboardTimesMs) {
    const key = wibDayKey(new Date(ms));
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  return new Set([...count].filter(([, n]) => n >= maxPerDay).map(([key]) => key));
}

/**
 * Slot kosong berikutnya untuk satu akun: jam terbaiknya dulu, lalu slot bawaan 11/15/19 WIB.
 * Selalu mengembalikan waktu di masa depan (fallback terakhir: now + 10 menit di jam bulat berikutnya).
 */
export function nextFreeSlot(q: Omit<SlotQuery, "hours"> & { hours?: number[] }): Date {
  const best = q.hours?.length ? findSlot({ ...q, hours: q.hours }) : null;
  if (best) return best;
  const fallback = findSlot({ ...q, hours: DEFAULT_SLOT_HOURS });
  if (fallback) return fallback;
  const t = new Date(q.now.getTime() + SLOT_MIN_LEAD_MS);
  t.setUTCMinutes(0, 0, 0);
  return new Date(t.getTime() + HOUR_MS);
}

/** Slot di jam tertentu (WIB) pada/setelah `startDay`; null bila tidak ada dalam jangkauan. */
export function slotForHour(q: Omit<SlotQuery, "hours"> & { hour: number }): Date | null {
  return findSlot({ ...q, hours: [q.hour], horizonDays: q.horizonDays ?? 14 });
}

export type ScheduleResult =
  | { ok: true; at: Date; immediate: boolean }
  | { ok: false; error: string };

/** Validasi `publishAt`: "now" atau ISO 8601, minimal 2 menit dan maksimal 60 hari ke depan. */
export function parsePublishAt(publishAt: unknown, now: Date): ScheduleResult {
  if (publishAt === "now") return { ok: true, at: new Date(now.getTime()), immediate: true };
  if (typeof publishAt !== "string" || publishAt.length > 40) {
    return { ok: false, error: "Waktu posting tidak valid." };
  }
  const ms = Date.parse(publishAt);
  if (!Number.isFinite(ms)) return { ok: false, error: "Format waktu posting tidak valid." };
  const lead = ms - now.getTime();
  if (lead < SCHEDULE_MIN_LEAD_MS) {
    return { ok: false, error: "Jadwal harus minimal 2 menit dari sekarang." };
  }
  if (lead > SCHEDULE_MAX_LEAD_MS) {
    return { ok: false, error: "Jadwal paling jauh 60 hari ke depan." };
  }
  return { ok: true, at: new Date(ms), immediate: false };
}

export interface ExistingSlot {
  /** epoch ms tayang */
  at: number;
  /** true bila ScheduledPost ini dibuat dari dashboard (menghitung kuota harian) */
  dashboard: boolean;
}

/**
 * Cek aturan anti-spam satu waktu terhadap jadwal akun yang sudah ada.
 * - Kuota harian: maksimal `maxPerDay` posting dashboard per akun per hari WIB.
 * - Jarak minimal `minGapMs` dengan posting lain (semua sumber) yang Terjadwal/Terbit.
 * Mengembalikan pesan Indonesia, atau null bila lolos.
 */
export function findScheduleViolation(
  at: Date,
  existing: ExistingSlot[],
  limits: SlotLimits
): string | null {
  const key = wibDayKey(at);
  const sameDay = existing.filter((e) => e.dashboard && wibDayKey(new Date(e.at)) === key).length;
  if (sameDay >= limits.maxPerDay) {
    return `Batas ${limits.maxPerDay} postingan dashboard per akun per hari sudah tercapai untuk tanggal tersebut.`;
  }
  const clash = existing.find(
    (e) => limits.minGapMs > 0 && Math.abs(e.at - at.getTime()) < limits.minGapMs
  );
  if (clash) {
    const minutes = Math.round(limits.minGapMs / 60000);
    return `Jarak dengan postingan lain di akun ini kurang dari ${minutes} menit (sudah ada yang tayang ${formatWibLabel(new Date(clash.at))}).`;
  }
  return null;
}

/** Jendela jam posting wajar (WIB) saat sistem menggeser jadwal sendiri. */
const RESOLVE_FIRST_HOUR = 7;
const RESOLVE_LAST_HOUR = 22;
const RESOLVE_STEP_MS = 15 * 60 * 1000;
const RESOLVE_HORIZON_MS = 14 * DAY_MS;

/**
 * Waktu terdekat pada/setelah `at` yang lolos aturan kuota harian dan jarak minimal, dalam jendela
 * 07.00-22.59 WIB, maksimal 14 hari ke depan. Dipakai saat AI/sistem mengatur jadwal sendiri: bentrok
 * diselesaikan dengan menggeser, bukan menggagalkan. Null bila tidak ada slot dalam jangkauan.
 */
export function resolveSlot(at: Date, existing: ExistingSlot[], limits: SlotLimits, now: Date): Date | null {
  const earliest = now.getTime() + SCHEDULE_MIN_LEAD_MS;
  // Mulai dari kelipatan 15 menit supaya hasilnya jam yang rapi (17.00 -> 18.00, bukan 18.07).
  let t = Math.ceil(Math.max(at.getTime(), earliest) / RESOLVE_STEP_MS) * RESOLVE_STEP_MS;
  const end = at.getTime() + RESOLVE_HORIZON_MS;
  for (; t <= end; t += RESOLVE_STEP_MS) {
    const d = new Date(t);
    const h = wibParts(d).h;
    if (h < RESOLVE_FIRST_HOUR || h > RESOLVE_LAST_HOUR) continue;
    if (!findScheduleViolation(d, existing, limits)) return d;
  }
  return null;
}
