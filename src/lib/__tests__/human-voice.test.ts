import { describe, expect, it } from "vitest";
import { HUMAN_VOICE, dropDashes } from "../human-voice";
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
});
