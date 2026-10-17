/**
 * Rencana posting autopilot untuk satu hari: apa yang akan (atau sudah) diposting tiap slot.
 *
 * Slot yang sudah ditulis menampilkan drafnya. Slot yang belum ditulis menampilkan PERKIRAAN isinya,
 * dihitung dengan logika yang sama persis dengan penulis (`planSlotBrief`): giliran promo, giliran
 * affiliate, lalu ide terbaik dari bank ide (ide tren didahulukan). Simulasi berjalan berurutan menurut
 * jam tayang lintas hari ini dan besok, jadi ide yang "dipakai" slot lebih awal tidak muncul dua kali.
 *
 * Tidak memanggil AI dan tidak menulis apa pun. Kueri: 3 putaran RPC (+1 bila draf merujuk tren yang
 * belum termuat), semuanya lewat indeks (sql/021).
 */
import { emptyAffiliateState, loadAffiliateState, type AffiliateState } from "./affiliate-store";
import { rememberAffiliate } from "./affiliate-pick";
import type { TopicUse } from "./autopilot-ideas";
import { EMPTY_KNOWLEDGE, loadKnowledge, type AccountKnowledge } from "./autopilot-research";
import { visibleAccounts } from "./autopilot-service";
import { loadState, planDrafts, type ClaimedSlot, type ConfigRow, type PlanDraftRow, type SlotRow } from "./autopilot-store";
import type { PlanItemDTO, PlanSignalDTO, PlanViewResponse } from "./autopilot-types";
import { pickPromo, planSlotBrief } from "./autopilot-writer";
import type { RequestCtx } from "./request-ctx";
import { ideaCandidates, ideaDetails, signalBriefs, type IdeaCandidate, type IdeaDetail, type SignalBrief } from "./radar-store";
import { hookLabel } from "./radar-types";
import { wibDayKey } from "./scheduling";
import type { Failure } from "./threads-publish";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Cadangan ide per akun di atas jumlah slot terbuka (ide yang ditolak karena topik kembar antar-akun). */
const SPARE_IDEAS = 3;
const MAX_SIGNALS_PER_ITEM = 3;

const toSignals = (ids: string[], signals: Map<string, SignalBrief>): PlanSignalDTO[] =>
  ids
    .map((id) => signals.get(id))
    .filter((s): s is SignalBrief => !!s)
    .slice(0, MAX_SIGNALS_PER_ITEM)
    .map((s) => ({ source: s.source, title: s.title, url: s.url }));

const pct = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : null);

interface Projection {
  kind: "IDE" | "PROMO" | "AFFILIATE" | "BEBAS";
  topik: string | null;
  idea: IdeaCandidate | null;
  pillar: string | null;
}

/** Perkiraan isi slot-slot terbuka, berurutan menurut jam tayang (meniru urutan penulis). */
function project(
  open: SlotRow[],
  configs: Map<string, ConfigRow>,
  ideas: Map<string, IdeaCandidate[]>,
  knowledge: Map<string, AccountKnowledge>,
  affiliate: AffiliateState
): Map<string, Projection> {
  const out = new Map<string, Projection>();
  const pool = new Map([...ideas].map(([k, v]) => [k, [...v]]));
  const topicsByDay = new Map<string, TopicUse[]>();
  for (const s of open) {
    const config = configs.get(s.accountId);
    if (!config) continue;
    const kb = knowledge.get(s.accountId) ?? EMPTY_KNOWLEDGE;
    const topicsToday = topicsByDay.get(s.dayKey) ?? [];
    topicsByDay.set(s.dayKey, topicsToday);
    const slot: ClaimedSlot = {
      id: s.id,
      workspaceId: config.workspaceId,
      accountId: s.accountId,
      dayKey: s.dayKey,
      slotIndex: s.slotIndex,
      slotAt: new Date(s.slotAt),
      hour: s.hour,
      kind: s.kind,
      reason: s.reason,
      // Saat diklaim penulis, percobaan bertambah satu.
      attempt: s.attempt + 1,
      ideaId: null,
      mode: config.mode,
      prevText: null,
    };
    const brief = planSlotBrief(slot, config, kb, { ideas: pool, topicsToday, affiliate });
    if (brief.promo) {
      const promo = pickPromo(config.promoRatio, kb.promos, s.id);
      out.set(s.id, { kind: "PROMO", topik: promo ? `Soft-selling promo: ${promo.judul}` : "Soft-selling promo berjalan", idea: null, pillar: brief.pillar });
    } else if (brief.affiliate) {
      rememberAffiliate(affiliate, slot, config.workspaceId, brief.affiliate.product.id);
      out.set(s.id, { kind: "AFFILIATE", topik: `Rekomendasi natural: ${brief.affiliate.product.nama}`, idea: null, pillar: brief.pillar });
    } else if (brief.idea) {
      const used = brief.idea;
      pool.set(s.accountId, (pool.get(s.accountId) ?? []).filter((c) => c.id !== used.id));
      topicsToday.push({ aid: s.accountId, topicKey: used.topicKey });
      out.set(s.id, { kind: "IDE", topik: used.topik, idea: used, pillar: brief.pillar });
    } else {
      out.set(s.id, { kind: "BEBAS", topik: null, idea: null, pillar: brief.pillar });
    }
  }
  return out;
}

export async function getPlanView(
  ctx: RequestCtx,
  opts: { day: "today" | "tomorrow"; accountId: string | null },
  now = new Date()
): Promise<PlanViewResponse | Failure> {
  const today = wibDayKey(now);
  const tomorrow = wibDayKey(new Date(now.getTime() + DAY_MS));
  const dayKey = opts.day === "tomorrow" ? tomorrow : today;

  const [accounts, state] = await Promise.all([visibleAccounts(ctx), loadState(ctx.workspaceId, today, tomorrow)]);
  const visible = new Set(accounts.map((a) => a.id));
  if (opts.accountId && !visible.has(opts.accountId)) return { ok: false, status: 404, error: "Akun Threads tidak ditemukan." };
  const inScope = (aid: string) => visible.has(aid) && (!opts.accountId || aid === opts.accountId);

  const slots = state.slots
    .filter((s) => inScope(s.accountId) && s.dayKey <= dayKey)
    .sort((a, b) => a.slotAt.localeCompare(b.slotAt) || a.id.localeCompare(b.id));
  const target = slots.filter((s) => s.dayKey === dayKey);
  if (target.length === 0) return { success: true, dayKey, items: [] };

  // Slot yang belum ditulis dan masih akan datang; slot hari ini ikut dihitung saat melihat besok.
  const open = slots.filter((s) => (s.status === "DIRENCANAKAN" || s.status === "MENULIS") && Date.parse(s.slotAt) > now.getTime());
  const openIds = new Set(open.map((s) => s.id));
  const projIds = [...new Set(open.map((s) => s.accountId))];
  const projConfigs = projIds.map((id) => state.configs.get(id)).filter((c): c is ConfigRow => !!c);
  const perAccount = Math.max(0, ...projIds.map((id) => open.filter((s) => s.accountId === id).length)) + SPARE_IDEAS;
  const targetAccounts = [...new Set(target.map((s) => s.accountId))];

  // Tambahan (bank ide, knowledge base, affiliate) boleh gagal: rencana tetap tampil tanpa perkiraan itu.
  const [drafts, ideas, knowledge, affiliate] = await Promise.all([
    target.some((s) => !openIds.has(s.id))
      ? planDrafts(ctx.workspaceId, dayKey, targetAccounts).then((rows) => new Map(rows.map((d) => [d.id, d])))
      : new Map<string, PlanDraftRow>(),
    projIds.length ? ideaCandidates(projIds, now, perAccount).catch(() => new Map<string, IdeaCandidate[]>()) : new Map<string, IdeaCandidate[]>(),
    projConfigs.length ? loadKnowledge(projConfigs, now).catch(() => new Map<string, AccountKnowledge>()) : new Map<string, AccountKnowledge>(),
    projIds.length ? loadAffiliateState(projIds, today).catch(() => emptyAffiliateState()) : emptyAffiliateState(),
  ]);

  const projection = project(open, state.configs, ideas, knowledge, affiliate);

  // Rincian ide (alasan, potensi viral, rujukan tren) untuk slot hari yang diminta saja.
  const ideaIds = target
    .map((s) => (openIds.has(s.id) ? projection.get(s.id)?.idea?.id : drafts.get(s.id)?.ideaId))
    .filter((id): id is string => !!id);
  const [details, knownSignals] = await Promise.all([
    ideaDetails(ideaIds, ctx.workspaceId).catch(() => new Map<string, IdeaDetail>()),
    signalBriefs(target.flatMap((s) => projection.get(s.id)?.idea?.signalIds ?? [])).catch(() => new Map<string, SignalBrief>()),
  ]);
  const missing = [...details.values()].flatMap((d) => d.signalIds).filter((id) => !knownSignals.has(id));
  const signals = missing.length
    ? new Map([...knownSignals, ...(await signalBriefs(missing).catch(() => new Map<string, SignalBrief>()))])
    : knownSignals;

  const items = target.map((s): PlanItemDTO => {
    const proj = openIds.has(s.id) ? projection.get(s.id) : undefined;
    const draft = proj ? undefined : drafts.get(s.id);
    const ideaId = proj ? proj.idea?.id : draft?.ideaId;
    const detail = ideaId ? details.get(ideaId) : undefined;
    const base = {
      slotId: s.id,
      sudut: detail?.sudut ?? null,
      hook: hookLabel(detail?.formulaHook) ?? null,
      score: pct(detail?.score),
      viral: pct(detail?.viral),
      alasan: detail?.alasan ?? null,
      signals: toSignals(detail?.signalIds ?? proj?.idea?.signalIds ?? [], signals),
    };
    if (proj) {
      return { ...base, kind: proj.kind, tentative: true, topik: proj.topik, text: null, pilar: detail?.pilar ?? proj.pillar };
    }
    if (draft?.text) {
      const topik = draft.topik ?? (draft.affiliate ? `Rekomendasi natural: ${draft.affiliate}` : draft.promo ? "Soft-selling promo" : null);
      return { ...base, kind: "DRAF", tentative: false, topik, text: draft.text, pilar: draft.pillar ?? detail?.pilar ?? null };
    }
    // Slot lewat tanpa draf (dilewati sebelum ditulis): tidak ada isi.
    return { ...base, kind: "BEBAS", tentative: false, topik: null, text: null, pilar: null };
  });

  return { success: true, dayKey, items };
}
