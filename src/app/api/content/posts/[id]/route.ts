import { NextResponse } from "next/server";
import { afterResponse } from "@/lib/after-safe";
import { learnFromEdit } from "@/lib/account-memory";
import { internalError, jsonError, PUBLISH_DISABLED, readJson } from "@/lib/api-auth";
import { isPublishEnabled } from "@/lib/content-config";
import { parsePatchBody } from "@/lib/content-validation";
import { cancelPost, editPost } from "@/lib/threads-publish";
import { withCtx } from "@/lib/request-ctx";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Ubah teks, topik, atau jadwal posting dashboard yang belum diproses worker. */
export const PATCH = withCtx<{ id: string }>("EDITOR", async (request, ctx, route) => {
  const userId = ctx.userId;
  if (!isPublishEnabled()) return PUBLISH_DISABLED();

  const { id } = await route.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id postingan tidak valid.");

  const parsed = parsePatchBody(await readJson(request));
  if (!parsed.ok) return jsonError(400, parsed.error);

  const { aiBase, ...edit } = parsed.value;
  try {
    const result = await editPost({ userId, postId: id, ...edit });
    if (!result.ok) return jsonError(result.status, result.error, result.details);
    // AI belajar dari koreksi pemilik akun: versi AI yang dipilih (bila ada) atau teks lama -> teks akhir.
    const learn = result.learn;
    if (learn) {
      afterResponse("memori gaya", () =>
        learnFromEdit({
          accountId: learn.accountId,
          workspaceId: ctx.workspaceId,
          before: aiBase ?? learn.before,
          after: learn.after,
          source: aiBase ? "AI_EDIT" : "EDIT",
        })
      );
    }
    return NextResponse.json({ success: true, post: result.post });
  } catch (err) {
    return internalError("content/posts/[id]:PATCH", err);
  }
});

/** Batalkan posting dashboard yang belum diproses worker (menghapus baris antrean). */
export const DELETE = withCtx<{ id: string }>("EDITOR", async (request, ctx, route) => {
  const userId = ctx.userId;
  if (!isPublishEnabled()) return PUBLISH_DISABLED();

  const { id } = await route.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id postingan tidak valid.");

  try {
    const result = await cancelPost({ userId, postId: id });
    if (!result.ok) return jsonError(result.status, result.error, result.details);
    return NextResponse.json({ success: true });
  } catch (err) {
    return internalError("content/posts/[id]:DELETE", err);
  }
});
