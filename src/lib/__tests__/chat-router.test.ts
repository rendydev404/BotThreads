import { describe, expect, it } from "vitest";
import { draftIntentFromDecision, parseDecision, scopeFromDecision, singleAccountOf, type RouteDecision } from "../chat-router";
import { isRolePromptRequest } from "../role-prompt";
import { parsePublishIntent } from "../content-intent";
import type { PublishAccount } from "../publish-accounts";

const HANDLES = ["theakbaralatas", "sukashawarmaofficial", "kemitraansukashawarma"];
const acc = (id: string, username: string, ready = true) => ({ id, username, displayName: username, ready }) as unknown as PublishAccount;
const ACCOUNTS = [acc("a1", "theakbaralatas"), acc("a2", "sukashawarmaofficial"), acc("a3", "kemitraansukashawarma")];
const decision = (d: Partial<RouteDecision>): RouteDecision => ({
  intent: "CONTENT",
  also: [],
  accounts: null,
  topic: null,
  count: null,
  revise: false,
  ...d,
});

describe("parseDecision", () => {
  it("kasus screenshot: prompt profil + saran bahasan", () => {
    const d = parseDecision(
      { intent: "ROLE_PROMPT", also: ["ADVICE", "ROLE_PROMPT", "NGAWUR"], akun: [], topik: "bahasan atau curhat yang viral di Threads", jumlah: 0 },
      HANDLES
    );
    expect(d).toEqual({
      intent: "ROLE_PROMPT",
      also: ["ADVICE"],
      accounts: null,
      topic: "bahasan atau curhat yang viral di Threads",
      count: null,
      revise: false,
    });
  });

  it("akun: semua, handle yang dikenal saja, beberapa tanpa nama; intent tak dikenal ditolak", () => {
    expect(parseDecision({ intent: "CONTENT", akun: ["all"] }, HANDLES)?.accounts).toBe("all");
    expect(parseDecision({ intent: "CONTENT", akun: ["@TheAkbarAlatas", "akunpalsu"] }, HANDLES)?.accounts).toEqual(["theakbaralatas"]);
    expect(parseDecision({ intent: "CONTENT", akun: ["beberapa"] }, HANDLES)?.accounts).toBe("some");
    expect(parseDecision({ intent: "CONTENT", akun: ["akunpalsu"] }, HANDLES)?.accounts).toBeNull();
    expect(parseDecision({ intent: "HAPUS_SEMUA" }, HANDLES)).toBeNull();
    expect(parseDecision(null, HANDLES)).toBeNull();
  });

  it("jumlah dibatasi 1-10, topik pendek dibuang", () => {
    expect(parseDecision({ intent: "CONTENT", jumlah: 50, topik: "a" }, HANDLES)).toMatchObject({ count: 10, topic: null });
    expect(parseDecision({ intent: "CONTENT", jumlah: 0 }, HANDLES)?.count).toBeNull();
  });
});

describe("scopeFromDecision", () => {
  const base = { accounts: ACCOUNTS, accountFilter: null, publish: null, text: "x" };

  it("semua akun -> orchestrator; 2 akun -> akun itu; 1 akun -> draf biasa; tidak jelas -> tanya", () => {
    expect(scopeFromDecision({ ...base, decision: decision({ accounts: "all", topic: "promo" }) })).toMatchObject({ kind: "all", topic: "promo" });
    expect(scopeFromDecision({ ...base, decision: decision({ accounts: ["theakbaralatas", "sukashawarmaofficial"] }) })).toMatchObject({
      kind: "accounts",
      accountIds: ["a1", "a2"],
    });
    expect(scopeFromDecision({ ...base, decision: decision({ accounts: ["theakbaralatas"] }) }).kind).toBe("single");
    expect(scopeFromDecision({ ...base, decision: decision({}) }).kind).toBe("ask");
    expect(scopeFromDecision({ ...base, accountFilter: "theakbaralatas", decision: decision({}) }).kind).toBe("single");
  });

  it("satu akun siap: tidak perlu bertanya", () => {
    const one = [acc("a1", "theakbaralatas"), acc("a2", "lain", false)];
    expect(scopeFromDecision({ ...base, accounts: one, decision: decision({}) }).kind).toBe("single");
  });

  it("posting langsung hanya bila intent PUBLISH DAN ada perintah eksplisit", () => {
    const text = "posting sekarang ke semua akun tentang promo akhir bulan";
    const publish = parsePublishIntent(text);
    expect(publish?.mode).toBe("now");
    expect(scopeFromDecision({ ...base, text, publish, decision: decision({ intent: "PUBLISH", accounts: "all" }) })).toMatchObject({
      kind: "all",
      publish: { mode: "now" },
    });
    // Router bilang CONTENT: walau ada kata posting, tidak langsung tayang.
    expect(scopeFromDecision({ ...base, text, publish, decision: decision({ intent: "CONTENT", accounts: "all" }) })).toMatchObject({
      publish: null,
    });
  });

  it("jam dari pesan ikut terbawa", () => {
    const text = "bikin draf untuk semua akun jam 7 malam";
    expect(scopeFromDecision({ ...base, text, decision: decision({ accounts: "all" }) })).toMatchObject({ time: "19:00" });
  });
});

describe("draftIntentFromDecision", () => {
  it("revisi draf kedua hanya bila ada draf sebelumnya", () => {
    const d = decision({ revise: true });
    expect(draftIntentFromDecision(d, "draf kedua bikin lebih pendek", true)).toMatchObject({ revise: true, reviseIndex: 2, count: 1 });
    expect(draftIntentFromDecision(d, "draf kedua bikin lebih pendek", false)).toMatchObject({ revise: false, count: 3 });
  });

  it("jumlah dan waktu dari keputusan/pesan", () => {
    expect(draftIntentFromDecision(decision({ count: 5 }), "buat 5 draf untuk besok jam 8 pagi", false)).toMatchObject({
      count: 5,
      dayOffset: 1,
      hourWib: 8,
    });
  });

  it("akun tunggal dari keputusan", () => {
    expect(singleAccountOf(decision({ accounts: ["theakbaralatas"] }))).toBe("theakbaralatas");
    expect(singleAccountOf(decision({ accounts: "all" }))).toBeNull();
  });
});

describe("cadangan kata kunci (router AI tidak menjawab)", () => {
  it("'prompt untuk isi profil' dikenali sebagai prompt peran", () => {
    expect(
      isRolePromptRequest(
        "buatin gw prompt untuk isi profil gw nah menurut lu kasih saran, bahas atau curhat apa aja biar rame di threads biar viral"
      )
    ).toBe(true);
    expect(isRolePromptRequest("buatin isi profil buat akun gw")).toBe(true);
    // Permintaan konten tetap konten.
    expect(isRolePromptRequest("buat postingan tentang profil perusahaan")).toBe(false);
  });
});
