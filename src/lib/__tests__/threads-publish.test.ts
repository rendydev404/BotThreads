import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, isMissingAuditTable } from "../threads-publish";

describe("cursor", () => {
  it("roundtrip", () => {
    const at = new Date("2026-03-05T10:00:00.000Z");
    const back = decodeCursor(encodeCursor(at, "abc123"));
    expect(back?.id).toBe("abc123");
    expect(back?.at.getTime()).toBe(at.getTime());
  });

  it.each([null, "", "!!!", "bm90LWpzb24", "e30"])("input sampah %p menghasilkan null", (raw) => {
    expect(decodeCursor(raw)).toBeNull();
  });
});

describe("isMissingAuditTable", () => {
  it("mengenali pesan tabel DashboardPostLog belum ada", () => {
    expect(isMissingAuditTable(new Error('Supabase: relation "public.DashboardPostLog" does not exist (42P01)'))).toBe(true);
  });

  it("tidak salah mengenali error lain", () => {
    expect(isMissingAuditTable(new Error("Supabase: connection refused"))).toBe(false);
    expect(isMissingAuditTable(null)).toBe(false);
  });
});