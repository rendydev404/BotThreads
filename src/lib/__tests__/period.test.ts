import { afterEach, describe, expect, it, vi } from "vitest";
import { isoDate, resolvePeriod } from "@/lib/period";

describe("resolvePeriod", () => {
  afterEach(() => vi.useRealTimers());

  // 19 Okt 2026 16.33 WIB
  const now = new Date("2026-10-19T09:33:00Z");

  it("Hari ini: satu hari, tanggal WIB hari ini, live, pembanding kemarin", () => {
    vi.useFakeTimers({ now });
    const p = resolvePeriod("today");
    expect(p.label).toBe("Hari ini");
    expect([isoDate(p.from), isoDate(p.to), p.days, p.live]).toEqual(["2026-10-19", "2026-10-19", 1, true]);
    expect([isoDate(p.prevFrom), isoDate(p.prevTo)]).toEqual(["2026-10-18", "2026-10-18"]);
  });

  it("tanggal hari ini mengikuti WIB, bukan UTC", () => {
    // 20 Okt 00.30 WIB = 19 Okt 17.30 UTC
    vi.useFakeTimers({ now: new Date("2026-10-19T17:30:00Z") });
    expect(isoDate(resolvePeriod("today").to)).toBe("2026-10-20");
  });

  it("preset lain tetap berakhir kemarin dan tidak live", () => {
    vi.useFakeTimers({ now });
    for (const key of ["yesterday", "7d", "30d"]) {
      const p = resolvePeriod(key);
      expect(isoDate(p.to)).toBe("2026-10-18");
      expect(p.live).toBe(false);
    }
  });

  it("kustom yang berakhir hari ini ikut live", () => {
    vi.useFakeTimers({ now });
    expect(resolvePeriod("custom", "2026-10-13", "2026-10-19").live).toBe(true);
    expect(resolvePeriod("custom", "2026-10-13", "2026-10-18").live).toBe(false);
  });
});
