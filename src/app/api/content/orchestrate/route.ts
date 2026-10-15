import { randomUUID } from "node:crypto";
import { internalError, jsonError, PUBLISH_DISABLED, readJson } from "@/lib/api-auth";
import { queueDraft } from "@/lib/auto-publish";
import { isPublishEnabled } from "@/lib/content-config";
import { runOrchestration } from "@/lib/content-orchestrator";
import type { OrchestrateEvent } from "@/lib/content-types";
import { parseOrchestrateBody } from "@/lib/content-validation";
import { listPublishAccounts, type PublishAccount } from "@/lib/publish-accounts";
import { throttle } from "@/lib/throttle";
import { FORBIDDEN, hasRole, withCtx } from "@/lib/request-ctx";

/** Puluhan agen dengan konkurensi terbatas; satu putaran penuh bisa lebih dari satu menit. */
export const maxDuration = 300;

const RUN_DEADLINE_MS = 240_000;
const HEARTBEAT_MS = 15_000;

/**
 * Multi-Agent Orchestrator: draf untuk banyak akun sekaligus, dialirkan sebagai SSE (satu peristiwa
 * per akun). Tanpa `publish` hanya menghasilkan draf. Dengan `publish` (perintah eksplisit pengguna,
 * peran minimal Editor) tiap draf langsung dimasukkan ke antrean lewat `queueDraft`.
 */
export const POST = withCtx("VIEWER", async (request, ctx) => {
  const userId = ctx.userId;

  const parsed = parseOrchestrateBody(await readJson(request));
  if (!parsed.ok) return jsonError(400, parsed.error);
  const input = parsed.value;
  // Posting otomatis hanya untuk putaran penuh dan hanya bila saklar posting menyala.
  const publish = input.accountIds?.length === 1 && input.avoid ? null : input.publish;
  if (publish && !hasRole(ctx, "EDITOR")) return FORBIDDEN();
  if (publish && !isPublishEnabled()) return PUBLISH_DISABLED();

  // Buat ulang satu akun jauh lebih murah daripada satu putaran penuh, jadi kuotanya dipisah.
  const single = input.accountIds?.length === 1;
  const limit = single
    ? throttle(`orchestrate-one:${userId}`, 60, 5 * 60_000)
    : throttle(`orchestrate:${userId}`, 8, 5 * 60_000);
  if (!limit.ok) {
    return jsonError(429, "Terlalu sering menjalankan orkestrasi. Coba lagi sebentar lagi.", undefined, {
      "Retry-After": String(limit.retryAfter),
    });
  }

  let accounts: PublishAccount[];
  try {
    const all = await listPublishAccounts();
    const wanted = input.accountIds ? new Set(input.accountIds) : null;
    accounts = wanted ? all.filter((a) => wanted.has(a.id)) : all;
  } catch (err) {
    return internalError("content/orchestrate", err);
  }
  if (accounts.length === 0) return jsonError(404, "Akun Threads tidak ditemukan.");

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(RUN_DEADLINE_MS)]);
  const encoder = new TextEncoder();
  const cancel = new AbortController();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const emit = (event: OrchestrateEvent) => send(`data: ${JSON.stringify(event)}\n\n`);
      // Mode posting otomatis: tiap draf diantrekan segera setelah jadi (berurutan, satu kunci per akun),
      // jadi akun pertama sudah terjadwal saat agen lain masih menulis. "done" dikirim setelah antrean beres.
      const runKey = randomUUID();
      let queue: Promise<void> = Promise.resolve();
      const onEvent = (event: OrchestrateEvent) => {
        emit(event);
        if (!publish || event.type !== "draft") return;
        const draft = event.draft;
        queue = queue.then(async () => {
          const r = await queueDraft(userId, draft, publish, `${runKey}:${draft.threadsAccountId}`);
          emit(
            r.ok
              ? {
                  type: "queued",
                  accountId: draft.threadsAccountId,
                  postId: r.postId,
                  at: r.at,
                  mode: r.mode,
                  ...(r.rescheduledFrom ? { rescheduledFrom: r.rescheduledFrom } : {}),
                }
              : { type: "queue-error", accountId: draft.threadsAccountId, error: r.error }
          );
        });
      };
      // Komentar SSE berkala supaya proxy tidak memutus koneksi yang sedang menunggu AI.
      heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);

      runOrchestration(
        {
          accounts,
          topic: input.topic,
          fixedTime: input.fixedTime,
          avoid: single ? input.avoid : null,
          signal: AbortSignal.any([signal, cancel.signal]),
        },
        onEvent
      )
        .then(async (summary) => {
          await queue;
          emit({ type: "done", ...summary });
        })
        .catch((err) => {
          console.error("[content/orchestrate]", err instanceof Error ? err.message : "galat tak dikenal");
          emit({ type: "fatal", error: "Orkestrasi terhenti karena kesalahan server. Coba lagi." });
        })
        .finally(() => {
          clearInterval(heartbeat);
          if (!closed) {
            closed = true;
            controller.close();
          }
        });
    },
    cancel() {
      closed = true;
      clearInterval(heartbeat);
      cancel.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
