import { NextResponse } from "next/server";
import { internalError, jsonError, PUBLISH_DISABLED } from "@/lib/api-auth";
import { isPublishEnabled } from "@/lib/content-config";
import { retryPost } from "@/lib/threads-publish";
import { withCtx } from "@/lib/request-ctx";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Kirim ulang posting yang gagal (mengembalikannya ke antrean worker). */
export const POST = withCtx<{ id: string }>("EDITOR", async (request, ctx, route) => {
  const userId = ctx.userId;
  if (!isPublishEnabled()) return PUBLISH_DISABLED();

  const { id } = await route.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id postingan tidak valid.");

  try {
    const result = await retryPost({ userId, postId: id });
    if (!result.ok) return jsonError(result.status, result.error, result.details);
    return NextResponse.json({ success: true, post: result.post });
  } catch (err) {
    return internalError("content/posts/[id]/retry", err);
  }
});
