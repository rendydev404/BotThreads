import { afterEach, describe, expect, it, vi } from "vitest";

const llm = vi.hoisted(() => ({ calls: [] as { system: string; prompt: string; googleSearch?: boolean }[], replies: [] as unknown[] }));
vi.mock("../gemini", async (original) => ({
  ...(await original<typeof import("../gemini")>()),
  generateWithFailover: vi.fn(async (opts: { system: string; googleSearch?: boolean; contents: { parts: { text: string }[] }[] }) => {
    llm.calls.push({ system: opts.system, prompt: opts.contents[0].parts[0].text, googleSearch: opts.googleSearch });
    const json = llm.replies.shift();
    return json === null || json === undefined ? null : { text: JSON.stringify(json), json, model: "llm-uji" };
  }),
}));

import { nicheJobs, planNiche } from "../autopilot-research";
import type { AutopilotState, ConfigRow } from "../autopilot-store";
import { DEFAULT_SETTINGS } from "../autopilot-types";
import { mergeNews, newsSearchUrl, parseNewsRss, type NewsItem } from "../news-search";
import {
  buildNewsPrompt,
  buildNichePrompt,
  newsTopics,
  nicheKey,
  nicheProfile,
  nicheTopicsToSignals,
  nicheTrendScore,
  researchNiche,
} from "../niche-trends";
import type { PublishAccount } from "../publish-accounts";
import type { RadarState } from "../radar-store";

const NOW = new Date("2026-10-19T03:00:00Z"); // Senin 10.00 WIB

const POSTS = [
  "Gue baru nyoba agen coding buat refactor, hasilnya bikin ngakak",
  "Prompt yang panjang belum tentu bikin jawaban AI makin akurat",
  "Developer junior sekarang belajar dari AI duluan, bukan dari dokumentasi",
];

const config = (over: Partial<ConfigRow> = {}): ConfigRow => ({
  ...DEFAULT_SETTINGS,
  accountId: "a1",
  workspaceId: "ws1",
  pausedReason: null,
  pausedAt: null,
  updatedAt: null,
  ...over,
});

const topic = (over: Record<string, unknown> = {}) => ({
  judul: "Rilis agen coding baru dari OpenAI",
  ringkasan: "OpenAI merilis agen coding yang bisa mengerjakan tugas panjang, diumumkan kemarin.",
  alasan: "Developer ramai membandingkan dengan alat yang mereka pakai sekarang.",
  panas: 5,
  url: "https://www.theverge.com/ai/agen",
  ...over,
});

describe("profil niche", () => {
  it("tema dan pilar jadi acuan utama; contoh postingan dibatasi", () => {
    const p = nicheProfile(config({ brief: "  berita AI <b>terbaru</b> dan prompting ", pillars: [{ key: "Prompting", bobot: 50 }] }), [...POSTS, ...POSTS]);
    expect(p).toEqual({ brief: "berita AI terbaru dan prompting", pillars: ["Prompting"], samples: [...POSTS, POSTS[0]] });
  });

  it("tema kosong: niche disimpulkan dari postingan, butuh minimal tiga postingan", () => {
    expect(nicheProfile(config(), POSTS)?.samples).toEqual(POSTS);
    expect(nicheProfile(config(), POSTS.slice(0, 2))).toBeNull();
    expect(nicheProfile(config(), ["pendek", "ok", "hm"])).toBeNull();
  });

  it("akun dengan tema dan pilar sama berbagi kunci; tanpa tema tidak berbagi", () => {
    const a = nicheProfile(config({ brief: "Kuliner Cabang", pillars: [{ key: "Menu", bobot: 1 }, { key: "Promo", bobot: 1 }] }), [])!;
    const b = nicheProfile(config({ brief: "kuliner cabang", pillars: [{ key: "promo", bobot: 9 }, { key: "menu", bobot: 9 }] }), POSTS)!;
    const c = nicheProfile(config({ brief: "kuliner pusat" }), [])!;
    expect(nicheKey(a)).toBe(nicheKey(b));
    expect(nicheKey(a)).not.toBe(nicheKey(c));
    expect(nicheKey(nicheProfile(config(), POSTS)!)).toBeNull();
  });

  it("prompt riset memuat tanggal, tema, dan contoh postingan sebagai data", () => {
    const prompt = buildNichePrompt(nicheProfile(config(), POSTS)!, NOW);
    expect(prompt).toContain("Hari ini Senin, 19 Oktober 2026 (WIB).");
    expect(prompt).toContain("Tema dari pemilik akun: (tidak diisi, simpulkan dari contoh postingan)");
    expect(prompt).toContain(`Contoh postingan terakhir (acuan niche):\n- ${POSTS[0]}`);
  });
});

describe("tren niche jadi sinyal", () => {
  const target = { accountId: "a1", workspaceId: "ws1" };

  it("milik akun dan workspace, berumur 48 jam, URL hanya dari sumber grounding", () => {
    const [s] = nicheTopicsToSignals({ niche: "teknologi AI untuk developer", topics: [topic()], domains: ["theverge.com"] }, target, NOW);
    expect(s).toMatchObject({
      source: "NICHE",
      accountId: "a1",
      workspaceId: "ws1",
      title: "Rilis agen coding baru dari OpenAI",
      url: "https://www.theverge.com/ai/agen",
      rank: 1,
      score: 0.95,
      hash: "NICHE:a1:2026-10-19:rilis agen coding baru dari openai",
      summary:
        "OpenAI merilis agen coding yang bisa mengerjakan tugas panjang, diumumkan kemarin. Kenapa naik: Developer ramai membandingkan dengan alat yang mereka pakai sekarang.",
      raw: { niche: "teknologi AI untuk developer", panas: 5 },
    });
    expect(Date.parse(s.expiresAt) - NOW.getTime()).toBe(48 * 60 * 60 * 1000);
    const [untrusted] = nicheTopicsToSignals({ niche: "", topics: [topic()], domains: ["detik.com"] }, target, NOW);
    expect(untrusted.url).toBeNull();
  });

  it("menyaring topik sensitif, larangan akun, kembar, dan terlalu pendek", () => {
    const signals = nicheTopicsToSignals(
      {
        niche: "AI",
        topics: [
          topic(),
          topic({ judul: "rilis AGEN coding baru dari OpenAI!" }),
          topic({ judul: "Menteri bahas regulasi AI", ringkasan: "Pejabat membahas aturan AI di rapat hari ini." }),
          topic({ judul: "Kompetitor X rilis fitur", ringkasan: "Kompetitor X merilis fitur baru minggu ini." }),
          topic({ judul: "ok", ringkasan: "pendek" }),
          topic({ judul: "Debat prompt panjang vs pendek", panas: 1 }),
        ],
        domains: [],
      },
      target,
      NOW,
      ["kompetitor x"]
    );
    expect(signals.map((s) => s.title)).toEqual(["Rilis agen coding baru dari OpenAI", "Debat prompt panjang vs pendek"]);
    expect(signals[1]).toMatchObject({ rank: 2, score: nicheTrendScore(1) });
  });

  it("skor naik menurut keramaian dan selalu di bawah 1", () => {
    expect(nicheTrendScore(1)).toBeLessThan(nicheTrendScore(3));
    expect(nicheTrendScore(9)).toBe(0.95);
  });
});

describe("jadwal riset niche", () => {
  it("akun bertema sama berbagi satu riset; akun tanpa bahan dilewati; dibatasi per tick", () => {
    const shared = { brief: "kuliner cabang", pillars: [] };
    const due = [
      config({ accountId: "a1", ...shared }),
      config({ accountId: "a2", ...shared }),
      config({ accountId: "a3" }),
      config({ accountId: "a4" }),
      config({ accountId: "a5", brief: "parenting" }),
    ];
    const recents = new Map([["a3", POSTS]]);
    const { jobs, skipped } = nicheJobs(due, recents, 2);
    expect(jobs.map((j) => j.targets.map((t) => t.accountId))).toEqual([["a1", "a2"], ["a3"]]);
    expect(skipped.map((c) => c.accountId)).toEqual(["a4"]);
  });

  it("akun yang trennya basi diriset, yang idenya hampir habis dulu; tanpa sql/027 atau di luar jam aktif tidak ada", () => {
    process.env.GEMINI_API_KEY = "uji";
    const configs = ["a1", "a2", "a3", "a4"].map((id) => config({ accountId: id, mode: "OTOMATIS" }));
    const state = { configs: new Map(configs.map((c) => [c.accountId, c])), workspaceActive: new Map() } as unknown as AutopilotState;
    const accounts = new Map(configs.map((c) => [c.accountId, { ready: c.accountId !== "a4" } as PublishAccount]));
    const radar: RadarState = {
      lastCapture: {},
      // a1 punya 5 ide, a2 dan a3 hampir habis.
      ideaCounts: new Map([["a1", 5], ["a2", 1], ["a3", 0]]),
      nicheAt: new Map([
        ["a1", new Date(NOW.getTime() - 9 * 3600_000)],
        ["a2", new Date(NOW.getTime() - 2 * 3600_000)],
      ]),
    };
    // a2 baru diriset 2 jam lalu; a4 belum siap.
    expect(planNiche(state, accounts, radar, NOW).due.map((c) => c.accountId)).toEqual(["a3", "a1"]);
    expect(planNiche(state, accounts, { ...radar, nicheAt: null }, NOW)).toEqual({ installed: false, due: [] });
    expect(planNiche(state, accounts, radar, new Date("2026-10-19T16:00:00Z")).due).toEqual([]); // 23.00 WIB
  });
});

const rssItem = (title: string, source: string, pubDate: string, link = "https://news.google.com/rss/articles/abc?oc=5") =>
  `<item><title>${title} - ${source}</title><link>${link}</link><pubDate>${pubDate}</pubDate><source url="https://${source}">${source}</source></item>`;

const RSS = `<rss><channel>
${rssItem("Website hasil vibe coding dibobol 6 hari setelah rilis", "detik.com", "Mon, 19 Oct 2026 01:00:00 GMT")}
${rssItem("Google rilis situs pendeteksi gambar AI SynthID", "kompas.com", "Sun, 18 Oct 2026 10:00:00 GMT", `https://news.google.com/rss/articles/${"x".repeat(600)}`)}
${rssItem("Berita lama soal chatbot pertama", "tempo.co", "Mon, 12 Oct 2026 10:00:00 GMT")}
<item><title>tanpa tanggal yang jelas sama sekali</title></item>
</channel></rss>`;

describe("cadangan Google News", () => {
  afterEach(() => {
    llm.calls.length = 0;
    llm.replies.length = 0;
    vi.unstubAllGlobals();
  });

  it("URL pencarian lokal dan global untuk berita 3 hari terakhir", () => {
    expect(newsSearchUrl("agen coding", false)).toBe("https://news.google.com/rss/search?q=agen%20coding%20when%3A3d&hl=id&gl=ID&ceid=ID:id");
    expect(newsSearchUrl("AI agents", true)).toContain("&hl=en-US&gl=US&ceid=US:en");
  });

  it("mengurai berita yang masih hangat, membuang nama media di judul dan tautan yang terlalu panjang", () => {
    const items = parseNewsRss(RSS, NOW);
    expect(items.map((i) => i.title)).toEqual([
      "Website hasil vibe coding dibobol 6 hari setelah rilis",
      "Google rilis situs pendeteksi gambar AI SynthID",
    ]);
    expect(items[0]).toMatchObject({ source: "detik.com", link: "https://news.google.com/rss/articles/abc?oc=5" });
    // Tautan terpotong pasti rusak: dibuang, bukan dipotong.
    expect(items[1].link).toBeNull();
  });

  it("menggabungkan hasil beberapa pencarian tanpa judul kembar, paling baru dulu", () => {
    const item = (title: string, hoursAgo: number): NewsItem => ({ title, source: null, link: null, publishedAt: NOW.getTime() - hoursAgo * 3600_000 });
    const merged = mergeNews([[item("Rilis agen coding", 5), item("Debat prompt", 1)], [item("rilis AGEN coding!", 2), item("Lagu AI diberi label", 3)]]);
    // Judul kembar: yang paling baru yang disimpan.
    expect(merged.map((m) => m.title)).toEqual(["Debat prompt", "rilis AGEN coding!", "Lagu AI diberi label"]);
  });

  it("prompt memuat profil dan berita bernomor beserta umurnya", () => {
    const news = parseNewsRss(RSS, NOW);
    const prompt = buildNewsPrompt(nicheProfile(config({ brief: "teknologi AI" }), [])!, news, NOW);
    expect(prompt).toContain("Tema dari pemilik akun: teknologi AI");
    expect(prompt).toContain("[1] Website hasil vibe coding dibobol 6 hari setelah rilis (detik.com, 2 jam lalu)");
    expect(prompt).toContain("[2] Google rilis situs pendeteksi gambar AI SynthID (kompas.com, 17 jam lalu)");
  });

  it("tren tanpa berita rujukan dibuang; tautan diambil dari berita yang dirujuk", () => {
    const news = parseNewsRss(RSS, NOW);
    const research = newsTopics(
      {
        niche: "AI",
        topics: [
          { judul: "Vibe coding dibobol", ringkasan: "r", alasan: "a", panas: 5, berita: [1, 9] },
          { judul: "Karangan tanpa sumber", ringkasan: "r", alasan: "a", panas: 5, berita: [] },
          { judul: "SynthID", ringkasan: "r", alasan: "a", panas: 3, berita: [2] },
        ],
      },
      news
    );
    expect(research.topics.map((t) => [t.judul, t.url])).toEqual([
      ["Vibe coding dibobol", "https://news.google.com/rss/articles/abc?oc=5"],
      ["SynthID", undefined],
    ]);
    expect(research.domains).toEqual(["news.google.com"]);
  });

  it("pencarian Google tidak tersedia: kata kunci niche -> Google News -> AI memilih tren", async () => {
    process.env.GEMINI_API_KEY = "uji";
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetched.push(String(url));
        return new Response(RSS, { status: 200 });
      })
    );
    llm.replies.push(
      null, // Google Search: kuota habis
      { niche: "AI untuk developer", lokal: ["vibe coding", "AI terbaru"], global: ["AI coding agent"] },
      { niche: "AI untuk developer", topics: [{ judul: "Vibe coding dibobol", ringkasan: "Situs vibe coding dibobol.", alasan: "Developer peduli keamanan.", panas: 5, berita: [1] }] }
    );
    const research = await researchNiche(nicheProfile(config({ brief: "teknologi AI untuk developer" }), [])!, NOW, 60_000);
    expect(llm.calls.map((c) => [c.system.slice(0, 30), !!c.googleSearch])).toEqual([
      ["Anda peneliti tren untuk SATU ", true],
      ["Anda menyusun kata kunci penca", false],
      ["Anda analis tren untuk SATU ni", false],
    ]);
    expect(fetched).toHaveLength(3);
    expect(fetched[2]).toContain("hl=en-US");
    // Berita kembar dari tiga pencarian digabung sebelum masuk prompt.
    expect(llm.calls[2].prompt.match(/vibe coding dibobol/gi)).toHaveLength(1);
    const [signal] = nicheTopicsToSignals(research!, { accountId: "a1", workspaceId: "ws1" }, NOW);
    expect(signal).toMatchObject({ title: "Vibe coding dibobol", url: "https://news.google.com/rss/articles/abc?oc=5", raw: { niche: "AI untuk developer" } });
  });
});
