import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../autopilot-types";
import {
  JITTER_MAX_MINUTES,
  PLAN_MIN_LEAD_MS,
  dayPart,
  fixedHoursError,
  hash32,
  jitterMinute,
  planDay,
  type PlanInput,
} from "../autopilot-plan";
import { wibAt, wibParts, type HourRow } from "../scheduling";

// Senin 12 Okt 2026 05.00 WIB
const NOW = new Date("2026-10-11T22:00:00Z");
const TODAY = "2026-10-12";
const TOMORROW = "2026-10-13";
const MIN = 60_000;

const OWN: HourRow[] = [
  { hour: 7, n: 6, avg: 900 },
  { hour: 12, n: 8, avg: 1500 },
  { hour: 19, n: 9, avg: 2600 },
  { hour: 20, n: 7, avg: 2400 },
  { hour: 21, n: 5, avg: 1800 },
];
const NETWORK: HourRow[] = [
  { hour: 8, n: 40, avg: 1200 },
  { hour: 13, n: 55, avg: 1700 },
  { hour: 18, n: 60, avg: 2100 },
];

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  accountId: "akun-1",
  dayKey: TOMORROW,
  now: NOW,
  settings: { ...DEFAULT_SETTINGS, exploreRate: 0 },
  ownRows: OWN,
  networkRows: NETWORK,
  takenMs: [],
  usedIndexes: [],
  ...over,
});

const gaps = (times: Date[]): number[] =>
  times
    .map((t) => t.getTime())
    .sort((a, b) => a - b)
    .slice(1)
    .map((t, i, arr) => (t - (i === 0 ? Math.min(...times.map((x) => x.getTime())) : arr[i - 1])) / MIN);

describe("planDay: jam ramai", () => {
  it("memilih minimal 3 slot dari jam terbaik akun dengan jarak minimal terpenuhi", () => {
    const plan = planDay(input());
    expect(plan.source).toBe("account");
    expect(plan.slots).toHaveLength(3);
    // 19 teratas; 20 dan 21 terlalu dekat dengan 19, jadi 12 lalu 7.
    expect(plan.slots.map((s) => s.hour)).toEqual([7, 12, 19]);
    expect(plan.slots.every((s) => s.kind === "RAMAI")).toBe(true);
    for (const g of gaps(plan.slots.map((s) => s.slotAt))) expect(g).toBeGreaterThanOrEqual(150);
  });

  it("slotIndex urut waktu, menit sama untuk seluruh slot hari itu dan tidak lebih dari batas geser", () => {
    const plan = planDay(input());
    expect(plan.slots.map((s) => s.slotIndex)).toEqual([0, 1, 2]);
    const minutes = new Set(plan.slots.map((s) => wibParts(s.slotAt).min));
    expect(minutes.size).toBe(1);
    expect([...minutes][0]).toBe(jitterMinute("akun-1", TOMORROW));
    expect([...minutes][0]).toBeLessThanOrEqual(JITTER_MAX_MINUTES);
  });

  it("deterministik: perencanaan ulang menghasilkan slot yang sama", () => {
    expect(planDay(input())).toEqual(planDay(input()));
  });

  it("akun berbeda mendapat menit berbeda (tidak terbit serentak)", () => {
    const minutes = new Set(Array.from({ length: 33 }, (_, i) => jitterMinute(`akun-${i}`, TOMORROW)));
    expect(minutes.size).toBeGreaterThan(8);
  });

  it("alasan memuat kelipatan views dari data akun", () => {
    const top = planDay(input()).slots.find((s) => s.hour === 19)!;
    expect(top.reason).toMatch(/^Jam 19 rata-rata \d,\dx views akun ini \(9 posting\)\.$/);
  });

  it("mengisi sampai 6 slot dengan jam jaringan dan jam bawaan bila jam akun tidak cukup", () => {
    const plan = planDay(input({ settings: { ...DEFAULT_SETTINGS, exploreRate: 0, postsPerDay: 6, minGapMinutes: 120 } }));
    expect(plan.slots).toHaveLength(6);
    for (const g of gaps(plan.slots.map((s) => s.slotAt))) expect(g).toBeGreaterThanOrEqual(120);
    for (const s of plan.slots) {
      expect(s.hour).toBeGreaterThanOrEqual(6);
      expect(s.hour).toBeLessThanOrEqual(22);
    }
  });

  it("akun tanpa data memakai jam jaringan, lalu jam bawaan bila jaringan pun kosong", () => {
    const viaNetwork = planDay(input({ ownRows: [] }));
    expect(viaNetwork.source).toBe("network");
    expect(viaNetwork.slots.map((s) => s.hour)).toEqual([8, 13, 18]);

    const bare = planDay(input({ ownRows: [], networkRows: [] }));
    expect(bare.source).toBe("none");
    expect(bare.slots).toHaveLength(3);
    expect(bare.slots.every((s) => s.kind === "CADANGAN")).toBe(true);
  });

  it("slot tidak menumpuk di satu bagian hari", () => {
    const evening: HourRow[] = [
      { hour: 18, n: 9, avg: 3000 },
      { hour: 20, n: 9, avg: 2900 },
      { hour: 22, n: 9, avg: 2800 },
      { hour: 9, n: 4, avg: 500 },
    ];
    const plan = planDay(
      input({ ownRows: evening, networkRows: [], settings: { ...DEFAULT_SETTINGS, exploreRate: 0, minGapMinutes: 120 } })
    );
    expect(new Set(plan.slots.map((s) => dayPart(s.hour))).size).toBeGreaterThanOrEqual(2);
    expect(plan.slots.map((s) => s.hour)).toContain(9);
  });
});

describe("planDay: bentrok dan hari berjalan", () => {
  it("menghindari waktu yang sudah terisi (antrean sumber lain)", () => {
    const minute = jitterMinute("akun-1", TOMORROW);
    const taken = wibAt(NOW, 1, 19, minute).getTime() + 30 * MIN;
    const plan = planDay(input({ takenMs: [taken] }));
    for (const s of plan.slots) expect(Math.abs(s.slotAt.getTime() - taken)).toBeGreaterThanOrEqual(150 * MIN);
    expect(plan.slots.map((s) => s.hour)).not.toContain(19);
  });

  it("hari ini: hanya jam yang masih sempat ditulis", () => {
    // 18.30 WIB: tinggal 19, 20, 21, 22 yang mungkin.
    const late = new Date("2026-10-12T11:30:00Z");
    const plan = planDay(input({ now: late, dayKey: TODAY }));
    expect(plan.slots.length).toBeGreaterThanOrEqual(1);
    for (const s of plan.slots) {
      expect(s.slotAt.getTime()).toBeGreaterThanOrEqual(late.getTime() + PLAN_MIN_LEAD_MS);
    }
  });

  it("melengkapi kekurangan tanpa menyentuh slot yang sudah ada", () => {
    const minute = jitterMinute("akun-1", TOMORROW);
    const existing = wibAt(NOW, 1, 19, minute).getTime();
    const plan = planDay(input({ usedIndexes: [0], takenMs: [existing] }));
    expect(plan.slots).toHaveLength(2);
    expect(plan.slots.map((s) => s.slotIndex)).toEqual([1, 2]);
    expect(plan.slots.map((s) => s.hour)).toEqual([7, 12]);
  });

  it("kosong bila hari sudah penuh, hari tidak aktif, atau tanggal sudah lewat", () => {
    expect(planDay(input({ usedIndexes: [0, 1, 2] })).slots).toEqual([]);
    // 13 Okt 2026 = Selasa (2)
    expect(planDay(input({ settings: { ...DEFAULT_SETTINGS, activeDays: [0, 1, 3, 4, 5, 6] } })).slots).toEqual([]);
    expect(planDay(input({ dayKey: "2026-10-10" })).slots).toEqual([]);
  });
});

describe("planDay: eksplorasi", () => {
  it("tanpa eksplorasi bila peluangnya 0, selalu eksplorasi bila undian di bawah peluang", () => {
    expect(planDay(input()).slots.some((s) => s.kind === "EKSPLORASI")).toBe(false);

    const roll = hash32(`akun-1|${TOMORROW}|eksplorasi`) / 0x1_0000_0000;
    const plan = planDay(input({ settings: { ...DEFAULT_SETTINGS, exploreRate: Math.min(0.3, roll + 0.001) } }));
    if (roll < 0.3) {
      const explore = plan.slots.filter((s) => s.kind === "EKSPLORASI");
      expect(explore).toHaveLength(1);
      // Jam eksplorasi belum banyak dicoba dan tetap menjaga jarak.
      expect(OWN.find((r) => r.hour === explore[0].hour)?.n ?? 0).toBeLessThan(3);
      for (const g of gaps(plan.slots.map((s) => s.slotAt))) expect(g).toBeGreaterThanOrEqual(150);
      expect(plan.slots).toHaveLength(3);
    }
  });

  it("sekitar seperenam hari-akun mendapat slot eksplorasi pada peluang 0,15", () => {
    let explored = 0;
    const total = 400;
    for (let i = 0; i < total; i++) {
      const plan = planDay(input({ accountId: `akun-${i}`, settings: { ...DEFAULT_SETTINGS, exploreRate: 0.15 } }));
      if (plan.slots.some((s) => s.kind === "EKSPLORASI")) explored++;
    }
    expect(explored / total).toBeGreaterThan(0.08);
    expect(explored / total).toBeLessThan(0.24);
  });
});

describe("planDay: jam tetap", () => {
  it("memakai jam pilihan pengguna apa adanya", () => {
    const plan = planDay(
      input({ settings: { ...DEFAULT_SETTINGS, slotStrategy: "JAM_TETAP", fixedHours: [21, 8, 13], postsPerDay: 3 } })
    );
    expect(plan.slots.map((s) => s.hour)).toEqual([8, 13, 21]);
    expect(plan.slots.every((s) => s.kind === "TETAP")).toBe(true);
  });

  it("validasi jam tetap", () => {
    expect(fixedHoursError([8, 13, 21], 150)).toBeNull();
    expect(fixedHoursError([8, 13], 150)).toMatch(/3 sampai 6/);
    expect(fixedHoursError([8, 9, 21], 150)).toMatch(/Jarak/);
    expect(fixedHoursError([3, 13, 21], 150)).toMatch(/di antara/);
    expect(fixedHoursError([8, 8, 21], 150)).toMatch(/berulang/);
  });
});
