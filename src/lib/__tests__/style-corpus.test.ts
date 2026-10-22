/**
 * Korpus gaya Threads (sql/041_style_corpus.sql + src/lib/style-corpus.ts + /api/style-examples):
 * isolasi per workspace, pemeringkatan (skor, OWN, format, topik, hampir-sama, keragaman), contoh MANUAL
 * selalu ikut, profil layout, dan validasi/lingkup route. SQL asli di Postgres in-memory (PGlite); yang
 * di-mock hanya transport database dan pembacaan cookie sesi.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./helpers/pg";

const h = vi.hoisted(() => ({ db: null as unknown, calls: [] as string[] }));

vi.mock("@supabase/supabase-js", async () => {
  const { supabaseMock } = await import("./helpers/pg");
  return supabaseMock(() => h.db as TestDb, h.calls);
});

// Sesi tiruan: nilai cookie `session` langsung menjadi id pengguna.
vi.mock("@/lib/users", async (original) => ({
  ...(await original<typeof import("@/lib/users")>()),
  getSessionUserId: async (cookie: string | undefined) => cookie || null,
}));

import { NextRequest } from "next/server";
import { bootDb, pgRpc } from "./helpers/pg";
import { forgetMembership } from "../request-ctx";
import {
  buildCorpus,
  contentTokens,
  forgetStyleCorpus,
  layoutProfile,
  profileOf,
  rankExemplars,
  styleExemplars,
  type CorpusEntry,
} from "../style-corpus";
import { layoutFeatures, type PostFormat, type StyleExemplar } from "../style-types";
import { DELETE, GET, POST } from "@/app/api/style-examples/route";

let db: TestDb;
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const since = () => new Date(Date.now() - 120 * DAY).toISOString().replace("Z", "");

const MIRROR_INDEXES = `
  CREATE INDEX IF NOT EXISTS "ThreadsPostStat_acc_posted_idx" ON "ThreadsPostStat" ("threadsAccountId", "postedAt");
  CREATE INDEX IF NOT EXISTS "ThreadsAccount_ws_idx" ON "ThreadsAccount" ("workspaceId");
`;

async function post(id: string, acc: string, text: string, views: number, replies = 1, opts: { days?: number; quote?: boolean; type?: string } = {}) {
  await db.query(
    `INSERT INTO "ThreadsPostStat" (id, "mediaId", "threadsAccountId", "mediaType", text, "isQuote", "postedAt", views, likes, replies, reposts)
     VALUES ($1, $1, $2, $3, $4, $5, $6, $7, 0, $8, 0)`,
    [id, acc, opts.type ?? "TEXT_POST", text, opts.quote ?? false, opts.days === undefined ? ago(10) : ago(opts.days), views, replies]
  );
}

const LIST_HIT = "cara hemat kopi tiap hari:\n1. bawa tumbler sendiri\n2. seduh di rumah pakai v60\n3. beli biji kopi lokal";
const LIST_DUP = "cara hemat kopi tiap hari:\n1. bawa tumbler sendiri\n2. seduh di rumah pakai v60\n3. beli biji kopi lokal ya";

beforeAll(async () => {
  process.env.AUTH_SECRET = "uji-rahasia-yang-panjangnya-lebih-dari-32-karakter";
  process.env.SUPABASE_URL = "http://uji.lokal";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "kunci-uji";
  delete process.env.EXCLUDED_THREADS_ACCOUNTS;

  db = await bootDb(["sql/002_dashboard_post_log.sql", "sql/003_dashboard_rpc.sql", "sql/005_autopilot.sql", "sql/041_style_corpus.sql"]);
  h.db = db;
  await db.exec(MIRROR_INDEXES);
  await db.exec(`
    INSERT INTO "Workspace" VALUES ('ws1', 'Kopi Satu', 'kopi-satu'), ('ws1b', 'Kopi Cabang', 'kopi-cabang'), ('ws2', 'Brand Lain', 'brand-lain');
    INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "accessExpiresAt", "accessToken") VALUES
      ('a1', 'ws1', 'kopi_satu', 'Kopi Satu', '2099-01-01', 'x'),
      ('a2', 'ws1', 'kopi_dua', 'Kopi Dua', '2099-01-01', 'x'),
      ('a4', 'ws1b', 'kopi_cabang', 'Kopi Cabang', '2099-01-01', 'x'),
      ('a3', 'ws2', 'brand_lain', 'Brand Lain', '2099-01-01', 'x');
    -- ws1b tergabung ke tenant ws1; ws2 tenant sendiri.
    DELETE FROM "DashboardWorkspaceGroup";
    INSERT INTO "DashboardWorkspaceGroup" VALUES ('ws1', 'ws1'), ('ws1b', 'ws1');
  `);

  // a1 (OWN): median views 100, beberapa postingan ramai.
  for (let i = 0; i < 10; i++) await post(`a1-base${i}`, "a1", `menurut gue kopi susu gula aren itu biasa aja nomor ${i}`, 100, 2);
  await post("a1-list", "a1", LIST_HIT, 1000, 20);
  await post("a1-listdup", "a1", LIST_DUP, 900, 18);
  await post("a1-cerita1", "a1", "kemarin ada pelanggan pesan kopi tanpa gula\nterus dia bilang ini kopi paling jujur", 800, 10);
  await post("a1-cerita2", "a1", "dulu waktu pertama buka kedai\ncuma ada satu mesin dan dua kursi plastik", 700, 9);
  await post("a1-cerita3", "a1", "pernah suatu malam hujan deras\nsemua pelanggan nunggu reda sambil ngobrol bareng", 650, 8);
  await post("a1-quote", "a1", "kutipan postingan orang lain yang ramai sekali tentang kopi", 50000, 500, { quote: true });
  await post("a1-baru", "a1", "postingan baru sejam lalu yang metriknya belum matang ya", 50000, 500, { days: 1 });
  await post("a1-lama", "a1", "postingan yang sudah terlalu lama untuk masuk korpus gaya", 50000, 500, { days: 200 });
  await post("a1-pendek", "a1", "kopi!", 50000, 500);
  // a2 (WORKSPACE): median 50, satu INFO ramai.
  for (let i = 0; i < 4; i++) await post(`a2-base${i}`, "a2", `jadwal buka kedai hari ini seperti biasa ya kak ${i}`, 50, 1);
  await post("a2-info", "a2", "ternyata suhu air seduh yang pas itu 92 derajat\nlebih panas bikin kopi pahit", 500, 6);
  // a4 (workspace anggota kelompok ws1).
  await post("a4-base", "a4", "kedai cabang buka jam tujuh pagi sampai malam", 40, 1);
  await post("a4-hit", "a4", "unpopular opinion: kopi sachet itu tidak salah\nyang salah gengsinya", 400, 5);
  // a3 (workspace lain): sangat viral, memuat kata topik. TIDAK BOLEH muncul untuk ws1.
  await post("a3-base", "a3", "postingan biasa dari brand lain tentang teh", 10, 0);
  await post("a3-viral", "a3", "kopi tumbler hemat viral sekali dari workspace lain\n1. satu\n2. dua", 100000, 900);

  await db.exec(`
    INSERT INTO "StyleExample" (id, "workspaceId", "accountId", text, format, "createdAt") VALUES
      ('m-ws1', 'ws1', NULL, 'gue kasih tau ya\nkopi enak itu bukan soal mahal\ntapi soal siapa yang nyeduh', 'OPINI', now() - interval '2 hours'),
      ('m-a1', 'ws1', 'a1', 'pagi ini sepi banget\ntapi ada satu pelanggan yang balik lagi\ndan itu cukup', 'CURHAT', now() - interval '1 hour'),
      ('m-a2', 'ws1', 'a2', 'contoh khusus akun kopi dua yang bukan untuk akun satu', 'INFO', now()),
      ('m-ws2', 'ws2', NULL, 'contoh gaya milik workspace lain yang tidak boleh bocor', 'OPINI', now());
  `);

  await db.exec(fs.readFileSync(path.resolve(__dirname, "../../../sql/008_multiuser.sql"), "utf8"));
  await db.exec(`
    INSERT INTO "DashboardUser" (id, username, email, "passwordHash") VALUES
      ('u-owner', 'owner', 'owner@contoh.id', 'x'), ('u-editor', 'editor', 'editor@contoh.id', 'x'),
      ('u-viewer', 'viewer', 'viewer@contoh.id', 'x'), ('u-lain', 'lain', 'lain@contoh.id', 'x');
    DELETE FROM "DashboardMembership";
    INSERT INTO "DashboardMembership" ("userId", "workspaceId", role, "accountScope") VALUES
      ('u-owner', 'ws1', 'OWNER', 'SEMUA'), ('u-editor', 'ws1', 'EDITOR', 'PILIHAN'),
      ('u-viewer', 'ws1', 'VIEWER', 'SEMUA'), ('u-lain', 'ws2', 'OWNER', 'SEMUA');
    INSERT INTO "DashboardMemberAccount" VALUES ('u-editor', 'ws1', 'a2');
  `);
  forgetMembership();
}, 60_000);

beforeEach(() => {
  forgetStyleCorpus();
  h.calls.length = 0;
});

interface Cand {
  posts: { id: string; aid: string; source: string; handle: string; medViews: number; medReplies: number }[];
  manual: { id: string }[];
}

describe("dash_style_candidates (SQL)", () => {
  it("hanya postingan dan contoh dari workspace (tenant) yang sama", async () => {
    const r = await pgRpc<Cand>(db, "dash_style_candidates", { p_workspace: "ws1", p_account: "a1", p_since: since(), p_limit: 150 });
    const ids = r.posts.map((p) => p.id);
    expect(new Set(r.posts.map((p) => p.aid))).toEqual(new Set(["a1", "a2", "a4"]));
    expect(ids).not.toContain("a3-viral");
    // Bukan kutipan, bukan postingan < 2 hari, bukan di luar jendela, bukan teks < 20 karakter.
    for (const x of ["a1-quote", "a1-baru", "a1-lama", "a1-pendek"]) expect(ids).not.toContain(x);
    expect(r.posts.find((p) => p.id === "a1-list")).toMatchObject({ source: "OWN", handle: "kopi_satu", medViews: 100 });
    expect(r.posts.find((p) => p.id === "a2-info")).toMatchObject({ source: "WORKSPACE", medViews: 50 });
    expect(r.posts.find((p) => p.id === "a4-hit")?.source).toBe("WORKSPACE");
    // Urut views relatif (terbaik dulu).
    expect(ids[0]).toBe("a1-list");
    expect(r.manual.map((m) => m.id).sort()).toEqual(["m-a1", "m-ws1"]);

    // Akun workspace lain yang dicoba dari tenant ws2 tetap hanya mendapat data ws2.
    const other = await pgRpc<Cand>(db, "dash_style_candidates", { p_workspace: "ws2", p_account: "a1", p_since: since(), p_limit: 150 });
    expect(new Set(other.posts.map((p) => p.aid))).toEqual(new Set(["a3"]));
    expect(other.posts.every((p) => p.source === "WORKSPACE")).toBe(true);
    expect(other.manual.map((m) => m.id)).toEqual(["m-ws2"]);

    // Workspace anggota kelompok bukan tenant: tidak bisa membaca saudaranya lewat id-nya sendiri.
    const member = await pgRpc<Cand>(db, "dash_style_candidates", { p_workspace: "ws1b", p_account: "a4", p_since: since(), p_limit: 150 });
    expect(member.posts).toEqual([]);
  });

  it("p_limit memangkas di SQL", async () => {
    const r = await pgRpc<Cand>(db, "dash_style_candidates", { p_workspace: "ws1", p_account: "a1", p_since: since(), p_limit: 3 });
    expect(r.posts).toHaveLength(3);
  });

  it("CRUD contoh selalu dibatasi workspace", async () => {
    await expect(
      pgRpc(db, "dash_style_example_add", {
        p_workspace: "ws2", p_account: "a1", p_text: "akun milik workspace lain tidak boleh", p_format: "OPINI",
        p_note: null, p_user: "u", p_now: new Date(),
      })
    ).rejects.toThrow(/22023/);
    // Akun anggota kelompok boleh dipakai dari tenant-nya.
    const row = await pgRpc<{ id: string }>(db, "dash_style_example_add", {
      p_workspace: "ws1", p_account: "a4", p_text: "contoh untuk akun cabang dari tenant", p_format: "INFO", p_note: " ", p_user: "u", p_now: new Date(),
    });
    expect(await pgRpc(db, "dash_style_example_delete", { p_workspace: "ws2", p_id: row.id })).toBeNull();
    expect(await pgRpc(db, "dash_style_example_delete", { p_workspace: "ws1", p_id: row.id, p_accounts: ["a2"] })).toBeNull();
    expect(await pgRpc(db, "dash_style_example_delete", { p_workspace: "ws1", p_id: row.id })).toEqual({ accountId: "a4" });
    const list = await pgRpc<{ id: string }[]>(db, "dash_style_example_list", { p_workspace: "ws2" });
    expect(list.map((x) => x.id)).toEqual(["m-ws2"]);
  });
});

describe("styleExemplars / layoutProfile", () => {
  it("MANUAL selalu ikut, skor < 0.3 dibuang, hampir-sama dibuang, maks 2 per format", async () => {
    const ex = await styleExemplars({ workspaceId: "ws1", accountId: "a1" });
    const ids = ex.map((e) => e.id);
    expect(ex).toHaveLength(5);
    expect(ids.slice(0, 2).sort()).toEqual(["m-a1", "m-ws1"]);
    expect(ids).toContain("a1-list");
    expect(ids).not.toContain("a1-listdup");
    expect(ids).not.toContain("a3-viral");
    expect(ids).not.toContain("m-a2");
    expect(ids.some((i) => i.startsWith("a1-base"))).toBe(false);
    const counts = new Map<PostFormat, number>();
    for (const e of ex) counts.set(e.format, (counts.get(e.format) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
    for (const e of ex) {
      if (e.source === "MANUAL") expect(e.score).toBeNull();
      else expect(e.score!).toBeGreaterThanOrEqual(0.3);
    }
    // Baris baru dipertahankan, fitur layout terisi.
    const list = ex.find((e) => e.id === "a1-list")!;
    expect(list.text).toBe(LIST_HIT);
    expect(list.format).toBe("TIPS_LIST");
    expect(list.features).toEqual(layoutFeatures(LIST_HIT));
    expect(list.source).toBe("OWN");
    expect(list.handle).toBe("kopi_satu");
  });

  it("preferFormats melonggarkan batas format; topicHint menaikkan yang relevan", async () => {
    const cerita = await styleExemplars({ workspaceId: "ws1", accountId: "a1", preferFormats: ["CERITA"], limit: 6 });
    expect(cerita.filter((e) => e.format === "CERITA").length).toBe(3);

    const topic = await styleExemplars({ workspaceId: "ws1", accountId: "a1", topicHint: "suhu air seduh kopi derajat", limit: 3 });
    expect(topic.map((e) => e.id)).toContain("a2-info");
    // Satu panggilan RPC untuk tiga permintaan (cache 10 menit per workspace+akun).
    expect(h.calls.filter((c) => c === "dash_style_candidates")).toHaveLength(1);
  });

  it("profil layout: null di bawah 5 postingan, terisi di atasnya", async () => {
    expect(await layoutProfile("ws2", "a3")).toBeNull();
    const p = await layoutProfile("ws1", "a1");
    expect(p).not.toBeNull();
    expect(p!.sample).toBeGreaterThanOrEqual(5);
    expect(p!.topFormats[0].format).toBe("CERITA");
    expect(p!.topFormats.reduce((s, f) => s + f.share, 0)).toBeCloseTo(1, 1);
    expect(p!.listShare).toBeGreaterThan(0);
  });

  it("SQL belum dipasang atau galat: [] / null tanpa melempar", async () => {
    const bare = await bootDb(["sql/002_dashboard_post_log.sql", "sql/003_dashboard_rpc.sql", "sql/005_autopilot.sql"]);
    const prev = h.db;
    h.db = bare;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await styleExemplars({ workspaceId: "ws1", accountId: "a1" })).toEqual([]);
      expect(await layoutProfile("ws1", "a1")).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      h.db = prev;
      warn.mockRestore();
    }
  }, 30_000);
});

describe("rankExemplars / profileOf (murni)", () => {
  const entry = (id: string, text: string, score: number | null, source: StyleExemplar["source"] = "WORKSPACE", format?: PostFormat): CorpusEntry => ({
    id,
    text,
    format: format ?? "OPINI",
    features: layoutFeatures(text),
    score,
    source,
    handle: null,
    tokens: contentTokens(text),
  });

  it("OWN mendapat bonus kecil, MANUAL di atas segalanya", () => {
    const pool = [
      entry("w", "postingan workspace tentang kopi pagi hari", 1.0, "WORKSPACE", "INFO"),
      entry("o", "postingan sendiri tentang teh sore hari", 0.9, "OWN", "CERITA"),
      entry("m", "contoh manual tempelan pemilik akun", null, "MANUAL", "CURHAT"),
      entry("x", "postingan sepi yang tidak layak ditiru", 0.29, "OWN", "OPINI"),
    ];
    expect(rankExemplars(pool).map((e) => e.id)).toEqual(["m", "o", "w"]);
  });

  it("hampir-sama dibuang; batas format dilonggarkan bila kuota belum penuh", () => {
    const pool = [
      entry("a", "satu dua tiga empat lima enam tujuh delapan", 1.5),
      entry("b", "satu dua tiga empat lima enam tujuh sembilan", 1.4),
      entry("c", "kopi pahit pagi hari", 1.3),
      entry("d", "teh manis sore hari", 1.2),
    ];
    // Semua OPINI: putaran pertama maks 2 (a, c), putaran kedua menambah d; b tetap dibuang (hampir sama a).
    expect(rankExemplars(pool, { limit: 4 }).map((e) => e.id)).toEqual(["a", "c", "d"]);
  });

  it("buildCorpus membuang akun yang dikecualikan dan menebak format manual yang rusak", () => {
    const pool = buildCorpus({
      posts: [
        { id: "p1", aid: "x", handle: "maulanayusuf7923", source: "WORKSPACE", text: "teks akun yang dikecualikan dashboard", views: 9, likes: 0, replies: 0, reposts: 0, medViews: 1, medReplies: 0 },
      ],
      manual: [{ id: "m1", accountId: null, text: "tips:\n1. satu hal\n2. dua hal", format: "ANEH", note: null }],
    });
    expect(pool.map((e) => [e.id, e.format])).toEqual([["m1", "TIPS_LIST"]]);
    expect(profileOf(pool)).toBeNull();
  });
});

// ------------------------------------------------------------------ route

const req = (method: string, user: string | null, query = "", body?: unknown) =>
  new NextRequest(`http://localhost/api/style-examples${query}`, {
    method,
    headers: { ...(user ? { cookie: `session=${user}` } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

interface ListBody {
  success: boolean;
  ready?: boolean;
  examples?: { id: string; accountId: string | null; format: string; text: string }[];
  profile?: unknown;
  example?: { id: string; format: string; text: string; accountId: string | null };
  error?: string;
}
const json = async (res: Response) => (await res.json()) as ListBody;

describe("/api/style-examples", () => {
  it("butuh sesi; VIEWER boleh membaca, tidak boleh menulis", async () => {
    expect((await GET(req("GET", null, "?accountId=a1"))).status).toBe(401);
    const res = await GET(req("GET", "u-viewer", "?accountId=a1&profile=1"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.examples?.map((e) => e.id).sort()).toEqual(["m-a1", "m-ws1"]);
    expect(body.profile).not.toBeNull();
    expect((await POST(req("POST", "u-viewer", "", { accountId: "a1", text: "x".repeat(30) }))).status).toBe(403);
    expect((await DELETE(req("DELETE", "u-viewer", "?id=m-a1"))).status).toBe(403);
  });

  it("isolasi: pengguna workspace lain tidak melihat, membuat, atau menghapus contoh ws1", async () => {
    expect((await GET(req("GET", "u-lain", "?accountId=a1"))).status).toBe(404);
    const all = await json(await GET(req("GET", "u-lain")));
    expect(all.examples?.map((e) => e.id)).toEqual(["m-ws2"]);
    expect((await POST(req("POST", "u-lain", "", { accountId: "a1", text: "mencoba menulis ke akun workspace lain" }))).status).toBe(404);
    expect((await DELETE(req("DELETE", "u-lain", "?id=m-ws1"))).status).toBe(404);
    expect((await db.query(`SELECT 1 FROM "StyleExample" WHERE id = 'm-ws1'`)).rows).toHaveLength(1);
  });

  it("editor berlingkup akun: hanya akun miliknya, tidak boleh contoh semua akun", async () => {
    const list = await json(await GET(req("GET", "u-editor")));
    // Contoh khusus a1 tidak tampil untuknya; contoh semua akun dan contoh a2 tampil.
    expect(list.examples?.map((e) => e.id).sort()).toEqual(["m-a2", "m-ws1"]);
    expect((await POST(req("POST", "u-editor", "", { accountId: "a1", text: "akun ini bukan lingkup editor ya" }))).status).toBe(404);
    expect((await POST(req("POST", "u-editor", "", { accountId: null, text: "contoh untuk semua akun di workspace" }))).status).toBe(403);
    expect((await DELETE(req("DELETE", "u-editor", "?id=m-ws1"))).status).toBe(404);
    const ok = await POST(req("POST", "u-editor", "", { accountId: "a2", text: "contoh milik editor untuk akun dua" }));
    expect(ok.status).toBe(201);
    const { example } = await json(ok);
    expect((await DELETE(req("DELETE", "u-editor", `?id=${example!.id}`))).status).toBe(200);
  });

  it("validasi teks 20-1000 karakter dan format; baris baru dijaga; format otomatis", async () => {
    expect((await POST(req("POST", "u-owner", "", { accountId: "a1", text: "terlalu pendek" }))).status).toBe(400);
    expect((await POST(req("POST", "u-owner", "", { accountId: "a1", text: "a".repeat(1001) }))).status).toBe(400);
    expect((await POST(req("POST", "u-owner", "", { accountId: "a1", text: "a".repeat(40), format: "PUISI" }))).status).toBe(400);
    expect((await POST(req("POST", "u-owner", "", { accountId: "a1", text: "a".repeat(40), note: 5 }))).status).toBe(400);
    expect((await POST(req("POST", "u-owner", "", { accountId: "../x", text: "a".repeat(40) }))).status).toBe(404);

    const text = "3 kebiasaan barista yang jarang orang tau:\r\n1. cicip tiap shot\r\n2. bersihin steam wand\r\n3. timbang biji";
    const res = await POST(req("POST", "u-owner", "", { accountId: "a1", text, format: "AUTO" }));
    expect(res.status).toBe(201);
    const { example } = await json(res);
    expect(example).toMatchObject({ format: "TIPS_LIST", accountId: "a1", text: text.replace(/\r\n/g, "\n") });

    const opini = await json(await POST(req("POST", "u-owner", "", { accountId: null, text: "contoh tanpa akun berlaku untuk semua akun", format: "OPINI" })));
    expect(opini.example).toMatchObject({ format: "OPINI", accountId: null });

    // Cache korpus workspace dibuang saat menulis: contoh baru langsung dipakai penulis.
    await styleExemplars({ workspaceId: "ws1", accountId: "a1" });
    const fresh = await json(await POST(req("POST", "u-owner", "", { accountId: "a1", text: "contoh paling baru\nharus langsung terbaca korpus" })));
    const ex = await styleExemplars({ workspaceId: "ws1", accountId: "a1", limit: 10 });
    expect(ex.map((e) => e.id)).toContain(fresh.example!.id);

    for (const id of [example!.id, opini.example!.id, fresh.example!.id]) {
      expect((await DELETE(req("DELETE", "u-owner", `?id=${id}`))).status).toBe(200);
    }
    expect((await DELETE(req("DELETE", "u-owner", "?id=tidak-ada"))).status).toBe(404);
    expect((await DELETE(req("DELETE", "u-owner", "?id=../x"))).status).toBe(400);
  });
});

describe("volume realistis", () => {
  it("30 akun x 300 postingan: RPC cepat dan payload terbatas", async () => {
    await db.exec(`
      INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "accessExpiresAt", "accessToken")
      SELECT 'v' || g, 'ws9', 'vol_' || g, 'Vol ' || g, '2099-01-01', 'x' FROM generate_series(1, 30) g;
      INSERT INTO "ThreadsPostStat" (id, "mediaId", "threadsAccountId", "mediaType", text, "isQuote", "postedAt", views, likes, replies, reposts)
      SELECT 'vp-' || a || '-' || i, 'vp-' || a || '-' || i, 'v' || a, 'TEXT_POST',
             'postingan nomor ' || i || ' dari akun ' || a || E'\\nbaris kedua tentang kopi dan teh ' || (i % 17) || E'\\nbaris ketiga',
             (i % 50 = 0), (now() AT TIME ZONE 'UTC') - ((3 + (i % 150)) || ' days')::interval,
             (abs(hashtext(a || ':' || i)) % 5000), 0, (abs(hashtext(i || ':' || a)) % 40), 0
      FROM generate_series(1, 30) a, generate_series(1, 300) i;
      ANALYZE "ThreadsPostStat";
    `);
    const args = { p_workspace: "ws9", p_account: "v1", p_since: since(), p_limit: 150 };
    await pgRpc(db, "dash_style_candidates", args); // pemanasan
    const runs: number[] = [];
    let r: Cand | null = null;
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      r = await pgRpc<Cand>(db, "dash_style_candidates", args);
      runs.push(performance.now() - t);
    }
    runs.sort((a, b) => a - b);
    const bytes = JSON.stringify(r).length;
    console.log(`[style-corpus] dash_style_candidates 30x300: median ${runs[2].toFixed(1)} ms, payload ${(bytes / 1024).toFixed(1)} KB, posts ${r!.posts.length}`);
    expect(r!.posts).toHaveLength(150);
    // Tiap penulis maks sepertiga kuota.
    const per = new Map<string, number>();
    for (const p of r!.posts) per.set(p.aid, (per.get(p.aid) ?? 0) + 1);
    expect(Math.max(...per.values())).toBeLessThanOrEqual(50);
    expect(runs[2]).toBeLessThan(2000);
  }, 60_000);
});
