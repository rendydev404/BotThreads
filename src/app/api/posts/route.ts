import { NextRequest, NextResponse } from "next/server";
import { agg, db, likeEscape, must, toDate } from "@/lib/supabase";
import { cleanPostText } from "@/lib/utils";

export async function GET(request: NextRequest) {
  // Dibaca di luar try/catch: sinyal "route dinamis" dari Next tidak boleh tertelan
  const searchParams = request.nextUrl.searchParams;
  try {
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)));
    const tab = searchParams.get("tab") || "all"; // "all" | "top" | "flop"
    const search = searchParams.get("search") || "";
    const accountFilter = searchParams.get("account") || "all";
    const formatFilter = searchParams.get("format") || "all";
    const sortBy = searchParams.get("sortBy") || "recent"; // "recent" | "views_desc" | "likes_desc"

    const skip = (page - 1) * limit;

    // Filter akun lewat username ➜ id (setara relasi threadsAccount.username di Prisma)
    let accountIds: string[] | null = null;
    if (accountFilter && accountFilter !== "all") {
      const rows = await must<{ id: string }[]>(
        db().from("ThreadsAccount").select("id").eq("username", accountFilter)
      );
      accountIds = rows.map((r) => r.id);
    }

    const FORMAT_FILTERS = ["TEXT", "VIDEO", "CAROUSEL", "IMAGE"];

    // Determine ordering
    let orderCol: "postedAt" | "views" | "likes" = "postedAt";
    let ascending = false;
    if (tab === "top" || sortBy === "views_desc") {
      orderCol = "views";
    } else if (tab === "flop") {
      orderCol = "views";
      ascending = true;
    } else if (sortBy === "likes_desc") {
      orderCol = "likes";
    }

    let postsQuery = db()
      .from("ThreadsPostStat")
      .select(
        "id, mediaId, mediaType, text, permalink, postedAt, views, likes, replies, reposts, quotes, shares, ThreadsAccount(username, displayName, avatarUrl)",
        { count: "exact" }
      );
    if (search) postsQuery = postsQuery.ilike("text", `%${likeEscape(search)}%`);
    if (accountIds) {
      postsQuery = accountIds.length
        ? postsQuery.in("threadsAccountId", accountIds)
        : postsQuery.eq("threadsAccountId", "__none__");
    }
    if (FORMAT_FILTERS.includes(formatFilter)) {
      postsQuery = postsQuery.ilike("mediaType", `%${formatFilter}%`);
    }
    postsQuery = postsQuery
      .order(orderCol, { ascending })
      .order("id", { ascending: true })
      .range(skip, skip + limit - 1);

    type PostRow = {
      id: string;
      mediaId: string;
      mediaType: string;
      text: string;
      permalink: string | null;
      postedAt: string;
      views: number;
      likes: number;
      replies: number;
      reposts: number;
      quotes: number;
      shares: number;
      ThreadsAccount: { username: string | null; displayName: string; avatarUrl: string | null } | null;
    };

    const [postsRes, allAccounts, postCounts, mediaTotals] = await Promise.all([
      postsQuery,
      must<{ id: string; username: string | null; displayName: string }[]>(
        db().from("ThreadsAccount").select("id, username, displayName")
      ),
      agg.postsByAccount(),
      agg.postsByMedia(),
    ]);
    if (postsRes.error) throw new Error(`Supabase: ${postsRes.error.message}`);

    const totalCount = postsRes.count ?? 0;
    const postsRaw = ((postsRes.data ?? []) as unknown as PostRow[]).map((p) => ({
      ...p,
      postedAt: toDate(p.postedAt),
      threadsAccount: p.ThreadsAccount,
    }));

    const countOf = new Map(postCounts.map((c) => [c.threadsAccountId, c.posts]));
    const accountList = allAccounts
      .map((a) => ({
        username: a.username,
        displayName: a.displayName,
        _count: { postStats: countOf.get(a.id) ?? 0 },
      }))
      .sort((a, b) => b._count.postStats - a._count.postStats)
      .slice(0, 35);

    const totalViewsAgg = {
      _sum: mediaTotals.reduce(
        (s, m) => ({ views: s.views + m.views, likes: s.likes + m.likes, replies: s.replies + m.replies }),
        { views: 0, likes: 0, replies: 0 }
      ),
    };

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

    const deleted = await must<{ id: string }[]>(
      db().from("ThreadsPostStat").delete().eq("id", id).select("id")
    );
    if (deleted.length === 0) {
      return NextResponse.json(
        { success: false, error: "Post tidak ditemukan" },
        { status: 404 }
      );
    }

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
