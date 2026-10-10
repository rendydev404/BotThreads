import { prisma } from "@/lib/db";

/**
 * Konteks data live untuk asisten AI. Semua agregasi dikerjakan di database;
 * hasilnya di-cache 60 detik supaya chat beruntun tidak membebani DB.
 */

const TTL_MS = 60_000;

const MEDIA_LABEL: Record<string, string> = {
  TEXT_POST: "Teks",
  TEXT: "Teks",
  IMAGE: "Foto",
  VIDEO: "Video",
  CAROUSEL_ALBUM: "Carousel",
  REPOST_FACADE: "Repost",
};

const fmt = (n: number) => n.toLocaleString("id-ID");
const clip = (s: string, n: number) =>
  s.replace(/\s+/g, " ").trim().slice(0, n) + (s.length > n ? "…" : "");

export interface FleetContext {
  text: string;
  totals: {
    accounts: number;
    posts: number;
    views: number;
    interactions: number;
    er: string;
    followers: number;
  };
  byPosts: Array<{ username: string; posts: number; followers: number }>;
  byViews: Array<{ username: string; views: number; likes: number; replies: number; followers: number }>;
  byFollowers: Array<{ username: string; displayName: string; followers: number }>;
  topPosts: Array<{ username: string; text: string; views: number }>;
  usernames: string[];
}

let cache: { at: number; value: FleetContext } | null = null;

async function loadFleet(): Promise<FleetContext> {
  const since = new Date();
  since.setDate(since.getDate() - 6);
  since.setHours(0, 0, 0, 0);

  const [accounts, total, perAccount, topPosts, flopPosts, byMedia, last7, followerRows] =
    await Promise.all([
      prisma.threadsAccount.findMany({
        select: {
          id: true,
          username: true,
          displayName: true,
          _count: { select: { postStats: true } },
        },
      }),
      prisma.threadsAccountDaily.aggregate({
        _sum: { views: true, likes: true, replies: true, reposts: true },
      }),
      prisma.threadsAccountDaily.groupBy({
        by: ["threadsAccountId"],
        _sum: { views: true, likes: true, replies: true },
      }),
      prisma.threadsPostStat.findMany({
        take: 30,
        orderBy: { views: "desc" },
        select: {
          text: true,
          views: true,
          likes: true,
          replies: true,
          mediaType: true,
          postedAt: true,
          threadsAccount: { select: { username: true } },
        },
      }),
      prisma.threadsPostStat.findMany({
        take: 5,
        where: {
          views: { gt: 0 },
          postedAt: { lt: new Date(Date.now() - 3 * 86_400_000) },
        },
        orderBy: { views: "asc" },
        select: {
          text: true,
          views: true,
          likes: true,
          replies: true,
          threadsAccount: { select: { username: true } },
        },
      }),
      prisma.threadsPostStat.groupBy({
        by: ["mediaType"],
        _count: { _all: true },
        _avg: { views: true },
        _sum: { likes: true, replies: true, views: true },
      }),
      prisma.threadsAccountDaily.groupBy({
        by: ["date"],
        where: { date: { gte: since } },
        orderBy: { date: "asc" },
        _sum: { views: true, likes: true, replies: true },
      }),
      prisma.threadsAccountDaily.findMany({
        where: { followers: { not: null } },
        select: { threadsAccountId: true, date: true, followers: true },
        orderBy: { date: "desc" },
      }),
    ]);

  const latestFollowersMap = new Map<string, number>();
  for (const r of followerRows) {
    if (r.followers !== null && !latestFollowersMap.has(r.threadsAccountId)) {
      latestFollowersMap.set(r.threadsAccountId, r.followers);
    }
  }

  let totalFollowers = 0;
  for (const f of latestFollowersMap.values()) {
    totalFollowers += f;
  }

  const nameOf = new Map(accounts.map((a) => [a.id, a.username || a.displayName]));
  const views = total._sum.views ?? 0;
  const interactions =
    (total._sum.likes ?? 0) + (total._sum.replies ?? 0) + (total._sum.reposts ?? 0);
  const er = views > 0 ? ((interactions / views) * 100).toFixed(2) : "0";
  const postsTotal = accounts.reduce((s, a) => s + a._count.postStats, 0);

  const byFollowers = accounts
    .map((a) => ({
      username: a.username || a.displayName,
      displayName: a.displayName,
      followers: latestFollowersMap.get(a.id) ?? 0,
    }))
    .sort((a, b) => b.followers - a.followers);

  const byPosts = accounts
    .map((a) => ({
      username: a.username || a.displayName,
      posts: a._count.postStats,
      followers: latestFollowersMap.get(a.id) ?? 0,
    }))
    .sort((a, b) => b.posts - a.posts);

  const byViews = perAccount
    .map((d) => ({
      username: nameOf.get(d.threadsAccountId) || "unknown",
      views: d._sum.views ?? 0,
      likes: d._sum.likes ?? 0,
      replies: d._sum.replies ?? 0,
      followers: latestFollowersMap.get(d.threadsAccountId) ?? 0,
    }))
    .sort((a, b) => b.views - a.views);

  const top = topPosts.slice(0, 10).map((p) => ({
    username: p.threadsAccount?.username || "unknown",
    text: p.text || "",
    views: p.views,
    likes: p.likes,
    replies: p.replies,
    media: MEDIA_LABEL[p.mediaType] || p.mediaType,
  }));

  // Jam posting (WIB) dari 30 postingan terbaik
  const hourCount = new Map<number, number>();
  for (const p of topPosts) {
    const h = (p.postedAt.getUTCHours() + 7) % 24;
    hourCount.set(h, (hourCount.get(h) ?? 0) + 1);
  }
  const bestHours = [...hourCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h, c]) => `${String(h).padStart(2, "0")}:00 WIB (${c} dari 30 post terbaik)`);

  const mediaText = byMedia
    .map((m) => {
      const inter = (m._sum.likes ?? 0) + (m._sum.replies ?? 0);
      const mViews = m._sum.views ?? 0;
      return `- ${MEDIA_LABEL[m.mediaType] || m.mediaType}: ${fmt(m._count._all)} post, rata-rata ${fmt(Math.round(m._avg.views ?? 0))} views/post, ER ${mViews ? ((inter / mViews) * 100).toFixed(2) : "0"}%`;
    })
    .join("\n");

  const trendText = last7
    .map(
      (d) =>
        `- ${d.date.toISOString().slice(0, 10)}: ${fmt(d._sum.views ?? 0)} views, ${fmt((d._sum.likes ?? 0) + (d._sum.replies ?? 0))} interaksi`
    )
    .join("\n");

  const text = `DATA LIVE JARINGAN AKUN THREADS SUKA SHAWARMA (dari database):
Ringkasan: ${accounts.length} akun | ${fmt(totalFollowers)} total followers seluruh jaringan | ${fmt(postsTotal)} postingan | ${fmt(views)} views | ${fmt(interactions)} interaksi | ER rata-rata ${er}%

DATA JUMLAH FOLLOWERS SEMUA AKUN (dari insight Threads di database):
${byFollowers.map((a, i) => `${i + 1}. @${a.username} (${a.displayName}): ${fmt(a.followers)} followers`).join("\n")}

PERINGKAT VIEWS (top 10 akun):
${byViews.slice(0, 10).map((a, i) => `${i + 1}. @${a.username}: ${fmt(a.views)} views, ${fmt(a.followers)} followers, ${fmt(a.likes)} suka, ${fmt(a.replies)} balasan`).join("\n")}

PERINGKAT JUMLAH POSTINGAN (top 10 akun):
${byPosts.slice(0, 10).map((a, i) => `${i + 1}. @${a.username}: ${fmt(a.posts)} post, ${fmt(a.followers)} followers`).join("\n")}

PERFORMA PER FORMAT KONTEN:
${mediaText}

TREN 7 HARI TERAKHIR (seluruh jaringan):
${trendText}

JAM POSTING PALING SERING MUNCUL DI POSTINGAN TERBAIK: ${bestHours.join("; ") || "-"}

10 POSTINGAN TERBAIK (views tertinggi):
${top.map((p, i) => `${i + 1}. @${p.username} [${p.media}] ${fmt(p.views)} views, ${p.likes} suka, ${p.replies} balasan: "${clip(p.text, 180)}"`).join("\n")}

5 POSTINGAN TERLEMAH (views rendah, sudah lewat 3 hari):
${flopPosts.map((p, i) => `${i + 1}. @${p.threadsAccount?.username || "unknown"} ${fmt(p.views)} views, ${p.likes} suka, ${p.replies} balasan: "${clip(p.text, 140)}"`).join("\n")}`;

  return {
    text,
    totals: { accounts: accounts.length, posts: postsTotal, views, interactions, er, followers: totalFollowers },
    byPosts,
    byViews,
    byFollowers,
    topPosts: top.map((p) => ({ username: p.username, text: p.text, views: p.views })),
    usernames: accounts.map((a) => a.username).filter((u): u is string => !!u),
  };
}

export async function getFleetContext(): Promise<FleetContext> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = await loadFleet();
  cache = { at: Date.now(), value };
  return value;
}

/** Detail satu akun bila pesan menyebut username atau nama cabangnya. */
export async function getAccountDetail(
  message: string,
  usernames: string[] = []
): Promise<string> {
  const accounts = await prisma.threadsAccount.findMany({
    select: { id: true, username: true, displayName: true },
  });

  const norm = (s: string) => s.toLowerCase().replace(/[@_\s.-]/g, "");
  const qNorm = norm(message);

  // Cari kecocokan terbaik berdasarkan username atau display name
  const hit = accounts
    .filter((a) => {
      const uNorm = norm(a.username || "");
      const dNorm = norm(a.displayName || "");
      if (uNorm.length >= 3 && qNorm.includes(uNorm)) return true;
      if (dNorm.length >= 3 && qNorm.includes(dNorm)) return true;
      return false;
    })
    .sort((a, b) => {
      const lenA = Math.max((a.username || "").length, (a.displayName || "").length);
      const lenB = Math.max((b.username || "").length, (b.displayName || "").length);
      return lenB - lenA;
    })[0];

  if (!hit) return "";

  const [sum, posts, count, latestDaily] = await Promise.all([
    prisma.threadsAccountDaily.aggregate({
      where: { threadsAccountId: hit.id },
      _sum: { views: true, likes: true, replies: true },
    }),
    prisma.threadsPostStat.findMany({
      where: { threadsAccountId: hit.id },
      take: 6,
      orderBy: { views: "desc" },
      select: { text: true, views: true, likes: true, replies: true, mediaType: true },
    }),
    prisma.threadsPostStat.count({ where: { threadsAccountId: hit.id } }),
    prisma.threadsAccountDaily.findFirst({
      where: { threadsAccountId: hit.id, followers: { not: null } },
      orderBy: { date: "desc" },
      select: { followers: true, date: true },
    }),
  ]);

  const v = sum._sum.views ?? 0;
  const inter = (sum._sum.likes ?? 0) + (sum._sum.replies ?? 0);
  const fol = latestDaily?.followers ?? 0;
  const folDate = latestDaily?.date ? latestDaily.date.toISOString().slice(0, 10) : null;

  return `DETAIL AKUN YANG DITANYAKAN (@${hit.username}, ${hit.displayName}):
- Followers: ${fmt(fol)} pengikut${folDate ? ` (data insight Threads per ${folDate})` : ""}
- Postingan: ${fmt(count)} post
- Total Views: ${fmt(v)} views
- Total Interaksi: ${fmt(inter)} (suka & balasan)
- Engagement Rate: ${v ? ((inter / v) * 100).toFixed(2) : "0"}%
Postingan terbaik akun ini:
${posts.map((p, i) => `${i + 1}. [${MEDIA_LABEL[p.mediaType] || p.mediaType}] ${fmt(p.views)} views, ${p.likes} suka, ${p.replies} balasan: "${clip(p.text, 160)}"`).join("\n")}`;
}
