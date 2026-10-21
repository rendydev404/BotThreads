import { NextResponse } from "next/server";
import { internalError, jsonError, PUBLISH_DISABLED } from "@/lib/api-auth";
import { REVIEW_CUTOFF_MS, lateBefore } from "@/lib/autopilot-config";
import { reconcile } from "@/lib/autopilot-store";
import { isPublishEnabled, WORKER_LATE_MS } from "@/lib/content-config";
import { withCtx } from "@/lib/request-ctx";
import { getPostsByIds, publishPostNow } from "@/lib/threads-publish";
import { runPublisher } from "@/lib/threads-publisher";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const maxDuration = 60;

/** Majukan jadwal posting ke sekarang dan langsung jalankan penerbit Threads. */
export const POST = withCtx<{ id: string }>("EDITOR", async (_request, ctx, route) => {
  if (!isPublishEnabled()) return PUBLISH_DISABLED();

  const { id } = await route.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id postingan tidak valid.");

  try {
    const now = new Date();
    const result = await publishPostNow({ userId: ctx.userId, postId: id }, now);
    if (!result.ok) return jsonError(result.status, result.error, result.details);

    await runPublisher({ now: new Date() }).catch((err) => {
      console.error("[publish-now] runPublisher:", err instanceof Error ? err.message : err);
    });

    const after = new Date();
    await reconcile(
      after,
      new Date(after.getTime() + REVIEW_CUTOFF_MS),
      lateBefore(after),
      new Date(after.getTime() - WORKER_LATE_MS)
    ).catch(() => undefined);

    const [updated] = await getPostsByIds([id], false, after);
    return NextResponse.json({ success: true, post: updated ?? result.post });
  } catch (err) {
    return internalError("content/posts/[id]/publish-now", err);
  }
});
