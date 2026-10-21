/**
 * Preview postingan dari satu ide bank ide (tab Ide di Radar). Ditulis AI sekali saat ide pertama kali dilihat,
 * disimpan di ide itu, lalu dipakai ulang: tampilan berikutnya tidak memanggil AI lagi, dan autopilot memakai
 * teks yang sama lebih dulu saat menulis slot dengan ide ini (tetap melewati gerbang dan kritikus).
 */
import { runGate } from "./autopilot-gate";
import { editCandidates } from "./content-ai";
import { getPublishAccountMap } from "./publish-accounts";
import { ideaPreviewSource, saveIdeaPreview, type IdeaPreview } from "./radar-store";
import type { RequestCtx } from "./request-ctx";
import type { Failure } from "./threads-publish";

const failure = (status: number, error: string): Failure => ({ ok: false, status, error });

export async function ideaPreview(
  ctx: RequestCtx,
  id: string,
  opts: { regenerate: boolean; signal?: AbortSignal },
  now = new Date()
): Promise<{ ok: true; preview: IdeaPreview } | Failure> {
  const idea = await ideaPreviewSource(id, ctx.workspaceId, ctx.accountIds);
  if (!idea) return failure(404, "Ide tidak ditemukan.");
  if (idea.preview && !opts.regenerate) return { ok: true, preview: idea.preview };
  if (idea.status !== "BARU") return failure(409, "Ide ini sudah tidak siap dipakai, jadi preview-nya tidak ditulis ulang.");

  const account = (await getPublishAccountMap([idea.accountId])).get(idea.accountId);
  if (!account) return failure(404, "Akun Threads ide ini tidak ditemukan.");

  const res = await editCandidates(
    { account, text: idea.preview?.text ?? "", action: "idea", idea: { topik: idea.topik, sudut: idea.sudut }, signal: opts.signal },
    now
  );
  if (!res.ok) return failure(502, res.error);
  // Versi yang lolos pemeriksaan klaim (tanpa sumber fakta: paling ketat) didahulukan, supaya preview yang
  // dilihat pengguna adalah versi yang nanti juga lolos saat autopilot menulis slotnya.
  const best =
    res.result.candidates.find((c) => runGate({ text: c.text, sources: [], peers: [] }).ok) ?? res.result.candidates[0];
  const preview: IdeaPreview = { text: best.text, topicTag: best.topicTag ?? null, model: res.result.model, at: now.toISOString() };
  await saveIdeaPreview(id, preview, now);
  return { ok: true, preview };
}
