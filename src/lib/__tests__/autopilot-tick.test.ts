/**
 * Uji integrasi mesin autopilot: tick asli + SQL asli (sql/002, 003, 005 di Postgres in-memory).
 * Yang di-mock hanya batas sistem: transport ke database (rpc -> PGlite) dan API LLM. Tidak ada yang
 * terkirim ke Threads; hasil dinilai dari baris yang tertulis di antrean (ScheduledPost/PostDispatch)
 * dan status slot.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./helpers/pg";

const h = vi.hoisted(() => ({ db: null as unknown, calls: [] as string[] }));

// Klien Supabase diganti di tingkat pustakanya, jadi `@/lib/supabase` berjalan apa adanya (termasuk
// penentu lingkup akun dan peta tenant yang memanggil database secara internal).
vi.mock("@supabase/supabase-js", async () => (await import("./helpers/pg")).supabaseMock(() => h.db as TestDb, h.calls));

vi.mock("@/lib/gemini", async (original) => ({
  ...(await original<typeof import("@/lib/gemini")>()),
  // LLM tiruan: 3 kandidat dengan kosakata unik per akun dan per panggilan (tidak saling mirip).
  // Akun "akun5" selalu menulis promo karangan, yang harus ditolak gerbang.
  generateWithFailover: vi.fn(async (opts: { system: string; contents: { parts: { text: string }[] }[] }) => {
    const handle = /AKUN: @(\S+)/.exec(opts.contents[0].parts[0].text)?.[1] ?? "x";
    llmCalls++;
    // Kritikus: selalu memberi nilai baik tanpa risiko.
    if (opts.system.startsWith("Anda editor media sosial")) {
      const json = { hook: 4, relevansi: 4, alami: 5, risiko: [], catatan: "" };
      return { text: JSON.stringify(json), json, model: "llm-uji" };
    }
    // Perencana ide: topik unik per akun; satu ide sengaja menyentuh topik terlarang dan harus dibuang.
    if (opts.system.startsWith("Anda perencana konten")) {
      const ideas = [
        ...[1, 2, 3, 4, 5, 6, 7].map((i) => ({
          topik: `${handle}ide${i}satu ${handle}ide${i}dua ${handle}ide${i}tiga obrolan santai`,
          sudut: `arah ${i}`,
          formulaHook: "pertanyaan",
          pilar: "",
          sinyal: i === 1 ? [1] : [],
          kecocokan: 4,
        })),
        { topik: `pendapat ${handle} soal pemilu dan capres tahun ini`, sudut: "x", formulaHook: "opini", kecocokan: 5 },
      ];
      return { text: JSON.stringify({ ideas }), json: { ideas }, model: "llm-uji" };
    }
    const drafts = [1, 2, 3].map((n) => ({
      text:
        handle === "akun5"
          ? `lagi ada promo diskon 50% nih buat ${handle} panggilan ${llmCalls} kandidat ${n}, buruan mampir sebelum habis ya`
          : Array.from({ length: 10 }, (_, k) => `${handle}c${llmCalls}n${n}w${k}`).join(" ") + " gimana menurut kalian?",
      angle: `Sudut ${n}`,
      rationale: "Cocok dengan gaya akun",
      suggestedHourWib: 12,
      inspiredBy: 0,
    }));
    return { text: JSON.stringify({ drafts }), json: { drafts }, model: "llm-uji" };
  }),
}));

// Sumber tren luar tidak boleh benar-benar dipanggil dari uji.
vi.mock("@/lib/radar-sources", async (original) => ({
  ...(await original<typeof import("@/lib/radar-sources")>()),
  fetchGoogleTrends: vi.fn(async () => [
    { keyword: "resep sambal matah", traffic: 20000, context: "Resep sambal matah yang lagi ramai dicoba", rank: 1 },
    { keyword: "hasil pilkada", traffic: 500000, context: "Hasil pilkada terbaru", rank: 2 },
    { keyword: "menu bekal anak", traffic: 5000, context: null, rank: 3 },
  ]),
}));

let llmCalls = 0;

import { bootDb, pgRpc, useTestSupabaseEnv } from "./helpers/pg";
import { upsertConfigs } from "../autopilot-store";
import { runTick } from "../autopilot-tick";
import { DEFAULT_SETTINGS } from "../autopilot-types";
import { approveSlot, rejectSlot, rewriteSlot, skipSlot } from "../autopilot-writer";
import { wibParts } from "../scheduling";

// Selasa 13 Okt 2026, 11.00 WIB
const T0 = new Date("2026-10-13T04:00:00Z");
const MIN = 60_000;
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN);

let db: TestDb;

interface SlotRow {
  id: string;
  accountId: string;
  dayKey: string;
  slotIndex: number;
  slotAt: string;
  hour: number;
  status: string;
  attempt: number;
  postId: string | null;
  lastError: string | null;
  skipReason: string | null;
  draft: { text: string; edited?: boolean; checks: { key: string; ok: boolean }[] } | null;
}

const slots = async (where = "TRUE"): Promise<SlotRow[]> =>
  (
    await db.query<SlotRow>(
      `SELECT id, "accountId", "dayKey"::text AS "dayKey", "slotIndex", to_char("slotAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "slotAt",
              hour, status, attempt, "postId", "lastError", "skipReason", draft
       FROM "AutopilotSlot" WHERE ${where} ORDER BY "slotAt", id`
    )
  ).rows;

const count = async (sql: string): Promise<number> => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`)).rows[0].n;

const tick = async (minutes: number) => {
  vi.setSystemTime(at(minutes));
  h.calls.length = 0;
  return runTick({ now: at(minutes) });
};

beforeAll(async () => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  useTestSupabaseEnv();
  process.env.CONTENT_PUBLISH_ENABLED = "true";
  delete process.env.CONTENT_PUBLISH_TEST_ACCOUNTS;
  delete process.env.EXCLUDED_THREADS_ACCOUNTS;

  db = await bootDb([
    "sql/002_dashboard_post_log.sql",
    "sql/003_dashboard_rpc.sql",
    "sql/005_autopilot.sql",
    "sql/006_autopilot_radar.sql",
  ]);
  h.db = db;

  const accounts = ["1", "2", "3", "4", "5"];
  await db.exec(
    accounts
      .map(
        (n) => `
INSERT INTO "Outlet" VALUES ('o${n}', 'ws1', 'Cabang ${n}', true);
INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "needsReconnect", "accessExpiresAt", scopes)
  VALUES ('a${n}', 'ws1', 'akun${n}', 'Akun ${n}', ${n === "4"}, '2027-01-01', '{threads_basic,threads_content_publish}');
INSERT INTO "SocialAccount" VALUES ('s${n}', 'o${n}', 'a${n}');`
      )
      .join("\n")
  );
  // Data jam ramai akun 1: jam 19 teratas, lalu 12, lalu 07 (WIB) dalam 30 hari terakhir.
  const stat = (i: number, hourUtc: string, views: number) =>
    `('a1', 'm-${hourUtc}-${i}', 'postingan lama nomor ${i} jam ${hourUtc} yang cukup panjang untuk contoh gaya akun', '2026-10-${String(1 + i).padStart(2, "0")}T${hourUtc}:10:00', ${views})`;
  await db.exec(
    `INSERT INTO "ThreadsPostStat" ("threadsAccountId", "mediaId", text, "postedAt", views) VALUES ${[
      ...[0, 1, 2, 3, 4, 5].map((i) => stat(i, "12", 2600)),
      ...[0, 1, 2, 3, 4, 5].map((i) => stat(i, "05", 1500)),
      ...[0, 1, 2, 3].map((i) => stat(i, "00", 900)),
    ].join(", ")}`
  );

  // Satu postingan akun 1 yang jauh di atas median akunnya: menjadi sinyal pemenang jaringan.
  await db.exec(
    `INSERT INTO "ThreadsPostStat" ("threadsAccountId", "mediaId", text, permalink, "postedAt", views)
     VALUES ('a1', 'm-viral', 'postingan yang meledak karena pertanyaannya bikin semua orang ikut menjawab', 'https://threads.net/p/viral', '2026-10-09T03:10:00', 9000)`
  );

  const settings = { ...DEFAULT_SETTINGS, exploreRate: 0 };
  await upsertConfigs(
    [
      { accountId: "a1", workspaceId: "ws1", ...settings, mode: "OTOMATIS" },
      { accountId: "a2", workspaceId: "ws1", ...settings, mode: "TINJAU" },
      { accountId: "a3", workspaceId: "ws1", ...settings, mode: "MATI" },
      { accountId: "a4", workspaceId: "ws1", ...settings, mode: "OTOMATIS" },
      { accountId: "a5", workspaceId: "ws1", ...settings, mode: "OTOMATIS" },
    ],
    "u-admin",
    T0
  );
});

afterAll(() => {
  vi.useRealTimers();
});

describe("tick autopilot: rencana, tulis, antre", () => {
  it("putaran pertama merencanakan minimal 3 slot per hari di jam ramai dan mengerjakan yang jatuh tempo", async () => {
    const r = await tick(0);
    expect(r.ok).toBe(true);
    expect(r.error).toBeUndefined();

    // a1, a2, a5 aktif dan siap: 3 slot hari ini + 3 besok. a3 mati, a4 belum siap.
    expect(r.counts.direncanakan).toBe(18);
    for (const aid of ["a1", "a2", "a5"]) {
      for (const day of ["2026-10-13", "2026-10-14"]) {
        const list = await slots(`"accountId" = '${aid}' AND "dayKey" = '${day}'`);
        expect(list).toHaveLength(3);
        const times = list.map((s) => Date.parse(s.slotAt));
        for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(150 * MIN);
      }
    }
    expect(await count(`"AutopilotSlot" WHERE "accountId" IN ('a3', 'a4')`)).toBe(0);
    // Jam teratas akun 1 (19 dan 12 WIB) terpilih; hari ini jam 07 sudah lewat.
    const today1 = await slots(`"accountId" = 'a1' AND "dayKey" = '2026-10-13'`);
    expect(today1.map((s) => s.hour)).toEqual([12, 15, 19]);
    expect(today1.map((s) => wibParts(new Date(s.slotAt)).h)).toEqual([12, 15, 19]);
    expect((await slots(`"accountId" = 'a1' AND "dayKey" = '2026-10-14'`)).map((s) => s.hour)).toEqual([7, 12, 19]);

    // Akun yang perlu disambung ulang dijeda oleh penjaga.
    expect(r.counts.dijeda).toBe(1);
    const paused = await db.query<{ pausedReason: string }>(`SELECT "pausedReason" FROM "AutopilotConfig" WHERE "accountId" = 'a4'`);
    expect(paused.rows[0].pausedReason).toBe("AKUN_TIDAK_SIAP:NEEDS_RECONNECT");

    // Jatuh tempo: slot 12.xx akun 1 dan akun 5 (mode otomatis, <= 90 menit) + dua slot akun 2 (mode tinjau, <= 6 jam).
    expect(r.counts.diklaim).toBe(4);
    expect(r.counts.diantre).toBe(1);
    expect(r.counts.tinjau).toBe(2);
    expect(r.counts.gagalTulis).toBe(1);
  });

  it("slot mode otomatis masuk antrean penerbit tepat pada jam slot, atas nama sistem", async () => {
    const [slot] = await slots(`"accountId" = 'a1' AND status = 'TERANTRE'`);
    expect(slot.hour).toBe(12);
    expect(slot.draft?.checks.every((c) => c.ok)).toBe(true);

    const post = await db.query<{ tayang: string; source: string; status: string; caption: string }>(
      `SELECT to_char("tayangPada", 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS tayang, source, status::text, caption FROM "ScheduledPost" WHERE id = $1`,
      [slot.postId]
    );
    expect(post.rows[0]).toMatchObject({ tayang: slot.slotAt, source: "DASHBOARD_AI", status: "MENUNGGU", caption: slot.draft?.text });
    const dispatch = await db.query<{ publisher: string; status: string; socialAccountId: string }>(
      `SELECT publisher, status::text, "socialAccountId" FROM "PostDispatch" WHERE "postId" = $1`,
      [slot.postId]
    );
    expect(dispatch.rows).toEqual([{ publisher: "THREADS", status: "MENUNGGU", socialAccountId: "s1" }]);
    const log = await db.query<{ userId: string; key: string; aiEdited: boolean }>(
      `SELECT "userId", detail->>'idempotencyKey' AS key, "aiEdited" FROM "DashboardPostLog" WHERE "postId" = $1`,
      [slot.postId]
    );
    expect(log.rows).toEqual([{ userId: "system:autopilot", key: `autopilot:${slot.id}`, aiEdited: false }]);
  });

  it("riset mengisi radar (tanpa topik sensitif) dan bank ide; draf ditulis dari ide dan dinilai editor AI", async () => {
    const signals = await db.query<{ source: string; title: string; workspaceId: string | null }>(
      `SELECT source, title, "workspaceId" FROM "TrendSignal" ORDER BY source, title`
    );
    expect(signals.rows.filter((s) => s.source === "GTRENDS").map((s) => s.title)).toEqual(["menu bekal anak", "resep sambal matah"]);
    const winners = signals.rows.filter((s) => s.source === "JARINGAN");
    expect(winners).toHaveLength(1);
    expect(winners[0]).toMatchObject({ workspaceId: "ws1" });
    expect(winners[0].title).toMatch(/^postingan yang meledak/);

    // 7 ide sah per akun aktif; ide bertopik pemilu dibuang.
    for (const aid of ["a1", "a2", "a5"]) expect(await count(`"ContentIdea" WHERE "accountId" = '${aid}'`)).toBe(7);
    expect(await count(`"ContentIdea" WHERE topik ILIKE '%pemilu%'`)).toBe(0);
    expect(await count(`"ContentIdea" WHERE "accountId" IN ('a3', 'a4')`)).toBe(0);
    // Ide yang merujuk sinyal mendapat skor sinyal lebih tinggi daripada yang tidak.
    const scored = await db.query<{ withSignal: number; without: number }>(
      `SELECT MAX(score) FILTER (WHERE cardinality("signalIds") > 0) AS "withSignal",
              MAX(score) FILTER (WHERE cardinality("signalIds") = 0) AS without FROM "ContentIdea" WHERE "accountId" = 'a1'`
    );
    expect(scored.rows[0].withSignal).toBeGreaterThan(scored.rows[0].without);

    const [slot] = await slots(`"accountId" = 'a1' AND status = 'TERANTRE'`);
    const draft = slot.draft as unknown as { idea?: { id: string; topik: string }; topicKey?: string; checks: { key: string; ok: boolean }[] };
    expect(draft.idea?.topik).toMatch(/^akun1ide/);
    expect(draft.topicKey).toBeTruthy();
    expect(draft.checks.map((c) => c.key)).toEqual(["bentuk", "klaim", "terlarang", "kembar", "kritik"]);
    const used = await db.query<{ status: string; usedBySlot: string }>(`SELECT status, "usedBySlot" FROM "ContentIdea" WHERE id = $1`, [draft.idea!.id]);
    expect(used.rows[0]).toEqual({ status: "DIPAKAI", usedBySlot: slot.id });
    const score = await db.query<{ criticScore: number; ideaId: string }>(`SELECT "criticScore", "ideaId" FROM "AutopilotSlot" WHERE id = $1`, [slot.id]);
    expect(score.rows[0].criticScore).toBeCloseTo(0.87, 2);
    expect(score.rows[0].ideaId).toBe(draft.idea!.id);
  });

  it("mode tinjau: draf tersimpan, tidak ada yang masuk antrean tanpa persetujuan", async () => {
    const review = await slots(`"accountId" = 'a2' AND status = 'MENUNGGU_TINJAU'`);
    expect(review.map((s) => s.hour)).toEqual([12, 15]);
    expect(review.every((s) => s.draft && s.postId === null)).toBe(true);
    // Draf kedua akun yang sama tidak mengulang draf pertama.
    expect(review[0].draft?.text).not.toBe(review[1].draft?.text);
    expect(await count(`"ScheduledPost"`)).toBe(1);
  });

  it("draf yang memuat promo karangan ditolak gerbang dan tidak pernah diantre", async () => {
    const [slot] = await slots(`"accountId" = 'a5' AND "dayKey" = '2026-10-13' AND hour = 12`);
    expect(slot.status).toBe("DIRENCANAKAN");
    expect(slot.attempt).toBe(1);
    expect(slot.lastError).toMatch(/Tidak lolos pemeriksaan/);
    expect(slot.lastError).toMatch(/promo|diskon|50%/);
  });

  it("putaran berikutnya tidak menggandakan rencana maupun posting, dan hemat perjalanan ke database", async () => {
    const before = { slots: await count(`"AutopilotSlot"`), posts: await count(`"ScheduledPost"`) };
    const r = await tick(5);
    expect(r.ok).toBe(true);
    expect(r.counts.direncanakan).toBeUndefined();
    expect(await count(`"AutopilotSlot"`)).toBe(before.slots);
    expect(await count(`"ScheduledPost"`)).toBe(before.posts);
    // Hanya slot akun 5 yang dicoba lagi (masih ditolak gerbang).
    expect(r.counts.diklaim).toBe(1);
    expect(r.counts.gagalTulis).toBe(1);

    // Putaran tanpa penulisan: jumlah RPC tetap, tidak bergantung jumlah akun.
    await db.exec(`UPDATE "AutopilotConfig" SET mode = 'MATI' WHERE "accountId" = 'a5'`);
    const quiet = await tick(6);
    expect(quiet.counts.diklaim).toBeUndefined();
    expect(h.calls.length).toBeLessThanOrEqual(12);
    await db.exec(`UPDATE "AutopilotConfig" SET mode = 'OTOMATIS' WHERE "accountId" = 'a5'`);
  });

  it("slot yang gagal ditulis tiga kali dilewati dengan alasan yang jelas", async () => {
    const r = await tick(10);
    expect(r.counts.dilewati).toBe(1);
    const [slot] = await slots(`"accountId" = 'a5' AND "dayKey" = '2026-10-13' AND hour = 12`);
    expect(slot.status).toBe("DILEWATI");
    expect(slot.attempt).toBe(3);
    expect(slot.skipReason).toMatch(/Tidak lolos pemeriksaan/);
    expect(await count(`"ScheduledPost" p JOIN "PostDispatch" d ON d."postId" = p.id WHERE d."socialAccountId" = 's5'`)).toBe(0);
  });

  it("dua tick serentak: hanya satu yang bekerja", async () => {
    vi.setSystemTime(at(11));
    const [a, b] = await Promise.all([runTick({ now: at(11) }), runTick({ now: at(11) })]);
    expect([a.skipped, b.skipped].filter(Boolean)).toEqual(["Tick lain masih berjalan."]);
  });
});

describe("tick autopilot: rekonsiliasi dan penjaga", () => {
  it("posting yang terbit menandai slotnya TERBIT", async () => {
    await db.exec(`UPDATE "PostDispatch" SET status = 'TERBIT', "releaseUrl" = 'https://threads.net/p/1' WHERE "socialAccountId" = 's1'`);
    const r = await tick(15);
    expect(r.counts.terbit).toBe(1);
    expect((await slots(`"accountId" = 'a1' AND status = 'TERBIT'`)).map((s) => s.hour)).toEqual([12]);
  });

  it("akun yang sudah siap kembali dilanjutkan dan langsung direncanakan", async () => {
    await db.exec(`UPDATE "ThreadsAccount" SET "needsReconnect" = false WHERE id = 'a4'`);
    const r = await tick(20);
    expect(r.counts.dilanjutkan).toBe(1);
    expect(r.counts.direncanakan).toBeGreaterThanOrEqual(3);
    expect(await count(`"AutopilotSlot" WHERE "accountId" = 'a4' AND "dayKey" = '2026-10-14'`)).toBe(3);
  });

  it("saklar posting mati: rencana tetap ada, tidak ada yang ditulis atau diantre", async () => {
    delete process.env.CONTENT_PUBLISH_ENABLED;
    const posts = await count(`"ScheduledPost"`);
    const r = await tick(25);
    expect(r.counts.saklarMati).toBe(1);
    expect(r.counts.diklaim).toBeUndefined();
    expect(await count(`"ScheduledPost"`)).toBe(posts);
    process.env.CONTENT_PUBLISH_ENABLED = "true";
  });

  it("penerbit terlambat: autopilot berhenti menambah antrean", async () => {
    // Posting akun 4 yang seharusnya sudah tayang 10 menit lalu tetapi belum diambil penerbit.
    await db.exec(`
      INSERT INTO "ScheduledPost" (id, "workspaceId", caption, "tayangPada", status, source) VALUES ('p-telat', 'ws1', 'x', '${at(20).toISOString()}', 'MENUNGGU', 'DASHBOARD_AI');
      INSERT INTO "PostDispatch" (id, "postId", "outletId", "socialAccountId", publisher, status) VALUES ('d-telat', 'p-telat', 'o4', 's4', 'THREADS', 'MENUNGGU');
      UPDATE "AutopilotSlot" SET status = 'TERANTRE', "postId" = 'p-telat'
        WHERE id = (SELECT id FROM "AutopilotSlot" WHERE "accountId" = 'a4' ORDER BY "slotAt" LIMIT 1);`);
    const r = await tick(30);
    expect(r.counts.penerbitTelat).toBe(1);
    expect(r.counts.diklaim).toBeUndefined();
    await db.exec(`UPDATE "PostDispatch" SET status = 'TERBIT' WHERE id = 'd-telat'`);
  });

  it("tiga posting gagal beruntun menjeda akun", async () => {
    await db.exec(`
      UPDATE "AutopilotSlot" SET status = 'GAGAL', "slotAt" = '${at(31).toISOString()}'
        WHERE id IN (SELECT id FROM "AutopilotSlot" WHERE "accountId" = 'a5' AND status = 'DIRENCANAKAN' ORDER BY "slotAt" LIMIT 3);`);
    const r = await tick(35);
    expect(r.counts.dijeda).toBe(1);
    const cfg = await db.query<{ pausedReason: string }>(`SELECT "pausedReason" FROM "AutopilotConfig" WHERE "accountId" = 'a5'`);
    expect(cfg.rows[0].pausedReason).toBe("GAGAL_BERUNTUN");
  });
});

describe("tindakan manusia atas slot", () => {
  it("menyetujui draf (dengan suntingan) memasukkannya ke antrean atas nama penyetuju, tepat sekali", async () => {
    vi.setSystemTime(at(40));
    const [slot] = await slots(`"accountId" = 'a2' AND status = 'MENUNGGU_TINJAU' AND hour = 12`);
    const text = "versi suntingan manusia yang tetap santai, kalian setuju nggak sama ini?";
    const [first, second] = await Promise.all([
      approveSlot({ slotId: slot.id, workspaceId: "ws1", userId: "u-editor", text }),
      approveSlot({ slotId: slot.id, workspaceId: "ws1", userId: "u-editor", text }),
    ]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);

    const [after] = await slots(`id = '${slot.id}'`);
    expect(after.status).toBe("TERANTRE");
    expect(after.draft).toMatchObject({ text, edited: true });
    const log = await db.query<{ userId: string; aiEdited: boolean }>(
      `SELECT "userId", "aiEdited" FROM "DashboardPostLog" WHERE "postId" = $1`,
      [after.postId]
    );
    expect(log.rows).toEqual([{ userId: "u-editor", aiEdited: true }]);
    expect(await count(`"PostDispatch" WHERE "socialAccountId" = 's2'`)).toBe(1);
    expect(await count(`"DashboardAuditLog" WHERE action = 'AUTOPILOT_SETUJUI' AND actor = 'u-editor'`)).toBe(1);
  });

  it("workspace lain tidak bisa menyentuh slot", async () => {
    const [slot] = await slots(`"accountId" = 'a2' AND status = 'MENUNGGU_TINJAU'`);
    expect(await approveSlot({ slotId: slot.id, workspaceId: "ws-lain", userId: "u-x" })).toMatchObject({ ok: false, status: 404 });
    expect(await rejectSlot({ slotId: slot.id, workspaceId: "ws-lain", userId: "u-x" })).toMatchObject({ ok: false, status: 409 });
    expect((await slots(`id = '${slot.id}'`))[0].status).toBe("MENUNGGU_TINJAU");
  });

  it("tulis ulang mengembalikan slot ke rencana; tolak dan lewati menandainya dilewati", async () => {
    const [slot] = await slots(`"accountId" = 'a2' AND status = 'MENUNGGU_TINJAU'`);
    expect(await rewriteSlot({ slotId: slot.id, workspaceId: "ws1", userId: "u-editor" })).toEqual({ ok: true });
    let [after] = await slots(`id = '${slot.id}'`);
    expect(after).toMatchObject({ status: "DIRENCANAKAN", attempt: 0 });
    // Teks lama dipertahankan sebagai contoh yang harus dihindari saat ditulis ulang.
    expect(after.draft?.text).toBe(slot.draft?.text);

    expect(await skipSlot({ slotId: slot.id, workspaceId: "ws1", userId: "u-editor" })).toEqual({ ok: true });
    [after] = await slots(`id = '${slot.id}'`);
    expect(after).toMatchObject({ status: "DILEWATI", skipReason: "Dilewati pengguna." });
    expect(await rejectSlot({ slotId: slot.id, workspaceId: "ws1", userId: "u-editor" })).toMatchObject({ ok: false, status: 409 });
  });

  it("klaim ulang setelah proses terputus memulihkan slot, bukan menulis posting kedua", async () => {
    // Simulasi: posting sudah dibuat untuk slot, tetapi status slot belum sempat menjadi TERANTRE.
    const [slot] = await slots(`"accountId" = 'a1' AND "dayKey" = '2026-10-13' AND hour = 15`);
    await pgRpc(db, "dash_create_posts", {
      p_items: [
        {
          postId: "p-putus",
          workspaceId: "ws1",
          judul: "j",
          caption: "teks yang sudah terlanjur diantre sebelum proses terputus",
          hashtags: [],
          tayangPada: slot.slotAt,
          batchId: "b",
          outletId: "o1",
          socialAccountId: "s1",
          userId: "system:autopilot",
          action: "CREATE_SCHEDULED",
          aiModel: "m",
          aiEdited: false,
          detail: { idempotencyKey: `autopilot:${slot.id}` },
        },
      ],
    });
    await db.exec(`UPDATE "AutopilotSlot" SET status = 'MENULIS', attempt = 1, "leaseUntil" = '${at(41).toISOString()}' WHERE id = '${slot.id}'`);
    // Penerbit tiruan: posting lain yang sudah lewat jadwal dianggap terbit, supaya penulisan tidak ditahan.
    await db.exec(`UPDATE "PostDispatch" SET status = 'TERBIT' WHERE "postId" <> 'p-putus'`);
    const posts = await count(`"PostDispatch" WHERE "socialAccountId" = 's1'`);

    // 14.00 WIB: slot 15.xx jatuh tempo dan lease-nya sudah lewat.
    const r = await tick(180);
    expect(r.ok).toBe(true);
    const [after] = await slots(`id = '${slot.id}'`);
    expect(after).toMatchObject({ status: "TERANTRE", postId: "p-putus" });
    expect(await count(`"PostDispatch" WHERE "socialAccountId" = 's1'`)).toBe(posts);
  });
});
