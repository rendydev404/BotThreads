import { NextResponse } from "next/server";
import { jsonError, PUBLISH_DISABLED, readJson } from "@/lib/api-auth";
import { ID_PATTERN, TOO_MANY, autopilotError } from "@/lib/autopilot-api";
import type { SlotAction } from "@/lib/autopilot-types";
import { approveSlot, rejectSlot, rewriteSlot, skipSlot } from "@/lib/autopilot-writer";
import { isPublishEnabled } from "@/lib/content-config";
import { withCtx } from "@/lib/request-ctx";
import { THREADS_MAX_TEXT, charLength, parseTopicTag } from "@/lib/threads-text";
import { throttle } from "@/lib/throttle";

const ACTIONS: SlotAction[] = ["approve", "reject", "rewrite", "skip"];
const MAX_RAW_TEXT = 2000;

/**
 * Tindakan atas satu slot. Body: `{ action, text?, topicTag? }`.
 * - approve: draf (boleh diedit) masuk antrean pada jam slotnya
 * - reject / skip: slot dilewati
 * - rewrite: AI menulis ulang pada putaran berikutnya
 */
export const POST = withCtx<{ id: string }>("EDITOR", async (request, ctx, route) => {
  const { id } = await route.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id slot tidak valid.");

  const body = (await readJson(request)) as { action?: unknown; text?: unknown; topicTag?: unknown } | null;
  const action = body?.action as SlotAction;
  if (!ACTIONS.includes(action)) return jsonError(400, "Tindakan tidak valid.");

  const limit = throttle(`autopilot-slot:${ctx.userId}`, 60, 60_000);
  if (!limit.ok) return TOO_MANY(limit.retryAfter);

  const input = { slotId: id, workspaceId: ctx.workspaceId, userId: ctx.userId };
  try {
    if (action === "approve") {
      if (!isPublishEnabled()) return PUBLISH_DISABLED();
      let text: string | undefined;
      if (body?.text !== undefined) {
        if (typeof body.text !== "string" || body.text.length > MAX_RAW_TEXT) return jsonError(400, "Teks tidak valid.");
        if (charLength(body.text.trim()) > THREADS_MAX_TEXT) {
          return jsonError(400, `Teks maksimal ${THREADS_MAX_TEXT} karakter.`);
        }
        text = body.text;
      }
      let topicTag: string | null | undefined;
      if (body?.topicTag !== undefined) {
        const topic = parseTopicTag(body.topicTag);
        if (!topic.ok) return jsonError(400, topic.error);
        topicTag = topic.tag;
      }
      const result = await approveSlot({ ...input, text, topicTag });
      if (!result.ok) return jsonError(result.status, result.error, result.details);
      return NextResponse.json({ success: true });
    }
    const result =
      action === "reject" ? await rejectSlot(input) : action === "rewrite" ? await rewriteSlot(input) : await skipSlot(input);
    if (!result.ok) return jsonError(result.status, result.error, result.details);
    return NextResponse.json({ success: true });
  } catch (err) {
    return autopilotError("autopilot/slots:POST", err);
  }
});
