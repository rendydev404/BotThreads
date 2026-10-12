import { NextResponse, type NextRequest } from "next/server";
import {
  PUBLISH_DISABLED,
  getRequestUserId,
  internalError,
  jsonError,
  UNAUTHORIZED,
} from "@/lib/api-auth";
import { isPublishEnabled } from "@/lib/content-config";
import { retryPost } from "@/lib/threads-publish";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Kirim ulang posting yang gagal (mengembalikannya ke antrean worker). */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getRequestUserId(request);
  if (!userId) return UNAUTHORIZED();
  if (!isPublishEnabled()) return PUBLISH_DISABLED();

  const { id } = await ctx.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id postingan tidak valid.");

  try {
    const result = await retryPost({ userId, postId: id });
    if (!result.ok) return jsonError(result.status, result.error, result.details);
    return NextResponse.json({ success: true, post: result.post });
  } catch (err) {
    return internalError("content/posts/[id]/retry", err);
  }
}
