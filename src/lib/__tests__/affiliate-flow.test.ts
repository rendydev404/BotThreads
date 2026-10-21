import { describe, expect, it } from "vitest";
import { affiliateReadiness, type ReadinessInput } from "../affiliate-pick";
import { DEFAULT_AFFILIATE, FREQUENCY_PRESETS, effectivePerDay, looksSpammy, presetOf } from "../affiliate-types";

const NOW = new Date("2026-10-21T05:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const base = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  settings: { ...DEFAULT_AFFILIATE, aktif: true, niche: ["dapur"] },
  mode: "OTOMATIS",
  postsPerDay: 3,
  paused: false,
  products: [{ id: "p1", niche: ["dapur"] }],
  lastUse: new Map(),
  now: NOW,
  ...over,
});

describe("affiliateReadiness", () => {
  it("jalan bila semua syarat terpenuhi", () => {
    const r = affiliateReadiness(base());
    expect(r).toMatchObject({ ok: true, aksi: null, perHari: 1 });
  });
  it("menunjuk perbaikan sesuai urutan", () => {
    expect(affiliateReadiness(base({ settings: { ...DEFAULT_AFFILIATE } })).aksi).toBe("NYALAKAN");
    expect(affiliateReadiness(base({ paused: true })).aksi).toBe("LANJUTKAN");
    expect(affiliateReadiness(base({ mode: "MATI" })).aksi).toBe("AUTOPILOT");
    expect(affiliateReadiness(base({ settings: { ...DEFAULT_AFFILIATE, aktif: true, niche: [] } })).aksi).toBe("ATUR_AKUN");
    expect(affiliateReadiness(base({ postsPerDay: 1 })).aksi).toBe("ATUR_AKUN");
    const salahEja = affiliateReadiness(base({ products: [{ id: "p1", niche: ["masak"] }] }));
    expect(salahEja).toMatchObject({ ok: false, aksi: "TAMBAH_PRODUK" });
    expect(salahEja.teks).toMatch(/dapur/);
  });
  it("semua produk masih kena jeda: tidak jalan dan menyebut kapan tersedia", () => {
    const r = affiliateReadiness(base({ lastUse: new Map([["p1", new Date(NOW.getTime() - 3 * DAY)]]) }));
    expect(r).toMatchObject({ ok: false, aksi: "TAMBAH_PRODUK" });
    expect(r.teks).toMatch(/Tersedia lagi/);
    expect(affiliateReadiness(base({ lastUse: new Map([["p1", new Date(NOW.getTime() - 15 * DAY)]]) })).ok).toBe(true);
  });
});

describe("preset frekuensi", () => {
  it("dikenali kembali dari angkanya", () => {
    for (const p of FREQUENCY_PRESETS) expect(presetOf(p.values)).toBe(p.key);
    expect(presetOf({ perHari: 2, porsi: 0.4, jarakJam: 1, jedaHari: 3 })).toBeNull();
  });
  it("jarang = 1 per hari berapa pun jumlah postingan", () => {
    const j = FREQUENCY_PRESETS.find((p) => p.key === "JARANG")!.values;
    for (const n of [1, 3, 6]) expect(effectivePerDay({ ...j, aktif: true }, n)).toBe(1);
  });
  it("peringatan jualan di atas sepertiga postingan", () => {
    expect(looksSpammy(1, 3)).toBe(false);
    expect(looksSpammy(1, 2)).toBe(true);
    expect(looksSpammy(0, 0)).toBe(false);
  });
});
