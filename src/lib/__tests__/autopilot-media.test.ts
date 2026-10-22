/**
 * Gambar ide ikut ke postingan autopilot (autopilot-writer.ts): gambar menempel pada ide, baik draf memakai
 * teks preview maupun teks tulisan AI; dibuang bila teks + kredit melebihi batas Threads; tetap ikut saat
 * draf mode tinjau disetujui. Batas sistem (antrean, slot, ide, AI) di-mock.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PostMedia } from "../post-media";

const h = vi.hoisted(() => ({
  create: vi.fn(),
  updateSlot: vi.fn(),
  getSlot: vi.fn(),
  agent: vi.fn(),
}));

vi.mock("../threads-publish", async (orig) => ({ ...(await orig<typeof import("../threads-publish")>()), createPosts: h.create }));
vi.mock("../autopilot-store", async (orig) => ({
  ...(await orig<typeof import("../autopilot-store")>()),
  updateSlot: h.updateSlot,
  getSlot: h.getSlot,
}));
vi.mock("../radar-store", async (orig) => ({ ...(await orig<typeof import("../radar-store")>()), updateIdea: vi.fn(async () => true) }));
vi.mock("../content-ai", async (orig) => ({ ...(await orig<typeof import("../content-ai")>()), runAccountAgent: h.agent }));
vi.mock("../account-memory", () => ({ learnFromEdit: vi.fn(async () => undefined) }));

import { approveSlot, enqueueSlot, mediaForDraft, writeSlot, type WriteContext } from "../autopilot-writer";
import type { ClaimedSlot, ConfigRow } from "../autopilot-store";
import { DEFAULT_SETTINGS, type SlotDraftDTO } from "../autopilot-types";
import type { SharedContext } from "../content-ai";
import type { PublishAccount } from "../publish-accounts";
import type { IdeaCandidate } from "../radar-store";

const media: PostMedia = {
  type: "IMAGE",
  items: [
    {
      sourceUrl: "https://cdn.kompas.com/foto/x.jpg",
      credit: "kompas.com",
      sourceKind: "NEWS",
      articleUrl: "https://kompas.com/artikel",
      articleTitle: "Artikel",
      imageKey: "kx",
      width: 1080,
      height: 720,
    },
  ],
};

const SHORT = "Pagi ini aku nyoba bikin sambal matah sendiri dan ternyata gampang banget, kalian lebih suka pedas atau sedang?";
// 496 karakter: muat sendirian, tetapi tidak muat bila ditambah baris kredit.
const LONG = (SHORT + " ").repeat(5).slice(0, 496).trim();

const idea = (text: string): IdeaCandidate => ({
  id: "i1",
  accountId: "a1",
  topik: "sambal matah rumahan",
  topicKey: "sambal matah rumahan",
  sudut: "resep rumahan",
  formulaHook: null,
  pilar: null,
  signalIds: [],
  score: 0.8,
  pinned: false,
  preview: { text, topicTag: "Kuliner", model: "llm-uji", at: "2026-10-13T03:00:00.000Z", media },
});

const slot = (over: Partial<ClaimedSlot> = {}): ClaimedSlot => ({
  id: "slot1",
  workspaceId: "ws1",
  accountId: "a1",
  dayKey: "2026-10-13",
  slotIndex: 0,
  slotAt: new Date(Date.now() + 3 * 3600_000),
  hour: 14,
  kind: "RAMAI",
  reason: null,
  attempt: 1,
  ideaId: null,
  mode: "OTOMATIS",
  prevText: null,
  ...over,
});

const account = { id: "a1", username: "akun1", displayName: "Akun 1", ready: true } as unknown as PublishAccount;

const context = (ideaText: string): WriteContext => ({
  shared: { facts: new Map(), queues: new Map() } as unknown as SharedContext,
  accounts: new Map([["a1", account]]),
  configs: new Map([["a1", { ...DEFAULT_SETTINGS, mode: "OTOMATIS", accountId: "a1", workspaceId: "ws1" } as unknown as ConfigRow]]),
  peers: new Map(),
  bannedTerms: [],
  workspaceBanned: new Map(),
  knowledge: new Map(),
  ideas: new Map([["a1", [idea(ideaText)]]]),
  topicsToday: [],
  critic: false,
  proven: new Map(),
  deadline: Date.now() + 60_000,
  seed: 1,
  order: new Map(),
  onAi: () => undefined,
});

const queuedItem = () => h.create.mock.calls[0][0].items[0] as { text: string; media?: PostMedia | null };
const savedDraft = (): SlotDraftDTO => h.updateSlot.mock.calls.find((c) => c[1].patch?.draft)?.[1].patch.draft;

beforeEach(() => {
  h.create.mockReset().mockResolvedValue({ ok: true, posts: [{ postId: "p1", tayangPada: "2026-10-13T07:00:00.000Z" }], skipped: [] });
  h.updateSlot.mockReset().mockResolvedValue(true);
  h.getSlot.mockReset();
  h.agent.mockReset();
});

describe("gambar ide ke antrean autopilot", () => {
  it("mediaForDraft: hanya media sah yang muat bersama kredit", () => {
    expect(mediaForDraft(media, SHORT)).toEqual(media);
    expect(mediaForDraft(media, LONG)).toBeNull();
    expect(mediaForDraft({ type: "IMAGE", items: [] }, SHORT)).toBeNull();
    expect(mediaForDraft(null, SHORT)).toBeNull();
  });

  it("draf dari teks preview membawa gambar ide sampai createPosts", async () => {
    const out = await writeSlot(slot(), context(SHORT));
    expect(out).toEqual({ kind: "diantre" });
    expect(h.agent).not.toHaveBeenCalled();
    expect(queuedItem()).toMatchObject({ text: SHORT, media });
    expect(savedDraft().media).toEqual(media);
  });

  it("teks tulisan ulang AI tetap memakai gambar ide", async () => {
    const aiText = "Sambal matah itu soal bawang yang diiris tipis dan minyak panas, kalian biasanya pakai terasi atau tidak?";
    h.agent.mockResolvedValue({
      ok: true,
      rounds: 1,
      draft: { text: aiText, topicTag: null, angle: "x", rationale: "y", model: "llm-uji", chars: aiText.length },
    });
    // Preview sama dengan teks yang diminta dihindari: AI menulis teks baru.
    const out = await writeSlot(slot({ prevText: SHORT }), context(SHORT));
    expect(out).toEqual({ kind: "diantre" });
    expect(h.agent).toHaveBeenCalled();
    expect(queuedItem()).toMatchObject({ text: aiText, media });
  });

  it("gambar dibuang bila teks + kredit melebihi batas Threads", async () => {
    const out = await writeSlot(slot(), context(LONG));
    expect(out).toEqual({ kind: "diantre" });
    expect(queuedItem().text).toBe(LONG);
    expect(queuedItem().media).toBeUndefined();
    expect(savedDraft().media).toBeUndefined();
  });

  it("mode tinjau menyimpan gambar di draf yang ditinjau", async () => {
    const out = await writeSlot(slot({ mode: "TINJAU", slotAt: new Date(Date.now() + 5 * 3600_000) }), context(SHORT));
    expect(out).toEqual({ kind: "tinjau" });
    expect(h.create).not.toHaveBeenCalled();
    expect(savedDraft().media).toEqual(media);
  });
});

describe("persetujuan draf mode tinjau", () => {
  const reviewDraft: SlotDraftDTO = {
    text: SHORT,
    topicTag: null,
    angle: "x",
    rationale: "y",
    model: "llm-uji",
    chars: SHORT.length,
    checks: [],
    media,
  };
  const reviewSlot = () => ({
    id: "slot1",
    workspaceId: "ws1",
    accountId: "a1",
    status: "MENUNGGU_TINJAU",
    slotAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
    draft: reviewDraft,
  });

  it("gambar ikut saat disetujui", async () => {
    h.getSlot.mockResolvedValue(reviewSlot());
    expect(await approveSlot({ slotId: "slot1", workspaceId: "ws1", userId: "u1" })).toEqual({ ok: true, postId: "p1" });
    expect(queuedItem()).toMatchObject({ text: SHORT, media });
    expect(savedDraft().media).toEqual(media);
  });

  it("suntingan yang membuat teks + kredit terlalu panjang: terbit tanpa gambar", async () => {
    h.getSlot.mockResolvedValue(reviewSlot());
    expect(await approveSlot({ slotId: "slot1", workspaceId: "ws1", userId: "u1", text: LONG })).toEqual({ ok: true, postId: "p1" });
    expect(queuedItem().media).toBeUndefined();
    expect(savedDraft().media).toBeUndefined();
  });

  it("enqueueSlot tanpa media tetap mengirim item teks seperti sebelumnya", async () => {
    await enqueueSlot({ id: "s9", accountId: "a1", slotAt: new Date(Date.now() + 3600_000) }, { text: SHORT, topicTag: null, model: "m" }, "u1");
    expect("media" in queuedItem()).toBe(false);
  });
});
