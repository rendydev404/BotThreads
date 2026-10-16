import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { designatedSlots, pickAffiliate, rememberAffiliate, type AffSlot } from "../affiliate-pick";
import { parseAffiliatePatch } from "../affiliate-service";
import type { AffiliateState } from "../affiliate-store";
import { DEFAULT_AFFILIATE, effectivePerDay, isShopeeLink, normalizeNiche, replyFromTemplate } from "../affiliate-types";
import { affiliateProblems, runGate } from "../autopilot-gate";
import { bootDb, pgRpc, type TestDb } from "./helpers/pg";

/* ------------------------------------------------------------------ aturan murni */

describe("effectivePerDay", () => {
  const s = (perHari: number, porsi: number, aktif = true) => ({ aktif, perHari, porsi });
  it("memakai batas yang paling ketat antara maks per hari dan porsi", () => {
    expect(effectivePerDay(s(3, 0.3), 3)).toBe(1);
    expect(effectivePerDay(s(3, 0.3), 6)).toBe(2);
    expect(effectivePerDay(s(1, 0.3), 6)).toBe(1);
    expect(effectivePerDay(s(6, 1), 4)).toBe(4);
    expect(effectivePerDay(s(6, 0.5), 5)).toBe(3);
  });
  it("nol bila mati atau porsinya tidak cukup untuk satu postingan", () => {
    expect(effectivePerDay(s(3, 0.3, false), 6)).toBe(0);
    expect(effectivePerDay(s(3, 0.3), 1)).toBe(0);
    expect(effectivePerDay(s(0, 1), 6)).toBe(0);
  });
});

describe("isShopeeLink", () => {
  it.each(["https://s.shopee.co.id/AbC123", "https://shopee.co.id/Wajan-i.1.2", "https://shope.ee/xyz", "https://shopee.co.id"])(
    "menerima %s",
    (u) => expect(isShopeeLink(u)).toBe(true)
  );
  it.each(["http://s.shopee.co.id/x", "https://shopee.co.id.evil.com/x", "https://tokopedia.com/x", "javascript:alert(1)", "s.shopee.co.id/x", "https://u:p@shopee.co.id/"])(
    "menolak %s",
    (u) => expect(isShopeeLink(u)).toBe(false)
  );
});

it("normalizeNiche dan templat balasan", () => {
  expect(normalizeNiche("  #Dapur   Rumahan ")).toBe("dapur rumahan");
  expect(replyFromTemplate("Link: {link}\n(link affiliate)", "https://s.shopee.co.id/a")).toBe("Link: https://s.shopee.co.id/a\n(link affiliate)");
});

describe("gerbang affiliate", () => {
  it("lolos untuk postingan natural yang menyebut produk", () => {
    expect(affiliateProblems("Akhirnya nemu wajan yang telurnya nggak nempel. Link-nya aku taruh di komen ya.", "Wajan anti lengket")).toEqual([]);
  });
  it("menolak link, ajakan jualan keras, dan produk yang tidak disebut", () => {
    expect(affiliateProblems("Wajan ini mantap cek https://s.shopee.co.id/x", "Wajan granit")[0]).toMatch(/link/);
    expect(affiliateProblems("Wajan granit ini enak, checkout sekarang di keranjang kuning!", "Wajan granit").join(" ")).toMatch(/checkout.*keranjang kuning/);
    expect(affiliateProblems("Pagi ini masak telur dadar, gampang banget.", "Wajan granit").join(" ")).toMatch(/tidak disebut/);
  });
  it("runGate menambah pemeriksaan affiliate hanya untuk slot affiliate", () => {
    const base = { text: "Akhirnya nemu wajan yang telurnya nggak nempel sama sekali.", sources: [], peers: [] };
    expect(runGate(base).checks.some((c) => c.key === "affiliate")).toBe(false);
    const res = runGate({ ...base, affiliate: { nama: "Panci presto" } });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/Panci presto/);
  });
});

describe("parseAffiliatePatch", () => {
  it("semua angka bebas diatur dalam batas", () => {
    const r = parseAffiliatePatch({ aktif: true, niche: "Dapur, skincare", perHari: 6, porsi: 1, jarakJam: 0, jedaHari: 0 }, DEFAULT_AFFILIATE);
    expect(r).toMatchObject({ ok: true, value: { aktif: true, niche: ["dapur", "skincare"], perHari: 6, porsi: 1, jarakJam: 0, jedaHari: 0 } });
  });
  it("menolak nilai di luar batas, templat tanpa {link}, dan saklar nyala tanpa niche", () => {
    expect(parseAffiliatePatch({ perHari: 7 }, DEFAULT_AFFILIATE).ok).toBe(false);
    expect(parseAffiliatePatch({ porsi: 1.5 }, DEFAULT_AFFILIATE).ok).toBe(false);
    expect(parseAffiliatePatch({ jedaHari: 61 }, DEFAULT_AFFILIATE).ok).toBe(false);
    expect(parseAffiliatePatch({ templateBalasan: "tanpa link" }, DEFAULT_AFFILIATE).ok).toBe(false);
    expect(parseAffiliatePatch({ aktif: true }, DEFAULT_AFFILIATE)).toMatchObject({ ok: false, error: expect.stringMatching(/niche/) });
  });
});

/* ------------------------------------------------------------------ undian slot */

const WS = "ws1";
const at = (iso: string) => new Date(iso);

function state(over: Partial<AffiliateState> = {}): AffiliateState {
  const cfg = { ...DEFAULT_AFFILIATE, aktif: true, perHari: 1, porsi: 0.5, jarakJam: 4, jedaHari: 14, niche: ["dapur"], templateBalasan: "Ini: {link}" };
  return {
    configs: new Map([
      ["a1", { accountId: "a1", workspaceId: WS, ...cfg }],
      ["a2", { accountId: "a2", workspaceId: WS, ...cfg }],
    ]),
    paused: new Set(),
    products: [
      { id: "p1", workspaceId: WS, nama: "Wajan", link: "https://s.shopee.co.id/1", niche: ["dapur"], catatan: "" },
      { id: "p2", workspaceId: WS, nama: "Spatula", link: "https://s.shopee.co.id/2", niche: ["dapur", "masak"], catatan: "" },
      { id: "p3", workspaceId: WS, nama: "Serum", link: "https://s.shopee.co.id/3", niche: ["skincare"], catatan: "" },
      { id: "p4", workspaceId: "lain", nama: "Wajan lain", link: "https://s.shopee.co.id/4", niche: ["dapur"], catatan: "" },
    ],
    recent: [],
    lastUse: new Map(),
    ...over,
  };
}

/** Slot yang ditunjuk sebagai affiliate untuk akun pada hari itu. */
function designated(accountId: string, dayKey: string, posts: number, n: number, hours: number[]): AffSlot[] {
  const idx = [...designatedSlots(accountId, dayKey, posts, n)];
  return idx.map((i) => ({ id: `${accountId}-${dayKey}-${i}`, accountId, dayKey, slotIndex: i, slotAt: at(`${dayKey}T${String(hours[i]).padStart(2, "0")}:00:00Z`) }));
}

describe("pickAffiliate", () => {
  const HOURS = [1, 5, 9, 13];

  it("tepat sejumlah jatah efektif per hari, produknya sesuai niche dan workspace", () => {
    const st = state();
    let picked = 0;
    for (let i = 0; i < 4; i++) {
      const slot = { id: `s${i}`, accountId: "a1", dayKey: "2026-10-16", slotIndex: i, slotAt: at(`2026-10-16T${String(HOURS[i]).padStart(2, "0")}:00:00Z`) };
      const r = pickAffiliate(slot, 4, st);
      if (r) {
        picked += 1;
        expect(["p1", "p2"]).toContain(r.product.id);
        expect(r.replyText).toBe(`Ini: ${r.product.link}`);
        expect(r.delayDetik).toBeGreaterThanOrEqual(60);
        expect(r.delayDetik).toBeLessThanOrEqual(180);
        rememberAffiliate(st, slot, WS, r.product.id);
      }
    }
    // perHari 1 (porsi 50% dari 4 = 2, yang ketat 1).
    expect(picked).toBe(1);
  });

  it("tidak jalan bila mati, dijeda, tanpa niche, atau autopilot 1 posting dengan porsi kecil", () => {
    const [slot] = designated("a1", "2026-10-16", 3, 1, HOURS);
    const off = state();
    off.configs.get("a1")!.aktif = false;
    expect(pickAffiliate(slot, 3, off)).toBeNull();
    expect(pickAffiliate(slot, 3, state({ paused: new Set([WS]) }))).toBeNull();
    const noNiche = state();
    noNiche.configs.get("a1")!.niche = [];
    expect(pickAffiliate(slot, 3, noNiche)).toBeNull();
    const [one] = designated("a1", "2026-10-16", 1, 1, HOURS);
    const small = state();
    small.configs.get("a1")!.porsi = 0.3;
    expect(pickAffiliate(one, 1, small)).toBeNull();
  });

  it("produk yang sudah dipakai akun lain hari itu tidak dipakai lagi", () => {
    const st = state({
      recent: [{ slotId: "x", accountId: "a2", workspaceId: WS, productId: "p1", dayKey: "2026-10-16", slotAt: at("2026-10-16T02:00:00Z") }],
    });
    const [slot] = designated("a1", "2026-10-16", 3, 1, HOURS);
    expect(pickAffiliate(slot, 3, st)?.product.id).toBe("p2");
  });

  it("jeda produk per akun dan rotasi: yang paling lama tidak dipakai didahulukan", () => {
    const [slot] = designated("a1", "2026-10-16", 3, 1, HOURS);
    const recentP1 = state({ lastUse: new Map([["a1|p1", at("2026-10-10T00:00:00Z")]]) });
    expect(pickAffiliate(slot, 3, recentP1)?.product.id).toBe("p2");
    const both = state({ lastUse: new Map([["a1|p1", at("2026-10-10T00:00:00Z")], ["a1|p2", at("2026-10-12T00:00:00Z")]]) });
    expect(pickAffiliate(slot, 3, both)).toBeNull();
    both.configs.get("a1")!.jedaHari = 3;
    expect(pickAffiliate(slot, 3, both)?.product.id).toBe("p1");
  });

  it("menghormati jarak jam antar postingan affiliate di akun yang sama", () => {
    const st = state();
    st.configs.get("a1")!.perHari = 2;
    st.configs.get("a1")!.porsi = 1;
    const slots = designated("a1", "2026-10-16", 2, 2, [1, 3]);
    const first = pickAffiliate(slots[0], 2, st)!;
    rememberAffiliate(st, slots[0], WS, first.product.id);
    expect(pickAffiliate(slots[1], 2, st)).toBeNull();
    st.configs.get("a1")!.jarakJam = 1;
    expect(pickAffiliate(slots[1], 2, st)).not.toBeNull();
  });

  it("slot yang ditulis ulang tetap slot affiliate (undian deterministik)", () => {
    const [slot] = designated("a1", "2026-10-16", 3, 1, HOURS);
    const st = state();
    const a = pickAffiliate(slot, 3, st)!;
    rememberAffiliate(st, slot, WS, a.product.id);
    expect(pickAffiliate(slot, 3, st)?.product.id).toBe(a.product.id);
  });
});

/* ------------------------------------------------------------------ SQL (PGlite) */

describe("sql/019_affiliate.sql", () => {
  let db: TestDb;
  let productId = "";
  const NOW = "2026-10-16T05:00:00.000Z";
  const rpc = <T>(fn: string, args: Record<string, unknown>) => pgRpc<T>(db, fn, args);
  const slotRow = (id: string, idx: number, status: string, draft: unknown, postId: string | null) =>
    db.query(
      `INSERT INTO "AutopilotSlot" (id, "workspaceId", "accountId", "dayKey", "slotIndex", "slotAt", hour, status, draft, "postId")
       VALUES ($1, 'ws1', 'acc1', '2026-10-16', $2, '2026-10-16 05:00', 12, $3, $4, $5)`,
      [id, idx, status, draft === null ? null : JSON.stringify(draft), postId]
    );
  const saveUse = (slotId: string, pid = productId) =>
    rpc<string>("dash_aff_use_save", {
      p_item: { slotId, workspaceId: "ws1", accountId: "acc1", productId: pid, dayKey: "2026-10-16", slotAt: "2026-10-16T05:00:00Z", replyText: "Link: x", delayDetik: 120 },
      p_now: NOW,
    });

  beforeAll(async () => {
    db = await bootDb(["sql/002_dashboard_post_log.sql", "sql/003_dashboard_rpc.sql", "sql/005_autopilot.sql", "sql/019_affiliate.sql"]);
    await db.exec(`
      INSERT INTO "ThreadsAccount" (id, "workspaceId", username) VALUES ('acc1', 'ws1', 'satu'), ('acc2', 'ws1', 'dua');
      INSERT INTO "SocialAccount" (id, "outletId", "threadsAccountId") VALUES ('sa1', 'o1', 'acc1');
      INSERT INTO "ScheduledPost" (id, "workspaceId", judul, caption, "tayangPada") VALUES ('post1', 'ws1', 'x', 'x', '2026-10-16 05:00');
      INSERT INTO "PostDispatch" (id, "postId", "outletId", "socialAccountId", publisher, status, "platformPostId", "updatedAt")
        VALUES ('d1', 'post1', 'o1', 'sa1', 'THREADS', 'TERBIT', 'media1', '2026-10-16 05:00');
    `);
    productId = await rpc<string>("dash_aff_product_upsert", {
      p_item: { workspaceId: "ws1", nama: "Wajan", link: "https://s.shopee.co.id/1", niche: ["dapur"], catatan: "Lapisan granit." },
      p_user: "u1",
      p_now: NOW,
    });
    await rpc<number>("dash_aff_config_upsert", {
      p_items: [{ accountId: "acc1", workspaceId: "ws1", aktif: true, perHari: 2, porsi: 0.5, jarakJam: 3, jedaHari: 10, niche: ["dapur"], templateBalasan: "Link: {link}" }],
      p_user: "u1",
      p_now: NOW,
    });
  });
  afterAll(async () => db?.close());

  it("dash_aff_state mengembalikan pengaturan, katalog, dan pemakaian yang berlaku saja", async () => {
    await slotRow("slotOk", 0, "TERANTRE", { text: "a", affiliate: { productId } }, "post1");
    await slotRow("slotSkip", 1, "DILEWATI", { text: "b", affiliate: { productId } }, null);
    await slotRow("slotBiasa", 2, "TERANTRE", { text: "c" }, null);
    for (const s of ["slotOk", "slotSkip", "slotBiasa"]) expect(await saveUse(s)).toBeTruthy();

    const st = await rpc<{
      configs: { accountId: string; niche: string[]; perHari: number }[];
      products: { id: string }[];
      recent: { slotId: string }[];
      lastUse: { productId: string }[];
      paused: string[];
    }>("dash_aff_state", { p_account_ids: ["acc1"], p_from: "2026-10-16" });
    expect(st.configs).toMatchObject([{ accountId: "acc1", niche: ["dapur"], perHari: 2 }]);
    expect(st.products.map((p) => p.id)).toEqual([productId]);
    expect(st.recent.map((r) => r.slotId)).toEqual(["slotOk"]);
    expect(st.lastUse).toMatchObject([{ productId }]);
    expect(st.paused).toEqual([]);

    await rpc("dash_aff_workspace_set", { p_workspace: "ws1", p_aktif: false, p_user: "u1", p_now: NOW });
    expect((await rpc<{ paused: string[] }>("dash_aff_state", { p_account_ids: ["acc1"], p_from: "2026-10-16" })).paused).toEqual(["ws1"]);
    await rpc("dash_aff_workspace_set", { p_workspace: "ws1", p_aktif: true, p_user: "u1", p_now: NOW });
  });

  it("antrean balasan: menunggu jeda, mengunci, membatalkan yang tidak sah, lalu tercatat terkirim", async () => {
    type Job = { id: string; text: string; mediaId: string; threadsAccountId: string };
    expect(await rpc<Job[]>("dash_aff_reply_due", { p_now: "2026-10-16T05:01:00Z", p_limit: 10 })).toEqual([]);
    const jobs = await rpc<Job[]>("dash_aff_reply_due", { p_now: "2026-10-16T05:03:00Z", p_limit: 10 });
    expect(jobs).toMatchObject([{ text: "Link: x", mediaId: "media1", threadsAccountId: "acc1" }]);
    // Terkunci 5 menit: tidak diambil dua kali.
    expect(await rpc<Job[]>("dash_aff_reply_due", { p_now: "2026-10-16T05:04:00Z", p_limit: 10 })).toEqual([]);

    const st = (await db.query<{ slotId: string; status: string }>(`SELECT "slotId", status FROM "AffiliateUse" ORDER BY "slotId"`)).rows;
    expect(st).toEqual([
      { slotId: "slotBiasa", status: "BATAL" },
      { slotId: "slotOk", status: "MENUNGGU" },
      { slotId: "slotSkip", status: "BATAL" },
    ]);

    expect(await rpc<string>("dash_aff_reply_done", { p_id: jobs[0].id, p_reply_id: null, p_error: "jaringan", p_retry_at: "2026-10-16T05:10:00Z", p_now: NOW })).toBe("MENUNGGU");
    expect(await rpc<Job[]>("dash_aff_reply_due", { p_now: "2026-10-16T05:09:00Z", p_limit: 10 })).toEqual([]);
    expect(await rpc<Job[]>("dash_aff_reply_due", { p_now: "2026-10-16T05:11:00Z", p_limit: 10 })).toHaveLength(1);
    expect(await rpc<string>("dash_aff_reply_done", { p_id: jobs[0].id, p_reply_id: "reply1", p_error: null, p_retry_at: null, p_now: NOW })).toBe("TERKIRIM");
    // Upsert ulang slot yang sudah terkirim tidak mengulang balasan.
    await saveUse("slotOk");
    expect((await db.query<{ status: string }>(`SELECT status FROM "AffiliateUse" WHERE "slotId" = 'slotOk'`)).rows[0].status).toBe("TERKIRIM");
  });

  it("gagal permanen setelah 3 percobaan", async () => {
    await db.exec(`INSERT INTO "AffiliateUse" (id, "slotId", "workspaceId", "accountId", "productId", "dayKey", "slotAt", "replyText")
                   VALUES ('u3', 'slotX', 'ws1', 'acc1', 'p', '2026-10-16', '2026-10-16 05:00', 't')`);
    for (const expected of ["MENUNGGU", "MENUNGGU", "GAGAL"]) {
      expect(await rpc<string>("dash_aff_reply_done", { p_id: "u3", p_reply_id: null, p_error: "x", p_retry_at: "2026-10-16T06:00:00Z", p_now: NOW })).toBe(expected);
    }
  });

  it("dash_aff_overview merangkum katalog, akun, dan aktivitas", async () => {
    await db.exec(`UPDATE "AutopilotSlot" SET status = 'TERBIT' WHERE id = 'slotOk'`);
    const o = await rpc<{
      aktif: boolean;
      configs: { accountId: string }[];
      products: { id: string; dipakai30: number }[];
      recent: { productId: string; balasan: string }[];
      summary: { terbit: number; balasanTerkirim: number };
    }>("dash_aff_overview", { p_workspace: "ws1", p_account_ids: null, p_now: "2026-10-16T06:00:00Z" });
    expect(o.aktif).toBe(true);
    expect(o.configs.map((c) => c.accountId)).toEqual(["acc1"]);
    expect(o.products).toMatchObject([{ id: productId, dipakai30: 1 }]);
    expect(o.recent[0]).toMatchObject({ productId, balasan: "TERKIRIM" });
    expect(o.summary).toMatchObject({ terbit: 1, balasanTerkirim: 1 });
    // Pengguna berlingkup akun lain tidak melihat pengaturan akun ini.
    expect((await rpc<{ configs: unknown[] }>("dash_aff_overview", { p_workspace: "ws1", p_account_ids: ["acc2"], p_now: NOW })).configs).toEqual([]);
  });

  it("menghapus produk membatalkan balasan yang belum terkirim", async () => {
    await slotRow("slotLain", 3, "TERANTRE", { text: "d", affiliate: { productId } }, null);
    await saveUse("slotLain");
    expect(await rpc<boolean>("dash_aff_product_delete", { p_id: productId, p_workspace: "ws1", p_user: "u1", p_now: NOW })).toBe(true);
    expect((await db.query<{ status: string }>(`SELECT status FROM "AffiliateUse" WHERE "slotId" = 'slotLain'`)).rows[0].status).toBe("BATAL");
  });

  it("hanya service_role yang boleh menjalankan fungsi", async () => {
    await db.exec(`SET ROLE service_role`);
    try {
      await expect(pgRpc(db, "dash_aff_state", { p_account_ids: ["acc1"], p_from: "2026-10-16" })).resolves.toBeTruthy();
    } finally {
      await db.exec(`RESET ROLE`);
    }
    await db.exec(`SET ROLE anon`);
    try {
      await expect(pgRpc(db, "dash_aff_state", { p_account_ids: ["acc1"], p_from: "2026-10-16" })).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec(`RESET ROLE`);
    }
  });
});
