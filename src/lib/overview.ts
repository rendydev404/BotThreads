import { prisma } from "@/lib/db";
import { isoDate, resolvePeriod } from "@/lib/period";
import { pctDelta } from "@/lib/report";

const DAY = 86_400_000;
const WIB_MS = 7 * 3_600_000;
const DAY_NAMES = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const sums = { views: true, likes: true, replies: true, reposts: true } as const;

function erOf(views: number, interactions: number, digits = 1) {
  return views > 0 ? Number(((interactions / views) * 100).toFixed(digits)) : 0;
}

export interface OverviewParams {
  account: string;
  period: string | null;
  from: string | null;
  to: string | null;
}

/** Seluruh data dasbor untuk satu akun/semua akun pada satu periode. */
export async function buildOverview(opts: OverviewParams) {
  {
    const accountFilter = opts.account || "all";
    const period = resolvePeriod(opts.period, opts.from, opts.to);
    const { from, to, prevFrom, prevTo, days } = period;

    // Batas postingan dalam hari WIB (postedAt tersimpan UTC)
    const inRange = (a: Date, b: Date) => ({
      gte: new Date(a.getTime() - WIB_MS),
      lt: new Date(b.getTime() + DAY - WIB_MS),
    });

    // Daftar akun (untuk filter & peringkat)
    const rawAccounts = await prisma.threadsAccount.findMany({
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        threadsUserId: true,
        insightsSyncedAt: true,
        _count: { select: { postStats: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const accounts = [...rawAccounts].sort(
      (a, b) => (b._count?.postStats || 0) - (a._count?.postStats || 0)
    );

    const isAll = accountFilter === "all" || !accountFilter;
    const targetAccount = isAll
      ? null
      : accounts.find(
          (a) =>
            a.username?.toLowerCase() === accountFilter.toLowerCase() ||
            a.id === accountFilter
        );

    const acc = targetAccount ? { threadsAccountId: targetAccount.id } : {};
    const dailyCur = { ...acc, date: { gte: from, lte: to } };
    const dailyPrev = { ...acc, date: { gte: prevFrom, lte: prevTo } };
    const postCur = { ...acc, postedAt: inRange(from, to) };
    const postPrev = { ...acc, postedAt: inRange(prevFrom, prevTo) };

    const [
      curByDate,
      prevByDate,
      postsCur,
      postsPrev,
      mediaTypesGrouped,
      topPost,
      reportLogs,
      lbCur,
      lbPrev,
      lbPosts,
    ] = await Promise.all([
      // Per hari pada periode: total sekaligus data grafik
      prisma.threadsAccountDaily.groupBy({
        by: ["date"],
        where: dailyCur,
        _sum: sums,
        orderBy: { date: "asc" },
      }),
      // Periode pembanding (jumlah hari berdata dipakai untuk menilai kelayakan)
      prisma.threadsAccountDaily.groupBy({
        by: ["date"],
        where: dailyPrev,
        _sum: { views: true, likes: true, replies: true, reposts: true },
      }),
      prisma.threadsPostStat.count({ where: postCur }),
      prisma.threadsPostStat.count({ where: postPrev }),
      prisma.threadsPostStat.groupBy({
        by: ["mediaType"],
        where: postCur,
        _count: { id: true },
      }),
      prisma.threadsPostStat.findFirst({
        where: postCur,
        orderBy: { views: "desc" },
        select: {
          id: true,
          text: true,
          mediaType: true,
          views: true,
          likes: true,
          replies: true,
          reposts: true,
          permalink: true,
          postedAt: true,
          threadsAccount: {
            select: { username: true, displayName: true, avatarUrl: true },
          },
        },
      }),
      prisma.analyticsReportLog.findMany({
        take: 4,
        orderBy: { createdAt: "desc" },
        select: { id: true, kind: true, periodKey: true, createdAt: true },
      }),
      // Peringkat seluruh cabang pada periode ini dan periode sebelumnya
      prisma.threadsAccountDaily.groupBy({
        by: ["threadsAccountId"],
        where: { date: { gte: from, lte: to } },
        _sum: sums,
      }),
      prisma.threadsAccountDaily.groupBy({
        by: ["threadsAccountId"],
        where: { date: { gte: prevFrom, lte: prevTo } },
        _sum: { views: true },
      }),
      prisma.threadsPostStat.groupBy({
        by: ["threadsAccountId"],
        where: { postedAt: inRange(from, to) },
        _count: { _all: true },
      }),
    ]);

    // ---- Total periode ini & sebelumnya
    const total = (rows: typeof curByDate) =>
      rows.reduce(
        (t, r) => ({
          views: t.views + (r._sum.views || 0),
          likes: t.likes + (r._sum.likes || 0),
          replies: t.replies + (r._sum.replies || 0),
          reposts: t.reposts + (r._sum.reposts || 0),
        }),
        { views: 0, likes: 0, replies: 0, reposts: 0 }
      );

    const cur = total(curByDate);
    const prev = total(prevByDate as typeof curByDate);
    const totalInteractions = cur.likes + cur.replies + cur.reposts;
    const prevInteractions = prev.likes + prev.replies + prev.reposts;
    const avgER = erOf(cur.views, totalInteractions);
    const hasPrev = prevByDate.length >= Math.ceil(days * 0.6);

    const deltas = hasPrev
      ? {
          views: pctDelta(cur.views, prev.views),
          posts: pctDelta(postsCur, postsPrev),
          interactions: pctDelta(totalInteractions, prevInteractions),
          // Selisih ER dalam poin persen
          er: Number((avgER - erOf(prev.views, prevInteractions)).toFixed(1)),
        }
      : null;

    // ---- Grafik: isi hari kosong dengan 0 agar sumbu waktu utuh
    const byDate = new Map(curByDate.map((d) => [isoDate(d.date), d]));
    const activity = Array.from({ length: days }, (_, i) => {
      const d = new Date(from.getTime() + i * DAY);
      const row = byDate.get(isoDate(d));
      return {
        day:
          days <= 7
            ? DAY_NAMES[d.getUTCDay()]
            : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`,
        date: isoDate(d),
        views: row?._sum.views || 0,
        interactions:
          (row?._sum.likes || 0) + (row?._sum.replies || 0) + (row?._sum.reposts || 0),
      };
    });

    // ---- Jenis konten (postingan yang terbit pada periode)
    const formatMap = { TEXT: 0, VIDEO: 0, CAROUSEL: 0, IMAGE: 0 };
    let totalCategorized = 0;
    mediaTypesGrouped.forEach((item) => {
      const type = (item.mediaType || "TEXT_POST").toUpperCase();
      const count = item._count.id;
      totalCategorized += count;
      if (type.includes("VIDEO") || type.includes("REELS")) formatMap.VIDEO += count;
      else if (type.includes("CAROUSEL") || type.includes("ALBUM")) formatMap.CAROUSEL += count;
      else if (type.includes("IMAGE") || type.includes("PHOTO")) formatMap.IMAGE += count;
      else formatMap.TEXT += count;
    });
    const divisor = totalCategorized || 1;
    const pct = (n: number) => Math.round((n / divisor) * 100);
    const contentFormats = [
      { name: "Teks Singkat", value: pct(formatMap.TEXT), count: formatMap.TEXT, color: "#1814F3" },
      { name: "Video / Reels", value: pct(formatMap.VIDEO), count: formatMap.VIDEO, color: "#16DBCC" },
      { name: "Foto / Promo", value: pct(formatMap.IMAGE), count: formatMap.IMAGE, color: "#FF4B4A" },
      { name: "Carousel Edukasi", value: pct(formatMap.CAROUSEL), count: formatMap.CAROUSEL, color: "#FFBB38" },
    ];

    const recentBotActions = reportLogs.map((log) => ({
      id: log.id,
      type: "report",
      title: log.kind === "daily" ? "Laporan Harian Telegram" : "Laporan Sosmed Telegram",
      desc: `Periode: ${log.periodKey} terkirim sukses`,
      status: "SENT",
      createdAt: log.createdAt.toISOString(),
    }));

    const currentAccount = targetAccount
      ? {
          isAll: false,
          id: targetAccount.id,
          username: targetAccount.username,
          displayName: targetAccount.displayName,
          avatarUrl: targetAccount.avatarUrl,
          threadsUserId: targetAccount.threadsUserId,
          insightsSyncedAt: targetAccount.insightsSyncedAt?.toISOString() || null,
          totalPosts: targetAccount._count?.postStats || 0,
        }
      : {
          isAll: true,
          username: "all",
          displayName: `Semua Akun (${accounts.length} Terhubung)`,
          avatarUrl: null,
          threadsUserId: null,
          insightsSyncedAt: accounts[0]?.insightsSyncedAt?.toISOString() || null,
          totalPosts: postsCur,
          totalAccounts: accounts.length,
        };

    // ---- Peringkat cabang
    const curMap = new Map(lbCur.map((g) => [g.threadsAccountId, g._sum]));
    const prevMap = new Map(lbPrev.map((g) => [g.threadsAccountId, g._sum.views || 0]));
    const postMap = new Map(lbPosts.map((g) => [g.threadsAccountId, g._count._all]));

    const leaderboard = accounts
      .map((a) => {
        const d = curMap.get(a.id);
        const views = d?.views || 0;
        const likes = d?.likes || 0;
        const replies = d?.replies || 0;
        const reposts = d?.reposts || 0;
        return {
          id: a.id,
          username: a.username || "outlet",
          displayName: a.displayName || a.username || "Cabang",
          avatarUrl: a.avatarUrl,
          posts: postMap.get(a.id) || 0,
          views,
          likes,
          replies,
          reposts,
          er: erOf(views, likes + replies + reposts, 2),
          delta: hasPrev ? pctDelta(views, prevMap.get(a.id) || 0) : null,
        };
      })
      .sort((a, b) => b.views - a.views);

    return {
      success: true as const,
      period: {
        key: period.key,
        label: period.label,
        from: isoDate(from),
        to: isoDate(to),
        days,
        hasPrev,
      },
      currentAccount,
      stats: {
        totalViews: cur.views,
        totalLikes: cur.likes,
        totalReplies: cur.replies,
        totalReposts: cur.reposts,
        totalInteractions,
        avgER,
        activeAccounts: accounts.length,
        totalPosts: postsCur,
      },
      deltas,
      accounts,
      leaderboard,
      topPost,
      activity,
      contentFormats,
      recentBotActions,
    };
  }
}
