import { describe, expect, it } from "vitest";
import { ThreadsApiError } from "../threads-publisher";
import {
  friendlyInsightsError,
  insightMetric,
  isSyncDue,
  needsMediaRefresh,
  needsMetaFill,
  wibDateKey,
  wibMidnight,
} from "../threads-insights";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("tanggal WIB", () => {
  it("23.30 UTC sudah hari berikutnya di WIB", () => {
    expect(wibDateKey(new Date("2026-10-20T23:30:00Z"))).toBe("2026-10-21");
    expect(wibMidnight(new Date("2026-10-20T23:30:00Z")).toISOString()).toBe("2026-10-20T17:00:00.000Z");
  });
});

describe("isSyncDue", () => {
  const now = new Date("2026-10-21T04:00:00Z"); // 11.00 WIB

  it("akun yang belum pernah diambil langsung jalan", () => {
    expect(isSyncDue(null, now)).toBe(true);
  });

  it("sudah diambil setelah 05.00 WIB hari ini: tidak diulang", () => {
    expect(isSyncDue(new Date("2026-10-20T22:30:00Z"), now)).toBe(false);
  });

  it("terakhir diambil kemarin: jatuh tempo", () => {
    expect(isSyncDue(new Date("2026-10-19T22:30:00Z"), now)).toBe(true);
  });

  it("sebelum 05.00 WIB belum jatuh tempo meski terakhir kemarin", () => {
    expect(isSyncDue(new Date("2026-10-19T22:30:00Z"), new Date("2026-10-20T21:00:00Z"))).toBe(false);
  });
});

describe("needsMediaRefresh", () => {
  const now = new Date("2026-10-21T04:00:00Z");

  it("belum pernah diambil metriknya", () => {
    expect(needsMediaRefresh(new Date(now.getTime() - 10 * DAY), null, now)).toBe(true);
  });

  it("postingan ≤ 3 hari diambil ulang setelah 20 jam", () => {
    const posted = new Date(now.getTime() - DAY);
    expect(needsMediaRefresh(posted, new Date(now.getTime() - 10 * HOUR), now)).toBe(false);
    expect(needsMediaRefresh(posted, new Date(now.getTime() - 21 * HOUR), now)).toBe(true);
  });

  it("postingan lama cukup seminggu sekali", () => {
    const posted = new Date(now.getTime() - 10 * DAY);
    expect(needsMediaRefresh(posted, new Date(now.getTime() - 3 * DAY), now)).toBe(false);
    expect(needsMediaRefresh(posted, new Date(now.getTime() - 8 * DAY), now)).toBe(true);
  });

  it("baris kerangka tanpa teks/permalink/jenis media asli tetap dilengkapi", () => {
    const recent = new Date(now.getTime() - 5 * 60_000);
    expect(
      needsMetaFill(
        { text: "Isi asli dari Threads", permalink: "https://www.threads.com/@akun/post/1", media_type: "VIDEO" },
        { mediaId: "m1", metricsUpdatedAt: recent, text: "", permalink: null, mediaType: "TEXT_POST" }
      )
    ).toBe(true);
    expect(
      needsMetaFill(
        { text: "Isi asli dari Threads", permalink: "https://www.threads.com/@akun/post/1", media_type: "VIDEO" },
        {
          mediaId: "m1",
          metricsUpdatedAt: recent,
          text: "Isi asli dari Threads",
          permalink: "https://www.threads.com/@akun/post/1",
          mediaType: "VIDEO",
        }
      )
    ).toBe(false);
  });
});

describe("insightMetric", () => {
  const data = [
    { name: "views", values: [{ value: 10 }, { value: 5 }] },
    { name: "likes", total_value: { value: 7 } },
    { name: "clicks", link_total_values: [{ value: 2 }, { value: 3 }] },
  ];

  it("menjumlahkan tiap bentuk respons", () => {
    expect(insightMetric(data, "views")).toBe(15);
    expect(insightMetric(data, "likes")).toBe(7);
    expect(insightMetric(data, "clicks")).toBe(5);
    expect(insightMetric(data, "quotes")).toBe(0);
    expect(insightMetric(undefined, "views")).toBe(0);
  });
});

describe("friendlyInsightsError", () => {
  it("memetakan galat Threads ke pesan yang bisa ditindaklanjuti", () => {
    expect(friendlyInsightsError(new ThreadsApiError("x", 401, 190))).toMatch(/Hubungkan ulang/);
    expect(friendlyInsightsError(new ThreadsApiError("x", 400, 10))).toMatch(/threads_manage_insights/);
    expect(friendlyInsightsError(new ThreadsApiError("x", 429))).toMatch(/rate limit/);
    expect(friendlyInsightsError(new Error("putus"))).toBe("Gagal ambil data: putus");
  });
});
