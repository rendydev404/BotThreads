/**
 * Jam terbaik per akun (FR-2 butir 2): port SQL `bestHours` dari bot Telegram auto-suka, tetapi
 * difilter langsung per `threadsAccountId` dan untuk banyak akun sekaligus dengan satu GROUP BY
 * (`= ANY($ids)`), bukan satu query per akun. Bobot paruh waktu 14 hari, 60 hari terakhir.
 * Cache 10 menit per akun.
 */
import { rpc, scopedIds } from "@/lib/supabase";
import {
  hourMultiplier,
  overallAverage,
  rankBestHours,
  type BestHour,
  type HourRow,
} from "./scheduling";
import type { BestHourDTO } from "./content-types";

const TTL_MS = 10 * 60 * 1000;
/** Paruh waktu bobot: postingan 14 hari lalu berbobot 1/2, 28 hari 1/4. */
const HALF_LIFE_DAYS = 14;
const NETWORK_KEY = "__network__";
/** Akun dianggap punya pola jam sendiri bila minimal sekian jam terbaik terdeteksi. */
const MIN_OWN_HOURS = 2;

export interface AccountHours {
  best: BestHour[];
  /** Rata-rata views keseluruhan akun (pembanding kelipatan). */
  overall: number;
  /** Asal jam terbaik: data akun sendiri atau jaringan (fallback). */
  source: "account" | "network" | "none";
}

const cache = new Map<string, { at: number; rows: HourRow[] }>();

interface HourSqlRow extends HourRow {
  aid: string | null;
}

async function fetchRows(ids: string[] | null, now: Date): Promise<HourSqlRow[]> {
  // Agregasi di database (dash_hour_rows): satu GROUP BY untuk banyak akun; ids=null = seluruh jaringan.
  return rpc<HourSqlRow[]>("dash_hour_rows", { p_ids: ids, p_now: now, p_half_life: HALF_LIFE_DAYS });
}

/** Pola jam seluruh jaringan tanpa akun yang dikecualikan (baris per akun digabung per jam). */
async function fetchNetworkRows(now: Date): Promise<HourSqlRow[]> {
  const visible = await scopedIds();
  if (!visible) return fetchRows(null, now);
  const byHour = new Map<number, { n: number; vw: number; w: number }>();
  for (const r of await fetchRows(visible, now)) {
    const h = byHour.get(r.hour) ?? { n: 0, vw: 0, w: 0 };
    h.n += r.n;
    const w = r.w ?? 0;
    h.vw += r.avg * w;
    h.w += w;
    byHour.set(r.hour, h);
  }
  return [...byHour].map(([hour, h]) => ({ aid: null, hour, n: h.n, avg: h.w ? Math.round(h.vw / h.w) : 0, w: h.w }));
}

function summarize(rows: HourRow[]): { best: BestHour[]; overall: number } {
  return { best: rankBestHours(rows), overall: overallAverage(rows) };
}

/**
 * Jam terbaik untuk banyak akun. Akun dengan data jam kurang dari 2 memakai jam terbaik
 * seluruh jaringan (`source: "network"`); bila jaringan pun kosong, `source: "none"`.
 */
export async function bestHoursForAccounts(
  ids: string[],
  now = new Date()
): Promise<Map<string, AccountHours>> {
  const fresh = (k: string) => {
    const hit = cache.get(k);
    return hit && now.getTime() - hit.at < TTL_MS ? hit.rows : null;
  };

  const missing = ids.filter((id) => !fresh(id));
  const needNetwork = !fresh(NETWORK_KEY);
  const [accountRows, networkRows] = await Promise.all([
    missing.length ? fetchRows(missing, now) : Promise.resolve([] as HourSqlRow[]),
    needNetwork ? fetchNetworkRows(now) : Promise.resolve(null),
  ]);

  if (missing.length) {
    const grouped = new Map<string, HourRow[]>(missing.map((id) => [id, []]));
    for (const r of accountRows) grouped.get(r.aid ?? "")?.push({ hour: r.hour, n: r.n, avg: r.avg, w: r.w });
    for (const [id, rows] of grouped) cache.set(id, { at: now.getTime(), rows });
  }
  if (networkRows) {
    cache.set(NETWORK_KEY, {
      at: now.getTime(),
      rows: networkRows.map((r) => ({ hour: r.hour, n: r.n, avg: r.avg, w: r.w })),
    });
  }

  const network = summarize(cache.get(NETWORK_KEY)?.rows ?? []);
  const out = new Map<string, AccountHours>();
  for (const id of ids) {
    const own = summarize(cache.get(id)?.rows ?? []);
    if (own.best.length >= MIN_OWN_HOURS) {
      out.set(id, { ...own, source: "account" });
    } else if (network.best.length) {
      // Pembanding kelipatan tetap rata-rata akun bila ada, selain itu rata-rata jaringan.
      out.set(id, { best: network.best, overall: own.overall || network.overall, source: "network" });
    } else {
      out.set(id, { best: [], overall: own.overall, source: "none" });
    }
  }
  return out;
}

/** Jam terbaik seluruh jaringan (rata-rata views berbobot waktu per jam WIB), cache 10 menit. */
export async function networkBestHours(
  now = new Date(),
  limit = 5
): Promise<{ best: BestHour[]; overall: number }> {
  const hit = cache.get(NETWORK_KEY);
  let rows: HourRow[];
  if (hit && now.getTime() - hit.at < TTL_MS) {
    rows = hit.rows;
  } else {
    rows = (await fetchNetworkRows(now)).map((r) => ({ hour: r.hour, n: r.n, avg: r.avg, w: r.w }));
    cache.set(NETWORK_KEY, { at: now.getTime(), rows });
  }
  return { best: rankBestHours(rows, limit), overall: overallAverage(rows) };
}

/** Bentuk ringkas untuk chip jam terbaik di UI. */
export function toBestHourDTO(hours: AccountHours): BestHourDTO[] {
  return hours.best.slice(0, 3).map((b) => ({
    hour: b.h,
    multiplier: hourMultiplier(b.avgViews, hours.overall),
    posts: b.posts,
  }));
}
