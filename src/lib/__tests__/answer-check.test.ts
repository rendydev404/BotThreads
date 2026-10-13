import { describe, expect, it } from "vitest";
import { checkAnswer, correctionPrompt, extractNumbers, numberPool, unknownHandles } from "../answer-check";

const DATA = `Ringkasan: 33 akun | 2.219 postingan | 147.411 views
@theakbaralatas: 79.829 views, 48 followers
Carousel: 19 post, rata-rata 601 views/post
2026-10-13: 5.120 views`;

describe("extractNumbers", () => {
  it("membaca format id-ID dan mengabaikan tanggal/jam", () => {
    const nums = extractNumbers("79.829 views, 12,5% pada 2026-10-13 jam 08:30");
    expect(nums).toContain(79829);
    expect(nums).toContain(12.5);
    expect(nums).not.toContain(2026);
    expect(nums).not.toContain(8);
  });

  it("melewati angka hasil hitung sesudah tanda sama dengan", () => {
    expect(extractNumbers("12.000 / 40 = 300", { skipDerived: true })).toEqual([12000, 40]);
  });
});

describe("checkAnswer", () => {
  const pool = numberPool(DATA);
  const known = new Set(["theakbaralatas", "akbaralatas"]);

  it("lolos bila angka dan akun ada di data", () => {
    const r = checkAnswer("@theakbaralatas punya 79.829 views dari 48 followers, dari 2.219 post total.", pool, known);
    expect(r.ok).toBe(true);
  });

  it("menoleransi pembulatan kecil", () => {
    expect(checkAnswer("Carousel rata-rata 602 views per post.", pool, known).ok).toBe(true);
  });

  it("menandai angka yang tidak ada di data", () => {
    const r = checkAnswer("@theakbaralatas mencapai 95.000 views.", pool, known);
    expect(r.ok).toBe(false);
    expect(r.numbers).toEqual([95000]);
  });

  it("menandai akun yang tidak dikenal", () => {
    const r = checkAnswer("@akunpalsu menurun.", pool, known);
    expect(r.ok).toBe(false);
    expect(r.handles).toEqual(["akunpalsu"]);
  });

  it("angka hasil hitung yang ditunjukkan tidak dianggap karangan", () => {
    expect(checkAnswer("79.829 / 48 = 1.663 views per follower", pool, known).ok).toBe(true);
  });

  it("angka kecil (persen, urutan) tidak diperiksa", () => {
    expect(checkAnswer("Naik 45% dan peringkat 3 dari 33.", pool, known).ok).toBe(true);
  });
});

describe("unknownHandles", () => {
  it("mengabaikan titik penutup kalimat", () => {
    expect(unknownHandles("Lihat @abc.", new Set(["abc"]))).toEqual([]);
  });
});

describe("correctionPrompt", () => {
  it("menyebut angka dan akun bermasalah", () => {
    const p = correctionPrompt({ ok: false, numbers: [95000], handles: ["palsu"] });
    expect(p).toContain("95.000");
    expect(p).toContain("@palsu");
  });
});
