import { describe, expect, it } from "vitest";
import {
  THREADS_MAX_TEXT,
  charLength,
  cleanCaption,
  clipChars,
  isTooSimilar,
  jaccard,
  parseTopicTag,
  postTitle,
  splitThreadsHashtagLines,
  validateThreadsText,
} from "../threads-text";

describe("charLength / clipChars", () => {
  it("menghitung emoji sebagai satu karakter", () => {
    expect(charLength("a\u{1F600}b")).toBe(3);
    expect("a\u{1F600}b".length).toBe(4);
  });
  it("memotong tanpa memutus pasangan surrogate", () => {
    expect(clipChars("a\u{1F600}b", 2)).toBe("a\u{1F600}");
    expect(clipChars("abc", 5)).toBe("abc");
  });
});

describe("validateThreadsText", () => {
  it("lolos tepat 500 karakter dan menolak 501", () => {
    expect(validateThreadsText("a".repeat(THREADS_MAX_TEXT), "").ok).toBe(true);
    const r = validateThreadsText("a".repeat(THREADS_MAX_TEXT + 1), "");
    expect(r.ok).toBe(false);
    expect(r.length).toBe(501);
  });
  it("menghitung emoji per karakter Unicode", () => {
    expect(validateThreadsText("\u{1F600}".repeat(500), "").ok).toBe(true);
  });
  it("mengganti {nama_cabang} sebelum menghitung panjang", () => {
    const r = validateThreadsText("Halo {nama_cabang}!", "Jogja");
    expect(r.ok && r.text).toBe("Halo Jogja!");
  });
  it("menolak teks kosong", () => {
    expect(validateThreadsText("   ", "").ok).toBe(false);
  });
  it("memisahkan baris hashtag menjadi topik", () => {
    const r = validateThreadsText("Isi postingan\n\n#kuliner", "");
    expect(r.ok && r.text).toBe("Isi postingan");
    expect(r.ok && r.topicTag).toBe("kuliner");
  });
  it("topik eksplisit diutamakan dibanding hashtag di teks", () => {
    const r = validateThreadsText("Isi\n\n#lama", "", "baru");
    expect(r.ok && r.topicTag).toBe("baru");
  });
});

describe("splitThreadsHashtagLines", () => {
  it("membiarkan hashtag di tengah kalimat", () => {
    const r = splitThreadsHashtagLines("Enak banget #shawarma hari ini");
    expect(r.text).toBe("Enak banget #shawarma hari ini");
    expect(r.hashtags).toEqual([]);
  });
});

describe("parseTopicTag", () => {
  it("membuang # dan spasi tepi", () => {
    expect(parseTopicTag("#kuliner")).toEqual({ ok: true, tag: "kuliner" });
  });
  it("kosong berarti tanpa topik", () => {
    expect(parseTopicTag("")).toEqual({ ok: true, tag: null });
    expect(parseTopicTag(null)).toEqual({ ok: true, tag: null });
  });
  it("menolak titik, tanda & dan lebih dari 50 karakter", () => {
    expect(parseTopicTag("a.b").ok).toBe(false);
    expect(parseTopicTag("a&b").ok).toBe(false);
    expect(parseTopicTag("x".repeat(51)).ok).toBe(false);
    expect(parseTopicTag("x".repeat(50)).ok).toBe(true);
  });
});

describe("cleanCaption", () => {
  it("membuang markdown tebal, prefix, dan kutip pembungkus", () => {
    expect(cleanCaption('**Caption:** "Halo dunia"')).toBe("Halo dunia");
  });
  it("memotong rapi di batas kalimat dalam 450 karakter", () => {
    const out = cleanCaption("Kalimat satu yang cukup panjang. ".repeat(40));
    expect(charLength(out)).toBeLessThanOrEqual(450);
    expect(out.endsWith(".")).toBe(true);
  });
});

describe("kemiripan", () => {
  it("jaccard antar kata", () => {
    expect(jaccard("kopi susu enak", "kopi susu mantap")).toBeCloseTo(0.5);
    expect(jaccard("", "apa saja")).toBe(0);
  });
  it("isTooSimilar memakai ambang 80%", () => {
    expect(isTooSimilar("kopi susu enak banget hari ini", ["Kopi susu enak banget hari ini"])).toBe(true);
    expect(isTooSimilar("kopi susu enak", ["roti bakar keju"])).toBe(false);
  });
});

describe("postTitle", () => {
  it("memakai baris pertama dengan awalan Dashboard AI", () => {
    expect(postTitle("Halo dunia\nbaris dua")).toBe("Dashboard AI \u00b7 Halo dunia");
  });
});
