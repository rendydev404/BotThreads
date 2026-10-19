/**
 * Penerbit Threads dashboard (src/lib/threads-publisher.ts + sql/022_threads_publisher.sql): SQL asli di
 * Postgres in-memory, API Threads tiruan lewat `fetch`. Memastikan antrean terbit tepat sekali, postingan
 * basi dan postingan non-dashboard tidak disentuh, dan galat token menandai akun untuk dihubungkan ulang.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./helpers/pg";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@supabase/supabase-js", async () => (await import("./helpers/pg")).supabaseMock(() => h.db as TestDb));

import { bootDb, useTestSupabaseEnv } from "./helpers/pg";
import { encryptThreadsToken } from "../threads-token";
import { postText, runPublisher } from "../threads-publisher";

let db: TestDb;
const NOW = new Date("2026-10-19T02:00:00Z");
const ts = (offsetMin: number) => new Date(NOW.getTime() + offsetMin * 60_000).toISOString().replace("Z", "");
const rows = async <T>(sql: string): Promise<T[]> => (await db.query<T>(sql)).rows;

/** API Threads tiruan: mencatat panggilan; status container diatur per uji. */
const api = { calls: [] as { url: string; body: string }[], status: "FINISHED", failCreate: null as null | { status: number; code: number } };
function fakeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const body = init?.body ? String(init.body) : "";
  api.calls.push({ url, body });
  const json = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status }));
  if (url.endsWith("/threads") && init?.method === "POST") {
    if (api.failCreate) return json({ error: { message: "Token tidak berlaku", code: api.failCreate.code } }, api.failCreate.status);
    return json({ id: `c-${api.calls.length}` });
  }
  if (url.endsWith("/threads_publish")) return json({ id: `m-${new URLSearchParams(body).get("creation_id")}` });
  if (url.includes("fields=status")) return json({ status: api.status });
  if (url.includes("fields=permalink")) return json({ permalink: "https://www.threads.net/@akun/post/abc" });
  return json({ error: { message: "tak dikenal" } }, 404);
}

beforeAll(async () => {
  useTestSupabaseEnv();
  process.env.TOKEN_ENCRYPTION_KEY = "kunci-uji-penerbit";
  db = await bootDb([]);
  h.db = db;
  await db.exec(`
    ALTER TABLE "ThreadsAccount" ADD COLUMN "threadsUserId" text, ADD COLUMN "updatedAt" timestamp(3);
    ALTER TABLE "PostDispatch" ADD COLUMN "platformKind" text;
  `);
  // Dipasang dua kali: harus idempoten.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const sql = fs.readFileSync(path.resolve(__dirname, "../../../sql/022_threads_publisher.sql"), "utf8");
  for (let i = 0; i < 2; i++) await db.exec(sql);
});

beforeEach(async () => {
  process.env.CONTENT_PUBLISH_ENABLED = "true";
  api.calls = [];
  api.status = "FINISHED";
  api.failCreate = null;
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  const token = encryptThreadsToken("token-asli");
  await db.exec(`
    DELETE FROM "PostDispatch"; DELETE FROM "ScheduledPost"; DELETE FROM "SocialAccount"; DELETE FROM "ThreadsAccount"; DELETE FROM "Outlet";
    INSERT INTO "Outlet" (id, "workspaceId", nama) VALUES ('o1', 'w1', 'Cabang Jogja');
    INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "threadsUserId", "accessToken", "accessExpiresAt", "updatedAt")
      VALUES ('ta1', 'w1', 'akun', '1789', '${token}', '2026-12-31', '${ts(-60)}');
    INSERT INTO "SocialAccount" (id, "outletId", "threadsAccountId") VALUES ('sa1', 'o1', 'ta1');
  `);
});

afterEach(() => vi.unstubAllGlobals());

async function post(id: string, tayangOffsetMin: number, over: { source?: string; caption?: string; hashtags?: string } = {}) {
  await db.exec(`
    INSERT INTO "ScheduledPost" (id, "workspaceId", judul, caption, hashtags, "mediaType", "tayangPada", status, source, "updatedAt")
      VALUES ('${id}', 'w1', 'j', '${over.caption ?? "Halo dari {nama_cabang}"}', ${over.hashtags ?? "ARRAY['#kuliner']"}, 'TEXT',
              '${ts(tayangOffsetMin)}', 'MENUNGGU', '${over.source ?? "DASHBOARD_AI"}', '${ts(-120)}');
    INSERT INTO "PostDispatch" (id, "postId", "outletId", "socialAccountId", publisher, status)
      VALUES ('d-${id}', '${id}', 'o1', 'sa1', 'THREADS', 'MENUNGGU');
  `);
}

const dispatch = (id: string) =>
  rows<{ status: string; platformPostId: string | null; platformContainerId: string | null; releaseUrl: string | null; pesanError: string | null; lockedAt: unknown }>(
    `SELECT status::text, "platformPostId", "platformContainerId", "releaseUrl", "pesanError", "lockedAt" FROM "PostDispatch" WHERE id = 'd-${id}'`
  ).then((r) => r[0]);
const postStatus = (id: string) => rows<{ status: string }>(`SELECT status::text FROM "ScheduledPost" WHERE id = '${id}'`).then((r) => r[0].status);

describe("runPublisher", () => {
  it("menerbitkan postingan jatuh tempo sekali: container, publish, permalink, posting SELESAI", async () => {
    await post("p1", -1);
    await post("nanti", 30);
    const res = await runPublisher({ now: NOW });
    expect(res.counts).toMatchObject({ diklaim: 1, TERBIT: 1 });

    const create = api.calls.find((c) => c.url.endsWith("/1789/threads"))!;
    const form = new URLSearchParams(create.body);
    expect(form.get("text")).toBe("Halo dari Cabang Jogja");
    expect(form.get("topic_tag")).toBe("kuliner");
    expect(form.get("access_token")).toBe("token-asli");

    expect(await dispatch("p1")).toMatchObject({
      status: "TERBIT",
      platformContainerId: expect.stringMatching(/^c-/),
      platformPostId: expect.stringMatching(/^m-c-/),
      releaseUrl: "https://www.threads.net/@akun/post/abc",
      lockedAt: null,
    });
    expect(await postStatus("p1")).toBe("SELESAI");
    expect((await dispatch("nanti")).status).toBe("MENUNGGU");

    // Putaran berikutnya tidak menerbitkan ulang.
    api.calls = [];
    expect((await runPublisher({ now: NOW })).counts.diklaim).toBe(0);
    expect(api.calls).toEqual([]);
  });

  it("container yang belum siap disimpan lalu diterbitkan di putaran berikutnya", async () => {
    await post("p2", -1);
    api.status = "IN_PROGRESS";
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ CONTAINER: 1 });
    expect(await dispatch("p2")).toMatchObject({ status: "MENUNGGU", platformContainerId: expect.stringMatching(/^c-/), lockedAt: null });
    expect(await postStatus("p2")).toBe("DIPROSES");

    api.status = "FINISHED";
    api.calls = [];
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ TERBIT: 1 });
    // Tahap 2 tidak membuat container baru.
    expect(api.calls.some((c) => c.url.endsWith("/1789/threads"))).toBe(false);
    expect(await postStatus("p2")).toBe("SELESAI");
  });

  it("container yang ternyata sudah PUBLISHED ditandai TERBIT tanpa publish ulang", async () => {
    await post("p3", -1);
    api.status = "IN_PROGRESS";
    await runPublisher({ now: NOW });
    api.status = "PUBLISHED";
    api.calls = [];
    await runPublisher({ now: NOW });
    expect(api.calls.some((c) => c.url.endsWith("/threads_publish"))).toBe(false);
    expect((await dispatch("p3")).status).toBe("TERBIT");
  });

  it("token dicabut: GAGAL dan akun ditandai hubungkan ulang", async () => {
    await post("p4", -1);
    api.failCreate = { status: 400, code: 190 };
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ GAGAL: 1 });
    expect((await dispatch("p4")).pesanError).toContain("Hubungkan ulang");
    expect(await postStatus("p4")).toBe("GAGAL");
    expect((await rows<{ needsReconnect: boolean }>(`SELECT "needsReconnect" FROM "ThreadsAccount" WHERE id = 'ta1'`))[0].needsReconnect).toBe(true);
  });

  it("galat sementara dicoba ulang, lalu GAGAL setelah batas percobaan", async () => {
    await post("p5", -1);
    api.failCreate = { status: 500, code: 2 };
    for (let i = 0; i < 2; i++) expect((await runPublisher({ now: NOW })).counts).toMatchObject({ ULANG: 1 });
    expect((await dispatch("p5")).status).toBe("MENUNGGU");
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ GAGAL: 1 });
  });

  it("postingan basi (lewat > 2 jam) dan postingan non-dashboard tidak diterbitkan", async () => {
    await post("basi", -180);
    await post("telegram", -1, { source: "TELEGRAM" });
    const res = await runPublisher({ now: NOW });
    expect(res.counts.diklaim).toBe(0);
    expect(api.calls).toEqual([]);
    expect(await dispatch("basi")).toMatchObject({ status: "GAGAL", pesanError: expect.stringContaining("Lewat jam tayang") });
    expect(await postStatus("basi")).toBe("GAGAL");
    expect((await dispatch("telegram")).status).toBe("MENUNGGU");
  });

  it("saklar posting mati: tidak menyentuh antrean", async () => {
    process.env.CONTENT_PUBLISH_ENABLED = "false";
    await post("p6", -1);
    expect((await runPublisher({ now: NOW })).skipped).toBeTruthy();
    expect(api.calls).toEqual([]);
    expect((await dispatch("p6")).status).toBe("MENUNGGU");
  });

  it("dispatch yang sedang dikunci proses lain tidak diambil sampai kuncinya basi", async () => {
    await post("p7", -1);
    await db.exec(`UPDATE "PostDispatch" SET "lockedAt" = '${ts(-2)}' WHERE id = 'd-p7'`);
    expect((await runPublisher({ now: NOW })).counts.diklaim).toBe(0);
    await db.exec(`UPDATE "PostDispatch" SET "lockedAt" = '${ts(-15)}' WHERE id = 'd-p7'`);
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ TERBIT: 1 });
  });
});

describe("postText", () => {
  it("mengganti tag cabang dan merapikan spasi", () => {
    expect(postText("  Mampir ke {nama_outlet} ya \n", "Suka Jogja")).toBe("Mampir ke Suka Jogja ya");
    expect(postText(null, null)).toBe("");
  });
});
