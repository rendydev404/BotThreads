import { NextResponse } from "next/server";
import { internalError, jsonError, PUBLISH_DISABLED, readJson } from "@/lib/api-auth";
import { isPublishEnabled } from "@/lib/content-config";
import type { CreatePostsResponse, PostStatusKey, PostsResponse } from "@/lib/content-types";
import { parseCreateBody, parseIdList } from "@/lib/content-validation";
import { throttle } from "@/lib/throttle";
import { createPosts, getPostsByIds, listPosts } from "@/lib/threads-publish";
import { withCtx } from "@/lib/request-ctx";

const STATUS_KEYS: PostStatusKey[] = ["SCHEDULED", "QUEUED", "PROCESSING", "PUBLISHED", "FAILED"];

/**
 * Daftar posting Threads dari dashboard.
 * Query: `scope` (upcoming|history), `account` (username), `status`, `cursor`, `all=1` (semua sumber,
 * baca-saja), atau `ids=a,b,c` untuk polling status ringkas.
 */
export const GET = withCtx("VIEWER", async (request) => {
  const q = request.nextUrl.searchParams;
  const includeAll = q.get("all") === "1" || q.get("includeAll") === "1";

  try {
    const idsParam = q.get("ids");
    if (idsParam !== null) {
      const ids = parseIdList(idsParam);
      if (!ids) return jsonError(400, "Daftar id tidak valid (maksimal 20).");
      const items = await getPostsByIds(ids, includeAll);
      return NextResponse.json({ success: true, items, nextCursor: null } satisfies PostsResponse);
    }

    const scope = q.get("scope") === "history" ? "history" : "upcoming";
    const statusRaw = q.get("status");
    if (statusRaw && !STATUS_KEYS.includes(statusRaw as PostStatusKey)) {
      return jsonError(400, "Filter status tidak valid.");
    }
    const account = q.get("account");
    const accountUsername = account && account !== "all" && /^[A-Za-z0-9_.]{1,60}$/.test(account) ? account : null;
    if (account && account !== "all" && !accountUsername) return jsonError(400, "Akun tidak valid.");

    const result = await listPosts({
      scope,
      accountUsername,
      status: (statusRaw as PostStatusKey | null) || null,
      cursor: q.get("cursor"),
      includeAll,
    });
    return NextResponse.json({ success: true, ...result } satisfies PostsResponse);
  } catch (err) {
    return internalError("content/posts:GET", err);
  }
});

/**
 * Masukkan posting/jadwal ke antrean bersama (ScheduledPost + PostDispatch). Penerbitan dikerjakan
 * worker threads-publisher; dashboard tidak memegang token dan tidak memanggil Threads.
 */
export const POST = withCtx("EDITOR", async (request, ctx) => {
  const userId = ctx.userId;
  if (!isPublishEnabled()) return PUBLISH_DISABLED();

  const limit = throttle(`create:${userId}`, 30, 60_000);
  if (!limit.ok) {
    return jsonError(429, "Terlalu banyak permintaan posting. Tunggu sebentar.", undefined, {
      "Retry-After": String(limit.retryAfter),
    });
  }

  const parsed = parseCreateBody(await readJson(request));
  if (!parsed.ok) return jsonError(400, parsed.error);

  try {
    const result = await createPosts({
      userId,
      idempotencyKey: parsed.value.idempotencyKey,
      items: parsed.value.items,
      partial: parsed.value.partial,
      autoReschedule: parsed.value.autoReschedule,
    });
    if (!result.ok) return jsonError(result.status, result.error, result.details);
    const body: CreatePostsResponse = {
      success: true,
      posts: result.posts,
      ...(result.replayed ? { replayed: true } : {}),
      ...(result.skipped ? { skipped: result.skipped } : {}),
    };
    return NextResponse.json(body, { status: result.replayed || result.posts.length === 0 ? 200 : 201 });
  } catch (err) {
    return internalError("content/posts:POST", err);
  }
});

/**
 * Batalkan banyak postingan sekaligus (bulk cancel).
 */
export const DELETE = withCtx("EDITOR", async (request, ctx) => {
  const userId = ctx.userId;
  if (!isPublishEnabled()) return PUBLISH_DISABLED();

  try {
    const body = (await readJson(request)) as { ids?: string[] } | null;
    if (!body || !Array.isArray(body.ids)) {
      return jsonError(400, "Daftar ids tidak valid.");
    }
    if (body.ids.length === 0) {
      return NextResponse.json({ success: true, failedCount: 0 });
    }
    if (body.ids.length > 50) {
      return jsonError(400, "Maksimal 50 postingan dapat dibatalkan sekaligus.");
    }

    const { throttle } = await import("@/lib/throttle");
    const limit = throttle(`cancel:${userId}`, 10, 60_000);
    if (!limit.ok) {
      return jsonError(429, "Terlalu banyak aksi pembatalan. Tunggu sebentar.", undefined, {
        "Retry-After": String(limit.retryAfter),
      });
    }

    const { cancelPost } = await import("@/lib/threads-publish");
    
    // Untuk bulk hapus/batal kita bisa jalankan secara berurutan atau Promise.all 
    // karena memanggil operasi RPC cancelPost masing-masing.
    let failedCount = 0;
    await Promise.all(
      body.ids.map(async (id: string) => {
        const res = await cancelPost({ userId, postId: id });
        if (!res.ok) failedCount++;
      })
    );

    if (failedCount === body.ids.length && body.ids.length > 0) {
      return jsonError(400, "Gagal membatalkan semua postingan yang dipilih. Mungkin sudah diproses.");
    }

    return NextResponse.json({ success: true, failedCount });
  } catch (err) {
    return internalError("content/posts:DELETE", err);
  }
});
