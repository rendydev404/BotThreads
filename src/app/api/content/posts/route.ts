import { NextResponse, type NextRequest } from "next/server";
import {
  PUBLISH_DISABLED,
  getRequestUserId,
  internalError,
  jsonError,
  readJson,
  UNAUTHORIZED,
} from "@/lib/api-auth";
import { isPublishEnabled } from "@/lib/content-config";
import type { CreatePostsResponse, PostStatusKey, PostsResponse } from "@/lib/content-types";
import { parseCreateBody, parseIdList } from "@/lib/content-validation";
import { throttle } from "@/lib/throttle";
import { createPosts, getPostsByIds, listPosts } from "@/lib/threads-publish";

const STATUS_KEYS: PostStatusKey[] = ["SCHEDULED", "QUEUED", "PROCESSING", "PUBLISHED", "FAILED"];

/**
 * Daftar posting Threads dari dashboard.
 * Query: `scope` (upcoming|history), `account` (username), `status`, `cursor`, `all=1` (semua sumber,
 * baca-saja), atau `ids=a,b,c` untuk polling status ringkas.
 */
export async function GET(request: NextRequest) {
  if (!(await getRequestUserId(request))) return UNAUTHORIZED();
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
}

/**
 * Masukkan posting/jadwal ke antrean bersama (ScheduledPost + PostDispatch). Penerbitan dikerjakan
 * worker threads-publisher; dashboard tidak memegang token dan tidak memanggil Threads.
 */
export async function POST(request: NextRequest) {
  const userId = await getRequestUserId(request);
  if (!userId) return UNAUTHORIZED();
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
    });
    if (!result.ok) return jsonError(result.status, result.error, result.details);
    const body: CreatePostsResponse = {
      success: true,
      posts: result.posts,
      ...(result.replayed ? { replayed: true } : {}),
    };
    return NextResponse.json(body, { status: result.replayed ? 200 : 201 });
  } catch (err) {
    return internalError("content/posts:POST", err);
  }
}
