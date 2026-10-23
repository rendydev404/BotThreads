import { describe, expect, it } from "vitest";
import { EMPTY_BRAIN, brainBlocks, briefLines, themeEmojiRule } from "../account-brain";
import { deriveLessons, lessonKey } from "../account-memory";
import { humanScore, slopTells } from "../human-voice";
import { mentionsTrend, trendAnchors } from "../trend-anchor";

describe("detektor tulisan mesin", () => {
  it("teks santai manusia tidak ditandai", () => {
    const t = "gue kira deploy jumat sore aman, ternyata servernya ikut minta libur wkwk";
    expect(slopTells(t)).toEqual([]);
    expect(humanScore(t)).toBe(100);
  });

  it("menandai ciri khas AI", () => {
    const t = "Nah, di era digital ini — tentu saja kita perlu adaptasi!!";
    const tells = slopTells(t);
    expect(tells).toEqual(expect.arrayContaining(["tanda pisah panjang", "pembuka template", "kata khas mesin", "tanda seru beruntun"]));
    expect(humanScore(t)).toBeLessThan(50);
  });

  it("emoji berlebihan menurunkan skor", () => {
    expect(slopTells("mantap 🔥🔥🔥")).toContain("emoji berlebihan");
  });
});

describe("deriveLessons (belajar dari koreksi)", () => {
  it("teks sama: tidak ada pelajaran", () => {
    expect(deriveLessons("Halo semua", "halo semua ")).toEqual([]);
  });

  it("emoji dibuang, pertanyaan penutup dibuang, kata ganti diganti", () => {
    const ai = "Aku baru sadar ngoding sambil ngopi bikin fokus banget ☕ Kalian juga gitu nggak?";
    const human = "gue baru sadar ngoding sambil ngopi bikin fokus banget";
    const keys = deriveLessons(ai, human).map((l) => l.key);
    expect(keys).toEqual(expect.arrayContaining(["emoji:none", "close:noq", "case:lower", "self:gue"]));
  });

  it("versi pemilik akun jauh lebih pendek", () => {
    const ai =
      "Jadi begini, setelah saya pikir-pikir panjang, ternyata belajar coding itu tidak harus selalu mahal dan ribet, cukup konsisten setiap hari.";
    const human = "belajar coding gak harus mahal, yang penting konsisten";
    expect(deriveLessons(ai, human).map((l) => l.key)).toContain("len:short");
  });

  it("ciri mesin yang dibuang jadi pelajaran", () => {
    const keys = deriveLessons("Intinya, coba dulu — pasti kerasa bedanya", "coba dulu pasti kerasa bedanya").map((l) => l.key);
    expect(keys).toEqual(expect.arrayContaining(["tell:tanda pisah panjang", "tell:kata khas mesin"]));
  });

  it("kunci pelajaran AI stabil walau urutan kata beda", () => {
    expect(lessonKey("Pakai kata banget bukan sangat")).toBe(lessonKey("bukan sangat, pakai kata banget"));
  });
});

describe("brainBlocks (Profil AI global)", () => {
  const brain = {
    ...EMPTY_BRAIN,
    accountId: "a1",
    role: "Akun developer yang bahas AI dengan gaya santai",
    voiceStyle: "gue_lo" as const,
    pillars: ["AI", "Coding"],
    lessons: ["Jangan pakai emoji."],
    facts: ["Produk: kelas coding"],
  };

  it("berisi peran, gaya, kategori, pelajaran, dan fakta", () => {
    const titles = brainBlocks(brain).map((b) => b.title);
    expect(titles.some((t) => t.startsWith("PERAN & TEMA AKUN"))).toBe(true);
    expect(titles).toContain("GAYA SAPAAN (wajib)");
    expect(titles).toContain("KATEGORI TOPIK AKUN");
    expect(titles.some((t) => t.startsWith("PELAJARAN GAYA"))).toBe(true);
    expect(titles.some((t) => t.startsWith("FAKTA BRAND"))).toBe(true);
  });

  it("bisa melewati blok yang sudah ditulis pemanggil", () => {
    const titles = brainBlocks(brain, { role: true, voice: true, facts: true }).map((b) => b.title);
    expect(titles.some((t) => t.startsWith("PERAN"))).toBe(false);
    expect(titles).not.toContain("GAYA SAPAAN (wajib)");
    expect(titles.some((t) => t.startsWith("PELAJARAN GAYA"))).toBe(true);
  });

  it("tanpa otak akun: tidak ada blok", () => {
    expect(brainBlocks(undefined)).toEqual([]);
  });

  it("tema panjang satu baris tidak terpotong: aturan emoji di akhir tetap sampai", () => {
    const long = `${"Kalimat tema yang panjang sekali soal developer. ".repeat(90)}dan harus pake emoji kalo topik nya santai dan sarkas atau kritik`;
    const lines = briefLines(long);
    expect(lines.every((l) => [...l].length <= 1500)).toBe(true);
    expect(lines.join(" ")).toBe(long);
    const blocks = brainBlocks({ ...brain, role: long });
    expect(blocks.find((b) => b.title.startsWith("PERAN"))!.lines.join(" ")).toContain("harus pake emoji");
    const emoji = blocks.find((b) => b.title.startsWith("EMOJI"));
    expect(emoji?.lines[0]).toContain("harus pake emoji kalo topik nya santai");
    // Tema meminta emoji: pelajaran otomatis "Jangan pakai emoji." tidak ikut (bertentangan).
    expect(blocks.find((b) => b.title.startsWith("PELAJARAN GAYA"))).toBeUndefined();
  });

  it("themeEmojiRule membedakan larangan, permintaan, dan tema yang diam", () => {
    expect(themeEmojiRule("Santai. Dilarang menggunakan emoji sama sekali.")?.mode).toBe("ban");
    expect(themeEmojiRule("Santai. Wajib pakai emoji yang pas.")?.mode).toBe("want");
    expect(themeEmojiRule("Akun teknologi yang kritis.")).toBeNull();
    expect(themeEmojiRule(null)).toBeNull();
  });
});


describe("jangkar tren", () => {
  const anchors = trendAnchors([
    "Devin dan Gemini 4 Argon tamatkan boss Minecraft 27 jam; gue masih debat sama bug satu baris",
    "AI Coding Agent Pamer Stunt Ekstrem",
  ]);

  it("nama diri jadi jangkar kuat", () => {
    expect(anchors.strong).toEqual(expect.arrayContaining(["gemini", "argon", "minecraft"]));
  });

  it("draf yang melenceng dari tren ditolak, yang menyebut tren lolos", () => {
    expect(mentionsTrend("Mitos paling awet soal AI coding: kalau agent bisa ngerjain demo rumit, kerjaan dev beres.", anchors)).toBe(false);
    expect(mentionsTrend("Gemini 4 Argon bisa namatin Minecraft 27 jam, gue debug satu baris aja seharian", anchors)).toBe(true);
  });

  it("judul berkapital semua memakai kata isi sebagai jangkar lemah", () => {
    const a = trendAnchors(["Google Rilis Fitur Pencarian Baru"]);
    expect(a.strong).toEqual([]);
    expect(mentionsTrend("fitur pencarian google yang baru ini lumayan", a)).toBe(true);
  });

  it("tanpa jangkar: tidak diperiksa", () => {
    expect(mentionsTrend("apa saja", null)).toBe(true);
  });
});
