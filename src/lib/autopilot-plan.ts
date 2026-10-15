/**
 * Perencana slot autopilot (murni, tanpa I/O): memilih minimal 3 jam tayang per hari per akun dari
 * data jam ramai akun itu sendiri. Deterministik untuk (akun, hari) yang sama, jadi perencanaan aman
 * diulang kapan pun dan mudah diuji.
 *
 * Urutan kandidat: jam terbaik akun -> jam terbaik jaringan -> jam bawaan. Pemilihan serakah dari
 * skor tertinggi dengan syarat jarak minimal antar posting, mencakup lebih dari satu bagian hari,
 * tidak bentrok dengan antrean yang sudah ada, dan (sesekali) satu slot eksplorasi di jam yang
 * jarang dicoba supaya data jam terus bertambah.
 */
import {
  ACTIVE_FIRST_HOUR,
  ACTIVE_LAST_HOUR,
  type AutopilotSettings,
  type SlotKind,
} from "./autopilot-types";
import {
  DEFAULT_SLOT_HOURS,
  dayOffsetFromKey,
  hourMultiplier,
  overallAverage,
  rankBestHours,
  wibAt,
  wibParts,
  type BestHour,
  type HourRow,
} from "./scheduling";

const MINUTE_MS = 60_000;
/** Slot hari ini harus minimal sekian menit ke depan supaya masih sempat ditulis dan diperiksa. */
export const PLAN_MIN_LEAD_MS = 20 * MINUTE_MS;
/** Geser menit maksimal per akun per hari, supaya puluhan akun tidak terbit di menit yang sama. */
export const JITTER_MAX_MINUTES = 17;
/** Akun dianggap punya pola jam sendiri bila minimal sekian jam berdata cukup. */
const MIN_OWN_HOURS = 2;
/** Jam dengan postingan kurang dari ini (60 hari) masih layak dieksplorasi. */
const EXPLORE_MAX_TRIES = 3;
/** Cadangan saat data jam belum cukup: jam ramai umum audiens Indonesia, urut prioritas. */
const FALLBACK_HOURS = [19, 12, 7, 21, 15, 9, 17, 11, 20, 14, 8, 18, 10, 13, 16, 22, 6];

const pad2 = (n: number): string => String(n).padStart(2, "0");
const fmtMult = (x: number): string => `${x.toFixed(1).replace(".", ",")}x`;
const inWindow = (h: number): boolean => Number.isInteger(h) && h >= ACTIVE_FIRST_HOUR && h <= ACTIVE_LAST_HOUR;

/** Hash FNV-1a 32-bit: benih deterministik untuk geser menit dan undian eksplorasi. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Bagian hari untuk memastikan slot tidak menumpuk di satu rentang waktu. */
export function dayPart(hour: number): "pagi" | "siang" | "sore" | "malam" {
  if (hour <= 10) return "pagi";
  if (hour <= 14) return "siang";
  if (hour <= 17) return "sore";
  return "malam";
}

/** Menit tayang akun pada hari itu (sama untuk semua slot hari itu, jadi jarak antar slot utuh). */
export const jitterMinute = (accountId: string, dayKey: string): number =>
  hash32(`${accountId}|${dayKey}`) % (JITTER_MAX_MINUTES + 1);

export interface PlanInput {
  accountId: string;
  /** Hari yang direncanakan, "YYYY-MM-DD" (WIB). */
  dayKey: string;
  now: Date;
  settings: Pick<
    AutopilotSettings,
    "postsPerDay" | "slotStrategy" | "fixedHours" | "minGapMinutes" | "activeDays" | "exploreRate"
  >;
  /** Ringkasan views per jam akun ini dan seluruh jaringan (dash_hour_rows). */
  ownRows: HourRow[];
  networkRows: HourRow[];
  /** Waktu (epoch ms) yang sudah terisi: antrean semua sumber dan slot autopilot yang sudah ada. */
  takenMs: number[];
  /** slotIndex yang sudah dipakai pada hari itu (slot lama tidak direncanakan ulang). */
  usedIndexes: number[];
}

export interface PlannedSlot {
  slotIndex: number;
  slotAt: Date;
  hour: number;
  minute: number;
  kind: SlotKind;
  reason: string;
}

export interface DayPlan {
  slots: PlannedSlot[];
  /** Asal data jam: akun sendiri, jaringan, atau belum ada data sama sekali. */
  source: "account" | "network" | "none";
}

interface Candidate {
  hour: number;
  kind: SlotKind;
  reason: string;
  /** Urutan prioritas (0 = terbaik). */
  rank: number;
}

function hourReason(b: BestHour, overall: number, owner: "account" | "network"): string {
  const mult = hourMultiplier(b.avgViews, overall);
  const jam = `Jam ${pad2(b.h)}`;
  if (owner === "account") {
    return mult !== null && mult >= 1
      ? `${jam} rata-rata ${fmtMult(mult)} views akun ini (${b.posts} posting).`
      : `${jam} termasuk jam teratas akun ini (${b.posts} posting).`;
  }
  return mult !== null && mult >= 1
    ? `${jam} ramai di jaringan (${fmtMult(mult)} rata-rata jaringan).`
    : `${jam} termasuk jam teratas jaringan.`;
}

function rankedCandidates(input: PlanInput): { list: Candidate[]; source: DayPlan["source"] } {
  const own = rankBestHours(input.ownRows, 24).filter((b) => inWindow(b.h));
  const net = rankBestHours(input.networkRows, 24).filter((b) => inWindow(b.h));
  const list: Candidate[] = [];
  const seen = new Set<number>();
  const push = (hour: number, kind: SlotKind, reason: string) => {
    if (seen.has(hour) || !inWindow(hour)) return;
    seen.add(hour);
    list.push({ hour, kind, reason, rank: list.length });
  };

  const useOwn = own.length >= MIN_OWN_HOURS;
  if (useOwn) {
    const overall = overallAverage(input.ownRows);
    for (const b of own) push(b.h, "RAMAI", hourReason(b, overall, "account"));
  }
  const netOverall = overallAverage(input.networkRows);
  for (const b of net) push(b.h, "RAMAI", hourReason(b, netOverall, "network"));
  for (const h of [...DEFAULT_SLOT_HOURS, ...FALLBACK_HOURS]) {
    push(h, "CADANGAN", `Jam ${pad2(h)} adalah jam bawaan: data jam akun belum cukup.`);
  }
  return { list, source: useOwn ? "account" : net.length ? "network" : "none" };
}

function fixedCandidates(hours: number[]): Candidate[] {
  return [...new Set(hours)]
    .filter(inWindow)
    .sort((a, b) => a - b)
    .map((hour, rank) => ({ hour, kind: "TETAP" as const, reason: `Jam ${pad2(hour)} adalah jam tetap pilihan pengguna.`, rank }));
}

/**
 * Rencana slot satu akun untuk satu hari. Mengembalikan hanya slot BARU yang perlu ditambahkan
 * (jumlah target dikurangi slot yang sudah ada); kosong bila hari itu tidak aktif atau sudah penuh.
 */
export function planDay(input: PlanInput): DayPlan {
  const { settings, now, accountId, dayKey } = input;
  const off = dayOffsetFromKey(now, dayKey);
  if (off === null || off < 0) return { slots: [], source: "none" };
  if (!settings.activeDays.includes(wibParts(wibAt(now, off, 12)).dow)) return { slots: [], source: "none" };

  const fixed = settings.slotStrategy === "JAM_TETAP" ? fixedCandidates(settings.fixedHours) : [];
  const ranked = fixed.length ? { list: fixed, source: "account" as const } : rankedCandidates(input);
  const target = fixed.length ? Math.min(settings.postsPerDay, fixed.length) : settings.postsPerDay;
  const need = target - input.usedIndexes.length;
  if (need <= 0) return { slots: [], source: ranked.source };

  const minute = jitterMinute(accountId, dayKey);
  const gapMs = settings.minGapMinutes * MINUTE_MS;
  const earliest = now.getTime() + PLAN_MIN_LEAD_MS;
  const timeOf = (hour: number): number => wibAt(now, off, hour, minute).getTime();
  const fits = (hour: number, others: Candidate[]): boolean => {
    const t = timeOf(hour);
    if (t < earliest) return false;
    if (input.takenMs.some((x) => Math.abs(x - t) < gapMs)) return false;
    return others.every((o) => Math.abs(timeOf(o.hour) - t) >= gapMs);
  };

  const pool = [...ranked.list];
  const chosen: Candidate[] = [];
  while (chosen.length < need && pool.length) {
    let idx = -1;
    // Slot terakhir: bila semua pilihan menumpuk di satu bagian hari, utamakan bagian hari lain.
    const parts = new Set(chosen.map((c) => dayPart(c.hour)));
    if (!fixed.length && chosen.length >= 1 && chosen.length === need - 1 && parts.size === 1) {
      idx = pool.findIndex((c) => !parts.has(dayPart(c.hour)) && fits(c.hour, chosen));
    }
    if (idx < 0) idx = pool.findIndex((c) => fits(c.hour, chosen));
    if (idx < 0) break;
    chosen.push(pool.splice(idx, 1)[0]);
  }

  // Eksplorasi: sesekali ganti pilihan berperingkat terendah dengan jam yang jarang dicoba.
  const roll = hash32(`${accountId}|${dayKey}|eksplorasi`) / 0x1_0000_0000;
  if (!fixed.length && chosen.length >= 2 && roll < settings.exploreRate) {
    const tried = new Map(input.ownRows.map((r) => [r.hour, r.n]));
    const victim = chosen.reduce((a, b) => (b.rank > a.rank ? b : a));
    const others = chosen.filter((c) => c !== victim);
    const taken = new Set(chosen.map((c) => c.hour));
    const explore = Array.from({ length: ACTIVE_LAST_HOUR - ACTIVE_FIRST_HOUR + 1 }, (_, i) => ACTIVE_FIRST_HOUR + i)
      .filter((h) => !taken.has(h) && (tried.get(h) ?? 0) < EXPLORE_MAX_TRIES)
      .sort(
        (a, b) =>
          (tried.get(a) ?? 0) - (tried.get(b) ?? 0) ||
          hash32(`${accountId}|${dayKey}|${a}`) - hash32(`${accountId}|${dayKey}|${b}`)
      )
      .find((h) => fits(h, others));
    if (explore !== undefined) {
      const n = tried.get(explore) ?? 0;
      chosen[chosen.indexOf(victim)] = {
        hour: explore,
        kind: "EKSPLORASI",
        rank: victim.rank,
        reason: `Eksplorasi: jam ${pad2(explore)} baru ${n} kali dicoba dalam 60 hari terakhir.`,
      };
    }
  }

  const used = new Set(input.usedIndexes);
  let nextIndex = 0;
  const slots = chosen
    .sort((a, b) => a.hour - b.hour)
    .map((c): PlannedSlot => {
      while (used.has(nextIndex)) nextIndex++;
      used.add(nextIndex);
      return {
        slotIndex: nextIndex,
        slotAt: new Date(timeOf(c.hour)),
        hour: c.hour,
        minute,
        kind: c.kind,
        reason: c.reason,
      };
    });
  return { slots, source: ranked.source };
}

/** Jam tetap yang sah: 3-6 jam berbeda dalam jendela tayang dengan jarak antar jam memenuhi `minGapMinutes`. */
export function fixedHoursError(hours: number[], minGapMinutes: number): string | null {
  const list = [...new Set(hours)].sort((a, b) => a - b);
  if (list.length !== hours.length) return "Jam tetap tidak boleh berulang.";
  if (list.some((h) => !inWindow(h))) {
    return `Jam tetap harus di antara ${pad2(ACTIVE_FIRST_HOUR)}.00 dan ${pad2(ACTIVE_LAST_HOUR)}.00.`;
  }
  if (list.length < 3 || list.length > 6) return "Pilih 3 sampai 6 jam tetap.";
  for (let i = 1; i < list.length; i++) {
    if ((list[i] - list[i - 1]) * 60 < minGapMinutes) {
      return `Jarak antar jam tetap minimal ${minGapMinutes} menit.`;
    }
  }
  return null;
}
