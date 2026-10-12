import { describe, expect, it } from "vitest";
import { parsePublishIntent } from "../content-intent";
import { publishAtFor } from "../auto-publish";

describe("parsePublishIntent", () => {
  it("posting sekarang", () => {
    expect(parsePublishIntent("posting sekarang ke semua akun")).toEqual({ mode: "now", dayOffset: null, hourWib: null });
    expect(parsePublishIntent("langsung post aja")).toMatchObject({ mode: "now" });
  });
  it("terjadwal", () => {
    expect(parsePublishIntent("jadwalkan besok jam 7 malam")).toEqual({ mode: "schedule", dayOffset: 1, hourWib: 19 });
    expect(parsePublishIntent("posting besok ya")).toMatchObject({ mode: "schedule", dayOffset: 1 });
    expect(parsePublishIntent("posting sekarang tapi jam 9 pagi")).toMatchObject({ mode: "schedule", hourWib: 9 });
    expect(parsePublishIntent("jadwalkan 7 hari lagi ke semua akun")).toMatchObject({ mode: "schedule", dayOffset: 7 });
  });
  it("bukan perintah posting", () => {
    expect(parsePublishIntent("buat 3 draf postingan untuk besok")).toBeNull();
    expect(parsePublishIntent("buat ide konten untuk semua akun")).toBeNull();
    expect(parsePublishIntent("kapan jam terbaik posting?")).toBeNull();
  });
});

describe("publishAtFor", () => {
  const now = new Date("2026-10-12T08:00:00Z"); // 15.00 WIB
  const suggested = "2026-10-12T11:30:00.000Z"; // 18.30 WIB
  it("sekarang", () => {
    expect(publishAtFor(suggested, { mode: "now", dayOffset: null, hourWib: null }, now)).toBe("now");
  });
  it("jam saran agen dipakai apa adanya", () => {
    expect(publishAtFor(suggested, { mode: "schedule", dayOffset: null, hourWib: null }, now)).toBe(suggested);
  });
  it("besok pada jam saran, atau jam yang diminta", () => {
    expect(publishAtFor(suggested, { mode: "schedule", dayOffset: 1, hourWib: null }, now)).toBe("2026-10-13T11:30:00.000Z");
    expect(publishAtFor(suggested, { mode: "schedule", dayOffset: 1, hourWib: 19 }, now)).toBe("2026-10-13T12:00:00.000Z");
  });
  it("jam yang sudah lewat digeser ke hari berikutnya", () => {
    expect(publishAtFor(suggested, { mode: "schedule", dayOffset: 0, hourWib: 9 }, now)).toBe("2026-10-13T02:00:00.000Z");
  });
});
