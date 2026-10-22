/**
 * Loop belajar autopilot: fungsi murni (penyusutan, pola terbukti) + integrasi dengan SQL asli
 * (sql/005-007 di Postgres in-memory): sinkron hasil, viral, ide lanjutan, turun mode, notifikasi.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./helpers/pg";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@supabase/supabase-js", async () => (await import("./helpers/pg")).supabaseMock(() => h.db as TestDb));

import { bootDb, pgRpc, useTestSupabaseEnv } from "./helpers/pg";
import {
  LABEL_BATCH,
  buildStats,
  ideaPerformance,
  labelOutcome,
  labelOutcomes,
  loadLearnStats,
  preferredFormats,
  provenPatterns,
  runLearning,
  shrunk,
  toUnit,
  type StatRow,
} from "../autopilot-learning";
import { engagementScore } from "../style-types";
import { getHealth, getPerformance, listNotifications, markNotificationsRead } from "../notification-service";
import type { RequestCtx } from "../request-ctx";

describe("statistik belajar (murni)", () => {
  it("penyusutan: sedikit data ditarik ke pembanding, banyak data mendekati rata-rata sendiri", () => {
    expect(shrunk(0, 0, 0.4)).toBeCloseTo(0.4, 10);
    expect(shrunk(3, 1, 0)).toBe(0.5);
    expect(shrunk(30, 1, 0)).toBeCloseTo(0.909, 3);
  });

  const rows: StatRow[] = [
    { aid: "a1", dim: "formulaHook", val: "pertanyaan", n: 9, avg: 0.6 },
    { aid: "a1", dim: "formulaHook", val: "daftar", n: 1, avg: 2 },
    { aid: "a1", dim: "pilar", val: "Edukasi", n: 6, avg: -0.5 },
    { aid: null, dim: "formulaHook", val: "pertanyaan", n: 40, avg: 0.3 },
    { aid: null, dim: "formulaHook", val: "cerita", n: 20, avg: 0.4 },
    { aid: null, dim: "pilar", val: "Edukasi", n: 30, avg: -0.2 },
  ];
  const stats = buildStats(rows);

  it("skor akun disusutkan ke rata-rata jaringan; satu posting hebat tidak langsung menang", () => {
    const s = stats.get("a1")!;
    expect(s.score("formulaHook", "pertanyaan")).toBeCloseTo((9 * 0.6 + 3 * shrunk(40, 0.3, 0)) / 12, 5);
    // "daftar": 1 posting skor 2, tanpa data jaringan -> jauh di bawah 2.
    expect(s.score("formulaHook", "daftar")).toBe(0.5);
    // Belum pernah dipakai akun: pakai rata-rata jaringan.
    expect(s.score("formulaHook", "cerita")).toBeCloseTo(shrunk(20, 0.4, 0), 5);
    expect(s.score("formulaHook", "opini")).toBeNull();
    expect(s.score("pilar", null)).toBeNull();
    expect(s.count("formulaHook", "pertanyaan")).toBe(9);
  });

  it("kinerja ide 0..1: di atas 0,5 untuk pola yang berhasil, di bawah untuk yang lemah, 0,5 tanpa data", () => {
    const perf = ideaPerformance(stats.get("a1"));
    expect(perf({ formulaHook: "pertanyaan", pilar: null })).toBeGreaterThan(0.5);
    expect(perf({ formulaHook: null, pilar: "Edukasi" })).toBeLessThan(0.5);
    expect(perf({ formulaHook: "opini", pilar: null })).toBe(0.5);
    expect(ideaPerformance(undefined)({ formulaHook: "pertanyaan", pilar: null })).toBe(0.5);
    expect([toUnit(-5), toUnit(0), toUnit(5)]).toEqual([0, 0.5, 1]);
  });

  it("pola terbukti hanya yang datanya cukup dan hasilnya di atas biasanya", () => {
    const lines = provenPatterns(rows, "a1", stats.get("a1"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Pembuka gaya "Pertanyaan terbuka" rata-rata 1,\dx views biasa \(9 posting\)\.$/);
    expect(provenPatterns(rows, "a2", stats.get("a2"))).toEqual([]);
  });

  // Dimensi gaya: format + layout (sql/042).
  const style: StatRow[] = [
    ...rows,
    { aid: "a1", dim: "format", val: "TIPS_LIST", n: 8, avg: 0.9 },
    { aid: "a1", dim: "format", val: "CERITA", n: 6, avg: 0.4 },
    { aid: "a1", dim: "format", val: "CURHAT", n: 2, avg: 2 }, // sampel terlalu sedikit
    { aid: "a1", dim: "format", val: "OPINI", n: 9, avg: -0.4 },
    { aid: "a1", dim: "format", val: "BUKAN_FORMAT", n: 9, avg: 1.5 },
    { aid: "a1", dim: "baris", val: "2-4", n: 12, avg: 0.5 },
    { aid: "a1", dim: "baris", val: "1", n: 7, avg: -0.3 },
    { aid: "a1", dim: "daftar", val: "ya", n: 3, avg: 1.2 }, // sampel terlalu sedikit
    { aid: "a1", dim: "daftar", val: "tidak", n: 20, avg: 0.02 },
    { aid: null, dim: "format", val: "TIPS_LIST", n: 30, avg: 0.3 },
    { aid: null, dim: "baris", val: "2-4", n: 40, avg: 0.2 },
    { aid: null, dim: "baris", val: "1", n: 40, avg: -0.1 },
  ];
  const styleStats = buildStats(style);

  it("pola gaya: format dan perbandingan layout ikut tampil, hanya dengan sampel cukup", () => {
    const lines = provenPatterns(style, "a1", styleStats.get("a1"));
    // Pola lama tetap pertama dan tidak berubah.
    expect(lines[0]).toMatch(/^Pembuka gaya "Pertanyaan terbuka"/);
    const styleLines = lines.slice(1);
    expect(styleLines.length).toBeLessThanOrEqual(3);
    expect(styleLines).toContainEqual(
      expect.stringMatching(/^Di akun ini, tips berbentuk daftar rata-rata \d,\dx hasil biasa \(views \+ balasan, 8 postingan\)\.$/)
    );
    expect(styleLines).toContainEqual(
      expect.stringMatching(/^Postingan 2-4 baris lebih berhasil daripada 1 baris: \d,\dx vs 0,\dx hasil biasa \(12 vs 7 postingan\)\.$/)
    );
    expect(styleLines.join(" ")).not.toMatch(/curhat|berbentuk daftar \(poin|BUKAN_FORMAT|opini/);
  });

  it("preferredFormats: format bersampel cukup dengan hasil di atas biasanya, terbaik dulu", () => {
    expect(preferredFormats(style, "a1")).toEqual(["TIPS_LIST", "CERITA"]);
    expect(preferredFormats(style, "a1", styleStats.get("a1"))).toEqual(["TIPS_LIST", "CERITA"]);
    expect(preferredFormats(style, "a2")).toEqual([]);
    expect(preferredFormats(rows, "a1")).toEqual([]);
  });

  it("label hasil: format dan layout dari teks; teks kosong tanpa format", () => {
    const l = labelOutcome("3 cara biar kopi tetap enak:\n1. pakai susu dingin\n2. gula aren cair\n3. es batu terpisah");
    expect(l.format).toBe("TIPS_LIST");
    expect(l.layout).toMatchObject({ lines: 4, isList: true, startsLowercase: true });
    expect(labelOutcome("   ")).toMatchObject({ format: null, layout: { chars: 0, lines: 0 } });
  });
});

const daysAgo = (d: number, hourUtc = 5) => new Date(Date.UTC(2026, 9, 20 - d, hourUtc, 10)).toISOString().replace("Z", "");
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Satu posting autopilot yang sudah terbit: slot + antrean + statistik Threads. `caption` = teks yang diterbitkan. */
const published = (
  id: string,
  aid: string,
  ago: number,
  views: number,
  hook: string | null,
  pilar: string | null,
  opts: { caption?: string; replies?: number } = {}
) => {
  const caption = opts.caption ?? `teks ${id}`;
  return `
    INSERT INTO "ContentIdea" (id, "workspaceId", "accountId", topik, "topicKey", "formulaHook", pilar, "expiresAt", "createdAt", "updatedAt", status)
      VALUES ('idea-${id}', 'ws1', '${aid}', 'topik ${id}', 'topik ${id}', ${hook ? `'${hook}'` : "NULL"}, ${pilar ? `'${pilar}'` : "NULL"}, '2027-01-01', '${daysAgo(ago)}', '${daysAgo(ago)}', 'DIPAKAI');
    INSERT INTO "ScheduledPost" (id, "workspaceId", caption, "tayangPada", status, source) VALUES ('p-${id}', 'ws1', ${q(caption)}, '${daysAgo(ago)}', 'SELESAI', 'DASHBOARD_AI');
    INSERT INTO "PostDispatch" (id, "postId", "outletId", "socialAccountId", publisher, status, "platformPostId")
      VALUES ('d-${id}', 'p-${id}', 'o-${aid}', 's-${aid}', 'THREADS', 'TERBIT', 'm-${id}');
    INSERT INTO "AutopilotSlot" (id, "workspaceId", "accountId", "dayKey", "slotIndex", "slotAt", hour, kind, status, "postId", "ideaId", draft)
      VALUES ('sl-${id}', 'ws1', '${aid}', '${daysAgo(ago).slice(0, 10)}', ${Math.abs(hash(id)) % 30000}, '${daysAgo(ago)}', 12, 'RAMAI', 'TERBIT', 'p-${id}', 'idea-${id}',
              ${q(JSON.stringify({ text: caption, pillar: pilar }))});
    INSERT INTO "ThreadsPostStat" ("threadsAccountId", "mediaId", text, permalink, "postedAt", views, likes, replies, reposts)
      VALUES ('${aid}', 'm-${id}', ${q(caption)}, 'https://threads.net/p/${id}', '${daysAgo(ago)}', ${views}, 10, ${opts.replies ?? 5}, 1);`;
};

/** Akun ws1 (outlet, akun Threads, autopilot OTOMATIS) + kebiasaan 30 hari: 12 posting biasa ~1.000 views, 5 balasan. */
const accountsSql = (ids: string[]) =>
  ids
    .map(
      (a) => `
INSERT INTO "Outlet" VALUES ('o-${a}', 'ws1', 'Cabang ${a}', true);
INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "accessExpiresAt", scopes)
  VALUES ('${a}', 'ws1', 'akun_${a}', 'Akun ${a}', '2027-01-01', '{threads_content_publish}');
INSERT INTO "SocialAccount" VALUES ('s-${a}', 'o-${a}', '${a}');
INSERT INTO "AutopilotConfig" ("accountId", "workspaceId", mode, "updatedAt") VALUES ('${a}', 'ws1', 'OTOMATIS', '2026-09-01');`
    )
    .join("\n") +
  `
INSERT INTO "ThreadsPostStat" ("threadsAccountId", "mediaId", text, "postedAt", views, replies) VALUES ${ids
    .flatMap((a) => Array.from({ length: 12 }, (_, i) => `('${a}', 'base-${a}-${i}', 'posting biasa ${i}', '${daysAgo(3 + i * 2, 9)}', ${900 + i * 20}, 5)`))
    .join(", ")};`;

const LEARN_SQL = [
  "sql/002_dashboard_post_log.sql",
  "sql/003_dashboard_rpc.sql",
  "sql/005_autopilot.sql",
  "sql/006_autopilot_radar.sql",
  "sql/007_autopilot_learning.sql",
  "sql/042_learning_format.sql",
];

describe("belajar dari hasil posting (SQL asli)", () => {
  const NOW = new Date("2026-10-20T04:00:00Z");
  const owner: RequestCtx = { userId: "u-owner", workspaceId: "ws1", role: "OWNER", accountIds: null };
  const scoped: RequestCtx = { userId: "u-cabang", workspaceId: "ws1", role: "VIEWER", accountIds: ["a2"] };
  const other: RequestCtx = { userId: "u-lain", workspaceId: "ws2", role: "OWNER", accountIds: null };
  let db: TestDb;
  const counts: Record<string, number> = {};

  const count = async (sql: string): Promise<number> => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`)).rows[0].n;

  beforeAll(async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    useTestSupabaseEnv();
    delete process.env.CONTENT_PUBLISH_TEST_ACCOUNTS;
    delete process.env.EXCLUDED_THREADS_ACCOUNTS;
    db = await bootDb(LEARN_SQL);
    h.db = db;
    await db.exec(accountsSql(["a1", "a2"]));
    await db.exec(
      [
        // Akun 1: "pertanyaan" konsisten di atas biasanya, "daftar" di bawah; satu posting baru meledak.
        published("q1", "a1", 3, 2400, "pertanyaan", "Cerita"),
        published("q2", "a1", 5, 2100, "pertanyaan", "Cerita"),
        published("q3", "a1", 7, 2600, "pertanyaan", "Cerita"),
        published("l1", "a1", 4, 400, "daftar", "Edukasi"),
        published("l2", "a1", 6, 500, "daftar", "Edukasi"),
        published("l3", "a1", 8, 450, "daftar", "Edukasi"),
        published("viral", "a1", 1, 9000, "pertanyaan", "Cerita"),
        // Akun 2: pekan lalu sehat, pekan ini anjlok lebih dari separuh.
        ...[9, 10, 11, 12, 13].map((d, i) => published(`old${i}`, "a2", d, 1200, "cerita", null)),
        ...[2, 3, 4, 5, 6].map((d, i) => published(`new${i}`, "a2", d, 300, "cerita", null)),
      ].join("\n")
    );
  });

  it("sinkron pertama mencatat hasil, mengenali posting viral, dan menurunkan mode akun yang anjlok", async () => {
    await runLearning(NOW, counts);
    expect(counts).toEqual({ viral: 1, modeDiturunkan: 1, hasilDilabeli: 17 });
    expect(await count(`"ContentOutcome"`)).toBe(17);

    const viral = await db.query<{ isViral: boolean; score: number; baseline: number; formulaHook: string; pilar: string }>(
      `SELECT "isViral", score, baseline, "formulaHook", pilar FROM "ContentOutcome" WHERE "postId" = 'p-viral'`
    );
    expect(viral.rows[0]).toMatchObject({ isViral: true, formulaHook: "pertanyaan", pilar: "Cerita" });
    expect(viral.rows[0].baseline).toBeGreaterThan(900);
    expect(viral.rows[0].score).toBeGreaterThan(1.5);
    expect(await count(`"ContentOutcome" WHERE "isViral"`)).toBe(1);

    // Ide lanjutan untuk akun yang sama, berskor tinggi supaya dipakai di slot berikutnya.
    const follow = await db.query<{ accountId: string; score: number; formulaHook: string; status: string }>(
      `SELECT "accountId", score, "formulaHook", status FROM "ContentIdea" WHERE id = 'lanjutan-p-viral'`
    );
    expect(follow.rows[0]).toMatchObject({ accountId: "a1", formulaHook: "pertanyaan", status: "BARU" });
    expect(follow.rows[0].score).toBeCloseTo(0.95, 2);

    const modes = await db.query<{ accountId: string; mode: string }>(`SELECT "accountId", mode FROM "AutopilotConfig" ORDER BY "accountId"`);
    expect(modes.rows).toEqual([
      { accountId: "a1", mode: "OTOMATIS" },
      { accountId: "a2", mode: "TINJAU" },
    ]);
    expect(await count(`"DashboardAuditLog" WHERE action = 'AUTOPILOT_TURUN_MODE' AND target = 'a2'`)).toBe(1);
  });

  it("dijaga lease 3 jam: sinkron ulang tidak berjalan lagi dan tidak menggandakan apa pun", async () => {
    const again: Record<string, number> = {};
    await runLearning(new Date(NOW.getTime() + 60 * 60_000), again);
    expect(again).toEqual({});
    // Setelah 3 jam berjalan lagi: tidak ada viral baru (yang lama tidak diberitahukan ulang).
    await runLearning(new Date(NOW.getTime() + 3 * 60 * 60_000 + 1000), again);
    expect(again).toEqual({});
    expect(await count(`"DashboardNotification" WHERE jenis = 'VIRAL'`)).toBe(1);
    expect(await count(`"ContentIdea" WHERE id LIKE 'lanjutan-%'`)).toBe(1);
  });

  it("statistik per akun menghasilkan pola terbukti untuk prompt", async () => {
    const rows = await loadLearnStats(["a1"], NOW);
    const stats = buildStats(rows);
    const s = stats.get("a1")!;
    expect(s.score("formulaHook", "pertanyaan")).toBeGreaterThan(0.3);
    expect(s.score("formulaHook", "daftar")).toBeLessThan(-0.3);
    const lines = provenPatterns(rows, "a1", s);
    expect(lines.some((l) => /Pertanyaan terbuka/.test(l))).toBe(true);
    expect(lines.some((l) => /Pilar "Cerita"/.test(l))).toBe(true);
    expect(lines.some((l) => /Daftar|Edukasi/.test(l))).toBe(false);
    // Posting berumur kurang dari sehari (yang viral) belum ikut dihitung: metriknya belum matang.
    expect(s.count("formulaHook", "pertanyaan")).toBe(3);
  });

  it("notifikasi: lingkup workspace dan akun, tandai dibaca per pengguna", async () => {
    const all = await listNotifications(owner, null);
    expect(all.installed).toBe(true);
    expect(all.items.map((n) => n.jenis).sort()).toEqual(["MODE_DITURUNKAN", "VIRAL"]);
    expect(all.unread).toBe(2);
    const viral = all.items.find((n) => n.jenis === "VIRAL")!;
    expect(viral.judul).toBe("Posting @akun_a1 sedang ramai: 9.000 views");
    expect(viral.tautan).toBe("https://threads.net/p/viral");

    // Pengguna berlingkup akun 2 hanya melihat notifikasi akun 2; workspace lain tidak melihat apa pun.
    expect((await listNotifications(scoped, null)).items.map((n) => n.jenis)).toEqual(["MODE_DITURUNKAN"]);
    expect((await listNotifications(other, null)).items).toEqual([]);

    expect(await markNotificationsRead(scoped, [viral.id])).toBe(0);
    expect(await markNotificationsRead(owner, [viral.id])).toBe(1);
    expect(await markNotificationsRead(owner, [viral.id])).toBe(0);
    const after = await listNotifications(owner, null);
    expect(after.unread).toBe(1);
    expect(after.items.find((n) => n.id === viral.id)?.dibaca).toBe(true);
    // Status dibaca milik masing-masing pengguna.
    expect((await listNotifications(scoped, null)).unread).toBe(1);
    expect(await markNotificationsRead(owner, null)).toBe(1);
    expect((await listNotifications(owner, null)).unread).toBe(0);
  });

  it("ringkasan performa: kelipatan per kategori, autopilot dibanding posting lain, daftar viral", async () => {
    const perf = (await getPerformance(owner, "a1", NOW))!;
    expect(perf.installed).toBe(true);
    const hook = (val: string) => perf.dims.find((d) => d.dim === "formulaHook" && d.val === val)!;
    expect(hook("pertanyaan")).toMatchObject({ label: "Pertanyaan terbuka", n: 3 });
    expect(hook("pertanyaan").multiplier).toBeGreaterThan(2);
    expect(hook("daftar").multiplier).toBeLessThan(0.6);
    expect(perf.dims.find((d) => d.dim === "jam")).toMatchObject({ val: "12", label: "12.00 WIB" });
    expect(perf.autopilot.n).toBe(6);
    expect(perf.lainnya.n).toBe(12);
    expect(perf.viral).toEqual([expect.objectContaining({ postId: "p-viral", username: "akun_a1", views: 9000 })]);

    expect(await getPerformance(scoped, "a1", NOW)).toBeNull();
    expect((await getPerformance(scoped, null, NOW))!.viral).toEqual([]);
    expect((await getPerformance(other, null, NOW))!.dims).toEqual([]);
  });

  it("kesehatan: ringkasan 24 jam dari riwayat tick", async () => {
    const run = (minAgo: number, hitung: Record<string, number>, error?: string) =>
      db.query(`SELECT dash_ap_run_log($1::jsonb)`, [
        JSON.stringify({
          startedAt: new Date(NOW.getTime() - minAgo * 60_000).toISOString(),
          finishedAt: new Date(NOW.getTime() - minAgo * 60_000 + 2000).toISOString(),
          durasiMs: 2000,
          hitung,
          ...(error ? { error } : {}),
        }),
      ]);
    await run(5, { diantre: 2, putaranAi: 6 });
    await run(10, { dilewati: 1, putaranAi: 2 }, "galat uji");
    await run(60 * 30, { diantre: 9 });
    const health = await getHealth(NOW);
    expect(health.runs).toHaveLength(3);
    expect(health.last24h).toEqual({ ticks: 2, errors: 1, putaranAi: 8, diantre: 2, dilewati: 1, avgMs: 2000 });
    // Umur tick dihitung klien dari jam server, dengan ambang dan saklar posting dari server juga.
    expect(health).toMatchObject({ serverNow: NOW.toISOString(), staleAfterMs: 15 * 60_000, publishEnabled: process.env.CONTENT_PUBLISH_ENABLED === "true" });
  });
});

describe("belajar format dan layout (SQL asli, sql/042)", () => {
  const NOW = new Date("2026-10-20T04:00:00Z");
  const later = (min: number) => new Date(NOW.getTime() + min * 60_000);
  let db: TestDb;

  const LIST = "3 cara biar kopi tetap enak:\n1. pakai susu dingin\n2. gula aren cair\n3. es batu terpisah";
  const ONE_LINER = "Menurut gue kopi susu kekinian itu overrated.";
  const CURHAT = "capek banget hari ini.\nkopi doang yang ngerti.";

  type Row = { score: number; baseline: number; medianReplies: number; views: number; replies: number; format: string | null; layout: Record<string, unknown> | null };
  const outcome = async (postId: string): Promise<Row> =>
    (await db.query<Row>(`SELECT score, baseline, "medianReplies", views, replies, format, layout FROM "ContentOutcome" WHERE "postId" = $1`, [postId])).rows[0];
  const unlabeled = async (): Promise<number> =>
    (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "ContentOutcome" WHERE layout IS NULL`)).rows[0].n;

  beforeAll(async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    useTestSupabaseEnv();
    db = await bootDb(LEARN_SQL);
    h.db = db;
    await db.exec(accountsSql(["a1"]));
    await db.exec(
      [
        // Daftar 2-4 baris: views dan balasan di atas biasanya.
        ...[2, 4, 6, 8, 10].map((d, i) => published(`li${i}`, "a1", d, 2500, "daftar", "Edukasi", { caption: LIST, replies: 12 })),
        // Satu baris: di bawah biasanya.
        ...[3, 5, 7, 9, 11].map((d, i) => published(`op${i}`, "a1", d, 600, "cerita", "Opini", { caption: ONE_LINER, replies: 2 })),
        // Views sama, balasan beda: hanya bobot balasan yang membedakan skornya.
        published("rA", "a1", 12, 1000, "cerita", "Opini", { caption: "Kopi susu gula aren tetap juara.", replies: 30 }),
        published("rB", "a1", 13, 1000, "cerita", "Opini", { caption: "Kopi susu gula aren tetap juara.", replies: 0 }),
        // Curhat sangat ramai tapi baru 2 posting: belum boleh disebut pola.
        ...[6, 8].map((d, i) => published(`cu${i}`, "a1", d, 5000, "cerita", "Curhat", { caption: CURHAT, replies: 40 })),
      ].join("\n")
    );
  });

  it("skor memberi bobot balasan (sama dengan engagementScore) dan label terisi di run yang sama", async () => {
    const c: Record<string, number> = {};
    await runLearning(NOW, c);
    expect(c.hasilDilabeli).toBe(14);
    expect(await unlabeled()).toBe(0);

    const li = await outcome("p-li0");
    expect(li.medianReplies).toBeGreaterThan(0);
    expect(li.score).toBeCloseTo(
      engagementScore({ views: li.views, replies: li.replies, likes: 0, reposts: 0 }, { views: li.baseline, replies: li.medianReplies }),
      4
    );
    const [a, b] = [await outcome("p-rA"), await outcome("p-rB")];
    expect(a.score - b.score).toBeCloseTo(0.5 * Math.log(31), 4);

    expect(li.format).toBe("TIPS_LIST");
    expect(li.layout).toMatchObject({ lines: 4, isList: true, startsLowercase: true });
    expect(await outcome("p-op0")).toMatchObject({ format: "OPINI", layout: expect.objectContaining({ lines: 1, isList: false, startsLowercase: false }) });
    expect((await outcome("p-cu0")).format).toBe("CURHAT");
  });

  it("pelabelan idempoten: label yang ada tidak ditimpa, antrean kosong tidak memanggil apa pun lagi", async () => {
    const layout = { chars: 1, lines: 1, isList: false, startsLowercase: false };
    expect(await pgRpc(db, "dash_learn_label_set", { p_items: [{ id: "p-li0", format: "PROMO", layout }] })).toBe(0);
    expect((await outcome("p-li0")).format).toBe("TIPS_LIST");
    expect(await labelOutcomes(NOW)).toEqual({ labeled: 0, more: false });
    await expect(pgRpc(db, "dash_learn_label_set", { p_items: [{ id: "p-li0", format: "OPINI", layout: { chars: "x" } }] })).rejects.toThrow(/layout tidak valid/);

    const c: Record<string, number> = {};
    await runLearning(later(5), c);
    expect(c).toEqual({});
  });

  it("pelabelan dibatasi per tick: paling banyak LABEL_BATCH, sisanya di tick berikutnya; di luar 60 hari dilewati", async () => {
    // 60 hasil lama di workspace lain + 1 hasil di luar jendela 60 hari.
    await db.exec(`
      INSERT INTO "ScheduledPost" (id, "workspaceId", caption, "tayangPada", status, source)
        SELECT 'pz-' || g, 'ws9', 'posting lama ' || g, '${daysAgo(20)}'::timestamp - g * interval '1 minute', 'SELESAI', 'DASHBOARD_AI'
        FROM generate_series(1, 60) g;
      INSERT INTO "ContentOutcome" ("postId", "slotId", "workspaceId", "accountId", "jamLokal", "jenisSlot", "postedAt", "diukurPada")
        SELECT 'pz-' || g, 'slz-' || g, 'ws9', 'z9', 12, 'RAMAI', '${daysAgo(20)}'::timestamp - g * interval '1 minute', '${daysAgo(19)}'
        FROM generate_series(1, 60) g;
      INSERT INTO "ContentOutcome" ("postId", "slotId", "workspaceId", "accountId", "jamLokal", "jenisSlot", "postedAt", "diukurPada")
        VALUES ('pz-kuno', 'slz-kuno', 'ws9', 'z9', 12, 'RAMAI', '${daysAgo(70)}', '${daysAgo(69)}');`);

    expect(await labelOutcomes(NOW, 3)).toEqual({ labeled: 3, more: true });
    expect(await unlabeled()).toBe(58);

    // Sinkron berikutnya (lease 3 jam) menyalakan antrean: satu batch penuh, lalu sisanya di tick berikut.
    const t1: Record<string, number> = {};
    await runLearning(later(3 * 60 + 1), t1);
    expect(t1.hasilDilabeli).toBe(LABEL_BATCH);
    const t2: Record<string, number> = {};
    await runLearning(later(3 * 60 + 6), t2);
    expect(t2).toEqual({ hasilDilabeli: 57 - LABEL_BATCH });
    const t3: Record<string, number> = {};
    await runLearning(later(3 * 60 + 11), t3);
    expect(t3).toEqual({});
    // Hanya yang di luar jendela 60 hari yang tetap tanpa label.
    expect(await unlabeled()).toBe(1);
    expect((await outcome("pz-1")).format).toBe("OPINI");
  });

  it("dimensi gaya teragregasi (sampel minimal), pola terbukti dan format pilihan; dimensi lama tetap", async () => {
    const rows = await loadLearnStats(["a1"], NOW);
    const mine = (dim: string, val: string) => rows.find((r) => r.aid === "a1" && r.dim === dim && r.val === val);
    expect(mine("format", "TIPS_LIST")?.n).toBe(5);
    expect(mine("format", "OPINI")?.n).toBe(7);
    expect(mine("format", "CURHAT")?.n).toBe(2);
    expect([mine("baris", "2-4")?.n, mine("baris", "1")?.n]).toEqual([7, 7]);
    expect([mine("daftar", "ya")?.n, mine("daftar", "tidak")?.n]).toEqual([5, 9]);
    expect([mine("pembuka", "kecil")?.n, mine("pembuka", "kapital")?.n]).toEqual([7, 7]);
    expect(mine("panjang", "pendek")?.n).toBe(14);
    // Dimensi lama tidak berubah.
    expect(mine("jam", "12")?.n).toBe(14);
    expect(mine("jenisSlot", "RAMAI")?.n).toBe(14);
    expect(mine("formulaHook", "daftar")?.n).toBe(5);
    expect(mine("pilar", "Opini")?.n).toBe(7);
    // Workspace lain tidak ikut.
    expect(rows.some((r) => r.aid === "z9")).toBe(false);

    const stats = buildStats(rows);
    const lines = provenPatterns(rows, "a1", stats.get("a1"));
    expect(lines).toContainEqual(expect.stringMatching(/^Di akun ini, tips berbentuk daftar rata-rata \d,\dx hasil biasa \(views \+ balasan, 5 postingan\)\.$/));
    expect(lines).toContainEqual(expect.stringMatching(/^Postingan .+ lebih berhasil daripada .+ hasil biasa \(\d+ vs \d+ postingan\)\.$/));
    expect(lines.join(" ")).not.toMatch(/curhat/);
    expect(preferredFormats(rows, "a1")).toEqual(["TIPS_LIST"]);
  });
});
