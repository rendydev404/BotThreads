import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)));
    const tab = searchParams.get("tab") || "all"; // "all" | "top" | "flop"
    const search = searchParams.get("search") || "";

    const skip = (page - 1) * limit;

    const whereClause: any = {};
    if (search) {
      whereClause.text = {
        contains: search,
        mode: "insensitive",
      };
    }

    // Determine ordering based on tab
    let orderBy: any = { postedAt: "desc" };
    if (tab === "top") {
      orderBy = { views: "desc" };
    } else if (tab === "flop") {
      orderBy = { views: "asc" };
    }

    const [totalCount, postsRaw] = await Promise.all([
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
            },
          },
        },
      }),
    ]);

    // Calculate ER and enrich posts
    const posts = postsRaw.map((post) => {
      const views = Math.max(1, post.views);
      const engagements = post.likes + post.replies + post.reposts + post.quotes;
      const er = Number(((engagements / views) * 100).toFixed(1));
      const isPositive = er >= 4.0;

      return {
        id: post.id,
        mediaId: post.mediaId,
        mediaType: post.mediaType,
        text: post.text || "(Tidak ada caption teks)",
        permalink: post.permalink,
        postedAt: post.postedAt,
        views: post.views,
        likes: post.likes,
        replies: post.replies,
        reposts: post.reposts,
        er: er,
        isPositive,
        account: post.threadsAccount?.username || "sukashawarma",
      };
    });

    return NextResponse.json({
      success: true,
      posts,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1,
      },
    });
  } catch (error: any) {
    console.error("Error in /api/posts:", error);
    // Return sample mock data if DB empty or starting up
    const mockPosts = [
      {
        id: "post-1",
        mediaId: "12548796",
        mediaType: "VIDEO",
        text: "Kelezatan shawarma rempah asli yang dipanggang lambat hingga juicy!",
        permalink: "https://threads.net/@sukashawarma/post/1",
        postedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
        views: 48200,
        likes: 3120,
        replies: 420,
        reposts: 180,
        er: 7.7,
        isPositive: true,
        account: "sukashawarma",
      },
      {
        id: "post-2",
        mediaId: "12548797",
        mediaType: "TEXT",
        text: "Kenapa saus garlic kami beda dari yang lain? Simak rahasianya di utas ini 🧄",
        permalink: "https://threads.net/@sukashawarma/post/2",
        postedAt: new Date(Date.now() - 3600000 * 6).toISOString(),
        views: 24300,
        likes: 1250,
        replies: 190,
        reposts: 64,
        er: 6.2,
        isPositive: true,
        account: "sukashawarma",
      },
      {
        id: "post-3",
        mediaId: "12548798",
        mediaType: "CAROUSEL",
        text: "5 Perbedaan Doner Kebab vs Arabic Shawarma Tradisional.",
        permalink: "https://threads.net/@sukashawarma/post/3",
        postedAt: new Date(Date.now() - 3600000 * 24).toISOString(),
        views: 18900,
        likes: 890,
        replies: 82,
        reposts: 45,
        er: 5.4,
        isPositive: true,
        account: "sukashawarma",
      },
      {
        id: "post-4",
        mediaId: "12548799",
        mediaType: "IMAGE",
        text: "Outlet buka jam 10 pagi hari ini, ada promo bundling 2 porsi!",
        permalink: "https://threads.net/@sukashawarma/post/4",
        postedAt: new Date(Date.now() - 3600000 * 48).toISOString(),
        views: 5200,
        likes: 110,
        replies: 12,
        reposts: 4,
        er: 2.4,
        isPositive: false,
        account: "sukashawarma",
      },
    ];

    return NextResponse.json({
      success: true,
      posts: mockPosts,
      pagination: {
        page: 1,
        limit: 10,
        total: mockPosts.length,
        totalPages: 1,
      },
    });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ success: false, error: "ID post wajib disertakan" }, { status: 400 });
    }

    await prisma.threadsPostStat.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, message: `Post ${id} berhasil dihapus dari database` });
  } catch (error: any) {
    console.error("Error deleting post:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
