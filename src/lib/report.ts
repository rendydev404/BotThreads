import { prisma } from "@/lib/db";

/**
 * Laporan periodik jaringan (mirip laporan bot Telegram):
 * total + perbandingan dengan periode sebelumnya + peringkat akun.
 * Semua agregasi dikerjakan di database; hasil di-cache 60 detik.
 */

const DAY = 86_400_000;
const TTL_MS = 60_000;
const WIB_MS = 7 * 3_600_000;

/** Selisih persen, "new" bila sebelumnya 0 tetapi sekarang ada, null bila tidak bisa dihitung. */
export type Delta = number | "new" | null;

export interface RankRow {
  username: string;
  views: number;
  delta: Delta;
  er: number; // persen
  posts: number;
}

export interface ScopeOption {
  slug: string; // "all" atau slug workspace
  label: string;
  accounts: number;
}

export interface Report {
  days: number;
  scope: ScopeOption;
  scopes: ScopeOption[];
  from: string; // YYYY-MM-DD
  to: string;
  hasPrev: boolean;
  totalAccounts: number;
  totals: {
    views: number;
    viewsDelta: Delta;
    interactions: number;
    er: number;
    posts: number;
    followers: number | null;
    followersDelta: number | null;
  };
  ranking: RankRow[];
}

export function pctDelta(cur: number, prev: number): Delta {
  if (prev > 0) return Math.round(((cur - prev) / prev) * 100);
  return cur > 0 ? "new" : null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const DEFAULT_SCOPE = "suka-shawarma";
const cache = new Map<string, { at: number; value: Report | null }>();

export async function buildReport(
  rawDays: number,
  scopeSlug: string = DEFAULT_SCOPE
): Promise<Report | null> {
  const days = Math.min(60, Math.max(1, Math.round(rawDays) || 7));
  const cacheKey = `${days}:${scopeSlug}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const accounts = await prisma.threadsAccount.findMany({
    select: {
      id: true,
      username: true,
      displayName: true,
      workspace: { select: { slug: true, nama: true } },
    },
  });

  const byWs = new Map<string, ScopeOption>();
  for (const a of accounts) {
    const w = byWs.get(a.workspace.slug) ?? { slug: a.workspace.slug, label: a.workspace.nama, accounts: 0 };
    w.accounts += 1;
    byWs.set(a.workspace.slug, w);
  }
  const scopes: ScopeOption[] = [
    ...[...byWs.values()].sort((a, b) => b.accounts - a.accounts),
    { slug: "all", label: `Semua (${accounts.length} akun)`, accounts: accounts.length },
  ];
  const scope = scopes.find((s) => s.slug === scopeSlug) ?? scopes.find((s) => s.slug === DEFAULT_SCOPE) ?? scopes[scopes.length - 1];
  const scoped = scope.slug === "all" ? accounts : accounts.filter((a) => a.workspace.slug === scope.slug);
  const idFilter = scope.slug === "all" ? {} : { threadsAccountId: { in: scoped.map((a) => a.id) } };

  const max = await prisma.threadsAccountDaily.aggregate({ where: idFilter, _max: { date: true } });
  const to = max._max.date;
  if (!to) return null;

  const from = new Date(to.getTime() - (days - 1) * DAY);
  const prevTo = new Date(from.getTime() - DAY);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * DAY);
  // Batas hari WIB untuk postingan (postedAt tersimpan UTC)
  const postFrom = new Date(from.getTime() - WIB_MS);
  const postTo = new Date(to.getTime() + DAY - WIB_MS);

  const sums = { views: true, likes: true, replies: true, reposts: true, quotes: true } as const;

  const [cur, prev, prevDates, posts, folEnd, folStart] = await Promise.all([
    prisma.threadsAccountDaily.groupBy({
      by: ["threadsAccountId"],
      where: { ...idFilter, date: { gte: from, lte: to } },
      _sum: sums,
    }),
    prisma.threadsAccountDaily.groupBy({
      by: ["threadsAccountId"],
      where: { ...idFilter, date: { gte: prevFrom, lte: prevTo } },
      _sum: { views: true },
    }),
    prisma.threadsAccountDaily.groupBy({
      by: ["date"],
      where: { ...idFilter, date: { gte: prevFrom, lte: prevTo } },
    }),
    prisma.threadsPostStat.groupBy({
      by: ["threadsAccountId"],
      where: { ...idFilter, postedAt: { gte: postFrom, lt: postTo } },
      _count: { _all: true },
    }),
    prisma.threadsAccountDaily.aggregate({
      where: { ...idFilter, date: to, followers: { not: null } },
      _sum: { followers: true },
      _count: { followers: true },
    }),
    prisma.threadsAccountDaily.aggregate({
      where: { ...idFilter, date: prevTo, followers: { not: null } },
      _sum: { followers: true },
      _count: { followers: true },
    }),
  ]);

  const nameOf = new Map(accounts.map((a) => [a.id, a.username || a.displayName]));
  const prevViews = new Map(prev.map((p) => [p.threadsAccountId, p._sum.views ?? 0]));
  const postCount = new Map(posts.map((p) => [p.threadsAccountId, p._count._all]));
  const hasPrev = prevDates.length >= Math.ceil(days * 0.6);

  const inter = (s: (typeof cur)[number]["_sum"]) =>
    (s.likes ?? 0) + (s.replies ?? 0) + (s.reposts ?? 0) + (s.quotes ?? 0);

  const ranking: RankRow[] = cur
    .map((c) => {
      const views = c._sum.views ?? 0;
      return {
        username: nameOf.get(c.threadsAccountId) || "unknown",
        views,
        delta: hasPrev ? pctDelta(views, prevViews.get(c.threadsAccountId) ?? 0) : null,
        er: views > 0 ? Math.round((inter(c._sum) / views) * 1000) / 10 : 0,
        posts: postCount.get(c.threadsAccountId) ?? 0,
      };
    })
    .sort((a, b) => b.views - a.views);

  const views = cur.reduce((s, c) => s + (c._sum.views ?? 0), 0);
  const interactions = cur.reduce((s, c) => s + inter(c._sum), 0);
  const prevTotal = prev.reduce((s, p) => s + (p._sum.views ?? 0), 0);
  const followers = folEnd._count.followers > 0 ? folEnd._sum.followers : null;
  const followersBase = folStart._count.followers > 0 ? folStart._sum.followers : null;

  const value: Report = {
    days,
    scope,
    scopes,
    from: iso(from),
    to: iso(to),
    hasPrev,
    totalAccounts: scoped.length,
    totals: {
      views,
      viewsDelta: hasPrev ? pctDelta(views, prevTotal) : null,
      interactions,
      er: views > 0 ? Math.round((interactions / views) * 1000) / 10 : 0,
      posts: posts.reduce((s, p) => s + p._count._all, 0),
      followers,
      followersDelta:
        followers !== null && followersBase !== null ? followers - followersBase : null,
    },
    ranking,
  };

  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

const fmt = (n: number) => n.toLocaleString("id-ID");
const dtext = (d: Delta) =>
  d === null ? "" : d === "new" ? " (baru)" : ` (${d >= 0 ? "naik" : "turun"} ${Math.abs(d)}%)`;

/** Ringkasan teks laporan untuk konteks AI. */
export function reportToText(r: Report): string {
  return `LAPORAN ${r.days} HARI TERAKHIR, CAKUPAN: ${r.scope.label} (${r.from} s/d ${r.to})${r.hasPrev ? ", dibanding periode sebelumnya" : ", belum ada data pembanding periode sebelumnya"}:
Total: ${fmt(r.totals.views)} views${dtext(r.totals.viewsDelta)}, ${fmt(r.totals.interactions)} interaksi, ER ${r.totals.er}%, ${fmt(r.totals.posts)} postingan baru${r.totals.followers !== null ? `, followers ${fmt(r.totals.followers)}` : ""}
Peringkat akun menurut views periode ini:
${r.ranking
  .slice(0, 15)
  .map((a, i) => `${i + 1}. @${a.username}: ${fmt(a.views)} views${dtext(a.delta)}, ER ${a.er}%, ${a.posts} post`)
  .join("\n")}`;
}
