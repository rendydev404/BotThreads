import { afterEach, describe, expect, it, vi } from "vitest";

const llm = vi.hoisted(() => ({ calls: [] as { system: string; prompt: string; googleSearch?: boolean }[], replies: [] as unknown[] }));
vi.mock("../gemini", async (original) => ({
  ...(await original<typeof import("../gemini")>()),
  generateWithFailover: vi.fn(async (opts: { system: string; googleSearch?: boolean; contents: { parts: { text: string }[] }[] }) => {
    llm.calls.push({ system: opts.system, prompt: opts.contents[0].parts[0].text, googleSearch: opts.googleSearch });
    const reply = llm.replies.shift();
    return reply === null || reply === undefined ? null : reply;
  }),
}));

import { groundedDomains } from "../gemini";
import { VIRAL_NEWS_QUERIES, buildViralNewsPrompt, captureWebTrends, trustedUrl, webTopicsToSignals, webTrendScore } from "../web-trends";

const NOW = new Date("2026-10-17T02:00:00Z"); // Sabtu 09.00 WIB

const topic = (over: Record<string, unknown> = {}) => ({
  judul: "Tren bubur diaduk vs tidak",
  ringkasan: "Warganet Threads ramai berdebat cara makan bubur ayam.",
  alasan: "Semua orang punya kubu dan gampang ikut berpendapat.",
  platform: "Threads",
  kategori: "kuliner",
  panas: 5,
  url: "https://www.detik.com/food/bubur",
  ...over,
});

describe("viral di medsos", () => {
  it("menyaring topik sensitif, kembar, dan terlalu pendek; skor naik bila ramai di Threads", () => {
    const signals = webTopicsToSignals(
      [
        topic(),
        topic({ judul: "tren  BUBUR diaduk vs tidak!" }),
        topic({ judul: "Demo besar di ibu kota", ringkasan: "Ribuan orang turun ke jalan hari ini." }),
        topic({ judul: "ok", ringkasan: "pendek" }),
        topic({ judul: "Istilah 'healing tipis-tipis'", platform: "TikTok", kategori: "ngawur", panas: 9, url: "https://palsu.example.com/x" }),
      ],
      ["detik.com"],
      NOW
    );
    expect(signals.map((s) => s.title)).toEqual(["Tren bubur diaduk vs tidak", "Istilah 'healing tipis-tipis'"]);
    expect(signals[0]).toMatchObject({
      source: "WEB",
      workspaceId: null,
      url: "https://www.detik.com/food/bubur",
      score: 0.97,
      hash: "WEB:2026-10-17:tren bubur diaduk vs tidak",
      summary: "Warganet Threads ramai berdebat cara makan bubur ayam. Kenapa ramai: Semua orang punya kubu dan gampang ikut berpendapat.",
    });
    // Kategori tak dikenal jadi "lainnya", panas dibatasi 5, URL di luar sumber grounding dibuang.
    expect(signals[1]).toMatchObject({ url: null, raw: { kategori: "lainnya", panas: 5, platform: "TikTok" } });
    expect(Date.parse(signals[0].expiresAt) - NOW.getTime()).toBe(36 * 3600_000);
  });

  it("skor dan URL tepercaya", () => {
    expect(webTrendScore(1, "X")).toBe(0.52);
    expect(webTrendScore(3, "Threads")).toBe(0.77);
    expect(trustedUrl("https://news.kompas.com/a", ["kompas.com"])).toBe("https://news.kompas.com/a");
    expect(trustedUrl("http://kompas.com/a", ["kompas.com"])).toBeNull();
    expect(trustedUrl("https://kompas.com.evil.io/a", ["kompas.com"])).toBeNull();
    expect(trustedUrl("bukan url", ["kompas.com"])).toBeNull();
  });

  it("groundedDomains membaca judul potongan grounding Gemini", () => {
    const data = {
      candidates: [
        { groundingMetadata: { groundingChunks: [{ web: { title: "www.Detik.com" } }, { web: { title: "Judul artikel" } }, {}] } },
      ],
    };
    expect(groundedDomains(data)).toEqual(["detik.com"]);
    expect(groundedDomains({})).toEqual([]);
  });
});

const item = (title: string, source: string, pubDate: string) =>
  `<item><title>${title} - ${source}</title><link>https://news.google.com/rss/articles/${source}?oc=5</link><pubDate>${pubDate}</pubDate><source url="https://${source}">${source}</source></item>`;

// Sabtu 17 Okt 2026 09.00 WIB = 02.00 UTC.
const RSS = `<rss><channel>
${item("Lagu Oncom Gondrong kembali viral di TikTok", "rri.co.id", "Sat, 17 Oct 2026 01:00:00 GMT")}
${item("Viral video pria ditangkap polisi usai mencuri sapi", "inews.id", "Sat, 17 Oct 2026 00:30:00 GMT")}
${item("Ramai tren downgrade lifestyle di media sosial", "hipwee.com", "Fri, 16 Oct 2026 20:00:00 GMT")}
${item("Berita viral tiga hari lalu yang sudah basi", "lama.com", "Wed, 14 Oct 2026 10:00:00 GMT")}
</channel></rss>`;

describe("viral di medsos tanpa kuota Google Search", () => {
  afterEach(() => {
    llm.calls.length = 0;
    llm.replies.length = 0;
    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
  });

  it("prompt memuat berita bernomor beserta media dan umurnya", () => {
    const prompt = buildViralNewsPrompt(
      [{ title: "Lagu Oncom Gondrong kembali viral di TikTok", source: "rri.co.id", link: null, publishedAt: NOW.getTime() - 3600_000 }],
      NOW
    );
    expect(prompt).toContain("Hari ini Sabtu, 17 Oktober 2026 (WIB).");
    expect(prompt).toContain("[1] Lagu Oncom Gondrong kembali viral di TikTok (rri.co.id, 1 jam lalu)");
  });

  it("grounding kena kuota: berita viral Google News, judul berita keras dibuang, AI memilih topik dengan rujukan", async () => {
    process.env.GEMINI_API_KEY = "uji";
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetched.push(String(url));
        return new Response(RSS, { status: 200 });
      })
    );
    const json = {
      topics: [
        topic({ judul: "Lagu Oncom Gondrong", ringkasan: "Lagu lama kembali viral di TikTok.", platform: "TikTok", kategori: "hiburan", panas: 4, url: undefined, berita: [1] }),
        topic({ judul: "Tren downgrade lifestyle", ringkasan: "Warganet ramai membahas gaya hidup hemat.", platform: "umum", kategori: "keuangan", panas: 3, url: undefined, berita: [2] }),
        topic({ judul: "Karangan tanpa sumber", ringkasan: "Topik yang tidak ada di daftar berita.", berita: [] }),
      ],
    };
    llm.replies.push(null, { text: JSON.stringify(json), json, model: "llm-uji" });

    const signals = await captureWebTrends(NOW);
    expect(llm.calls.map((c) => [c.system.slice(0, 37), !!c.googleSearch])).toEqual([
      ["Anda peneliti tren media sosial Indon", true],
      ["Anda peneliti tren media sosial Indon", false],
    ]);
    expect(fetched).toHaveLength(VIRAL_NEWS_QUERIES.length);
    expect(fetched[0]).toContain("when%3A2d");
    // Berita kriminal tidak sampai ke AI; berita basi dan judul kembar dari beberapa pencarian dibuang.
    const prompt = llm.calls[1].prompt;
    expect(prompt).not.toContain("ditangkap polisi");
    expect(prompt).not.toContain("sudah basi");
    expect(prompt.match(/Lagu Oncom Gondrong/g)).toHaveLength(1);
    expect(prompt).toContain("[2] Ramai tren downgrade lifestyle di media sosial (hipwee.com, 6 jam lalu)");

    expect(signals.map((s) => [s.title, s.url])).toEqual([
      ["Lagu Oncom Gondrong", "https://news.google.com/rss/articles/rri.co.id?oc=5"],
      ["Tren downgrade lifestyle", "https://news.google.com/rss/articles/hipwee.com?oc=5"],
    ]);
    expect(signals[0]).toMatchObject({ source: "WEB", workspaceId: null, raw: { platform: "TikTok", kategori: "hiburan", panas: 4 } });
  });

  it("grounding memberi cukup topik: Google News tidak dipanggil; tanpa kunci Gemini tidak ada riset", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await captureWebTrends(NOW)).toEqual([]);
    expect(llm.calls).toHaveLength(0);

    process.env.GEMINI_API_KEY = "uji";
    const json = { topics: [topic(), topic({ judul: "Istilah healing tipis-tipis" }), topic({ judul: "Debat bubur ayam pakai kecap" })] };
    llm.replies.push({ text: JSON.stringify(json), json, model: "llm-uji", groundedDomains: ["detik.com"] });
    const signals = await captureWebTrends(NOW);
    expect(signals).toHaveLength(3);
    expect(llm.calls).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
