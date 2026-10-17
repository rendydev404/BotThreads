import { describe, expect, it } from "vitest";
import { groundedDomains } from "../gemini";
import { trustedUrl, webTopicsToSignals, webTrendScore } from "../web-trends";

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
