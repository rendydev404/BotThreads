import { describe, expect, it } from "vitest";
import {
  dayOffsetFromKey,
  findScheduleViolation,
  findSlot,
  formatWibFull,
  formatWibLabel,
  hasGapConflict,
  hourMultiplier,
  nextFreeSlot,
  overallAverage,
  parsePublishAt,
  rankBestHours,
  slotForHour,
  startOfWibDay,
  wibAt,
  wibDayKey,
  wibParts,
} from "../scheduling";

// Senin 12 Okt 2026 10.00 WIB
const NOW = new Date("2026-10-12T03:00:00Z");
const MIN = 60_000;

describe("zona waktu WIB", () => {
  it("wibParts membaca jam & hari WIB", () => {
    const p = wibParts(NOW);
    expect([p.y, p.m, p.d, p.h, p.dow]).toEqual([2026, 9, 12, 10, 1]);
  });
  it("wibAt menghitung jam WIB di hari ke-N (UTC)", () => {
    expect(wibAt(NOW, 1, 12).toISOString()).toBe("2026-10-13T05:00:00.000Z");
    expect(wibAt(NOW, 0, 0).toISOString()).toBe("2026-10-11T17:00:00.000Z");
  });
  it("startOfWibDay & wibDayKey", () => {
    expect(startOfWibDay(NOW).toISOString()).toBe("2026-10-11T17:00:00.000Z");
    expect(wibDayKey(NOW)).toBe("2026-10-12");
    // 20.00 UTC sudah hari berikutnya di WIB
    expect(wibDayKey(new Date("2026-10-12T20:00:00Z"))).toBe("2026-10-13");
  });
  it("dayOffsetFromKey", () => {
    expect(dayOffsetFromKey(NOW, "2026-10-14")).toBe(2);
    expect(dayOffsetFromKey(NOW, "2026-10-12")).toBe(0);
    expect(dayOffsetFromKey(NOW, "bukan-tanggal")).toBeNull();
  });
  it("memformat label WIB", () => {
    const t = wibAt(NOW, 1, 12);
    expect(formatWibLabel(t)).toBe("Selasa 12.00 WIB");
    expect(formatWibFull(t)).toBe("13 Okt 2026, 12.00 WIB");
  });
});

describe("jam terbaik", () => {
  const rows = [
    { hour: 12, n: 5, avg: 1000 },
    { hour: 19, n: 4, avg: 2000 },
    { hour: 7, n: 1, avg: 9000 },
  ];
  it("jam dengan satu postingan tidak dipertimbangkan, urut skor Bayesian", () => {
    expect(rankBestHours(rows).map((r) => r.h)).toEqual([19, 12]);
  });
  it("tanpa data menghasilkan daftar kosong", () => {
    expect(rankBestHours([])).toEqual([]);
  });
  it("rata-rata keseluruhan & kelipatan", () => {
    expect(overallAverage(rows)).toBe(2200);
    expect(hourMultiplier(2000, 1000)).toBe(2);
    expect(hourMultiplier(2000, 0)).toBeNull();
  });
});

describe("slot kosong", () => {
  const base = { now: NOW, takenMs: [] as number[], minGapMs: 60 * MIN };
  it("memilih jam bulat terdekat minimal 10 menit ke depan", () => {
    // 10.00 sudah lewat batas 10.10, jadi 12.00 hari ini
    expect(findSlot({ ...base, hours: [10, 12] })?.toISOString()).toBe(wibAt(NOW, 0, 12).toISOString());
  });
  it("menghindari bentrok dengan jarak minimal", () => {
    const taken = [wibAt(NOW, 0, 12).getTime()];
    expect(findSlot({ ...base, takenMs: taken, hours: [10, 12] })?.toISOString()).toBe(wibAt(NOW, 1, 10).toISOString());
  });
  it("hasGapConflict", () => {
    expect(hasGapConflict(1000 * MIN, [1030 * MIN], 60 * MIN)).toBe(true);
    expect(hasGapConflict(1000 * MIN, [1060 * MIN], 60 * MIN)).toBe(false);
    expect(hasGapConflict(1000 * MIN, [1000 * MIN], 0)).toBe(true);
  });
  it("nextFreeSlot jatuh ke slot bawaan 11/15/19 tanpa jam terbaik", () => {
    expect(nextFreeSlot({ ...base }).toISOString()).toBe(wibAt(NOW, 0, 11).toISOString());
  });
  it("slotForHour mulai dari hari target", () => {
    const t = slotForHour({ ...base, hour: 19, startDay: 1 });
    expect(t?.toISOString()).toBe(wibAt(NOW, 1, 19).toISOString());
  });
});

describe("parsePublishAt", () => {
  it('"now" berarti langsung', () => {
    const r = parsePublishAt("now", NOW);
    expect(r.ok && r.immediate).toBe(true);
  });
  it("menolak jadwal kurang dari 2 menit dan lebih dari 60 hari", () => {
    expect(parsePublishAt(new Date(NOW.getTime() + MIN).toISOString(), NOW).ok).toBe(false);
    expect(parsePublishAt(new Date(NOW.getTime() + 3 * MIN).toISOString(), NOW).ok).toBe(true);
    expect(parsePublishAt(new Date(NOW.getTime() + 61 * 24 * 60 * MIN).toISOString(), NOW).ok).toBe(false);
  });
  it("menolak format tidak valid", () => {
    expect(parsePublishAt("besok pagi", NOW).ok).toBe(false);
    expect(parsePublishAt(123, NOW).ok).toBe(false);
  });
});

describe("findScheduleViolation", () => {
  const limits = { minGapMs: 60 * MIN, maxPerDay: 6 };
  const at = wibAt(NOW, 1, 12);
  it("lolos bila kosong", () => {
    expect(findScheduleViolation(at, [], limits)).toBeNull();
  });
  it("menolak melebihi kuota harian posting dashboard", () => {
    const existing = Array.from({ length: 6 }, (_, i) => ({ at: wibAt(NOW, 1, 6 + i * 2).getTime(), dashboard: true }));
    expect(findScheduleViolation(wibAt(NOW, 1, 23), existing, limits)).toContain("Batas 6");
  });
  it("posting SukaPost tidak menghitung kuota tetapi tetap menghitung jarak", () => {
    const sukapost = Array.from({ length: 6 }, (_, i) => ({ at: wibAt(NOW, 1, 6 + i * 2).getTime(), dashboard: false }));
    expect(findScheduleViolation(wibAt(NOW, 1, 23), sukapost, limits)).toBeNull();
    expect(findScheduleViolation(at, [{ at: at.getTime() + 30 * MIN, dashboard: false }], limits)).toContain("kurang dari 60 menit");
  });
});
