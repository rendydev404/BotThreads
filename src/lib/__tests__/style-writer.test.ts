/**
 * Otak gaya Threads di sisi penulis: contoh gaya korpus + pola layout dimuat sekali per akun, izin daftar polos
 * mengikuti profil/contoh/ide, kandidat yang menjiplak contoh ditolak lalu ditulis ulang (agen, edit dengan AI,
 * dan gerbang autopilot). Yang di-mock: korpus gaya, AI (Gemini), RPC konteks, antrean, dan penyimpanan slot.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  exemplars: vi.fn(),
  profile: vi.fn(),
  gen: vi.fn(),
  rpc: vi.fn(),
  create: vi.fn(),
  updateSlot: vi.fn(),
}));

vi.mock("../style-corpus", async (orig) => ({
  ...(await orig<typeof import("../style-corpus")>()),
  styleExemplars: h.exemplars,
  layoutProfile: h.profile,
}));
vi.mock("../gemini", async (orig) => ({ ...(await orig<typeof import("../gemini")>()), generateWithFailover: h.gen }));
vi.mock("@/lib/supabase", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase")>()),
  rpc: h.rpc,
  excludedIdList: vi.fn(async () => null),
}));
vi.mock("../best-hours", async (orig) => ({
  ...(await orig<typeof import("../best-hours")>()),
  bestHoursForAccounts: vi.fn(async () => new Map()),
}));
vi.mock("../threads-publish", async (orig) => ({
  ...(await orig<typeof import("../threads-publish")>()),
  fetchSchedule: vi.fn(async () => []),
  createPosts: h.create,
}));
vi.mock("../account-facts", () => ({ getAccountFacts: vi.fn(async () => new Map()) }));
vi.mock("../account-brain", async (orig) => ({
  ...(await orig<typeof import("../account-brain")>()),
  loadBrains: vi.fn(async () => new Map()),
}));
vi.mock("../autopilot-store", async (orig) => ({ ...(await orig<typeof import("../autopilot-store")>()), updateSlot: h.updateSlot }));
vi.mock("../radar-store", async (orig) => ({ ...(await orig<typeof import("../radar-store")>()), updateIdea: vi.fn(async () => true) }));
vi.mock("../account-memory", async (orig) => ({ ...(await orig<typeof import("../account-memory")>()), learnFromEdit: vi.fn() }));

import { editCandidates, loadStyleContext, runAccountAgent, type SharedContext } from "../content-ai";
import { writeSlot, type WriteContext } from "../autopilot-writer";
import type { ClaimedSlot, ConfigRow } from "../autopilot-store";
import { DEFAULT_SETTINGS } from "../autopilot-types";
import type { PublishAccount } from "../publish-accounts";
import type { IdeaCandidate } from "../radar-store";
import { layoutFeatures, type LayoutProfile, type StyleExemplar } from "../style-types";

const ex = (text: string, format: StyleExemplar["format"] = "CERITA"): StyleExemplar => ({
  id: `e-${text.length}`,
  text,
  format,
  features: layoutFeatures(text),
  score: 1,
  source: "WORKSPACE",
  handle: "tetangga",
});

const EXEMPLAR = "tadi pagi nyoba resign dari grup wa keluarga\n\nbaru 5 menit\nudah ditelpon mama sama tante";
const COPY = "baru 5 menit udah ditelpon mama sama tante, padahal cuma mau keluar grup alumni";
const FRESH = "keluar grup alumni itu butuh mental baja\n\nnotif pertama: siapa yang left?\nnotif kedua: japri dari ketua angkatan";

const profile = (over: Partial<LayoutProfile> = {}): LayoutProfile => ({
  sample: 30,
  medianChars: 160,
  medianLines: 4,
  listShare: 0.05,
  lowercaseShare: 0.7,
  questionShare: 0.2,
  emojiShare: 0.1,
  topFormats: [
    { format: "CERITA", share: 0.5, avgScore: 0.9 },
    { format: "OPINI", share: 0.3, avgScore: 0.6 },
  ],
  ...over,
});

const reply = (...texts: string[]) => ({
  model: "llm-uji",
  json: { drafts: texts.map((text) => ({ text, angle: "cerita", rationale: "", suggestedHourWib: 19, inspiredBy: 1 })) },
});

const promptOf = (call: number): string => h.gen.mock.calls[call][0].contents[0].parts[0].text;
const systemOf = (call: number): string => h.gen.mock.calls[call][0].system;

const account = { id: "a1", username: "akun1", displayName: "Akun 1", outletNama: null, ready: true, tenantId: "ws1", workspaceId: "aw1" } as unknown as PublishAccount;

const shared = (): SharedContext => ({
  now: new Date(),
  contexts: new Map(),
  queues: new Map(),
  hours: new Map(),
  network: [],
  facts: new Map(),
});

beforeEach(() => {
  h.exemplars.mockReset().mockResolvedValue([ex(EXEMPLAR)]);
  h.profile.mockReset().mockResolvedValue(profile());
  h.gen.mockReset();
  h.rpc.mockReset().mockImplementation(async (fn: string) =>
    fn === "dash_ai_context" ? { style: [], weakest: [], recents: [], formats: [] } : []
  );
  h.create.mockReset().mockResolvedValue({ ok: true, posts: [{ postId: "p1", tayangPada: "2026-10-13T07:00:00.000Z" }], skipped: [] });
  h.updateSlot.mockReset().mockResolvedValue(true);
});

describe("loadStyleContext", () => {
  it("format pilihan diambil dari 2 format teratas profil; daftar tidak diizinkan tanpa alasan", async () => {
    const s = await loadStyleContext({ workspaceId: "ws1", accountId: "a1", topicHint: "grup keluarga" });
    expect(h.exemplars).toHaveBeenCalledWith({ workspaceId: "ws1", accountId: "a1", topicHint: "grup keluarga", preferFormats: ["CERITA", "OPINI"], limit: 5 });
    expect(s.allowLists).toBe(false);
    expect(s.exemplars).toHaveLength(1);
  });

  it("daftar diizinkan oleh profil (>= 15%), contoh TIPS_LIST, atau ide berbentuk daftar", async () => {
    h.profile.mockResolvedValue(profile({ listShare: 0.15 }));
    expect((await loadStyleContext({ workspaceId: "ws1", accountId: "a1" })).allowLists).toBe(true);
    h.profile.mockResolvedValue(profile());
    h.exemplars.mockResolvedValue([ex("biar hemat:\n1. masak\n2. bawa bekal", "TIPS_LIST")]);
    expect((await loadStyleContext({ workspaceId: "ws1", accountId: "a1" })).allowLists).toBe(true);
    h.exemplars.mockResolvedValue([]);
    expect((await loadStyleContext({ workspaceId: "ws1", accountId: "a1", listIdea: true })).allowLists).toBe(true);
  });

  it("tanpa workspace tidak menyentuh korpus; galat korpus = tanpa contoh", async () => {
    expect(await loadStyleContext({ workspaceId: null, accountId: "a1" })).toEqual({ exemplars: [], profile: null, allowLists: false });
    expect(h.exemplars).not.toHaveBeenCalled();
    h.exemplars.mockRejectedValue(new Error("db mati"));
    h.profile.mockRejectedValue(new Error("db mati"));
    expect(await loadStyleContext({ workspaceId: "ws1", accountId: "a1" })).toEqual({ exemplars: [], profile: null, allowLists: false });
  });
});

describe("runAccountAgent: anti-jiplak dan contoh gaya", () => {
  it("kandidat yang menjiplak contoh ditolak, putaran berikutnya diberi catatan dan menulis draf lain", async () => {
    h.gen.mockResolvedValueOnce(reply(COPY)).mockResolvedValueOnce(reply(FRESH));
    const sh = shared();
    const out = await runAccountAgent(sh, { account, brief: "keluar grup wa", angles: [], peers: [], avoid: null, fixedTime: { hour: 19, minute: 0 } });
    expect(out.ok && out.draft.text).toBe(FRESH);
    // Jeda baris draf AI tidak diratakan.
    expect(out.ok && out.draft.text.split("\n").length).toBe(4);
    expect(promptOf(0)).toContain(`CONTOH GAYA THREADS`);
    expect(promptOf(0)).toContain(`<<<\n${EXEMPLAR}\n>>>`);
    expect(promptOf(0)).not.toContain("CATATAN ANTI-JIPLAK");
    expect(promptOf(1)).toContain('Menyalin frasa "baru 5 menit udah ditelpon mama"');
    // Korpus dimuat sekali per akun (bukan per putaran), dari workspace dashboard akun.
    expect(h.exemplars).toHaveBeenCalledTimes(1);
    expect(h.exemplars.mock.calls[0][0].workspaceId).toBe("ws1");
    // Gaya akun tanpa daftar: aturan sistem tetap melarang daftar.
    expect(systemOf(0)).toContain("tanpa daftar atau markdown");
  });

  it("semua putaran menjiplak: gagal dengan alasan jelas", async () => {
    h.gen.mockResolvedValue(reply(COPY));
    const out = await runAccountAgent(shared(), { account, brief: "", angles: [], peers: [], avoid: null, fixedTime: { hour: 19, minute: 0 } });
    expect(out).toEqual({ ok: false, error: "Semua kandidat menyalin frasa dari contoh gaya." });
  });

  it("profil akun memakai daftar: aturan sistem mengizinkan daftar polos, markdown tetap dilarang", async () => {
    h.profile.mockResolvedValue(profile({ listShare: 0.3 }));
    h.gen.mockResolvedValue(reply("biar gak boncos akhir bulan\n1. catat jajan kopi\n2. matiin langganan yang lupa"));
    const out = await runAccountAgent(shared(), { account, brief: "", angles: [], peers: [], avoid: null, fixedTime: { hour: 19, minute: 0 } });
    expect(out.ok).toBe(true);
    expect(systemOf(0)).toContain("Daftar polos boleh");
    expect(systemOf(0)).toContain("tanpa markdown");
    expect(promptOf(0)).toContain("DAFTAR: boleh menulis daftar polos");
  });

  it("korpus kosong: prompt memakai blok CONTOH GAYA lama", async () => {
    h.exemplars.mockResolvedValue([]);
    h.gen.mockResolvedValue(reply(FRESH));
    const sh = shared();
    sh.contexts.set("a1", { style: [{ text: "kopi sachet itu penyelamat\njam 3 sore", views: 900 }, { text: "senin lagi", views: 500 }], weakest: [], recents: [], formats: [] });
    await runAccountAgent(sh, { account, brief: "", angles: [], peers: [], avoid: null, fixedTime: { hour: 19, minute: 0 } });
    expect(promptOf(0)).toContain("CONTOH GAYA (postingan akun ini dengan views tertinggi):");
    expect(promptOf(0)).not.toContain("CONTOH GAYA THREADS");
  });
});

describe("editCandidates (preview ide & edit dengan AI)", () => {
  it("ide baru memakai blok contoh gaya dari workspace yang diberikan dan membuang versi yang menjiplak", async () => {
    h.gen.mockResolvedValue(reply(COPY, FRESH));
    const res = await editCandidates({ account, text: "", action: "idea", idea: { topik: "keluar grup alumni", sudut: null }, workspaceId: "ws9" });
    expect(res.ok && res.result.candidates.map((c) => c.text)).toEqual([FRESH]);
    expect(res.ok && res.result.used.exemplars).toBe(1);
    expect(h.exemplars.mock.calls[0][0]).toMatchObject({ workspaceId: "ws9", topicHint: "keluar grup alumni" });
    expect(promptOf(0)).toContain(`<<<\n${EXEMPLAR}\n>>>`);
  });

  it("revisi teks berbentuk daftar: daftar tetap diizinkan dan tidak dihukum skor kealamian", async () => {
    const list = "3 hal yang bikin betah wfh\n1. gak macet\n2. makan siang masakan sendiri\n3. bisa rebahan pas istirahat";
    const revised = "3 hal yang bikin betah wfh\n1. gak kena macet\n2. makan siang masakan sendiri\n3. rebahan pas istirahat";
    h.gen.mockResolvedValue(reply(revised));
    const res = await editCandidates({ account, text: list, action: "casual" });
    expect(res.ok && res.result.candidates[0]).toMatchObject({ text: revised, humanScore: 100, tells: [] });
    expect(systemOf(0)).toContain("Daftar polos boleh");
  });
});

describe("writeSlot: gerbang anti-jiplak", () => {
  const idea: IdeaCandidate = {
    id: "i1",
    accountId: "a1",
    topik: "keluar grup alumni",
    topicKey: "keluar grup alumni",
    sudut: null,
    formulaHook: null,
    pilar: null,
    signalIds: [],
    score: 0.8,
    pinned: false,
    preview: { text: COPY, topicTag: null, model: "llm-uji", at: "2026-10-13T03:00:00.000Z", media: null },
  } as unknown as IdeaCandidate;

  const slot: ClaimedSlot = {
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
  } as unknown as ClaimedSlot;

  const context = (): WriteContext => ({
    shared: shared(),
    accounts: new Map([["a1", account]]),
    configs: new Map([["a1", { ...DEFAULT_SETTINGS, mode: "OTOMATIS", accountId: "a1", workspaceId: "ws1" } as unknown as ConfigRow]]),
    peers: new Map(),
    bannedTerms: [],
    workspaceBanned: new Map(),
    knowledge: new Map(),
    ideas: new Map([["a1", [idea]]]),
    topicsToday: [],
    critic: false,
    proven: new Map(),
    deadline: Date.now() + 60_000,
    seed: 1,
    order: new Map(),
    onAi: () => undefined,
  });

  it("preview yang menjiplak contoh ditolak gerbang, AI menulis ulang dengan catatan pemeriksa", async () => {
    h.gen.mockResolvedValue(reply(FRESH));
    const out = await writeSlot(slot, context());
    expect(out).toEqual({ kind: "diantre" });
    expect(h.create.mock.calls[0][0].items[0].text).toBe(FRESH);
    expect(promptOf(0)).toContain('Draf menyalin frasa dari contoh gaya: "baru 5 menit udah ditelpon mama"');
    // Satu kali muat korpus untuk slot ini: gerbang dan prompt memakai contoh yang sama.
    expect(h.exemplars).toHaveBeenCalledTimes(1);
    expect(h.exemplars.mock.calls[0][0]).toMatchObject({ workspaceId: "ws1", topicHint: "keluar grup alumni" });
    const saved = h.updateSlot.mock.calls.find((c) => c[1].patch?.draft)?.[1].patch.draft;
    expect(saved.checks.find((c: { key: string }) => c.key === "asli")?.ok).toBe(true);
  });
});
