/**
 * Auto Komentar: aturan murni (src/lib/auto-comment-rules.ts) dan batas anti-spam di SQL asli
 * (sql/043_auto_comment.sql di Postgres in-memory): jadwal jam bebas WIB dengan jendela 2 jam, saringan kandidat,
 * jeda/cooldown/batas harian, validasi komentar, dan aturan mode/peran.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  COOLDOWN_MIN,
  OWN_ONLY_NOTE,
  cooldownSince,
  dueSlot,
  filterCandidates,
  gateReason,
  normalizeSlot,
  parseAccountSettings,
  parseWorkspaceConfig,
  pickKeywords,
  roleAtLeast,
  roleForAccountChange,
  validateComment,
  type SearchPost,
} from "../auto-comment-rules";
import { bootDb, type TestDb } from "./helpers/pg";

const MIN = 60_000;
const HOUR = 60 * MIN;
/** 2026-10-19 10:00 WIB = 03:00 UTC. */
const NOW = new Date("2026-10-19T03:00:00Z");

describe("dueSlot (jam bebas WIB, sekali sehari, jendela 2 jam)", () => {
  const none = new Set<string>();

  it("jatuh tempo tepat di jamnya dan memakai WIB, bukan UTC", () => {
    expect(dueSlot(["10:00"], NOW, none)).toMatchObject({ dayKey: "2026-10-19", slot: "10:00" });
    // 03:00 UTC bukan jam 03:00 WIB.
    expect(dueSlot(["03:00"], NOW, none)).toBeNull();
  });

  it("menit bebas dan format longgar dinormalkan", () => {
    expect(dueSlot(["9.47"], NOW, none)).toMatchObject({ slot: "09:47" });
    expect(normalizeSlot("7:05")).toBe("07:05");
    expect(normalizeSlot("24:00")).toBeNull();
    expect(normalizeSlot("12:60")).toBeNull();
  });

  it("masih jalan sampai 2 jam setelah jamnya, lewat dari itu dilewati", () => {
    expect(dueSlot(["08:01"], NOW, none)?.slot).toBe("08:01");
    expect(dueSlot(["08:00"], NOW, none)).toBeNull();
    expect(dueSlot(["10:01"], NOW, none)).toBeNull(); // belum waktunya
  });

  it("sekali per hari: jam yang sudah dijalankan hari ini tidak jatuh tempo lagi", () => {
    expect(dueSlot(["09:30"], NOW, new Set(["2026-10-19|09:30"]))).toBeNull();
    // Kunci hari lain tidak berpengaruh.
    expect(dueSlot(["09:30"], NOW, new Set(["2026-10-18|09:30"]))?.slot).toBe("09:30");
  });

  it("jam larut malam yang dijalankan lewat tengah malam tetap milik hari sebelumnya", () => {
    const after = new Date("2026-10-19T17:20:00Z"); // 00:20 WIB tgl 20
    expect(dueSlot(["23:30"], after, none)).toMatchObject({ dayKey: "2026-10-19", slot: "23:30" });
    expect(dueSlot(["23:30"], after, new Set(["2026-10-19|23:30"]))).toBeNull();
  });

  it("beberapa jam jatuh tempo: yang paling awal dulu", () => {
    expect(dueSlot(["09:50", "09:10", "11:00"], NOW, none)?.slot).toBe("09:10");
    expect(dueSlot(["09:50", "09:10"], NOW, new Set(["2026-10-19|09:10"]))?.slot).toBe("09:50");
  });
});

describe("pengaturan akun dan workspace", () => {
  it("akun menyala wajib 1-12 jam dan 1-20 kata kunci; Mati boleh kosong", () => {
    expect(parseAccountSettings({ mode: "MATI", slots: [], keywords: [] }).ok).toBe(true);
    expect(parseAccountSettings({ mode: "TINJAU", slots: [], keywords: ["kopi"] })).toMatchObject({ ok: false });
    expect(parseAccountSettings({ mode: "TINJAU", slots: ["09:00"], keywords: [] })).toMatchObject({ ok: false });
    const slots13 = Array.from({ length: 13 }, (_, i) => `${String(i + 5).padStart(2, "0")}:07`);
    expect(parseAccountSettings({ mode: "TINJAU", slots: slots13, keywords: ["kopi"] })).toMatchObject({ ok: false });
    expect(parseAccountSettings({ mode: "TINJAU", slots: ["09:00"], keywords: Array.from({ length: 21 }, (_, i) => `kata ${i}`) })).toMatchObject({ ok: false });
    expect(parseAccountSettings({ mode: "TINJAU", slots: ["09:00"], keywords: ["k"] })).toMatchObject({ ok: false });
    const ok = parseAccountSettings({ mode: "OTOMATIS", slots: ["21:05", "07:33", "7:33"], keywords: [" Kopi  susu ", "kopi susu", "roti"], dailyCap: 5 });
    expect(ok).toEqual({ ok: true, value: { mode: "OTOMATIS", slots: ["07:33", "21:05"], keywords: ["Kopi susu", "roti"], dailyCap: 5 } });
  });

  it("batas harian bawaan 3, maksimal 12", () => {
    const base = { mode: "TINJAU", slots: ["09:00"], keywords: ["kopi"] };
    expect(parseAccountSettings(base)).toMatchObject({ ok: true, value: { dailyCap: 3 } });
    expect(parseAccountSettings({ ...base, dailyCap: 12 }).ok).toBe(true);
    expect(parseAccountSettings({ ...base, dailyCap: 13 }).ok).toBe(false);
    expect(parseAccountSettings({ ...base, dailyCap: 0 }).ok).toBe(false);
  });

  it("aturan workspace: jeda >= 10 menit, cooldown >= 14 hari, umur 1-72 jam, blokir dinormalkan", () => {
    const base = { aktif: true, gapMinutes: 15, cooldownDays: 30, maxPostAgeHours: 24, blockList: ["@Pesaing", "pesaing", " ", "a.b_c"] };
    expect(parseWorkspaceConfig(base)).toEqual({
      ok: true,
      value: { aktif: true, gapMinutes: 15, cooldownDays: 30, maxPostAgeHours: 24, blockList: ["a.b_c", "pesaing"] },
    });
    expect(parseWorkspaceConfig({ ...base, gapMinutes: 9 }).ok).toBe(false);
    expect(parseWorkspaceConfig({ ...base, cooldownDays: 13 }).ok).toBe(false);
    expect(parseWorkspaceConfig({ ...base, maxPostAgeHours: 0 }).ok).toBe(false);
    expect(parseWorkspaceConfig({ ...base, maxPostAgeHours: 73 }).ok).toBe(false);
    expect(parseWorkspaceConfig({ ...base, blockList: ["bukan username!"] }).ok).toBe(false);
  });
});

describe("mode dan peran", () => {
  it("menyalakan atau mengubah akun Otomatis hanya Admin/Pemilik; Tinjau cukup Editor", () => {
    expect(roleForAccountChange("MATI", "OTOMATIS")).toBe("ADMIN");
    expect(roleForAccountChange("OTOMATIS", "OTOMATIS")).toBe("ADMIN");
    expect(roleForAccountChange("OTOMATIS", "MATI")).toBe("ADMIN");
    expect(roleForAccountChange("MATI", "TINJAU")).toBe("EDITOR");
    expect(roleForAccountChange("TINJAU", "MATI")).toBe("EDITOR");
    expect(roleAtLeast("EDITOR", "ADMIN")).toBe(false);
    expect(roleAtLeast("OWNER", "ADMIN")).toBe(true);
    expect(roleAtLeast("VIEWER", "EDITOR")).toBe(false);
  });
});

describe("jeda, cooldown, batas harian (pra-cek)", () => {
  const base = { used: 0, dailyCap: 3, lastAt: null, wsLastAt: null, gapMinutes: 15, sends: true, now: NOW };

  it("batas harian menghitung draf dan kiriman", () => {
    expect(gateReason({ ...base, used: 3 })).toBe("BATAS_HARIAN");
    expect(gateReason({ ...base, used: 2 })).toBeNull();
  });

  it("jeda akun 30 menit dan jeda workspace (tidak pernah di bawah 10 menit)", () => {
    expect(gateReason({ ...base, lastAt: new Date(NOW.getTime() - 29 * MIN) })).toBe("JEDA_AKUN");
    expect(gateReason({ ...base, lastAt: new Date(NOW.getTime() - 31 * MIN) })).toBeNull();
    expect(gateReason({ ...base, wsLastAt: new Date(NOW.getTime() - 14 * MIN) })).toBe("JEDA_WORKSPACE");
    expect(gateReason({ ...base, wsLastAt: new Date(NOW.getTime() - 16 * MIN) })).toBeNull();
    expect(gateReason({ ...base, gapMinutes: 1, wsLastAt: new Date(NOW.getTime() - 9 * MIN) })).toBe("JEDA_WORKSPACE");
  });

  it("draf mode Tinjau hanya dibatasi batas harian", () => {
    expect(gateReason({ ...base, sends: false, lastAt: new Date(NOW.getTime() - MIN) })).toBeNull();
  });

  it("cooldown penulis tidak pernah kurang dari 14 hari", () => {
    expect(cooldownSince(NOW, 3).getTime()).toBe(NOW.getTime() - COOLDOWN_MIN * 24 * HOUR);
    expect(cooldownSince(NOW, 30).getTime()).toBe(NOW.getTime() - 30 * 24 * HOUR);
  });
});

describe("saringan kandidat", () => {
  const post = (over: Partial<SearchPost> = {}): SearchPost => ({
    id: over.id ?? "m1",
    username: "pembaca",
    text: "Pagi ini nyobain kopi susu gula aren di dekat kantor, enak banget",
    permalink: "https://www.threads.net/@pembaca/post/x",
    timestamp: new Date(NOW.getTime() - HOUR).toISOString(),
    isReply: false,
    keyword: "kopi",
    ...over,
  });
  const ctx = { now: NOW, ownUsername: "akunku", maxPostAgeHours: 24, blockList: new Set(["diblokir"]), botUsernames: new Set(["akunbot"]) };

  it("posting akun sendiri bukan kandidat dan menandai izin pencarian publik belum disetujui", () => {
    const r = filterCandidates([post({ username: "akunku" }), post({ id: "m2", username: "AkunKu" })], ctx);
    expect(r).toMatchObject({ eligible: [], skipped: [], ownOnly: true });
    expect(OWN_ONLY_NOTE).toContain("Sebelum izin pencarian disetujui Meta");
  });

  it("melewati balasan, blokir, akun BotThreads, posting lama, teks pendek, dan topik sensitif", () => {
    const r = filterCandidates(
      [
        post({ id: "a", isReply: true }),
        post({ id: "b", username: "diblokir" }),
        post({ id: "c", username: "akunbot" }),
        post({ id: "d", username: "lama", timestamp: new Date(NOW.getTime() - 25 * HOUR).toISOString() }),
        post({ id: "e", username: "pendek", text: "kopi enak" }),
        post({ id: "f", username: "duka", text: "Innalillahi, turut berduka untuk keluarga besar kami hari ini" }),
        post({ id: "g", username: "promo", text: "Promo kopi susu hari ini diskon besar untuk semua menu" }),
        post({ id: "h", username: "tanpalink", permalink: null }),
        post({ id: "ok", username: "layak" }),
      ],
      ctx
    );
    expect(r.eligible.map((p) => p.id)).toEqual(["ok"]);
    expect(Object.fromEntries(r.skipped.map((s) => [s.post.id, s.reason]))).toEqual({
      a: "Balasan, bukan postingan utama.",
      b: "Penulis ada di daftar blokir.",
      c: "Penulisnya akun BotThreads.",
      d: "Postingan terlalu lama.",
      e: "Teks postingan terlalu pendek.",
      f: "Topik sensitif atau promosi.",
      g: "Topik sensitif atau promosi.",
      h: "Tanpa tautan postingan.",
    });
    expect(r.ownOnly).toBe(false);
  });

  it("umur posting mengikuti aturan workspace dan format waktu Threads (+0000)", () => {
    const at = "2026-10-19T00:30:00+0000"; // 2,5 jam lalu
    expect(filterCandidates([post({ timestamp: at })], { ...ctx, maxPostAgeHours: 2 }).eligible).toHaveLength(0);
    expect(filterCandidates([post({ timestamp: at })], { ...ctx, maxPostAgeHours: 3 }).eligible).toHaveLength(1);
  });

  it("duplikat dibuang, satu kandidat per penulis, terbaru dulu", () => {
    const r = filterCandidates(
      [
        post({ id: "lama", timestamp: new Date(NOW.getTime() - 3 * HOUR).toISOString() }),
        post({ id: "baru", timestamp: new Date(NOW.getTime() - 10 * MIN).toISOString() }),
        post({ id: "baru" }),
        post({ id: "lain", username: "orang_lain", timestamp: new Date(NOW.getTime() - 2 * HOUR).toISOString() }),
      ],
      ctx
    );
    expect(r.eligible.map((p) => p.id)).toEqual(["baru", "lain"]);
  });

  it("paling banyak 2 kata kunci per putaran, bergilir", () => {
    const kws = ["a", "b", "c", "d"];
    expect(pickKeywords(kws, "2026-10-19|09:00")).toHaveLength(2);
    expect(pickKeywords(["x"], "s")).toEqual(["x"]);
    const used = new Set(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].flatMap((s) => pickKeywords(kws, s)));
    expect(used.size).toBeGreaterThan(2);
  });
});

describe("validasi komentar", () => {
  it("menerima komentar singkat yang wajar", () => {
    expect(validateComment(' "Gula aren memang bikin kopi susu jadi lebih nendang, setuju banget." ')).toEqual({
      ok: true,
      text: "Gula aren memang bikin kopi susu jadi lebih nendang, setuju banget.",
    });
  });

  it.each([
    ["mampir ke https://toko.id ya", "Komentar memuat link."],
    ["cek toko.com deh", "Komentar memuat link."],
    ["halo @temen ini enak", "Komentar memuat mention."],
    ["enak banget #kopi", "Komentar memuat hashtag."],
    ["di tempatku cuma 15rb lho", "Komentar memuat harga."],
    ["harganya 20k aja", "Komentar memuat harga."],
    ["paling 10 ribu sih", "Komentar memuat harga."],
    ["Rp 15.000 doang", "Komentar memuat harga."],
    ["aku cuma AI tapi setuju", "Komentar menyebut AI atau bot."],
    ["boleh cek bio kami ya", "Komentar memuat promosi atau ajakan."],
    ["DM aja kak", "Komentar memuat promosi atau ajakan."],
    ["aku pelanggan setia di sana", "Komentar memuat promosi atau ajakan."],
    ["   ", "Komentar kosong."],
    ["a".repeat(281), "Komentar lebih dari 280 karakter."],
  ])("menolak %j", (text, reason) => {
    expect(validateComment(text)).toEqual({ ok: false, reason });
  });
});

/* ------------------------------------------------------------------ SQL asli */

const REPO = path.resolve(__dirname, "../../..");
let db: TestDb;
const ts = (d: Date) => d.toISOString().replace("Z", "");
const DAY_START = "2026-10-18T17:00:00"; // 19 Okt 00:00 WIB

async function claim(item: Record<string, unknown>, status: "DRAF" | "MENGIRIM", at = NOW) {
  const r = await db.query<{ r: { ok: boolean; id?: string; reason?: string } }>(
    `SELECT dash_acmt_claim($1::jsonb, $2, $3::timestamp, 30, $4::timestamp) AS r`,
    [JSON.stringify(item), status, DAY_START, ts(at)]
  );
  return r.rows[0].r;
}
const item = (over: Record<string, unknown> = {}) => ({
  workspaceId: "w1",
  accountId: "a1",
  mediaId: "m1",
  authorUsername: "Pembaca",
  excerpt: "teks",
  permalink: "https://www.threads.net/@pembaca/post/x",
  keyword: "kopi",
  slot: "09:00",
  replyText: "Setuju banget.",
  ...over,
});

describe("SQL sql/043_auto_comment.sql", () => {
  beforeAll(async () => {
    db = await bootDb([]);
    await db.exec(`
      CREATE TABLE "AutopilotConfig" ("accountId" text PRIMARY KEY, "workspaceId" text, mode text, brief text, "voiceStyle" text);
      CREATE TABLE "DashboardAuditLog" (id bigserial, "workspaceId" text, actor text, action text, target text, detail jsonb, "createdAt" timestamp(3));
    `);
    // Dipasang dua kali: harus idempoten.
    const sql = fs.readFileSync(path.join(REPO, "sql/043_auto_comment.sql"), "utf8");
    for (let i = 0; i < 2; i++) await db.exec(sql);
  });

  beforeEach(async () => {
    await db.exec(`
      DELETE FROM "BtAutoCommentTarget"; DELETE FROM "BtAutoCommentRun"; DELETE FROM "BtAutoCommentSetting"; DELETE FROM "BtAutoCommentConfig";
      DELETE FROM "ThreadsAccount";
      INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName") VALUES ('a1', 'w1', 'akun1', 'A1'), ('b1', 'w2', 'akunb', 'B1');
      INSERT INTO "BtAutoCommentConfig" ("workspaceId", aktif, "gapMinutes", "cooldownDays") VALUES ('w1', true, 15, 30), ('w2', true, 15, 30);
      INSERT INTO "BtAutoCommentSetting" ("accountId", "workspaceId", mode, slots, keywords, "dailyCap") VALUES
        ('a1', 'w1', 'OTOMATIS', '{09:00}', '{kopi}', 3), ('a2', 'w1', 'OTOMATIS', '{09:00}', '{kopi}', 3),
        ('b1', 'w2', 'TINJAU', '{09:00}', '{kopi}', 2);
    `);
  });

  it("satu posting target hanya pernah menerima satu auto komentar lintas workspace", async () => {
    expect(await claim(item(), "MENGIRIM")).toMatchObject({ ok: true });
    expect(await claim(item({ workspaceId: "w2", accountId: "b1", authorUsername: "lain" }), "DRAF")).toEqual({ ok: false, reason: "SUDAH_DIKOMENTARI" });
  });

  it("penulis yang sudah dikomentari tidak disasar workspace lain selama cooldown", async () => {
    expect(await claim(item(), "MENGIRIM")).toMatchObject({ ok: true });
    expect(await claim(item({ workspaceId: "w2", accountId: "b1", mediaId: "m2", authorUsername: "pembaca" }), "DRAF")).toEqual({
      ok: false,
      reason: "COOLDOWN_PENULIS",
    });
    // Lewat 30 hari: boleh lagi.
    expect(await claim(item({ workspaceId: "w2", accountId: "b1", mediaId: "m3" }), "DRAF", new Date(NOW.getTime() + 31 * 24 * HOUR))).toMatchObject({ ok: true });
  });

  it("jeda akun 30 menit dan jeda workspace 15 menit untuk kiriman", async () => {
    expect(await claim(item(), "MENGIRIM")).toMatchObject({ ok: true });
    expect(await claim(item({ mediaId: "m2", authorUsername: "x2" }), "MENGIRIM", new Date(NOW.getTime() + 20 * MIN))).toEqual({ ok: false, reason: "JEDA_AKUN" });
    expect(await claim(item({ accountId: "a2", mediaId: "m3", authorUsername: "x3" }), "MENGIRIM", new Date(NOW.getTime() + 10 * MIN))).toEqual({
      ok: false,
      reason: "JEDA_WORKSPACE",
    });
    expect(await claim(item({ accountId: "a2", mediaId: "m3", authorUsername: "x3" }), "MENGIRIM", new Date(NOW.getTime() + 16 * MIN))).toMatchObject({ ok: true });
  });

  it("batas harian menghitung draf menunggu; mode Tinjau tidak boleh mengirim langsung", async () => {
    const b = (n: number) => item({ workspaceId: "w2", accountId: "b1", mediaId: `mb${n}`, authorUsername: `pb${n}` });
    expect(await claim(b(1), "DRAF")).toMatchObject({ ok: true });
    expect(await claim(b(2), "DRAF")).toMatchObject({ ok: true });
    expect(await claim(b(3), "DRAF")).toEqual({ ok: false, reason: "BATAS_HARIAN" });
    expect(await claim(b(4), "MENGIRIM")).toEqual({ ok: false, reason: "BUKAN_OTOMATIS" });
  });

  it("saklar workspace mati menolak klaim", async () => {
    await db.exec(`UPDATE "BtAutoCommentConfig" SET aktif = false WHERE "workspaceId" = 'w1'`);
    expect(await claim(item(), "MENGIRIM")).toEqual({ ok: false, reason: "MATI" });
  });

  it("jam yang sama hanya diklaim sekali per hari", async () => {
    const q = `SELECT dash_acmt_slot_claim('a1', 'w1', '2026-10-19', '09:00', '${ts(NOW)}') AS ok`;
    expect((await db.query<{ ok: boolean }>(q)).rows[0].ok).toBe(true);
    expect((await db.query<{ ok: boolean }>(q)).rows[0].ok).toBe(false);
    const load = await db.query<{ r: { doneSlots: string[] }[] }>(
      `SELECT dash_acmt_load(ARRAY['a1'], ARRAY['2026-10-19','2026-10-18']::date[], '${DAY_START}', '${ts(NOW)}') AS r`
    );
    expect(load.rows[0].r[0].doneSlots).toEqual(["2026-10-19|09:00"]);
  });

  it("setujui draf memeriksa ulang batas; tolak membebaskan posting", async () => {
    const d = await claim(item({ workspaceId: "w2", accountId: "b1" }), "DRAF");
    const rejected = await db.query<{ ok: boolean }>(`SELECT dash_acmt_reject($1, ARRAY['b1'], 'u1', $2::timestamp) AS ok`, [d.id, ts(NOW)]);
    expect(rejected.rows[0].ok).toBe(true);
    // Posting dan penulis bebas lagi untuk akun lain.
    expect(await claim(item(), "MENGIRIM")).toMatchObject({ ok: true });

    const d2 = await claim(item({ workspaceId: "w2", accountId: "b1", mediaId: "m9", authorUsername: "z9" }), "DRAF");
    const approve = (at: Date, ids = ["b1"]) =>
      db.query<{ r: { ok: boolean; reason?: string } }>(`SELECT dash_acmt_approve($1, $2, 'Setuju.', 'u1', $3::timestamp, 30, $4::timestamp) AS r`, [
        d2.id,
        ids,
        DAY_START,
        ts(at),
      ]);
    expect((await approve(NOW, ["a1"])).rows[0].r).toEqual({ ok: false, reason: "TIDAK_DITEMUKAN" });
    expect((await approve(NOW)).rows[0].r).toMatchObject({ ok: true, mediaId: "m9", replyText: "Setuju." });
    expect((await approve(NOW)).rows[0].r).toEqual({ ok: false, reason: "BUKAN_DRAF" });
  });

  it("pengaturan, ringkasan, riwayat berhalaman, hasil kirim, dan pemulihan kiriman macet", async () => {
    await db.query(`SELECT dash_acmt_config_set('w1', $1::jsonb, 'u1', $2::timestamp)`, [
      JSON.stringify({ aktif: true, gapMinutes: 20, cooldownDays: 14, maxPostAgeHours: 12, blockList: ["pesaing"] }),
      ts(NOW),
    ]);
    await db.query(`SELECT dash_acmt_setting_set('a1', 'w1', $1::jsonb, 'u1', $2::timestamp)`, [
      JSON.stringify({ mode: "TINJAU", slots: ["08:15", "20:45"], keywords: ["kopi susu"], dailyCap: 4 }),
      ts(NOW),
    ]);
    const d = await claim(item(), "DRAF");
    const sent = await claim(item({ accountId: "a2", mediaId: "m2", authorUsername: "p2" }), "MENGIRIM");
    await db.query(`SELECT dash_acmt_done($1, 'TERKIRIM', 'r1', 'https://www.threads.net/@akun/post/r1', NULL, $2::timestamp)`, [sent.id, ts(NOW)]);
    await db.query(`SELECT dash_acmt_run_done('a1', '2026-10-19', NULL, 'Draf komentar menunggu ditinjau.', '{}'::jsonb, $1::timestamp)`, [ts(NOW)]);

    const ov = await db.query<{ r: Record<string, unknown> }>(
      `SELECT dash_acmt_overview('w1', ARRAY['a1','a2'], ARRAY['2026-10-19']::date[], '${DAY_START}', '${ts(NOW)}', 50) AS r`
    );
    const r = ov.rows[0].r as {
      config: { gapMinutes: number; blockList: string[] };
      accounts: { accountId: string; mode: string; slots: string[]; used: number; lastNote: string | null; recent: string[] }[];
      queue: { id: string }[];
      counts: Record<string, number>;
    };
    expect(r.config).toMatchObject({ gapMinutes: 20, blockList: ["pesaing"] });
    const a1 = r.accounts.find((a) => a.accountId === "a1")!;
    expect(a1).toMatchObject({ mode: "TINJAU", slots: ["08:15", "20:45"], used: 1, lastNote: "Draf komentar menunggu ditinjau." });
    expect(r.accounts.find((a) => a.accountId === "a2")!.recent).toEqual(["Setuju banget."]);
    expect(r.queue.map((q) => q.id)).toEqual([d.id]);
    expect(r.counts).toMatchObject({ terkirim7: 1, draf: 1 });

    const page1 = await db.query<{ r: { id: string; createdAt: string }[] }>(
      `SELECT dash_acmt_history('w1', ARRAY['a1','a2'], NULL, NULL, NULL, 1) AS r`
    );
    expect(page1.rows[0].r).toHaveLength(1);
    const last = page1.rows[0].r[0];
    const page2 = await db.query<{ r: { id: string }[] }>(`SELECT dash_acmt_history('w1', ARRAY['a1','a2'], NULL, $1::timestamp, $2, 5) AS r`, [
      last.createdAt,
      last.id,
    ]);
    expect(page2.rows[0].r.map((x) => x.id)).not.toContain(last.id);
    expect(page2.rows[0].r).toHaveLength(1);

    // Kiriman MENGIRIM yang macet > 10 menit menjadi GAGAL (tidak dicoba ulang), dipulihkan oleh pemuatan tick.
    await claim(item({ accountId: "a2", mediaId: "m5", authorUsername: "p5" }), "MENGIRIM", new Date(NOW.getTime() + 40 * MIN));
    await db.query(`SELECT dash_acmt_load(NULL, ARRAY['2026-10-19']::date[], '${DAY_START}', $1::timestamp)`, [ts(new Date(NOW.getTime() + 60 * MIN))]);
    const st = await db.query<{ status: string }>(`SELECT status FROM "BtAutoCommentTarget" WHERE "mediaId" = 'm5'`);
    expect(st.rows[0].status).toBe("GAGAL");
  });

  it("dash_acmt_seen mengembalikan posting yang sudah disasar, penulis cooldown, dan akun BotThreads", async () => {
    await claim(item(), "MENGIRIM");
    await db.query(`SELECT dash_acmt_log($1::jsonb, $2::timestamp)`, [
      JSON.stringify([{ workspaceId: "w2", accountId: "b1", mediaId: "lama", authorUsername: "siapa", reason: "Postingan terlalu lama." }]),
      ts(NOW),
    ]);
    const r = await db.query<{ r: { media: string[]; authors: string[]; bots: string[] } }>(
      `SELECT dash_acmt_seen('b1', ARRAY['m1','lama','baru'], ARRAY['pembaca','akun1','siapa'], $1::timestamp) AS r`,
      [ts(new Date(NOW.getTime() - 30 * 24 * HOUR))]
    );
    expect(r.rows[0].r.media.sort()).toEqual(["lama", "m1"]);
    expect(r.rows[0].r.authors).toEqual(["pembaca"]);
    expect(r.rows[0].r.bots).toEqual(["akun1"]);
  });
});
