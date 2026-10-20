import { agg, db, excludedIdList, must, onlyVisible, sqlTs, toDate, toDateOrNull, type DailyByDate } from "@/lib/supabase";
import { isoDate, resolvePeriod } from "@/lib/period";
import { pctDelta } from "@/lib/report";
import { fetchLiveToday, livePostMetrics, withPostFloor, type LivePost, type LivePostMetrics } from "@/lib/threads-live";

const DAY = 86_400_000;
const WIB_MS = 7 * 3_600_000;
const DAY_NAMES = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

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
    const { from, to, prevFrom, prevTo, days, live } = period;
    // Periode sehari: grafik tetap memuat 6 hari sebelumnya sebagai konteks
    const chartFrom = days === 1 ? new Date(to.getTime() - 6 * DAY) : from;
    // Hari ini tidak ada di database (worker hanya menyimpan s.d. kemarin): diambil langsung dari Threads
    const dbTo = live ? new Date(to.getTime() - DAY) : to;
    const todayStart = new Date(to.getTime() - WIB_MS);

    // Batas postingan dalam hari WIB (postedAt tersimpan UTC)
    const inRange = (a: Date, b: Date) => ({
      gte: new Date(a.getTime() - WIB_MS),
      lt: new Date(b.getTime() + DAY - WIB_MS),
    });

    // Daftar akun (untuk filter & peringkat)
    const [accountRows, allPostCounts] = await Promise.all([
      must<
        {
          id: string;
          username: string | null;
          displayName: string;
          avatarUrl: string | null;
          threadsUserId: string;
          insightsSyncedAt: string | null;
        }[]
      >(
        db()
          .from("ThreadsAccount")
          .select("id, username, displayName, avatarUrl, threadsUserId, insightsSyncedAt")
          .order("createdAt", { ascending: true })
      ).then(onlyVisible),
      agg.postsByAccount(),
    ]);
    const postCountOf = new Map(allPostCounts.map((c) => [c.threadsAccountId, c.posts]));
    const rawAccounts = accountRows.map((a) => ({
      ...a,
      insightsSyncedAt: toDateOrNull(a.insightsSyncedAt),
      _count: { postStats: postCountOf.get(a.id) ?? 0 },
    }));

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

    const ids = targetAccount ? [targetAccount.id] : undefined;
    const curPostRange = inRange(from, to);
    const prevPostRange = inRange(prevFrom, prevTo);
    // Postingan hari ini dihitung dari data langsung; database hanya sampai sebelum 00.00 WIB hari ini
    const dbPostRange = live
      ? { gte: curPostRange.gte, lt: new Date(Math.max(curPostRange.gte.getTime(), todayStart.getTime())) }
      : curPostRange;
    const hasDbDays = from.getTime() <= dbTo.getTime();
    const hasDbPosts = dbPostRange.gte.getTime() < dbPostRange.lt.getTime();

    let topPostQuery = db()
      .from("ThreadsPostStat")
      .select(
        "id, text, mediaType, views, likes, replies, reposts, permalink, postedAt, ThreadsAccount(username, displayName, avatarUrl)"
      )
      .gte("postedAt", sqlTs(dbPostRange.gte))
      .lt("postedAt", sqlTs(dbPostRange.lt));
    if (targetAccount) topPostQuery = topPostQuery.eq("threadsAccountId", targetAccount.id);
    else {
      const hidden = await excludedIdList();
      if (hidden) topPostQuery = topPostQuery.not("threadsAccountId", "in", hidden);
    }

    const [
      curDaily,
      prevDaily,
      mediaRows,
      prevPostRows,
      topPostRows,
      reportLogRows,
      lbCurRows,
      lbPrevRows,
      lbPostRows,
      folCurRows,
      folPrevRows,
      liveData,
    ] = await Promise.all([
      // Per hari pada rentang grafik: total periode sekaligus data grafik
      agg.dailyByDate({ from: chartFrom, to: dbTo, ids }),
      // Periode pembanding (jumlah hari berdata dipakai untuk menilai kelayakan)
      agg.dailyByDate({ from: prevFrom, to: prevTo, ids }),
      hasDbPosts ? agg.postsByMedia({ from: dbPostRange.gte, to: dbPostRange.lt, ids }) : Promise.resolve([]),
      agg.postsByAccount({ from: prevPostRange.gte, to: prevPostRange.lt, ids }),
      must<
        {
          id: string;
          text: string;
          mediaType: string;
          views: number;
          likes: number;
          replies: number;
          reposts: number;
          permalink: string | null;
          postedAt: string;
          ThreadsAccount: { username: string | null; displayName: string; avatarUrl: string | null } | null;
        }[]
      >(hasDbPosts ? topPostQuery.order("views", { ascending: false }).limit(1) : Promise.resolve({ data: [], error: null })),
      must<{ id: string; kind: string; periodKey: string; createdAt: string }[]>(
        db()
          .from("AnalyticsReportLog")
          .select("id, kind, periodKey, createdAt")
          .order("createdAt", { ascending: false })
          .limit(4)
      ),
      // Peringkat seluruh cabang pada periode ini dan periode sebelumnya
      hasDbDays ? agg.dailyByAccount({ from, to: dbTo }) : Promise.resolve([]),
      agg.dailyByAccount({ from: prevFrom, to: prevTo }),
      hasDbPosts ? agg.postsByAccount({ from: dbPostRange.gte, to: dbPostRange.lt }) : Promise.resolve([]),
      // Followers cabang akhir periode saat ini dan pembanding
      agg.latestFollowers({ to }),
      agg.latestFollowers({ to: prevTo }),
      // Seluruh akun (bukan hanya yang dipilih): peringkat cabang juga butuh angka hari ini
      live ? fetchLiveToday(accounts.map((a) => a.id), todayStart) : Promise.resolve(null),
    ]);

    // ---- Angka hari ini dari Threads, dibatasi ke akun yang sedang dilihat
    const liveRaw = liveData ? [...liveData.accounts.values()] : [];
    const scopeIds = new Set(ids ?? accounts.map((a) => a.id));
    const livePosts: LivePost[] = liveRaw.filter((a) => scopeIds.has(a.accountId)).flatMap((a) => a.posts);
    // Metrik postingan hari ini (di-cache 60 dtk): untuk postingan terpopuler dan batas bawah interaksi hari ini.
    const postMetrics = livePosts.length ? await livePostMetrics(livePosts) : new Map<string, LivePostMetrics>();
    const liveAll = liveRaw.map((a) => withPostFloor(a, postMetrics));
    const liveScoped = liveAll.filter((a) => scopeIds.has(a.accountId));

    // Bentuk hasil disamakan dengan groupBy/aggregate Prisma sebelumnya
    const bySum = (r: DailyByDate) => ({
      date: toDate(r.date),
      _sum: { views: r.views, likes: r.likes, replies: r.replies, reposts: r.reposts },
    });
    const chartByDate = curDaily.map(bySum);
    if (live) {
      const sum = (k: "views" | "likes" | "replies" | "reposts") => liveScoped.reduce((t, a) => t + a[k], 0);
      chartByDate.push({
        date: to,
        _sum: { views: sum("views"), likes: sum("likes"), replies: sum("replies"), reposts: sum("reposts") },
      });
    }
    const curByDate = chartByDate.filter((d) => d.date.getTime() >= from.getTime());
    const prevByDate = prevDaily.map(bySum);
    const mediaCounts = new Map(mediaRows.map((m) => [m.mediaType, m.posts]));
    for (const p of livePosts) mediaCounts.set(p.mediaType, (mediaCounts.get(p.mediaType) ?? 0) + 1);
    const mediaTypesGrouped = [...mediaCounts].map(([mediaType, posts]) => ({ mediaType, _count: { id: posts } }));
    const postsCur = mediaRows.reduce((s, m) => s + m.posts, 0) + livePosts.length;
    const postsPrev = prevPostRows.reduce((s, p) => s + p.posts, 0);
    const dbTop = topPostRows[0]
      ? (({ ThreadsAccount, ...p }) => ({
          ...p,
          postedAt: toDate(p.postedAt),
          threadsAccount: ThreadsAccount,
        }))(topPostRows[0])
      : null;
    let liveTop: typeof dbTop = null;
    if (livePosts.length) {
      for (const p of livePosts) {
        const m = postMetrics.get(p.id);
        if (!m || (liveTop && liveTop.views >= m.views)) continue;
        const acc = accounts.find((a) => a.id === p.accountId);
        liveTop = {
          id: p.id,
          text: p.text,
          mediaType: p.mediaType,
          ...m,
          permalink: p.permalink,
          postedAt: p.postedAt,
          threadsAccount: acc ? { username: acc.username, displayName: acc.displayName, avatarUrl: acc.avatarUrl } : null,
        };
      }
    }
    const topPost = liveTop && (!dbTop || liveTop.views > dbTop.views) ? liveTop : dbTop;
    const reportLogs = reportLogRows.map((l) => ({ ...l, createdAt: toDate(l.createdAt) }));
    const lbCur = lbCurRows.map(({ threadsAccountId, ...s }) => ({ threadsAccountId, _sum: s }));
    const lbPrev = lbPrevRows.map((p) => ({ threadsAccountId: p.threadsAccountId, _sum: { views: p.views } }));
    const lbPosts = lbPostRows.map((p) => ({ threadsAccountId: p.threadsAccountId, _count: { _all: p.posts } }));

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
    const prev = total(prevByDate);
    const totalInteractions = cur.likes + cur.replies + cur.reposts;
    const prevInteractions = prev.likes + prev.replies + prev.reposts;
    const avgER = erOf(cur.views, totalInteractions);
    // Hari ini belum selesai: membandingkannya dengan kemarin sehari penuh menyesatkan
    const hasPrev = period.key !== "today" && prevByDate.length >= Math.ceil(days * 0.6);

    // Map followers per akun pada akhir periode dan pembanding
    const curFollowerMap = new Map<string, number>();
    for (const r of folCurRows) {
      if (r.followers !== null && !curFollowerMap.has(r.threadsAccountId)) {
        curFollowerMap.set(r.threadsAccountId, r.followers);
      }
    }

    for (const a of liveAll) if (a.followers !== null) curFollowerMap.set(a.accountId, a.followers);

    const prevFollowerMap = new Map<string, number>();
    for (const r of folPrevRows) {
      if (r.followers !== null && !prevFollowerMap.has(r.threadsAccountId)) {
        prevFollowerMap.set(r.threadsAccountId, r.followers);
      }
    }

    let totalFollowers: number | null = null;
    let prevTotalFollowers: number | null = null;

    if (isAll) {
      if (curFollowerMap.size > 0) {
        totalFollowers = Array.from(curFollowerMap.values()).reduce((a, b) => a + b, 0);
      }
      if (prevFollowerMap.size > 0) {
        prevTotalFollowers = Array.from(prevFollowerMap.values()).reduce((a, b) => a + b, 0);
      }
    } else if (targetAccount) {
      totalFollowers = curFollowerMap.get(targetAccount.id) ?? null;
      prevTotalFollowers = prevFollowerMap.get(targetAccount.id) ?? null;
    }

    const followersDelta =
      totalFollowers !== null && prevTotalFollowers !== null
        ? totalFollowers - prevTotalFollowers
        : null;

    const deltas = hasPrev
      ? {
          views: pctDelta(cur.views, prev.views),
          posts: pctDelta(postsCur, postsPrev),
          interactions: pctDelta(totalInteractions, prevInteractions),
          // Selisih ER dalam poin persen
          er: Number((avgER - erOf(prev.views, prevInteractions)).toFixed(1)),
          followers: followersDelta,
        }
      : null;

    // ---- Grafik: isi hari kosong dengan 0 agar sumbu waktu utuh
    const byDate = new Map(chartByDate.map((d) => [isoDate(d.date), d]));
    const chartDays = Math.round((to.getTime() - chartFrom.getTime()) / DAY) + 1;
    const activity = Array.from({ length: chartDays }, (_, i) => {
      const d = new Date(chartFrom.getTime() + i * DAY);
      const row = byDate.get(isoDate(d));
      return {
        day:
          chartDays <= 7
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
          followers: totalFollowers,
          followersDelta,
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
          followers: totalFollowers,
          followersDelta,
        };

    // ---- Peringkat cabang
    const curMap = new Map(lbCur.map((g) => [g.threadsAccountId, { ...g._sum }]));
    const prevMap = new Map(lbPrev.map((g) => [g.threadsAccountId, g._sum.views || 0]));
    const postMap = new Map(lbPosts.map((g) => [g.threadsAccountId, g._count._all]));
    for (const a of liveAll) {
      const d = curMap.get(a.accountId) ?? { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0 };
      curMap.set(a.accountId, {
        views: d.views + a.views,
        likes: d.likes + a.likes,
        replies: d.replies + a.replies,
        reposts: d.reposts + a.reposts,
        quotes: d.quotes + a.quotes,
      });
      postMap.set(a.accountId, (postMap.get(a.accountId) ?? 0) + a.posts.length);
    }

    const leaderboard = accounts
      .map((a) => {
        const d = curMap.get(a.id);
        const views = d?.views || 0;
        const likes = d?.likes || 0;
        const replies = d?.replies || 0;
        const reposts = d?.reposts || 0;
        const fol = curFollowerMap.get(a.id) ?? null;
        const pFol = prevFollowerMap.get(a.id) ?? null;
        return {
          id: a.id,
          username: a.username || "outlet",
          displayName: a.displayName || a.username || "Cabang",
          avatarUrl: a.avatarUrl,
          posts: postMap.get(a.id) || 0,
          followers: fol,
          followersDelta: fol !== null && pFol !== null ? fol - pFol : null,
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
        live,
        // Waktu angka hari ini diambil dari Threads; akun yang gagal diambil tidak ikut dihitung
        updatedAt: liveData?.fetchedAt.toISOString() ?? null,
        liveFailed: liveData ? liveData.failed : 0,
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
        totalFollowers,
        followersDelta,
      },
      deltas,
      accounts: accounts.map((a) => ({
        ...a,
        followers: curFollowerMap.get(a.id) ?? null,
      })),
      leaderboard,
      topPost,
      activity,
      contentFormats,
      recentBotActions,
    };
  }
}
