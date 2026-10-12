import { describe, expect, it } from "vitest";
import { findMentionedAccounts, parseDraftIntent, parseHour } from "../content-intent";
import type { PublishAccount } from "../publish-accounts";

describe("parseHour", () => {
  it.each([
    ["jadwalkan jam 7 malam", 19],
    ["jam 12 siang", 12],
    ["jam 1 siang", 13],
    ["jam 19.30", 19],
    ["jam 6 pagi", 6],
    ["jam 12 malam", 0],
    ["jam 5 sore", 17],
  ])("%s -> %s", (text, hour) => {
    expect(parseHour(text)).toBe(hour);
  });
  it("tanpa jam menghasilkan null", () => {
    expect(parseHour("buat draf besok")).toBeNull();
    expect(parseHour("jam 99")).toBeNull();
  });
});

describe("parseDraftIntent", () => {
  it("permintaan draf biasa dengan jumlah dan hari", () => {
    expect(parseDraftIntent("Buat 3 draf postingan untuk besok", false)).toEqual({
      count: 3,
      dayOffset: 1,
      revise: false,
      reviseIndex: null,
      hourWib: null,
    });
  });
  it("jumlah dibatasi maksimal 5 dan kata bilangan dikenali", () => {
    expect(parseDraftIntent("buatkan 9 draf", false)?.count).toBe(5);
    expect(parseDraftIntent("bikin dua caption", false)?.count).toBe(2);
  });
  it("bukan niat draf: pertanyaan analitik dan how-to", () => {
    expect(parseDraftIntent("Postingan terbaik minggu ini apa?", false)).toBeNull();
    expect(parseDraftIntent("Bagaimana cara buat konten viral?", false)).toBeNull();
    expect(parseDraftIntent("Ringkasan performa 7 hari terakhir", false)).toBeNull();
  });
  it("revisi butuh draf sebelumnya", () => {
    const withLast = parseDraftIntent("ganti draf 2 lebih singkat", true);
    expect(withLast?.revise).toBe(true);
    expect(withLast?.reviseIndex).toBe(2);
    expect(withLast?.count).toBe(1);
    expect(parseDraftIntent("ganti draf 2 lebih singkat", false)?.revise).toBe(false);
  });
  it("perintah jadwal dengan jam", () => {
    const r = parseDraftIntent("jadwalkan draf 1 jam 7 malam", true);
    expect(r?.revise).toBe(true);
    expect(r?.hourWib).toBe(19);
  });
  it("permintaan jumlah baru bukan revisi walau ada draf sebelumnya", () => {
    const r = parseDraftIntent("Jadwalkan 3 post minggu ini", true);
    expect(r?.revise).toBe(false);
    expect(r?.count).toBe(3);
    expect(r?.dayOffset).toBeNull();
  });
  it("lusa dan hari ini", () => {
    expect(parseDraftIntent("buat draf untuk lusa", false)?.dayOffset).toBe(2);
    expect(parseDraftIntent("buat draf hari ini", false)?.dayOffset).toBe(0);
  });
});

describe("findMentionedAccounts", () => {
  const acc = (id: string, username: string, outletNama: string | null = null) =>
    ({ id, username, displayName: username, outletNama, ready: true }) as unknown as PublishAccount;
  const list = [acc("1", "sukashawarma.xyz", "Condongcatur"), acc("2", "suka"), acc("3", "kopi_kita")];

  it("mengenali @username dan username polos", () => {
    expect(findMentionedAccounts("buat draf untuk @sukashawarma.xyz", list).map((a) => a.id)).toEqual(["1"]);
    expect(findMentionedAccounts("buat draf kopi_kita besok", list).map((a) => a.id)).toEqual(["3"]);
  });
  it("username pendek tidak mencocokkan potongan username lain", () => {
    expect(findMentionedAccounts("tulis untuk sukashawarma.xyz", list).map((a) => a.id)).toEqual(["1"]);
  });
  it("mengenali nama cabang persis", () => {
    expect(findMentionedAccounts("draf untuk cabang condongcatur", list).map((a) => a.id)).toEqual(["1"]);
  });
  it("tanpa sebutan akun", () => {
    expect(findMentionedAccounts("buat 3 draf", list)).toEqual([]);
  });
});
