import { describe, expect, it } from "vitest";
import { extractTopic, isContentRequest, resolveContentScope, type ChatTurn } from "../content-scope";
import type { PublishAccount } from "../publish-accounts";

const acc = (id: string, username: string): PublishAccount => ({
  id,
  username,
  displayName: username,
  avatarUrl: null,
  outletNama: null,
  ready: true,
  socialAccountId: null,
  outletId: null,
  workspaceId: null,
  tenantId: null,
});
const accounts = [acc("a1", "akbaralatas"), acc("a2", "theakbaralatas"), acc("a3", "sukashawarmaofficial")];

const resolve = (text: string, history: ChatTurn[] = [], accountFilter: string | null = "all") =>
  resolveContentScope({ text, history, accounts, hasLastDrafts: false, accountFilter });

describe("isContentRequest", () => {
  it("permintaan konten", () => {
    expect(isContentRequest("Buat 3 draf postingan untuk besok")).toBe(true);
    expect(isContentRequest("kasih 2 contoh postingan soal prompt AI")).toBe(true);
    expect(isContentRequest("Buat ide konten untuk semua akun")).toBe(true);
  });
  it("bukan permintaan konten", () => {
    expect(isContentRequest("Apa pola postingan terbaik dan kenapa berhasil?")).toBe(false);
    expect(isContentRequest("kasih tau postingan terbaik minggu ini")).toBe(false);
    expect(isContentRequest("Peringkat akun berdasarkan views minggu ini")).toBe(false);
  });
});

describe("resolveContentScope", () => {
  it("semua akun disebut langsung -> semua akun", () => {
    expect(resolve("buatkan ide postingan soal prompt AI untuk semua akun")).toEqual({
      kind: "all",
      accountIds: null,
      topic: "prompt AI",
      time: null,
      publish: null,
    });
  });

  it("balasan lanjutan 'untuk semua akun buat nya' memakai topik permintaan sebelumnya", () => {
    const history: ChatTurn[] = [
      { sender: "user", text: "kasih 2 contoh postingan soal prompt AI untuk @akbaralatas" },
      { sender: "bot", text: "Ini idenya\n```ide\nakun: @akbaralatas\n---\nisi\n```" },
      { sender: "user", text: "ya iya akun personal mah jangan kyk gitu" },
      { sender: "bot", text: "Revisi draf\n```ide\n---\nisi\n```" },
    ];
    expect(resolve("untuk semua akun buat nya", history)).toMatchObject({ kind: "all", topic: "prompt AI" });
    expect(resolve("semuanya", history)).toMatchObject({ kind: "all" });
  });

  it("tanpa konteks konten, 'semua akun' bukan permintaan konten", () => {
    expect(resolve("berapa followers semua akun?")).toBeNull();
    expect(resolve("untuk semua akun", [{ sender: "user", text: "Ringkasan performa 7 hari" }])).toBeNull();
  });

  it("beberapa akun disebut -> akun itu saja", () => {
    expect(resolve("buat draf untuk @akbaralatas dan @sukashawarmaofficial jam 7 malam")).toEqual({
      kind: "accounts",
      accountIds: ["a1", "a3"],
      topic: "",
      time: "19:00",
      publish: null,
    });
  });

  it("perintah posting ikut terbawa ke cakupan", () => {
    expect(resolve("posting sekarang ke semua akun tentang menu baru")).toMatchObject({
      kind: "all",
      topic: "menu baru",
      publish: { mode: "now", dayOffset: null, hourWib: null },
    });
    expect(resolve("jadwalkan besok jam 7 malam postingan promo untuk semua akun")).toMatchObject({
      kind: "all",
      publish: { mode: "schedule", dayOffset: 1, hourWib: 19 },
    });
  });

  it("satu akun -> jalur draf biasa", () => {
    expect(resolve("buat 3 draf untuk @akbaralatas")).toEqual({ kind: "single", publish: null });
    expect(resolve("buat 3 draf", [], "akbaralatas")).toEqual({ kind: "single", publish: null });
  });

  it("cakupan tidak jelas -> tanya pengguna", () => {
    expect(resolve("Buat 3 draf postingan untuk besok")).toEqual({ kind: "ask", topic: "", time: null, publish: null });
    expect(resolve("buat ide konten untuk beberapa akun", [], "akbaralatas")).toMatchObject({ kind: "ask" });
  });
});

describe("extractTopic", () => {
  it("mengambil topik setelah kata penanda", () => {
    expect(extractTopic("bikinin postingan tentang menu baru ramadan untuk semua akun")).toBe("menu baru ramadan");
  });
  it("perintah umum tanpa topik -> kosong", () => {
    expect(extractTopic("Buat ide postingan dari postingan terbaik")).toBe("");
    expect(extractTopic("Jadwalkan 3 post minggu ini")).toBe("");
  });
});
