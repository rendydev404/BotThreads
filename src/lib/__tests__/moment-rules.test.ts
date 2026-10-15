/**
 * Momen kalender bawaan: aturan "berlaku hari ini" (dipakai server untuk sinyal radar) dan rentang
 * terdekat (ditampilkan tab Momen) berasal dari satu definisi dan tidak boleh saling bertentangan.
 */
import { describe, expect, it } from "vitest";
import { BUILTIN_MOMENT_RULES, momentRuleActive, momentRuleRange } from "../moment-rules";
import { builtinMomentSignals } from "../radar-sources";

const DAY_MS = 24 * 60 * 60 * 1000;
const keyOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const rule = (key: string) => BUILTIN_MOMENT_RULES.find((r) => r.key === key)!;

describe("rentang momen bawaan", () => {
  it("contoh: sedang berjalan, akan datang, dan yang melewati batas bulan/tahun", () => {
    // Selasa 13 Okt 2026.
    expect(momentRuleRange(rule("gajian"), "2026-10-13")).toEqual({ mulai: "2026-10-25", selesai: "2026-11-02" });
    expect(momentRuleRange(rule("tanggal-tua"), "2026-10-13")).toEqual({ mulai: "2026-10-19", selesai: "2026-10-24" });
    expect(momentRuleRange(rule("akhir-pekan"), "2026-10-13")).toEqual({ mulai: "2026-10-16", selesai: "2026-10-18" });
    expect(momentRuleRange(rule("awal-pekan"), "2026-10-13")).toEqual({ mulai: "2026-10-19", selesai: "2026-10-19" });
    // Tanggal 1 Januari masih dalam rentang gajian yang mulai 25 Desember tahun sebelumnya.
    expect(momentRuleRange(rule("gajian"), "2027-01-01")).toEqual({ mulai: "2026-12-25", selesai: "2027-01-02" });
    // Minggu masih bagian dari akhir pekan yang mulai Jumat.
    expect(momentRuleRange(rule("akhir-pekan"), "2026-10-18")).toEqual({ mulai: "2026-10-16", selesai: "2026-10-18" });
    // Setelah tanggal tua lewat, yang tampil milik bulan depan (termasuk lintas tahun).
    expect(momentRuleRange(rule("tanggal-tua"), "2026-12-27")).toEqual({ mulai: "2027-01-19", selesai: "2027-01-24" });
    expect(momentRuleRange(rule("gajian"), "bukan-tanggal")).toBeNull();
  });

  it("selama 800 hari (melewati tahun kabisat): rentang selalu cocok dengan aturan aktif harian", () => {
    const start = Date.UTC(2027, 0, 1);
    for (const r of BUILTIN_MOMENT_RULES) {
      for (let i = 0; i < 800; i++) {
        const at = start + i * DAY_MS;
        const today = keyOf(at);
        const date = new Date(at);
        const active = momentRuleActive(r, date.getUTCDate(), date.getUTCDay());
        const range = momentRuleRange(r, today)!;
        // Aktif hari ini <=> hari ini berada di dalam rentang yang ditampilkan.
        expect(range.mulai <= today && today <= range.selesai, `${r.key} ${today}`).toBe(active);
        if (!active) {
          // Rentang "berikutnya" benar-benar yang terdekat: semua hari sampai mulai tidak aktif, hari mulai aktif.
          expect(range.mulai > today, `${r.key} ${today}`).toBe(true);
          for (let t = at + DAY_MS; keyOf(t) < range.mulai; t += DAY_MS) {
            const d = new Date(t);
            expect(momentRuleActive(r, d.getUTCDate(), d.getUTCDay()), `${r.key} ${keyOf(t)}`).toBe(false);
          }
        }
        const first = new Date(`${range.mulai}T00:00:00Z`);
        const last = new Date(`${range.selesai}T00:00:00Z`);
        expect(momentRuleActive(r, first.getUTCDate(), first.getUTCDay())).toBe(true);
        expect(momentRuleActive(r, last.getUTCDate(), last.getUTCDay())).toBe(true);
      }
    }
  });

  it("sinyal radar harian memakai aturan yang sama", () => {
    // Senin 26 Okt 2026, 10.00 WIB: gajian (25-2) dan awal pekan aktif.
    const titles = builtinMomentSignals(new Date("2026-10-26T03:00:00Z")).map((s) => s.title).sort();
    expect(titles).toEqual(["Awal pekan", "Tanggal gajian"]);
  });
});
