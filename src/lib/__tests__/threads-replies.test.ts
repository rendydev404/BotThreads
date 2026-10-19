/**
 * Balas komentar otomatis (src/lib/threads-replies.ts + sql/023_threads_replies.sql): SQL asli di Postgres
 * in-memory, API Threads dan AI tiruan. Memastikan komentar dibalas tepat sekali, komentar sendiri/lama/spam
 * tidak dibalas, saklar per akun dihormati, dan jeda antar-balasan per akun berlaku.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./helpers/pg";

const h = vi.hoisted(() => ({ db: null as unknown, ai: { balas: true, teks: "Wkwk sama, aku juga gitu tiap Senin 😅", alasan: "" } }));
vi.mock("@supabase/supabase-js", async () => (await import("./helpers/pg")).supabaseMock(() => h.db as TestDb));
vi.mock("@/lib/gemini", async (original) => ({
  ...(await original<typeof import("@/lib/gemini")>()),
  generateWithFailover: vi.fn(async () => ({ text: "", json: h.ai, model: "uji" })),
}));

import { bootDb, useTestSupabaseEnv } from "./helpers/pg";
import { encryptThreadsToken } from "../threads-token";
import { cleanReply, nextWatchAt, runReplies } from "../threads-replies";

const REPO = path.resolve(__dirname, "../../..");
let db: TestDb;
const NOW = new Date("2026-10-19T03:00:00Z");
const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
const ts = (min: number) => at(min).toISOString().replace("Z", "");
const rows = async <T>(sql: string): Promise<T[]> => (await db.query<T>(sql)).rows;

const api = { calls: [] as { url: string; body: string }[], replies: [] as { id: string; text?: string; username?: string; timestamp?: string }[] };
function fakeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const body = init?.body ? String(init.body) : "";
  api.calls.push({ url, body });
  const json = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status }));
  if (url.includes("/replies?")) return json({ data: api.replies });
  if (url.endsWith("/threads") && init?.method === "POST") return json({ id: `c-${api.calls.length}` });
  if (url.endsWith("/threads_publish")) return json({ id: `r-${api.calls.length}` });
  if (url.includes("fields=status")) return json({ status: "FINISHED" });
  return json({ error: { message: "tak dikenal" } }, 404);
}

beforeAll(async () => {
  useTestSupabaseEnv();
  process.env.TOKEN_ENCRYPTION_KEY = "kunci-uji-balas";
  db = await bootDb([]);
  h.db = db;
  await db.exec(`
    ALTER TABLE "ThreadsAccount" ADD COLUMN "threadsUserId" text, ADD COLUMN "updatedAt" timestamp(3);
    ALTER TABLE "PostDispatch" ADD COLUMN "platformKind" text;
    CREATE TABLE "AutopilotConfig" ("accountId" text PRIMARY KEY, "workspaceId" text, mode text, brief text, "voiceStyle" text);
    CREATE TABLE "DashboardAuditLog" (id bigserial, "workspaceId" text, actor text, action text, target text, detail jsonb, "createdAt" timestamp(3));
  `);
  const sql = fs.readFileSync(path.join(REPO, "sql/023_threads_replies.sql"), "utf8");
  for (let i = 0; i < 2; i++) await db.exec(sql);
});

beforeEach(async () => {
  api.calls = [];
  api.replies = [];
  h.ai = { balas: true, teks: "Wkwk sama, aku juga gitu tiap Senin 😅", alasan: "" };
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  await db.exec(`
    DELETE FROM "ThreadsComment"; DELETE FROM "ThreadsReplyWatch"; DELETE FROM "ThreadsReplySetting"; DELETE FROM "AutopilotConfig";
    DELETE FROM "PostDispatch"; DELETE FROM "ScheduledPost"; DELETE FROM "SocialAccount"; DELETE FROM "ThreadsAccount";
    INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "threadsUserId", "accessToken", "accessExpiresAt", "updatedAt")
      VALUES ('ta1', 'w1', 'akun', 'Akun', '1789', '${encryptThreadsToken("token-asli")}', '2026-12-31', '${ts(-60)}');
    INSERT INTO "SocialAccount" (id, "outletId", "threadsAccountId") VALUES ('sa1', 'o1', 'ta1');
    INSERT INTO "AutopilotConfig" ("accountId", "workspaceId", mode) VALUES ('ta1', 'w1', 'OTOMATIS');
    INSERT INTO "ScheduledPost" (id, "workspaceId", judul, caption, "mediaType", "tayangPada", status, source)
      VALUES ('p1', 'w1', 'j', 'Senin pagi bikin malas', 'TEXT', '${ts(-120)}', 'SELESAI', 'DASHBOARD_AI');
    INSERT INTO "PostDispatch" (id, "postId", "outletId", "socialAccountId", publisher, status, "platformPostId")
      VALUES ('d1', 'p1', 'o1', 'sa1', 'THREADS', 'TERBIT', 'm1');
  `);
});

afterEach(() => vi.unstubAllGlobals());

const comment = (id: string, minAgo: number, over: { text?: string; username?: string } = {}) => ({
  id,
  text: over.text ?? "Sama banget, Senin tuh berat",
  username: over.username ?? "pembaca",
  timestamp: at(-minAgo).toISOString(),
});
const statuses = () =>
  rows<{ commentId: string; status: string; replyText: string | null }>(`SELECT "commentId", status, "replyText" FROM "ThreadsComment" ORDER BY "commentId"`);

describe("runReplies", () => {
  it("mengambil komentar baru dan membalasnya sekali; komentar sendiri dan komentar lama tidak dibalas", async () => {
    api.replies = [comment("k1", 5), comment("k-sendiri", 4, { username: "akun" }), comment("k-lama", 60 * 30)];
    const counts: Record<string, number> = {};
    await runReplies(NOW, Date.now() + 30_000, counts);

    expect(await statuses()).toEqual([
      { commentId: "k-lama", status: "DILEWATI", replyText: null },
      { commentId: "k1", status: "DIBALAS", replyText: "Wkwk sama, aku juga gitu tiap Senin 😅" },
    ]);
    const create = new URLSearchParams(api.calls.find((c) => c.url.endsWith("/1789/threads"))!.body);
    expect(create.get("reply_to_id")).toBe("k1");
    expect(create.get("access_token")).toBe("token-asli");
    expect(counts).toMatchObject({ komentarBaru: 2, komentarDibalas: 1 });

    // Putaran berikutnya: komentar yang sama tidak disimpan ulang dan tidak dibalas lagi.
    api.calls = [];
    await runReplies(at(5), Date.now() + 30_000, {});
    expect(api.calls.some((c) => c.url.endsWith("/threads_publish"))).toBe(false);
    expect((await statuses()).filter((s) => s.status === "DIBALAS")).toHaveLength(1);
  });

  it("jadwal ambil komentar: belum waktunya = tidak memanggil API", async () => {
    await runReplies(NOW, Date.now() + 30_000, {});
    api.calls = [];
    await runReplies(at(1), Date.now() + 30_000, {});
    expect(api.calls).toEqual([]);
    await runReplies(at(2), Date.now() + 30_000, {});
    expect(api.calls.some((c) => c.url.includes("/replies?"))).toBe(true);
  });

  it("saklar: mode MATI tanpa pengaturan tidak dibalas; saklar akun menang atas mode", async () => {
    await db.exec(`UPDATE "AutopilotConfig" SET mode = 'MATI'`);
    api.replies = [comment("k1", 5)];
    await runReplies(NOW, Date.now() + 30_000, {});
    expect(api.calls).toEqual([]);

    await db.exec(`INSERT INTO "ThreadsReplySetting" ("accountId", "workspaceId", aktif) VALUES ('ta1', 'w1', true)`);
    await runReplies(NOW, Date.now() + 30_000, {});
    expect((await statuses())[0]).toMatchObject({ status: "DIBALAS" });
  });

  it("AI menilai spam: komentar dilewati dengan alasannya", async () => {
    h.ai = { balas: false, teks: "", alasan: "Promosi akun lain." };
    api.replies = [comment("k1", 5, { text: "follow back ya kak, cek akun aku" })];
    await runReplies(NOW, Date.now() + 30_000, {});
    expect((await rows<{ status: string; error: string }>(`SELECT status, error FROM "ThreadsComment"`))[0]).toEqual({
      status: "DILEWATI",
      error: "Promosi akun lain.",
    });
    expect(api.calls.some((c) => c.url.endsWith("/threads_publish"))).toBe(false);
  });

  it("jeda per akun: satu balasan per putaran, berikutnya setelah 20 detik", async () => {
    api.replies = [comment("k1", 6), comment("k2", 5)];
    await runReplies(NOW, Date.now() + 30_000, {});
    expect((await statuses()).map((s) => s.status)).toEqual(["DIBALAS", "BARU"]);

    await runReplies(new Date(NOW.getTime() + 10_000), Date.now() + 30_000, {});
    expect((await statuses())[1].status).toBe("BARU");

    await runReplies(new Date(NOW.getTime() + 21_000), Date.now() + 30_000, {});
    expect((await statuses())[1].status).toBe("DIBALAS");
  });
});

describe("pembantu", () => {
  it("cleanReply membuang tanda kutip dan hashtag, menolak link dan teks kosong", () => {
    expect(cleanReply('"Iya bener banget #senin"')).toBe("Iya bener banget");
    expect(cleanReply("cek di shopee.co.id ya")).toBeNull();
    expect(cleanReply("   ")).toBeNull();
  });

  it("nextWatchAt makin jarang seiring umur postingan", () => {
    const post = new Date("2026-10-19T00:00:00Z");
    expect(nextWatchAt(post, new Date("2026-10-19T01:00:00Z")).toISOString()).toBe("2026-10-19T01:02:00.000Z");
    expect(nextWatchAt(post, new Date("2026-10-20T12:00:00Z")).toISOString()).toBe("2026-10-20T12:15:00.000Z");
    expect(nextWatchAt(post, new Date("2026-10-23T00:00:00Z")).toISOString()).toBe("2026-10-23T01:00:00.000Z");
  });
});
