import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const accountFilter = request.nextUrl.searchParams.get("account") || "all";

    // 1. Fetch all 32 connected accounts with post count and stats count
    const rawAccounts = await prisma.threadsAccount.findMany({
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        threadsUserId: true,
        insightsSyncedAt: true,
        _count: {
          select: {
            postStats: true,
            dailyStats: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    // Sort accounts prioritizing primary outlets and high-activity accounts
    const accounts = [...rawAccounts].sort((a, b) => {
      if (a.username === "sukashawarmaofficial") return -1;
      if (b.username === "sukashawarmaofficial") return 1;
      if (a.username === "kemitraansukashawarma") return -1;
      if (b.username === "kemitraansukashawarma") return 1;
      return (b._count?.postStats || 0) - (a._count?.postStats || 0);
    });

    const isAll = accountFilter === "all" || !accountFilter;
    const targetAccount = isAll
      ? null
      : accounts.find(
          (a) => a.username?.toLowerCase() === accountFilter.toLowerCase() || a.id === accountFilter
        );

    // 2. Aggregate Daily Performance (either for ALL accounts or SPECIFIC account)
    const dailyWhere = targetAccount ? { threadsAccountId: targetAccount.id } : {};
    const postWhere = targetAccount ? { threadsAccountId: targetAccount.id } : {};

    const [
      dailyAgg,
      totalPostsCount,
      last7DaysDaily,
      mediaTypesGrouped,
      allDailyHistory,
      topPost,
      reportLogs,
    ] = await Promise.all([
      // A. Aggregated sum of views and interactions
      prisma.threadsAccountDaily.aggregate({
        where: dailyWhere,
        _sum: {
          views: true,
          likes: true,
          replies: true,
          reposts: true,
        },
      }),

      // B. Total posts count
      prisma.threadsPostStat.count({
        where: postWhere,
      }),

      // C. Last 7 days daily performance
      prisma.threadsAccountDaily.groupBy({
        by: ["date"],
        where: dailyWhere,
        _sum: {
          views: true,
          likes: true,
          replies: true,
          reposts: true,
        },
        orderBy: {
          date: "desc",
        },
        take: 7,
      }),

      // D. Media types breakdown
      prisma.threadsPostStat.groupBy({
        by: ["mediaType"],
        where: postWhere,
        _count: { id: true },
      }),

      // E. Engagement history over time
      prisma.threadsAccountDaily.groupBy({
        by: ["date"],
        where: dailyWhere,
        _sum: {
          views: true,
          likes: true,
          replies: true,
          reposts: true,
        },
        orderBy: {
          date: "asc",
        },
      }),

      // F. Top performing post
      prisma.threadsPostStat.findFirst({
        where: postWhere,
        orderBy: {
          views: "desc",
        },
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
            select: {
              username: true,
              displayName: true,
              avatarUrl: true,
            },
          },
        },
      }),

      // G. Recent bot logs
      prisma.analyticsReportLog.findMany({
        take: 4,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          kind: true,
          periodKey: true,
          createdAt: true,
        },
      }),
    ]);

    const totalViews = dailyAgg._sum.views || 0;
    const totalLikes = dailyAgg._sum.likes || 0;
    const totalReplies = dailyAgg._sum.replies || 0;
    const totalReposts = dailyAgg._sum.reposts || 0;
    const totalInteractions = totalLikes + totalReplies + totalReposts;

    // Calculate Engagement Rate
    const avgER =
      totalViews > 0
        ? Number(((totalInteractions / totalViews) * 100).toFixed(1))
        : 0.5;

    // Format 7 days weekly activity
    const chronological7Days = [...last7DaysDaily].reverse();
    const dayNames = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

    const weeklyActivity = chronological7Days.map((d) => {
      const dateObj = new Date(d.date);
      const dayName = dayNames[dateObj.getUTCDay()];
      const views = d._sum.views || 0;
      const interactions =
        (d._sum.likes || 0) + (d._sum.replies || 0) + (d._sum.reposts || 0);

      return {
        day: dayName,
        date: dateObj.toISOString().split("T")[0],
        views,
        interactions,
      };
    });

    // Content Format Distribution
    let totalCategorized = 0;
    const formatMap: Record<string, number> = {
      TEXT: 0,
      VIDEO: 0,
      CAROUSEL: 0,
      IMAGE: 0,
    };

    mediaTypesGrouped.forEach((item) => {
      const type = (item.mediaType || "TEXT_POST").toUpperCase();
      const count = item._count.id;
      totalCategorized += count;

      if (type.includes("VIDEO") || type.includes("REELS")) {
        formatMap.VIDEO += count;
      } else if (type.includes("CAROUSEL") || type.includes("ALBUM")) {
        formatMap.CAROUSEL += count;
      } else if (type.includes("IMAGE") || type.includes("PHOTO")) {
        formatMap.IMAGE += count;
      } else {
        formatMap.TEXT += count;
      }
    });

    const divisor = totalCategorized || 1;
    const contentFormats = [
      {
        name: "Teks Singkat",
        value: Math.round((formatMap.TEXT / divisor) * 100),
        count: formatMap.TEXT,
        color: "#1814F3",
      },
      {
        name: "Video / Reels",
        value: Math.round((formatMap.VIDEO / divisor) * 100),
        count: formatMap.VIDEO,
        color: "#16DBCC",
      },
      {
        name: "Foto / Promo",
        value: Math.round((formatMap.IMAGE / divisor) * 100),
        count: formatMap.IMAGE,
        color: "#FF4B4A",
      },
      {
        name: "Carousel Edukasi",
        value: Math.round((formatMap.CAROUSEL / divisor) * 100),
        count: formatMap.CAROUSEL,
        color: "#FFBB38",
      },
    ];

    // Engagement History points
    const step = Math.max(1, Math.floor(allDailyHistory.length / 7));
    const engagementHistory = allDailyHistory
      .filter((_, idx) => idx % step === 0 || idx === allDailyHistory.length - 1)
      .map((item) => {
        const d = new Date(item.date);
        const day = d.getDate();
        const monthNames = [
          "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
          "Jul", "Agu", "Sep", "Okt", "Nov", "Des"
        ];
        const label = `${day} ${monthNames[d.getMonth()]}`;
        const totalViewsK = Math.round((item._sum.views || 0) / 1000);
        return {
          month: label,
          value: totalViewsK,
          rawViews: item._sum.views || 0,
          interactions: (item._sum.likes || 0) + (item._sum.replies || 0),
        };
      });

    // Recent bot activity logs
    const recentBotActions = reportLogs.map((log) => ({
      id: log.id,
      type: "report",
      title:
        log.kind === "daily"
          ? "Laporan Harian Telegram"
          : "Laporan Sosmed Telegram",
      desc: `Periode: ${log.periodKey} terkirim sukses`,
      status: "SENT",
      createdAt: log.createdAt.toISOString(),
    }));

    // Current Account metadata
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
          displayName: "Semua Akun (32 Terhubung)",
          avatarUrl: null,
          threadsUserId: null,
          insightsSyncedAt: accounts[0]?.insightsSyncedAt?.toISOString() || null,
          totalPosts: totalPostsCount,
          totalAccounts: accounts.length,
        };

    return NextResponse.json({
      success: true,
      currentAccount,
      stats: {
        totalViews,
        totalLikes,
        totalReplies,
        totalReposts,
        totalInteractions,
        avgER,
        activeAccounts: accounts.length,
        totalPosts: totalPostsCount,
      },
      accounts,
      topPost,
      weeklyActivity,
      contentFormats,
      engagementHistory,
      recentBotActions,
    });
  } catch (error: any) {
    console.error("Error in /api/analytics/overview:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
