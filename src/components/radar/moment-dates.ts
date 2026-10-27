/**
 * Hitungan tanggal murni untuk tab Momen: selisih hari, fase momen terhadap hari ini, dan momen bawaan.
 * "Hari ini" selalu diberikan pemanggil (kunci "YYYY-MM-DD" WIB), jadi aman dipanggil saat render.
 */
import { BUILTIN_MOMENT_RULES, momentRuleRange } from "@/lib/moment-rules";
import { parseDayKey } from "@/components/settings/format";
import { tr } from "@/lib/i18n/core";

const DAY_MS = 24 * 60 * 60 * 1000;

const toUtc = (key: string): number | null => {
  const p = parseDayKey(key);
  return p ? Date.UTC(p.y, p.m - 1, p.d) : null;
};

/** Selisih hari dari `from` ke `to`; null bila salah satu kunci tidak valid. */
export function dayDiff(from: string, to: string): number | null {
  const a = toUtc(from);
  const b = toUtc(to);
  return a === null || b === null ? null : Math.round((b - a) / DAY_MS);
}

/** Nama hari dari kunci "YYYY-MM-DD" ("Rabu"); kosong bila kuncinya tidak valid. */
export function weekdayName(key: string): string {
  const at = toUtc(key);
  return at === null ? "" : ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"][new Date(at).getUTCDay()];
}

export type MomentPhase = "berjalan" | "mendatang" | "lewat";

/** Posisi rentang momen terhadap hari ini, dengan label siap tampil. */
export function momentPhase(today: string, mulai: string, selesai: string): { phase: MomentPhase; label: string } {
  if (selesai < today) return { phase: "lewat", label: tr("Sudah lewat") };
  if (mulai <= today) return { phase: "berjalan", label: tr("Sedang berlangsung") };
  const days = dayDiff(today, mulai);
  return {
    phase: "mendatang",
    label: days === null ? tr("Akan datang") : days === 1 ? tr("Mulai besok") : tr("Mulai {n} hari lagi", { n: days }),
  };
}

export interface BuiltinMoment {
  key: string;
  nama: string;
  /** Kapan momen ini berulang. */
  aturan: string;
  catatan: string;
  /** Rentang yang sedang berjalan, atau yang berikutnya bila hari ini di luar rentang. */
  mulai: string;
  selesai: string;
}

/**
 * Momen kalender bawaan beserta rentang terdekatnya. Aturannya satu sumber dengan server
 * (src/lib/moment-rules.ts), jadi yang tampil di sini sama dengan yang dijadikan sinyal radar.
 */
export function builtinMoments(today: string): BuiltinMoment[] {
  const list: BuiltinMoment[] = [];
  for (const rule of BUILTIN_MOMENT_RULES) {
    const range = momentRuleRange(rule, today);
    if (range) list.push({ key: rule.key, nama: rule.title, aturan: rule.rule, catatan: rule.summary, ...range });
  }
  return list.sort((a, b) => a.mulai.localeCompare(b.mulai));
}
