import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { cleanPostText } from "@/lib/utils";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)));
    const tab = searchParams.get("tab") || "all"; // "all" | "top" | "flop"
    const search = searchParams.get("search") || "";
    const accountFilter = searchParams.get("account") || "all";
    const formatFilter = searchParams.get("format") || "all";
    const sortBy = searchParams.get("sortBy") || "recent"; // "recent" | "views_desc" | "likes_desc"

    const skip = (page - 1) * limit;

    const whereClause: any = {};
    if (search) {
      whereClause.text = {
        contains: search,
        mode: "insensitive",
      };
    }

    if (accountFilter && accountFilter !== "all") {
      whereClause.threadsAccount = {
        username: accountFilter,
      };
    }

    if (formatFilter && formatFilter !== "all") {
      if (formatFilter === "TEXT") {
        whereClause.mediaType = { contains: "TEXT", mode: "insensitive" };
      } else if (formatFilter === "VIDEO") {
        whereClause.mediaType = { contains: "VIDEO", mode: "insensitive" };
      } else if (formatFilter === "CAROUSEL") {
        whereClause.mediaType = { contains: "CAROUSEL", mode: "insensitive" };
      } else if (formatFilter === "IMAGE") {
        whereClause.mediaType = { contains: "IMAGE", mode: "insensitive" };
      }
    }

    // Determine ordering
    let orderBy: any = { postedAt: "desc" };
    if (tab === "top" || sortBy === "views_desc") {
      orderBy = { views: "desc" };
    } else if (tab === "flop") {
      orderBy = { views: "asc" };
    } else if (sortBy === "likes_desc") {
      orderBy = { likes: "desc" };
    }

    const [totalCount, postsRaw, accountList, totalViewsAgg] = await Promise.all([
      prisma.threadsPostStat.count({ where: whereClause }),
      prisma.threadsPostStat.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          mediaId: true,
          mediaType: true,
          text: true,
          permalink: true,
          postedAt: true,
          views: true,
          likes: true,
          replies: true,
          reposts: true,
          quotes: true,
          shares: true,
          threadsAccount: {
            select: {
              username: true,
              displayName: true,
              avatarUrl: true,
            },
          },
        },
      }),
      prisma.threadsAccount.findMany({
        select: {
          username: true,
          displayName: true,
          _count: {
            select: { postStats: true },
          },
        },
        orderBy: {
          postStats: { _count: "desc" },
        },
        take: 35,
      }),
      prisma.threadsPostStat.aggregate({
        _sum: { views: true, likes: true, replies: true },
      }),
    ]);

    // Calculate ER and enrich posts
    const posts = postsRaw.map((post) => {
      const views = Math.max(1, post.views);
      const engagements = post.likes + post.replies + post.reposts + post.quotes;
      const er = Number(((engagements / views) * 100).toFixed(1));
      const isPositive = er >= 4.0;

      // Clean display format name
      const mType = post.mediaType.toUpperCase();
      let formatLabel = "Teks";
      let formatKey = "TEXT";
      if (mType.includes("VIDEO")) {
        formatLabel = "Video";
        formatKey = "VIDEO";
      } else if (mType.includes("CAROUSEL") || mType.includes("ALBUM")) {
        formatLabel = "Carousel";
        formatKey = "CAROUSEL";
      } else if (mType.includes("IMAGE") || mType.includes("PHOTO")) {
        formatLabel = "Foto";
        formatKey = "IMAGE";
      }

      return {
        id: post.id,
        mediaId: post.mediaId,
        mediaType: post.mediaType,
        formatLabel,
        formatKey,
        text: cleanPostText(post.text),
        rawText: post.text,
        permalink: post.permalink,
        postedAt: post.postedAt,
        views: post.views,
        likes: post.likes,
        replies: post.replies,
        reposts: post.reposts,
        er: er,
        isPositive,
        account: post.threadsAccount?.username || "sukashawarma",
        accountName: post.threadsAccount?.displayName || "Suka Shawarma",
        accountAvatar: post.threadsAccount?.avatarUrl,
      };
    });

    return NextResponse.json({
      success: true,
      posts,
      accounts: accountList.map((a) => ({
        username: a.username || "",
        displayName: a.displayName,
        count: a._count.postStats,
      })),
      stats: {
        totalPosts: totalCount,
        totalViews: totalViewsAgg._sum.views || 0,
        totalLikes: totalViewsAgg._sum.likes || 0,
        totalReplies: totalViewsAgg._sum.replies || 0,
      },
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1,
      },
    });
  } catch (error: any) {
    console.error("Error in /api/posts:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json(
        { success: false, error: "ID post wajib disertakan" },
        { status: 400 }
      );
    }

    await prisma.threadsPostStat.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: `Post ${id} berhasil dihapus dari database`,
    });
  } catch (error: any) {
    console.error("Error deleting post:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
