import { describe, expect, it } from "vitest";
import { bannedHits, moneyValues, runGate, unsupportedClaims } from "../autopilot-gate";

const OK_TEXT = "sore begini enaknya ngemil apa sih? aku lagi kepikiran yang gurih-gurih, kalian tim manis atau tim asin?";

describe("moneyValues", () => {
  it("membaca berbagai cara menulis harga", () => {
    expect(moneyValues("cuma Rp 15.000 aja")).toEqual([15000]);
    expect(moneyValues("mulai 15rb sampai 25 ribu")).toEqual([15000, 25000]);
    expect(moneyValues("paket Rp15,5 rb")).toEqual([15500]);
    expect(moneyValues("modal 2 juta")).toEqual([2_000_000]);
    expect(moneyValues("harganya 20k doang")).toEqual([20000]);
  });
  it("tidak salah menangkap angka biasa", () => {
    expect(moneyValues("udah 3 kali ke sini, antre 15 menit")).toEqual([]);
    expect(moneyValues("buka jam 10 sampai 22")).toEqual([]);
  });
});

describe("unsupportedClaims", () => {
  const facts = ['"Shawarma original Rp 18.000, buka jam 10 pagi" (2026-10-01)'];
  it("harga yang ada di fakta akun diterima, yang tidak ada ditolak", () => {
    expect(unsupportedClaims("yang original masih 18rb kok", facts)).toEqual([]);
    expect(unsupportedClaims("sekarang cuma 12rb", facts)).toEqual(["harga Rp 12.000"]);
  });
  it("kata promo hanya boleh bila ada di fakta", () => {
    expect(unsupportedClaims("hari ini ada promo beli 1 gratis 1", facts)).toEqual(
      expect.arrayContaining(['kata "promo"', 'kata "gratis"'])
    );
    expect(unsupportedClaims("promo masih jalan ya", ['"Promo pelajar tiap Jumat" (2026-10-05)'])).toEqual([]);
  });
  it("persen ditolak kecuali ungkapan 100%", () => {
    expect(unsupportedClaims("diskon 30% khusus hari ini", [])).toEqual(
      expect.arrayContaining(["angka 30%", 'kata "diskon"'])
    );
    expect(unsupportedClaims("aku 100% setuju sama ini", [])).toEqual([]);
  });
});

describe("bannedHits", () => {
  it("mencocokkan kata utuh, tidak peka huruf besar", () => {
    expect(bannedHits("Lagi rame bahas Pemilu nih", ["pemilu"])).toEqual(["pemilu"]);
    expect(bannedHits("masaranya enak", ["sara"])).toEqual([]);
    expect(bannedHits("turut  berduka ya", ["turut berduka"])).toEqual(["turut berduka"]);
  });
});

describe("runGate", () => {
  it("meloloskan draf biasa dan melaporkan semua pemeriksaan", () => {
    const r = runGate({ text: OK_TEXT, sources: [], peers: [] });
    expect(r.ok).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.checks.map((c) => c.key)).toEqual(["bentuk", "klaim", "terlarang", "kembar"]);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it("menolak harga karangan", () => {
    const r = runGate({ text: "shawarma jumbo sekarang cuma 10rb, siapa mau?", sources: [], peers: [] });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.key === "klaim")?.ok).toBe(false);
    expect(r.reason).toMatch(/10\.000/);
  });

  it("menolak topik sensitif bawaan dan kata terlarang workspace", () => {
    expect(runGate({ text: "ikut berduka buat korban gempa kemarin, semoga kuat ya semuanya", sources: [], peers: [] }).ok).toBe(false);
    const r = runGate({
      text: "enakan mana sih, tempat sebelah atau di sini? jujur aja nih jawabnya",
      sources: [],
      peers: [],
      bannedTerms: ["tempat sebelah"],
    });
    expect(r.checks.find((c) => c.key === "terlarang")?.ok).toBe(false);
  });

  it("menolak draf yang kembar dengan akun lain hari ini", () => {
    const peer = "sore begini enaknya ngemil apa sih? aku lagi kepikiran yang gurih-gurih, kalian tim manis atau asin?";
    const r = runGate({ text: OK_TEXT, sources: [], peers: [peer] });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.key === "kembar")?.detail).toMatch(/Kemiripan \d+%/);
  });

  it("anti-jiplak: menolak draf yang menyalin 6 kata berurutan dari contoh gaya", () => {
    const exemplar = "jujur ya, kerja remote itu enak\ntapi kangen juga ngobrol random di pantry kantor";
    const copy = runGate({ text: "aku setuju, kangen juga ngobrol random di pantry kantor tiap pagi", sources: [], peers: [], exemplars: [exemplar] });
    expect(copy.ok).toBe(false);
    expect(copy.checks.find((c) => c.key === "asli")?.ok).toBe(false);
    expect(copy.reason).toMatch(/^Draf menyalin frasa dari contoh gaya: "kangen juga ngobrol random di pantry/);

    // Lima kata sama (ritme mirip) masih boleh; tanpa contoh, pemeriksaan tidak ditambahkan.
    const own = runGate({ text: "kangen juga ngobrol random di warung kopi depan rumah", sources: [], peers: [], exemplars: [exemplar] });
    expect(own.ok).toBe(true);
    expect(own.checks.find((c) => c.key === "asli")?.ok).toBe(true);
    expect(runGate({ text: OK_TEXT, sources: [], peers: [], exemplars: [] }).checks.some((c) => c.key === "asli")).toBe(false);
  });

  it("menolak placeholder dan teks kepanjangan", () => {
    expect(runGate({ text: "mampir ke [isi alamat cabang] ya, ditunggu sore ini juga", sources: [], peers: [] }).ok).toBe(false);
    expect(runGate({ text: "a".repeat(501), sources: [], peers: [] }).ok).toBe(false);
  });
});
