import { describe, expect, it } from "vitest";
import { HUMAN_VOICE, dropDashes, humanScore, humanVoice, slopTells } from "../human-voice";
import { cleanReply } from "../threads-replies";

describe("dropDashes", () => {
  it("tanda pisah panjang di tengah kalimat jadi koma", () => {
    expect(dropDashes("Haha bener — console.log itu senjata abadi")).toBe("Haha bener, console.log itu senjata abadi");
    expect(dropDashes("udah biasa–tapi tetep kesel")).toBe("udah biasa, tapi tetep kesel");
  });

  it("rentang angka tetap rentang, tanda di awal baris tidak disentuh", () => {
    expect(dropDashes("buka jam 10–12 aja")).toBe("buka jam 10-12 aja");
    expect(dropDashes("– poin pertama\n— poin kedua")).toBe("– poin pertama\n— poin kedua");
  });
});

describe("balasan komentar", () => {
  it("cleanReply membuang tanda pisah panjang", () => {
    expect(cleanReply("relate bgt — tiap malem gitu")).toBe("relate bgt, tiap malem gitu");
  });

  it("balasan berisi kode tidak pernah dikirim", () => {
    for (const code of [
      "coba pake `console.log(x)` aja",
      'console.log("debug") dulu bang',
      "const x = await fetch(url)",
      "npm install axios terus jalanin",
      "pake arrow fn aja => lebih ringkas",
      "SELECT * FROM users where id = 1",
      "tinggal tambahin <div class='x'> di situ",
      "if (err) { return null; }",
    ]) {
      expect(cleanReply(code), code).toBeNull();
    }
  });

  it("menyebut istilah teknis tanpa kodenya tetap boleh", () => {
    for (const ok of [
      "haha console.log itu senjata abadi sih",
      "relate bgt, debugging jam 2 pagi emang paling nyiksa",
      "gue juga masih sering pake git kok, tapi gak sejago itu",
      "wkwk bener, AI-nya ngasih saran ngawur mulu",
    ]) {
      expect(cleanReply(ok), ok).toBe(ok);
    }
  });

  it("aturan gaya melarang pola khas AI yang terlihat di balasan", () => {
    for (const s of ["JANGAN selalu menutup dengan pertanyaan", '"Haha bener"', '"ironisnya"', "tanda pisah panjang"]) {
      expect(HUMAN_VOICE).toContain(s);
    }
  });

  it("balasan komentar tetap tanpa daftar: aturan bawaan melarang daftar dan markdown", () => {
    expect(HUMAN_VOICE).toBe(humanVoice());
    expect(HUMAN_VOICE).toContain("tanpa daftar atau markdown");
    expect(HUMAN_VOICE).not.toContain("Daftar polos boleh");
  });
});

describe("daftar polos vs markdown", () => {
  const LIST = "3 kebiasaan kecil biar gak boncos tiap akhir bulan\n\n1. catat jajan kopi\n2. matiin langganan yang lupa dipakai\n3. belanja bulanan pakai list";
  const DASH = "yang bikin betah kerja di sini\n- atasan gak micromanage\n- makan siang bareng";
  const MD = "**Tips hemat** buat anak kos\n## langkah pertama\ncatat pengeluaran";

  it("bawaan (balasan, postingan biasa): daftar dihukum", () => {
    expect(slopTells(LIST)).toContain("format daftar");
    expect(slopTells(DASH)).toContain("format daftar");
    expect(humanScore(LIST)).toBeLessThan(100);
  });

  it("plainLists: daftar polos tidak dihukum", () => {
    expect(slopTells(LIST, { plainLists: true })).toEqual([]);
    expect(humanScore(DASH, { plainLists: true })).toBe(100);
    expect(humanVoice({ plainLists: true })).toContain("Daftar polos boleh");
  });

  it("markdown tetap dilarang walau daftar diizinkan", () => {
    expect(slopTells(MD, { plainLists: true })).toContain("format markdown");
    expect(humanScore(MD, { plainLists: true })).toBeLessThan(100);
    expect(humanVoice({ plainLists: true })).toContain("tanpa markdown");
  });

  it("angka biasa di kalimat bukan daftar", () => {
    expect(slopTells("udah 2.5 tahun kerja di sini dan baru sadar hal ini")).toEqual([]);
  });
});
