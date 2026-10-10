/**
 * Filter periode dasbor: Kemarin, 7/14/30 hari, dan rentang kustom.
 * Semua periode berakhir "kemarin" (WIB), sama seperti laporan bot Telegram,
 * karena data hari ini belum lengkap.
 */

export type PeriodKey = "yesterday" | "7d" | "14d" | "30d" | "custom";

export const PERIOD_OPTIONS: Array<{ key: Exclude<PeriodKey, "custom">; label: string; days: number }> = [
  { key: "yesterday", label: "Kemarin", days: 1 },
  { key: "7d", label: "7 hari", days: 7 },
  { key: "14d", label: "14 hari", days: 14 },
  { key: "30d", label: "30 hari", days: 30 },
];

export const DEFAULT_PERIOD: PeriodKey = "7d";
export const MAX_CUSTOM_DAYS = 366;

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export interface ResolvedPeriod {
  key: PeriodKey;
  label: string;
  /** Tanggal (UTC 00:00) awal & akhir periode, inklusif */
  from: Date;
  to: Date;
  days: number;
  prevFrom: Date;
  prevTo: Date;
}

/** Tanggal hari ini di WIB sebagai Date UTC 00:00. */
export function todayWIB(now = Date.now()): Date {
  const w = new Date(now + 7 * 3_600_000);
  return new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()));
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function shortDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function parseIso(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || isoDate(d) !== s ? null : d;
}

export function resolvePeriod(
  key: string | null | undefined,
  fromStr?: string | null,
  toStr?: string | null
): ResolvedPeriod {
  const today = todayWIB();
  const yesterday = new Date(today.getTime() - DAY);

  let from: Date;
  let to: Date;
  let k: PeriodKey;
  let label: string;

  const preset = PERIOD_OPTIONS.find((p) => p.key === key);
  if (key === "custom") {
    const f = parseIso(fromStr);
    const t = parseIso(toStr);
    if (f && t) {
      to = t > today ? today : t;
      from = f > to ? to : f;
      if ((to.getTime() - from.getTime()) / DAY + 1 > MAX_CUSTOM_DAYS) {
        from = new Date(to.getTime() - (MAX_CUSTOM_DAYS - 1) * DAY);
      }
      k = "custom";
      label = from.getTime() === to.getTime() ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`;
    } else {
      return resolvePeriod(DEFAULT_PERIOD);
    }
  } else {
    const p = preset ?? PERIOD_OPTIONS.find((x) => x.key === DEFAULT_PERIOD)!;
    k = p.key;
    to = yesterday;
    from = new Date(to.getTime() - (p.days - 1) * DAY);
    label = p.key === "yesterday" ? "Kemarin" : `${p.days} hari terakhir`;
  }

  const days = Math.round((to.getTime() - from.getTime()) / DAY) + 1;
  const prevTo = new Date(from.getTime() - DAY);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * DAY);

  return { key: k, label, from, to, days, prevFrom, prevTo };
}
