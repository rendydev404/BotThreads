import { describe, expect, it } from "vitest";
import { aggregatePostStats, buildInsightsText, type InsightInput } from "../chat-insights";

const day = (id: string, views: number) => ({
  threadsAccountId: id,
  views,
  likes: 0,
  replies: 0,
  reposts: 0,
  quotes: 0,
});

describe("aggregatePostStats", () => {
  it("menghitung median, rata-rata, maksimum, dan post sepi per akun", () => {
    const rows = [
      ...[1, 1, 5, 9, 100].map((v) => ({ threadsAccountId: "a", views: v })),
      ...[10, 20].map((v) => ({ threadsAccountId: "b", views: v })),
    ];
    const [a, b] = aggregatePostStats(rows).sort((x, y) => x.aid.localeCompare(y.aid));
    expect(a).toMatchObject({ n: 5, median: 5, avg: 23, max: 100, low: 2, views: 116 });
    expect(b).toMatchObject({ n: 2, median: 15, avg: 15, max: 20, low: 0 });
  });
});

describe("buildInsightsText", () => {
  const base: InsightInput = {
    names: new Map([
      ["a", "akunbesar"],
      ["b", "akunkecil"],
      ["c", "akundiam"],
      ["d", "akunnaik"],
    ]),
    from: "2026-10-07",
    to: "2026-10-13",
    hasPrev: true,
    cur: [day("a", 9000), day("b", 300), day("c", 50), day("d", 1500)],
    prev: [day("a", 9000), day("b", 600), day("c", 40), day("d", 500)],
    curPosts: [
      { threadsAccountId: "a", posts: 20 },
      { threadsAccountId: "b", posts: 7 },
      { threadsAccountId: "d", posts: 5 },
    ],
    lifetime: [day("a", 50000), day("b", 3000), day("c", 800), day("d", 20000)],
    followers: new Map([
      ["a", 1000],
      ["b", 100],
      ["c", 50],
      ["d", 40],
    ]),
    stats: [
      { aid: "a", n: 40, views: 8000, avg: 200, median: 150, max: 900, low: 0 },
      { aid: "b", n: 12, views: 1200, avg: 100, median: 20, max: 700, low: 3 },
    ],
    media: [
      { mediaType: "TEXT_POST", posts: 400, avg_views: 66, views: 26400, likes: 100, replies: 40 },
      { mediaType: "CAROUSEL_ALBUM", posts: 8, avg_views: 600, views: 4800, likes: 30, replies: 5 },
    ],
    hours: { best: [{ h: 19, avgViews: 300, posts: 14 }], overall: 100 },
  };

  it("menyusun perubahan minggu ke minggu dengan akun naik dan turun", () => {
    const t = buildInsightsText(base);
    expect(t).toContain("Naik terbesar");
    expect(t).toMatch(/@akunnaik: 1\.500 views vs 500 periode sebelumnya \(naik 200%\)/);
    expect(t).toMatch(/@akunkecil: 300 views vs 600 periode sebelumnya \(turun 50%\)/);
  });

  it("mengabaikan akun dengan views sebelumnya terlalu kecil untuk persentase", () => {
    const t = buildInsightsText(base);
    expect(t).not.toMatch(/@akundiam: 50 views vs 40/);
  });

  it("mendaftar akun tanpa posting baru dan konsentrasi views", () => {
    const t = buildInsightsText(base);
    expect(t).toContain("AKUN TANPA POSTINGAN BARU 7 HARI (1): @akundiam");
    expect(t).toMatch(/3 akun teratas .* menyumbang 100% dari 10\.850 views/);
  });

  it("memberi peringatan sampel kecil pada format langka", () => {
    const t = buildInsightsText(base);
    expect(t).toMatch(/Carousel: 8 post, rata-rata 600 views\/post.*SAMPEL KECIL/);
    expect(t).not.toMatch(/Teks: 400 post.*SAMPEL KECIL/);
  });

  it("menandai akun timpang (rata-rata jauh di atas median)", () => {
    const t = buildInsightsText({ ...base, stats: [{ aid: "b", n: 12, views: 1200, avg: 100, median: 20, max: 700, low: 3 }] });
    expect(t).toContain("AKUN DENGAN HASIL TIMPANG");
    expect(t).toContain("@akunkecil (rata-rata 100 vs median 20)");
  });

  it("melewatkan perbandingan bila tidak ada periode sebelumnya", () => {
    expect(buildInsightsText({ ...base, hasPrev: false })).not.toContain("PERUBAHAN VIEWS");
  });
});
