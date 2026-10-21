import { NextResponse } from "next/server";
import { jsonError, PUBLISH_DISABLED, readJson } from "@/lib/api-auth";
import { ID_PATTERN, TOO_MANY, autopilotError } from "@/lib/autopilot-api";
import { REVIEW_CUTOFF_MS, lateBefore } from "@/lib/autopilot-config";
import { getSlot, reconcile } from "@/lib/autopilot-store";
import type { SlotAction } from "@/lib/autopilot-types";
import { approveSlot, rejectSlot, rewriteSlot, skipSlot } from "@/lib/autopilot-writer";
import { isPublishEnabled, WORKER_LATE_MS } from "@/lib/content-config";
import { canAccessAccount, withCtx } from "@/lib/request-ctx";
import { publishPostNow } from "@/lib/threads-publish";
import { runPublisher } from "@/lib/threads-publisher";
import { THREADS_MAX_TEXT, charLength, parseTopicTag } from "@/lib/threads-text";
import { throttle } from "@/lib/throttle";

const ACTIONS: SlotAction[] = ["approve", "reject", "rewrite", "skip", "publish_now"];
const MAX_RAW_TEXT = 2000;

export const maxDuration = 60;

/**
 * Hasil kerja AI untuk satu slot (animasi "cara kerja AI"): ide, draf, dan hasil pemeriksaan. Hanya kolom
 * yang ditampilkan; slot di luar lingkup akun pengguna dianggap tidak ada.
 */
export const GET = withCtx<{ id: string }>("VIEWER", async (_request, ctx, route) => {
  const { id } = await route.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id slot tidak valid.");
  try {
    const slot = await getSlot(id, ctx.workspaceId);
    if (!slot || !canAccessAccount(ctx, slot.accountId)) return jsonError(404, "Slot tidak ditemukan.");
    const d = slot.draft;
    return NextResponse.json(
      {
        success: true,
        item: {
          id: slot.id,
          status: slot.status,
          criticScore: slot.criticScore,
          lastError: slot.lastError,
          draft: d
            ? {
                text: d.text,
                angle: d.angle,
                rationale: d.rationale,
                checks: d.checks,
                topik: d.idea?.topik ?? null,
                pillar: d.pillar ?? null,
                promo: d.promo === true,
                affiliate: d.affiliate?.nama ?? null,
              }
            : null,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return autopilotError("autopilot/slots:GET", err);
  }
});

/**
 * Tindakan atas satu slot. Body: `{ action, text?, topicTag? }`.
 * - approve: draf (boleh diedit) masuk antrean pada jam slotnya
 * - publish_now: setujui/majukan ke sekarang lalu langsung jalankan penerbit Threads
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
    if (action === "approve" || action === "publish_now") {
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

      if (action === "approve") {
        const result = await approveSlot({ ...input, text, topicTag });
        if (!result.ok) return jsonError(result.status, result.error, result.details);
        return NextResponse.json({ success: true });
      }

      // action === "publish_now": dukung slot yang masih MENUNGGU_TINJAU maupun yang sudah TERANTRE
      const slot = await getSlot(id, ctx.workspaceId);
      if (!slot) return jsonError(404, "Slot tidak ditemukan.");
      let postId = slot.postId;
      if (slot.status === "MENUNGGU_TINJAU") {
        const approved = await approveSlot({ ...input, text, topicTag, immediate: true });
        if (!approved.ok) return jsonError(approved.status, approved.error, approved.details);
        postId = approved.postId ?? null;
      } else if (slot.status === "TERANTRE" && postId) {
        const moved = await publishPostNow({ userId: ctx.userId, postId });
        if (!moved.ok) return jsonError(moved.status, moved.error, moved.details);
      } else {
        return jsonError(409, "Slot ini belum memiliki draf terjadwal atau sudah diterbitkan.");
      }

      await runPublisher({ now: new Date() }).catch((err) => {
        console.error("[autopilot/slots:publish_now] runPublisher:", err instanceof Error ? err.message : err);
      });
      const after = new Date();
      await reconcile(
        after,
        new Date(after.getTime() + REVIEW_CUTOFF_MS),
        lateBefore(after),
        new Date(after.getTime() - WORKER_LATE_MS)
      ).catch(() => undefined);

      return NextResponse.json({ success: true, postId });
    }
    const result =
      action === "reject" ? await rejectSlot(input) : action === "rewrite" ? await rewriteSlot(input) : await skipSlot(input);
    if (!result.ok) return jsonError(result.status, result.error, result.details);
    return NextResponse.json({ success: true });
  } catch (err) {
    return autopilotError("autopilot/slots:POST", err);
  }
});
