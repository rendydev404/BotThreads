import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    // 1. Fetch Accounts with selective fields for performance
    const accounts = await prisma.threadsAccount.findMany({
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

    // 2. Aggregate actual 7-day performance from ThreadsAccountDaily
    const last7DaysDaily = await prisma.threadsAccountDaily.groupBy({
      by: ["date"],
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
    });

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

    // 3. Overall aggregations across all accounts
    const [dailyAgg, totalPostsCount, mediaTypesGrouped, reportLogs] = await Promise.all([
      prisma.threadsAccountDaily.aggregate({
        _sum: {
          views: true,
          likes: true,
          replies: true,
          reposts: true,
        },
      }),
      prisma.threadsPostStat.count(),
      prisma.threadsPostStat.groupBy({
        by: ["mediaType"],
        _count: { id: true },
      }),
      prisma.analyticsReportLog.findMany({
        take: 3,
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

    // 4. Calculate content format distribution from real database
    let totalCategorized = 0;
    const formatMap: Record<string, number> = {
      TEXT: 0,
      VIDEO: 0,
      CAROUSEL: 0,
      IMAGE: 0,
    };

    mediaTypesGrouped.forEach((item) => {
      const type = item.mediaType.toUpperCase();
      const count = item._count.id;
      totalCategorized += count;

      if (type.includes("TEXT")) {
        formatMap.TEXT += count;
      } else if (type.includes("VIDEO")) {
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

    // 5. 30-Day Real Engagement History from ThreadsAccountDaily
    const allDailyHistory = await prisma.threadsAccountDaily.groupBy({
      by: ["date"],
      _sum: {
        views: true,
        likes: true,
        replies: true,
        reposts: true,
      },
      orderBy: {
        date: "asc",
      },
    });

    // Sample every 4-5 days or display trend points
    const engagementHistory = allDailyHistory
      .filter((_, idx) => idx % 4 === 0 || idx === allDailyHistory.length - 1)
      .map((item) => {
        const d = new Date(item.date);
        const day = d.getDate();
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
        const label = `${day} ${monthNames[d.getMonth()]}`;
        const totalViewsK = Math.round((item._sum.views || 0) / 1000);
        return {
          month: label,
          value: totalViewsK,
          rawViews: item._sum.views || 0,
          interactions: (item._sum.likes || 0) + (item._sum.replies || 0),
        };
      });

    // 6. Recent bot actions: Real log entries from AnalyticsReportLog & Recent Syncs
    const recentBotActions = reportLogs.map((log) => ({
      id: log.id,
      type: "report",
      title: log.kind === "daily" ? "Laporan Harian Telegram" : "Laporan Sosmed Telegram",
      desc: `Periode: ${log.periodKey} terkirim sukses`,
      status: "SENT",
      createdAt: log.createdAt.toISOString(),
    }));

    // Find top primary & secondary real accounts
    const primaryAcc =
      accounts.find((a) => a.username === "sukashawarmaofficial") ||
      accounts[0];
    const secondaryAcc =
      accounts.find((a) => a.username === "kemitraansukashawarma") ||
      accounts[1] ||
      accounts[0];

    const maskedPrimaryId = primaryAcc?.threadsUserId
      ? `${primaryAcc.threadsUserId.slice(0, 4)} **** **** ${primaryAcc.threadsUserId.slice(-4)}`
      : "3855 **** **** 6364";

    const maskedSecondaryId = secondaryAcc?.threadsUserId
      ? `${secondaryAcc.threadsUserId.slice(0, 4)} **** **** ${secondaryAcc.threadsUserId.slice(-4)}`
      : "2974 **** **** 8454";

    return NextResponse.json({
      success: true,
      stats: {
        totalViews: totalViews,
        totalLikes: totalLikes,
        totalReplies: totalReplies,
        totalReposts: totalReposts,
        totalInteractions: totalInteractions,
        avgER: avgER,
        activeAccounts: accounts.length,
        totalPosts: totalPostsCount,
        primaryAccount: primaryAcc?.username || "sukashawarmaofficial",
        secondaryAccount: secondaryAcc?.username || "kemitraansukashawarma",
        maskedCardId: maskedPrimaryId,
        secondaryCardId: maskedSecondaryId,
      },
      accounts,
      recentBotActions,
      weeklyActivity,
      contentFormats,
      engagementHistory,
    });
  } catch (error: any) {
    console.error("Error in /api/analytics/overview:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
