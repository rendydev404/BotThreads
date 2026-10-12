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
import { parsePatchBody } from "@/lib/content-validation";
import { cancelPost, editPost } from "@/lib/threads-publish";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

type Ctx = { params: Promise<{ id: string }> };

/** Ubah teks, topik, atau jadwal posting dashboard yang belum diproses worker. */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const userId = await getRequestUserId(request);
  if (!userId) return UNAUTHORIZED();
  if (!isPublishEnabled()) return PUBLISH_DISABLED();

  const { id } = await ctx.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id postingan tidak valid.");

  const parsed = parsePatchBody(await readJson(request));
  if (!parsed.ok) return jsonError(400, parsed.error);

  try {
    const result = await editPost({ userId, postId: id, ...parsed.value });
    if (!result.ok) return jsonError(result.status, result.error, result.details);
    return NextResponse.json({ success: true, post: result.post });
  } catch (err) {
    return internalError("content/posts/[id]:PATCH", err);
  }
}

/** Batalkan posting dashboard yang belum diproses worker (menghapus baris antrean). */
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const userId = await getRequestUserId(request);
  if (!userId) return UNAUTHORIZED();
  if (!isPublishEnabled()) return PUBLISH_DISABLED();

  const { id } = await ctx.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id postingan tidak valid.");

  try {
    const result = await cancelPost({ userId, postId: id });
    if (!result.ok) return jsonError(result.status, result.error, result.details);
    return NextResponse.json({ success: true });
  } catch (err) {
    return internalError("content/posts/[id]:DELETE", err);
  }
}
