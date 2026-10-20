/**
 * Konstanta mesin autopilot dan validasi pengaturan dari pengguna (murni, tanpa I/O).
 * Nilai env dibaca saat dipanggil supaya perubahan di Coolify berlaku tanpa deploy ulang kode.
 *
 * Env:
 * - AUTOPILOT_CRON_SECRET    rahasia pemanggil tick (>= 32 karakter); tanpa ini tick menjawab 503
 * - AUTOPILOT_MAX_PER_TICK   slot yang ditulis per tick (default 12)
 * - AUTOPILOT_CONCURRENCY    penulisan serentak antar akun (default 6)
 * - AUTOPILOT_BANNED_TERMS   kata/frasa terlarang tambahan, dipisah koma
 */
import { fixedHoursError } from "./autopilot-plan";
import {
  ACTIVE_FIRST_HOUR,
  ACTIVE_LAST_HOUR,
  BRIEF_MAX_CHARS,
  EXPLORE_RATE_MAX,
  MIN_GAP_MAX,
  MIN_GAP_MIN,
  POSTS_PER_DAY_MAX,
  POSTS_PER_DAY_MIN,
  PROMO_RATIO_MAX,
  VOICE_STYLES,
  type AutopilotMode,
  type AutopilotPillar,
  type AutopilotSettings,
  type SlotStrategy,
  type VoiceStyle,
} from "./autopilot-types";
import type { Parsed } from "./content-validation";

const MINUTE_MS = 60_000;

/** Mode otomatis: draf ditulis mulai sekian menit sebelum tayang supaya konteksnya masih segar. */
export const WRITE_LEAD_AUTO_MS = 90 * MINUTE_MS;
/** Mode tinjau: draf ditulis lebih awal supaya manusia sempat membaca. */
export const WRITE_LEAD_REVIEW_MS = 6 * 60 * MINUTE_MS;
/** Slot yang tayang kurang dari ini tidak lagi ditulis (tidak sempat diperiksa dan diantre). */
export const QUEUE_MIN_LEAD_MS = 6 * MINUTE_MS;
/** Draf mode tinjau yang belum disetujui sampai sekian menit sebelum tayang dilewati. */
export const REVIEW_CUTOFF_MS = 15 * MINUTE_MS;
/** Kunci satu slot selama ditulis; lewat dari ini slot boleh diambil tick lain. */
export const SLOT_LEASE_MS = 10 * MINUTE_MS;
/** Kunci tick tunggal (sedikit di bawah jeda penjadwal 5 menit). */
export const TICK_LEASE_MS = 4.5 * MINUTE_MS;
/** Anggaran kerja satu tick. */
export const TICK_BUDGET_MS = 200_000;
/** Batas waktu menulis satu slot (tulis + periksa + tulis ulang). */
export const SLOT_WRITE_TIMEOUT_MS = 110_000;
/** Percobaan tulis per slot (lintas tick) sebelum slot dilewati. */
export const MAX_WRITE_ATTEMPTS = 3;
/** Tick terakhir lebih lama dari ini: penjadwal dianggap mati. */
export const TICK_STALE_MS = 15 * MINUTE_MS;

const intEnv = (name: string, fallback: number, min: number, max: number): number => {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export const maxSlotsPerTick = (): number => intEnv("AUTOPILOT_MAX_PER_TICK", 12, 1, 60);
export const writeConcurrency = (): number => intEnv("AUTOPILOT_CONCURRENCY", 6, 1, 12);

export const extraBannedTerms = (): string[] =>
  (process.env.AUTOPILOT_BANNED_TERMS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 3)
    .slice(0, 200);

/* ------------------------------------------------------------------ validasi pengaturan */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const MODES: AutopilotMode[] = ["MATI", "TINJAU", "OTOMATIS"];
const STRATEGIES: SlotStrategy[] = ["JAM_RAMAI", "JAM_TETAP"];
const MAX_PILLARS = 8;

const intIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

const numIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/** Posting per hari paling banyak yang muat di jendela tayang dengan jeda tertentu. */
export const maxPostsForGap = (minGapMinutes: number): number =>
  Math.floor(((ACTIVE_LAST_HOUR - ACTIVE_FIRST_HOUR) * 60) / minGapMinutes) + 1;

function parsePillars(v: unknown): Parsed<AutopilotPillar[]> {
  if (!Array.isArray(v) || v.length > MAX_PILLARS) return fail(`Kategori topik maksimal ${MAX_PILLARS}.`);
  const out: AutopilotPillar[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (!isRecord(item) || typeof item.key !== "string") return fail("Kategori topik tidak valid.");
    const key = item.key.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
    if (key.length < 2 || key.length > 40) return fail("Nama kategori harus 2-40 karakter.");
    if (seen.has(key.toLowerCase())) return fail("Nama kategori tidak boleh berulang.");
    if (!intIn(item.bobot, 1, 100)) return fail("Porsi kategori harus bilangan 1-100.");
    seen.add(key.toLowerCase());
    out.push({ key, bobot: item.bobot });
  }
  return { ok: true, value: out };
}

/**
 * Gabungkan perubahan dari body ke pengaturan sekarang lalu validasi hasil akhirnya.
 * Field yang tidak dikirim tidak berubah.
 */
export function parseSettingsPatch(body: unknown, base: AutopilotSettings): Parsed<AutopilotSettings> {
  if (!isRecord(body)) return fail("Body permintaan tidak valid.");
  const next: AutopilotSettings = { ...base };

  if (body.mode !== undefined) {
    if (!MODES.includes(body.mode as AutopilotMode)) return fail("Mode autopilot tidak valid.");
    next.mode = body.mode as AutopilotMode;
  }
  if (body.slotStrategy !== undefined) {
    if (!STRATEGIES.includes(body.slotStrategy as SlotStrategy)) return fail("Strategi jam tidak valid.");
    next.slotStrategy = body.slotStrategy as SlotStrategy;
  }
  if (body.minGapMinutes !== undefined) {
    if (!intIn(body.minGapMinutes, MIN_GAP_MIN, MIN_GAP_MAX)) {
      return fail(`Jeda antar posting harus ${MIN_GAP_MIN}-${MIN_GAP_MAX} menit.`);
    }
    next.minGapMinutes = body.minGapMinutes;
  }
  if (body.postsPerDay !== undefined) {
    if (!intIn(body.postsPerDay, POSTS_PER_DAY_MIN, POSTS_PER_DAY_MAX)) {
      return fail(`Posting per hari harus ${POSTS_PER_DAY_MIN}-${POSTS_PER_DAY_MAX}.`);
    }
    next.postsPerDay = body.postsPerDay;
  }
  if (body.fixedHours !== undefined) {
    if (!Array.isArray(body.fixedHours) || !body.fixedHours.every((h) => intIn(h, 0, 23))) {
      return fail("Jam tetap tidak valid.");
    }
    next.fixedHours = [...(body.fixedHours as number[])].sort((a, b) => a - b);
  }
  if (body.activeDays !== undefined) {
    if (!Array.isArray(body.activeDays) || !body.activeDays.every((d) => intIn(d, 0, 6))) {
      return fail("Hari aktif tidak valid.");
    }
    next.activeDays = [...new Set(body.activeDays as number[])].sort((a, b) => a - b);
  }
  if (body.exploreRate !== undefined) {
    if (!numIn(body.exploreRate, 0, EXPLORE_RATE_MAX)) return fail("Porsi eksplorasi harus 0-30%.");
    next.exploreRate = Math.round(body.exploreRate * 100) / 100;
  }
  if (body.promoRatio !== undefined) {
    if (!numIn(body.promoRatio, 0, PROMO_RATIO_MAX)) return fail("Porsi promo harus 0-30%.");
    next.promoRatio = Math.round(body.promoRatio * 100) / 100;
  }
  if (body.pillars !== undefined) {
    const pillars = parsePillars(body.pillars);
    if (!pillars.ok) return pillars;
    next.pillars = pillars.value;
  }
  if (body.voiceStyle !== undefined) {
    if (body.voiceStyle !== null && !(typeof body.voiceStyle === "string" && body.voiceStyle in VOICE_STYLES)) {
      return fail("Gaya sapaan tidak valid.");
    }
    next.voiceStyle = body.voiceStyle as VoiceStyle | null;
  }
  if (body.brief !== undefined) {
    if (body.brief !== null && typeof body.brief !== "string") return fail("Tema akun tidak valid.");
    const brief = typeof body.brief === "string" ? body.brief.replace(/\s+/g, " ").trim() : "";
    if (brief.length > BRIEF_MAX_CHARS) return fail(`Tema akun maksimal ${BRIEF_MAX_CHARS} karakter.`);
    next.brief = brief || null;
  }

  if (next.activeDays.length === 0) return fail("Pilih minimal satu hari aktif.");
  if (next.slotStrategy === "JAM_TETAP") {
    const error = fixedHoursError(next.fixedHours, next.minGapMinutes);
    if (error) return fail(error);
    next.postsPerDay = next.fixedHours.length;
  } else {
    const max = maxPostsForGap(next.minGapMinutes);
    if (next.postsPerDay > max) {
      return fail(`Dengan jeda ${next.minGapMinutes} menit, paling banyak ${max} posting per hari.`);
    }
  }
  return { ok: true, value: next };
}
