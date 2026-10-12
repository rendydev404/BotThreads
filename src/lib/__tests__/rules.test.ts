import { describe, expect, it } from "vitest";
import { isAccountError, postStatusView } from "../post-status";
import { evaluateReadiness, type ReadinessInput } from "../readiness";
import {
  parseCreateBody,
  parseIdList,
  parseOrchestrateBody,
  parsePatchBody,
  parseRecommendBody,
} from "../content-validation";

const NOW = new Date("2026-10-12T03:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);

describe("postStatusView", () => {
  const base = { postStatus: "MENUNGGU", dispatchStatus: "MENUNGGU", platformContainerId: null, lockedAt: null };

  it("terbit", () => {
    const v = postStatusView({ ...base, dispatchStatus: "TERBIT", postStatus: "SELESAI", tayangPada: at(-1000) }, NOW);
    expect(v.key).toBe("PUBLISHED");
    expect([v.editable, v.cancellable, v.retryable]).toEqual([false, false, false]);
  });
  it("gagal bisa dikirim ulang", () => {
    const v = postStatusView({ ...base, dispatchStatus: "GAGAL", postStatus: "GAGAL", tayangPada: at(-1000) }, NOW);
    expect(v.key).toBe("FAILED");
    expect(v.retryable).toBe(true);
  });
  it("terjadwal jauh: bisa ubah dan batal", () => {
    const v = postStatusView({ ...base, tayangPada: at(5 * 60_000) }, NOW);
    expect(v.key).toBe("SCHEDULED");
    expect([v.editable, v.cancellable]).toEqual([true, true]);
  });
  it("terjadwal kurang dari semenit: tidak bisa diubah", () => {
    const v = postStatusView({ ...base, tayangPada: at(30_000) }, NOW);
    expect(v.key).toBe("SCHEDULED");
    expect([v.editable, v.cancellable]).toEqual([false, true]);
  });
  it("mengantre: lewat waktu tapi belum diambil worker", () => {
    const v = postStatusView({ ...base, tayangPada: at(-60_000) }, NOW);
    expect(v.key).toBe("QUEUED");
    expect(v.cancellable).toBe(true);
  });
  it("diproses: terkunci atau punya container", () => {
    expect(postStatusView({ ...base, tayangPada: at(-1000), lockedAt: at(-500) }, NOW).key).toBe("PROCESSING");
    expect(postStatusView({ ...base, tayangPada: at(-1000), platformContainerId: "c1" }, NOW).key).toBe("PROCESSING");
    expect(postStatusView({ ...base, tayangPada: at(-1000), postStatus: "DIPROSES" }, NOW).cancellable).toBe(false);
  });
});

describe("isAccountError", () => {
  it("mengenali masalah sesi akun", () => {
    expect(isAccountError("Sesi Threads berakhir, hubungkan ulang")).toBe(true);
    expect(isAccountError("Timeout dari Threads")).toBe(false);
    expect(isAccountError(null)).toBe(false);
  });
});

describe("evaluateReadiness", () => {
  const ok: ReadinessInput = {
    id: "A1",
    username: "Suka.Cabang",
    needsReconnect: false,
    accessExpiresAt: at(86_400_000),
    scopes: ["threads_basic", "threads_content_publish"],
    socialAccountId: "sa1",
    outletId: "o1",
    outletActive: true,
  };
  it("siap bila semua syarat terpenuhi", () => {
    expect(evaluateReadiness(ok, NOW, null)).toBeUndefined();
  });
  it("urutan alasan", () => {
    expect(evaluateReadiness({ ...ok, socialAccountId: null }, NOW, null)).toBe("NOT_MAPPED");
    expect(evaluateReadiness({ ...ok, outletActive: false }, NOW, null)).toBe("OUTLET_INACTIVE");
    expect(evaluateReadiness({ ...ok, needsReconnect: true }, NOW, null)).toBe("NEEDS_RECONNECT");
    expect(evaluateReadiness({ ...ok, accessExpiresAt: at(-1) }, NOW, null)).toBe("TOKEN_EXPIRED");
    expect(evaluateReadiness({ ...ok, scopes: ["threads_basic"] }, NOW, null)).toBe("NO_PUBLISH_SCOPE");
  });
  it("pembatas masa uji memakai id atau username (tak peka huruf besar/kecil)", () => {
    expect(evaluateReadiness(ok, NOW, ["lain"])).toBe("TEST_RESTRICTED");
    expect(evaluateReadiness(ok, NOW, ["suka.cabang"])).toBeUndefined();
    expect(evaluateReadiness(ok, NOW, ["a1"])).toBeUndefined();
  });
});

describe("parseCreateBody", () => {
  const item = { threadsAccountId: "acc1", text: "Halo", publishAt: "now" };
  it("menerima body valid", () => {
    const r = parseCreateBody({ idempotencyKey: "key-12345678", items: [item] });
    expect(r.ok).toBe(true);
  });
  it("menolak key pendek, item kosong, dan lebih dari 10 item", () => {
    expect(parseCreateBody({ idempotencyKey: "x", items: [item] }).ok).toBe(false);
    expect(parseCreateBody({ idempotencyKey: "key-12345678", items: [] }).ok).toBe(false);
    expect(parseCreateBody({ idempotencyKey: "key-12345678", items: Array(11).fill(item) }).ok).toBe(false);
  });
  it("menolak teks kosong dan topik tidak valid", () => {
    expect(parseCreateBody({ idempotencyKey: "key-12345678", items: [{ ...item, text: "  " }] }).ok).toBe(false);
    expect(parseCreateBody({ idempotencyKey: "key-12345678", items: [{ ...item, topicTag: "a.b" }] }).ok).toBe(false);
  });
});

describe("parseRecommendBody", () => {
  it("default 3 draf dan dedupe akun", () => {
    const r = parseRecommendBody({ accountIds: ["a", "a", "b"] });
    expect(r.ok && r.value.accountIds).toEqual(["a", "b"]);
    expect(r.ok && r.value.count).toBe(3);
  });
  it("membatasi akun, jumlah, tanggal, dan brief", () => {
    expect(parseRecommendBody({ accountIds: [] }).ok).toBe(false);
    expect(parseRecommendBody({ accountIds: ["1", "2", "3", "4", "5", "6"] }).ok).toBe(false);
    expect(parseRecommendBody({ accountIds: ["a"], count: 6 }).ok).toBe(false);
    expect(parseRecommendBody({ accountIds: ["a"], date: "13-10-2026" }).ok).toBe(false);
    expect(parseRecommendBody({ accountIds: ["a"], brief: "x".repeat(601) }).ok).toBe(false);
  });
});

describe("parsePatchBody & parseIdList", () => {
  it("patch minimal satu perubahan", () => {
    expect(parsePatchBody({}).ok).toBe(false);
    expect(parsePatchBody({ text: "baru" }).ok).toBe(true);
    expect(parsePatchBody({ publishAt: "now" }).ok).toBe(false);
  });
  it("daftar id: unik, maksimal 20, karakter wajar", () => {
    expect(parseIdList("a,b,a")).toEqual(["a", "b"]);
    expect(parseIdList("")).toBeNull();
    expect(parseIdList("a;b")).toBeNull();
    expect(parseIdList(Array.from({ length: 21 }, (_, i) => `i${i}`).join(","))).toBeNull();
  });
});

describe("parseOrchestrateBody", () => {
  it("default: semua akun, jam terbaik tiap akun", () => {
    const r = parseOrchestrateBody({});
    expect(r.ok && r.value).toEqual({ accountIds: null, topic: "", fixedTime: null, avoid: null, publish: null });
  });
  it("jam manual HH:MM dan dedupe akun", () => {
    const r = parseOrchestrateBody({ accountIds: ["a", "a"], time: "17:30", topic: "  kopi  " });
    expect(r.ok && r.value).toMatchObject({ accountIds: ["a"], topic: "kopi", fixedTime: { hour: 17, minute: 30 } });
  });
  it("menolak jam, akun, dan topik yang tidak valid", () => {
    expect(parseOrchestrateBody({ time: "25:00" }).ok).toBe(false);
    expect(parseOrchestrateBody({ time: "7.30" }).ok).toBe(false);
    expect(parseOrchestrateBody({ accountIds: [] }).ok).toBe(false);
    expect(parseOrchestrateBody({ accountIds: [1] }).ok).toBe(false);
    expect(parseOrchestrateBody({ topic: "x".repeat(601) }).ok).toBe(false);
  });
});

describe("parseCreateBody: mode partial", () => {
  const item = { threadsAccountId: "a", text: "halo dunia", topicTag: null, publishAt: "now" };
  it("hanya aktif bila bernilai tepat true", () => {
    const off = parseCreateBody({ idempotencyKey: "kunci-12345", items: [item] });
    const on = parseCreateBody({ idempotencyKey: "kunci-12345", items: [item], partial: true });
    const odd = parseCreateBody({ idempotencyKey: "kunci-12345", items: [item], partial: "true" });
    expect([off.ok && off.value.partial, on.ok && on.value.partial, odd.ok && odd.value.partial]).toEqual([false, true, false]);
  });
});
