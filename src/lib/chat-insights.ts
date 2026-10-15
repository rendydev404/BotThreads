import {
  agg,
  db,
  excludedIdList,
  onlyVisible,
  must,
  rpc,
  scopedIds,
  sqlTs,
  type DailyByAccount,
  type PostsByAccount,
  type PostsByMedia,
} from "@/lib/supabase";
import { scopeKey } from "@/lib/tenant-scope";
import { networkBestHours } from "@/lib/best-hours";
import { hourMultiplier, type BestHour } from "@/lib/scheduling";

/**
 * Insight jaringan yang DIHITUNG SERVER dari data real, disajikan ke AI sebagai fakta jadi.
 * Tujuannya dua: (1) AI tidak perlu menghitung sendiri (sumber salah hitung dan karangan),
 * (2) AI melihat pola yang tidak tampak dari total: perubahan minggu ke minggu, median per akun,
 * konsentrasi views, outlier views per follower, format dan jam yang dinormalisasi.
 * Semua agregasi dikerjakan di database; hasil di-cache 5 menit.
 */

const DAY = 86_400_000;
const WIB_MS = 7 * 3_600_000;
const TTL_MS = 5 * 60_000;
const STATS_DAYS = 30;
/** Akun dengan post kurang dari ini tidak diperingkat menurut median (sampel terlalu kecil). */
const MIN_POSTS_FOR_RANK = 5;
/** Views periode sebelumnya minimal ini supaya persentase perubahan layak disebut. */
const MIN_PREV_VIEWS = 100;
/** Jam dengan post kurang dari ini tidak disebut jam terbaik (sampel terlalu kecil). */
const MIN_HOUR_POSTS = 10;

const fmt = (n: number) => Math.round(n).toLocaleString("id-ID");
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

export interface AccountPostStat {
  aid: string;
  n: number;
  views: number;
  avg: number;
  median: number;
  max: number;
  /** Jumlah post dengan views <= 1. */
  low: number;
}

/** Hitung statistik per akun dari baris mentah (dipakai saat RPC belum dipasang). */
export function aggregatePostStats(rows: Array<{ threadsAccountId: string; views: number }>): AccountPostStat[] {
  const by = new Map<string, number[]>();
  for (const r of rows) {
    const list = by.get(r.threadsAccountId);
    if (list) list.push(r.views ?? 0);
    else by.set(r.threadsAccountId, [r.views ?? 0]);
  }
  return [...by].map(([aid, vals]) => {
    vals.sort((a, b) => a - b);
    const n = vals.length;
    const sum = vals.reduce((s, v) => s + v, 0);
    const mid = n % 2 ? vals[(n - 1) / 2] : (vals[n / 2 - 1] + vals[n / 2]) / 2;
    return {
      aid,
      n,
      views: sum,
      avg: Math.round(sum / n),
      median: Math.round(mid),
      max: vals[n - 1],
      low: vals.filter((v) => v <= 1).length,
    };
  });
}

/** Statistik post per akun sejak `from`; `only` membatasi ke akun tertentu (default semua akun tampil). */
export async function loadPostStats(from: Date, only?: string[]): Promise<AccountPostStat[]> {
  const ids = only ?? (await scopedIds());
  try {
    return await rpc<AccountPostStat[]>("dash_account_post_stats", {
      p_ids: ids ?? null,
      p_from: sqlTs(from),
    });
  } catch {
    // RPC belum dipasang (sql/004): hitung di server dari baris ringkas, dipaginasi per 1.000 baris.
    const hidden = await excludedIdList();
    const rows: Array<{ threadsAccountId: string; views: number }> = [];
    for (let page = 0; page < 10; page++) {
      let q = db()
        .from("ThreadsPostStat")
        .select("threadsAccountId, views")
        .gte("postedAt", sqlTs(from))
        .order("id", { ascending: true })
        .range(page * 1000, page * 1000 + 999);
      if (only) q = q.in("threadsAccountId", only);
      else if (hidden) q = q.not("threadsAccountId", "in", hidden);
      const chunk = await must<Array<{ threadsAccountId: string; views: number }>>(q);
      rows.push(...chunk);
      if (chunk.length < 1000) break;
    }
    return aggregatePostStats(rows);
  }
}

export interface InsightInput {
  names: Map<string, string>;
  from: string;
  to: string;
  hasPrev: boolean;
  cur: DailyByAccount[];
  prev: DailyByAccount[];
  curPosts: PostsByAccount[];
  lifetime: DailyByAccount[];
  followers: Map<string, number>;
  stats: AccountPostStat[];
  media: PostsByMedia[];
  hours: { best: BestHour[]; overall: number };
}

const MEDIA_LABEL: Record<string, string> = {
  TEXT_POST: "Teks",
  TEXT: "Teks",
  IMAGE: "Foto",
  VIDEO: "Video",
  CAROUSEL_ALBUM: "Carousel",
  REPOST_FACADE: "Repost",
};

/** Susun teks insight dari data mentah. Murni, jadi bisa diuji tanpa database. */
export function buildInsightsText(i: InsightInput): string {
  const name = (id: string) => `@${i.names.get(id) ?? "unknown"}`;
  const out: string[] = [];

  const prevViews = new Map(i.prev.map((r) => [r.threadsAccountId, r.views]));
  const curPosts = new Map(i.curPosts.map((r) => [r.threadsAccountId, r.posts]));
  const totalCur = i.cur.reduce((s, r) => s + r.views, 0);

  // 1. Perubahan minggu ke minggu
  if (i.hasPrev) {
    const rows = i.cur
      .map((r) => {
        const p = prevViews.get(r.threadsAccountId) ?? 0;
        return { id: r.threadsAccountId, cur: r.views, prev: p, delta: pct(r.views - p, p), posts: curPosts.get(r.threadsAccountId) ?? 0 };
      })
      .filter((r) => r.prev >= MIN_PREV_VIEWS);
    const up = [...rows].sort((a, b) => b.delta - a.delta).filter((r) => r.delta > 0).slice(0, 5);
    const down = [...rows].sort((a, b) => a.delta - b.delta).filter((r) => r.delta < 0).slice(0, 5);
    const line = (r: (typeof rows)[number]) =>
      `${name(r.id)}: ${fmt(r.cur)} views vs ${fmt(r.prev)} periode sebelumnya (${r.delta >= 0 ? "naik" : "turun"} ${Math.abs(r.delta)}%), ${r.posts} post baru`;
    out.push(
      `PERUBAHAN VIEWS AKUN ${i.from} s/d ${i.to} DIBANDING 7 HARI SEBELUMNYA (hanya akun dengan views sebelumnya >= ${MIN_PREV_VIEWS}):`,
      `Naik terbesar:\n${up.map(line).join("\n") || "- tidak ada"}`,
      `Turun terbesar:\n${down.map(line).join("\n") || "- tidak ada"}`
    );
  }

  // 2. Konsentrasi views
  const sortedCur = [...i.cur].sort((a, b) => b.views - a.views);
  if (totalCur > 0 && sortedCur.length >= 3) {
    const top3 = sortedCur.slice(0, 3);
    const top3Sum = top3.reduce((s, r) => s + r.views, 0);
    const half = sortedCur.slice(Math.ceil(sortedCur.length / 2));
    const halfSum = half.reduce((s, r) => s + r.views, 0);
    out.push(
      `KONSENTRASI VIEWS 7 HARI: 3 akun teratas (${top3.map((r) => name(r.threadsAccountId)).join(", ")}) menyumbang ${pct(top3Sum, totalCur)}% dari ${fmt(totalCur)} views jaringan; ${half.length} akun terbawah hanya ${pct(halfSum, totalCur)}%.`
    );
  }

  // 3. Akun tanpa posting baru
  const silent = i.cur.filter((r) => (curPosts.get(r.threadsAccountId) ?? 0) === 0).map((r) => name(r.threadsAccountId));
  if (silent.length) {
    out.push(`AKUN TANPA POSTINGAN BARU 7 HARI (${silent.length}): ${silent.slice(0, 12).join(", ")}${silent.length > 12 ? ", dst." : ""}`);
  }

  // 4. Views per follower (outlier viral dan akun yang tidak menjangkau)
  const perFollower = i.lifetime
    .map((r) => ({ id: r.threadsAccountId, views: r.views, fol: i.followers.get(r.threadsAccountId) ?? 0 }))
    .filter((r) => r.fol > 0 && r.views > 0)
    .map((r) => ({ ...r, ratio: r.views / r.fol }))
    .sort((a, b) => b.ratio - a.ratio);
  if (perFollower.length >= 4) {
    const top = perFollower.slice(0, 3);
    const bottom = perFollower.slice(-3).reverse();
    const l = (r: (typeof perFollower)[number]) => `${name(r.id)}: ${fmt(r.views)} views / ${fmt(r.fol)} followers = ${fmt(r.ratio)} views per follower`;
    out.push(
      `VIEWS PER FOLLOWER (total sepanjang data; rasio tinggi = jangkauan jauh melampaui basis follower):`,
      `Tertinggi:\n${top.map(l).join("\n")}`,
      `Terendah:\n${bottom.map(l).join("\n")}`
    );
  }

  // 5. Kualitas post per akun (median menahan pengaruh satu post viral)
  const ranked = i.stats.filter((s) => s.n >= MIN_POSTS_FOR_RANK);
  if (ranked.length) {
    const byMedian = [...ranked].sort((a, b) => b.median - a.median);
    const l = (s: AccountPostStat) =>
      `${name(s.aid)}: ${s.n} post, median ${fmt(s.median)} views/post, rata-rata ${fmt(s.avg)}, tertinggi ${fmt(s.max)}, ${s.low} post <=1 view`;
    out.push(
      `KUALITAS POSTINGAN ${STATS_DAYS} HARI TERAKHIR PER AKUN (median = views tipikal satu post; hanya akun dengan >= ${MIN_POSTS_FOR_RANK} post):`,
      `Median tertinggi:\n${byMedian.slice(0, 6).map(l).join("\n")}`,
      `Median terendah:\n${byMedian.slice(-6).reverse().map(l).join("\n")}`
    );
    const skewed = ranked.filter((s) => s.avg > 0 && s.max > 0 && s.avg >= s.median * 3 && s.n >= 10).slice(0, 4);
    if (skewed.length) {
      out.push(
        `AKUN DENGAN HASIL TIMPANG (rata-rata >= 3x median: segelintir post viral menopang angka): ${skewed.map((s) => `${name(s.aid)} (rata-rata ${fmt(s.avg)} vs median ${fmt(s.median)})`).join("; ")}`
      );
    }
  }

  // 6. Format konten
  if (i.media.length) {
    const rows = [...i.media]
      .sort((a, b) => b.avg_views - a.avg_views)
      .map((m) => {
        const inter = m.likes + m.replies;
        const note = m.posts < 30 ? " (SAMPEL KECIL, jangan disimpulkan tegas)" : "";
        return `- ${MEDIA_LABEL[m.mediaType] ?? m.mediaType}: ${fmt(m.posts)} post, rata-rata ${fmt(m.avg_views)} views/post, ER ${m.views ? ((inter / m.views) * 100).toFixed(2) : "0"}%${note}`;
      });
    out.push(`PERFORMA FORMAT ${STATS_DAYS} HARI TERAKHIR (jumlah post tiap format berbeda jauh; format langka bisa unggul karena dipakai akun besar):`, rows.join("\n"));
  }

  // 7. Jam terbaik
  const hours = i.hours.best.filter((b) => b.posts >= MIN_HOUR_POSTS).slice(0, 5);
  if (hours.length) {
    out.push(
      `JAM TERBAIK JARINGAN (WIB; rata-rata views per post pada jam itu, bobot 60 hari, hanya jam dengan >= ${MIN_HOUR_POSTS} post, dibanding rata-rata ${fmt(i.hours.overall)} views):`,
      hours
        .map((b) => {
          const mult = hourMultiplier(b.avgViews, i.hours.overall);
          return `- ${String(b.h).padStart(2, "0")}:00 WIB: rata-rata ${fmt(b.avgViews)} views dari ${b.posts} post${mult ? `, ${mult}x rata-rata` : ""}`;
        })
        .join("\n")
    );
  }

  return out.join("\n\n");
}

// Per lingkup tenant (lihat tenant-scope.ts).
const cache = new Map<string, { at: number; text: string }>();
const pending = new Map<string, Promise<string>>();

async function loadInsights(): Promise<string> {
  const to = await agg.dailyMaxDate();
  if (!to) return "";
  const from = new Date(to.getTime() - 6 * DAY);
  const prevTo = new Date(from.getTime() - DAY);
  const prevFrom = new Date(prevTo.getTime() - 6 * DAY);
  const postFrom = new Date(from.getTime() - WIB_MS);
  const postTo = new Date(to.getTime() + DAY - WIB_MS);
  const statsFrom = new Date(Date.now() - STATS_DAYS * DAY);

  const [accounts, cur, prev, prevDates, curPosts, lifetime, followerRows, media, hours, stats] =
    await Promise.all([
      must<{ id: string; username: string | null; displayName: string }[]>(
        db().from("ThreadsAccount").select("id, username, displayName")
      ).then(onlyVisible),
      agg.dailyByAccount({ from, to }),
      agg.dailyByAccount({ from: prevFrom, to: prevTo }),
      agg.dailyByDate({ from: prevFrom, to: prevTo }),
      agg.postsByAccount({ from: postFrom, to: postTo }),
      agg.dailyByAccount(),
      agg.latestFollowers(),
      agg.postsByMedia({ from: statsFrom }),
      networkBestHours(new Date(), 10).catch(() => ({ best: [] as BestHour[], overall: 0 })),
      loadPostStats(statsFrom),
    ]);

  const names = new Map(accounts.map((a) => [a.id, a.username || a.displayName]));
  const followers = new Map<string, number>();
  for (const r of followerRows) {
    if (r.followers !== null && !followers.has(r.threadsAccountId)) followers.set(r.threadsAccountId, r.followers);
  }

  return buildInsightsText({
    names,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    hasPrev: prevDates.length >= 5,
    cur,
    prev,
    curPosts,
    lifetime,
    followers,
    stats,
    media,
    hours,
  });
}

/** Teks insight jaringan; cache 5 menit dan permintaan serentak digabung. */
export async function getNetworkInsights(): Promise<string> {
  const key = scopeKey();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.text;
  let job = pending.get(key);
  if (!job) {
    job = loadInsights()
      .then((text) => {
        cache.set(key, { at: Date.now(), text });
        return text;
      })
      .finally(() => {
        pending.delete(key);
      });
    pending.set(key, job);
  }
  return job;
}
