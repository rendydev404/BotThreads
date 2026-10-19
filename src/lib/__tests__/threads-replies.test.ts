/**
 * Balas komentar otomatis lewat webhook Threads (src/lib/threads-replies.ts, /api/webhooks/threads,
 * sql/023 + sql/024 + sql/025): SQL asli di Postgres in-memory, API Threads dan AI tiruan. Memastikan tanda tangan
 * Meta diperiksa, komentar dibalas tepat sekali, komentar sendiri/spam dan balasan untuk komentar orang lain tidak
 * dibalas, balasan untuk balasan AI dilanjutkan dengan riwayat obrolan (dibatasi), saklar per akun dihormati, dan jeda
 * antar-balasan per akun berlaku. Tidak ada polling ke Threads.
 */
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateWithFailover } from "@/lib/gemini";
import type { TestDb } from "./helpers/pg";

const SECRET = "rahasia-aplikasi-threads";
const h = vi.hoisted(() => ({
  db: null as unknown,
  ai: { balas: true, teks: "Wkwk sama, aku juga gitu tiap Senin 😅", alasan: "" },
  later: [] as (() => unknown)[],
}));
vi.mock("@supabase/supabase-js", async () => (await import("./helpers/pg")).supabaseMock(() => h.db as TestDb));
vi.mock("@/lib/gemini", async (original) => ({
  ...(await original<typeof import("@/lib/gemini")>()),
  generateWithFailover: vi.fn(async () => ({ text: "", json: h.ai, model: "uji" })),
}));
vi.mock("@/lib/integrations", () => ({
  getRawIntegrations: async () => ({ threadsOauth: { enabled: true, appId: "a", appSecret: "rahasia-aplikasi-threads" } }),
}));
// `after` di luar Next: kumpulkan, lalu jalankan manual seperti setelah respons terkirim.
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => unknown) => void h.later.push(fn),
}));

import { NextRequest } from "next/server";
import { bootDb, useTestSupabaseEnv } from "./helpers/pg";
import { encryptThreadsToken } from "../threads-token";
import { cleanReply, parseWebhook, runReplies, validSignature } from "../threads-replies";
import { GET as verify, POST as webhook } from "@/app/api/webhooks/threads/route";

const REPO = path.resolve(__dirname, "../../..");
let db: TestDb;
const NOW = new Date("2026-10-19T03:00:00Z");
const rows = async <T>(sql: string): Promise<T[]> => (await db.query<T>(sql)).rows;

const api = { calls: [] as { url: string; body: string }[] };
function fakeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const body = init?.body ? String(init.body) : "";
  api.calls.push({ url, body });
  const json = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status }));
  if (url.endsWith("/threads") && init?.method === "POST") return json({ id: `c-${api.calls.length}` });
  if (url.endsWith("/threads_publish")) return json({ id: `r-${api.calls.length}` });
  if (url.includes("fields=status")) return json({ status: "FINISHED" });
  return json({ error: { message: "tak dikenal" } }, 404);
}

beforeAll(async () => {
  useTestSupabaseEnv();
  process.env.TOKEN_ENCRYPTION_KEY = "kunci-uji-balas";
  process.env.THREADS_WEBHOOK_VERIFY_TOKEN = "token-verifikasi";
  db = await bootDb([]);
  h.db = db;
  await db.exec(`
    ALTER TABLE "ThreadsAccount" ADD COLUMN "threadsUserId" text, ADD COLUMN "updatedAt" timestamp(3);
    ALTER TABLE "PostDispatch" ADD COLUMN "platformKind" text;
    CREATE TABLE "AutopilotConfig" ("accountId" text PRIMARY KEY, "workspaceId" text, mode text, brief text, "voiceStyle" text);
    CREATE TABLE "DashboardAuditLog" (id bigserial, "workspaceId" text, actor text, action text, target text, detail jsonb, "createdAt" timestamp(3));
  `);
  // Dipasang dua kali: harus idempoten.
  for (const f of ["sql/023_threads_replies.sql", "sql/024_threads_reply_webhook.sql", "sql/025_threads_reply_thread.sql"]) {
    const sql = fs.readFileSync(path.join(REPO, f), "utf8");
    for (let i = 0; i < 2; i++) await db.exec(sql);
  }
});

beforeEach(async () => {
  api.calls = [];
  h.later = [];
  h.ai = { balas: true, teks: "Wkwk sama, aku juga gitu tiap Senin 😅", alasan: "" };
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  await db.exec(`
    DELETE FROM "ThreadsComment"; DELETE FROM "ThreadsReplySetting"; DELETE FROM "AutopilotConfig";
    DELETE FROM "PostDispatch"; DELETE FROM "ScheduledPost"; DELETE FROM "SocialAccount"; DELETE FROM "ThreadsAccount";
    INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "threadsUserId", "accessToken", "accessExpiresAt", "updatedAt")
      VALUES ('ta1', 'w1', 'akun', 'Akun', '1789', '${encryptThreadsToken("token-asli")}', '2026-12-31', '2026-10-19T02:00:00');
    INSERT INTO "SocialAccount" (id, "outletId", "threadsAccountId") VALUES ('sa1', 'o1', 'ta1');
    INSERT INTO "AutopilotConfig" ("accountId", "workspaceId", mode) VALUES ('ta1', 'w1', 'OTOMATIS');
    INSERT INTO "ScheduledPost" (id, "workspaceId", judul, caption, "mediaType", "tayangPada", status, source)
      VALUES ('p1', 'w1', 'j', 'Senin pagi bikin malas', 'TEXT', '2026-10-19T01:00:00', 'SELESAI', 'DASHBOARD_AI');
    INSERT INTO "PostDispatch" (id, "postId", "outletId", "socialAccountId", publisher, status, "platformPostId")
      VALUES ('d1', 'p1', 'o1', 'sa1', 'THREADS', 'TERBIT', 'm1');
  `);
});

afterEach(() => vi.unstubAllGlobals());

/** Payload persis bentuk dokumentasi Meta untuk topik replies. */
const payload = (id: string, over: { username?: string; text?: string; repliedTo?: string; media?: string } = {}) => ({
  app_id: "863834746815202",
  topic: "moderate",
  target_id: over.media ?? "m1",
  time: 1760842800,
  subscription_id: "s1",
  has_uid_field: false,
  values: {
    value: {
      id,
      username: over.username ?? "pembaca",
      text: over.text ?? "Sama banget, Senin tuh berat",
      media_type: "TEXT_POST",
      permalink: "https://www.threads.net/@pembaca/post/x",
      replied_to: { id: over.repliedTo ?? over.media ?? "m1" },
      root_post: { id: over.media ?? "m1", owner_id: "1789", username: "akun" },
      shortcode: "x",
      timestamp: "2026-10-19T02:55:00+0000",
    },
    field: "replies",
  },
});

const sign = (raw: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
async function deliver(body: unknown, secret = SECRET) {
  const raw = JSON.stringify(body);
  const res = await webhook(
    new NextRequest("https://bottrit.com/api/webhooks/threads", { method: "POST", body: raw, headers: { "x-hub-signature-256": sign(raw, secret) } })
  );
  for (const fn of h.later.splice(0)) await fn();
  return res;
}
const statuses = () =>
  rows<{ commentId: string; status: string; replyText: string | null; error: string | null }>(
    `SELECT "commentId", status, "replyText", error FROM "ThreadsComment" ORDER BY "commentId"`
  );

describe("webhook Threads", () => {
  it("verifikasi langganan: challenge hanya untuk token yang benar", async () => {
    const ok = await verify(new NextRequest("https://bottrit.com/api/webhooks/threads?hub.mode=subscribe&hub.verify_token=token-verifikasi&hub.challenge=123"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("123");
    const bad = await verify(new NextRequest("https://bottrit.com/api/webhooks/threads?hub.mode=subscribe&hub.verify_token=salah&hub.challenge=123"));
    expect(bad.status).toBe(403);
  });

  it("tanda tangan salah ditolak dan tidak menyimpan apa pun", async () => {
    const res = await deliver(payload("k1"), "rahasia-lain");
    expect(res.status).toBe(401);
    expect(await statuses()).toEqual([]);
  });

  it("komentar baru dibalas sekali tepat setelah webhook; kiriman ulang Meta tidak membalas lagi", async () => {
    expect((await deliver(payload("k1"))).status).toBe(200);
    expect(await statuses()).toEqual([{ commentId: "k1", status: "DIBALAS", replyText: "Wkwk sama, aku juga gitu tiap Senin 😅", error: null }]);
    const create = new URLSearchParams(api.calls.find((c) => c.url.endsWith("/1789/threads"))!.body);
    expect(create.get("reply_to_id")).toBe("k1");
    expect(create.get("access_token")).toBe("token-asli");

    api.calls = [];
    expect((await deliver(payload("k1"))).status).toBe(200);
    expect(api.calls).toEqual([]);
  });

  it("tidak disimpan: komentar akun sendiri, balasan untuk komentar orang lain, media bukan postingan dashboard, saklar mati", async () => {
    await deliver(payload("k-sendiri", { username: "akun" }));
    await deliver(payload("k-bersarang", { repliedTo: "k-lain" }));
    await deliver(payload("k-asing", { media: "m-lain" }));
    await db.exec(`INSERT INTO "ThreadsReplySetting" ("accountId", "workspaceId", aktif) VALUES ('ta1', 'w1', false)`);
    await deliver(payload("k-mati"));
    expect(await statuses()).toEqual([]);
    expect(api.calls).toEqual([]);
  });

  it("mode MATI tanpa saklar tidak dibalas; saklar akun menang atas mode", async () => {
    await db.exec(`UPDATE "AutopilotConfig" SET mode = 'MATI'`);
    await deliver(payload("k1"));
    expect(await statuses()).toEqual([]);
    await db.exec(`INSERT INTO "ThreadsReplySetting" ("accountId", "workspaceId", aktif) VALUES ('ta1', 'w1', true)`);
    await deliver(payload("k2"));
    expect((await statuses())[0]).toMatchObject({ commentId: "k2", status: "DIBALAS" });
  });

  it("AI menilai spam: komentar dilewati dengan alasannya", async () => {
    h.ai = { balas: false, teks: "", alasan: "Promosi akun lain." };
    await deliver(payload("k1", { text: "follow back ya kak, cek akun aku" }));
    expect((await statuses())[0]).toMatchObject({ status: "DILEWATI", error: "Promosi akun lain." });
    expect(api.calls.some((c) => c.url.endsWith("/threads_publish"))).toBe(false);
  });

  it("jeda per akun: komentar kedua menunggu putaran berikutnya (tanpa panggilan API untuk mencari komentar)", async () => {
    await deliver(payload("k1"));
    await deliver(payload("k2"));
    expect((await statuses()).map((s) => s.status)).toEqual(["DIBALAS", "BARU"]);

    // Putaran penerbit 21 detik kemudian: hanya membalas dari antrean database.
    api.calls = [];
    await runReplies(new Date(Date.now() + 21_000), Date.now() + 30_000, {});
    expect((await statuses())[1].status).toBe("DIBALAS");
    expect(api.calls.every((c) => !c.url.includes("/replies"))).toBe(true);
  });
});

describe("lanjutan obrolan", () => {
  /** Balasan AI terakhir untuk komentar `commentId` (id media balasan di Threads). */
  const replyIdOf = async (commentId: string) =>
    (await rows<{ replyId: string }>(`SELECT "replyId" FROM "ThreadsComment" WHERE "commentId" = '${commentId}'`))[0].replyId;
  /** Lewati jeda per akun supaya balasan berikutnya langsung terkirim. */
  const skipGap = () => db.exec(`UPDATE "ThreadsComment" SET "repliedAt" = "repliedAt" - interval '1 minute' WHERE "repliedAt" IS NOT NULL`);
  const lastPrompt = () => {
    const calls = vi.mocked(generateWithFailover).mock.calls;
    return calls[calls.length - 1][0].contents[0].parts[0].text as string;
  };

  it("orang yang membalas balasan AI dibalas lagi, dengan riwayat obrolan di prompt", async () => {
    await deliver(payload("k1"));
    const r1 = await replyIdOf("k1");
    await skipGap();

    h.ai = { balas: true, teks: "Kopi dulu biar kuat 😆", alasan: "" };
    api.calls = [];
    await deliver(payload("k1b", { repliedTo: r1, text: "Iya, kamu gimana ngatasinnya?" }));
    const row = (await rows<{ status: string; depth: number; parentId: string | null; replyText: string }>(
      `SELECT status, depth, "parentId", "replyText" FROM "ThreadsComment" WHERE "commentId" = 'k1b'`
    ))[0];
    expect(row).toMatchObject({ status: "DIBALAS", depth: 1, replyText: "Kopi dulu biar kuat 😆" });
    expect(row.parentId).not.toBeNull();
    const create = new URLSearchParams(api.calls.find((c) => c.url.endsWith("/1789/threads"))!.body);
    expect(create.get("reply_to_id")).toBe("k1b");

    const prompt = lastPrompt();
    expect(prompt).toContain("<obrolan>");
    expect(prompt).toContain("@pembaca: Sama banget, Senin tuh berat");
    expect(prompt).toContain("@akun (Anda): Wkwk sama, aku juga gitu tiap Senin 😅");
    expect(prompt).toContain("Iya, kamu gimana ngatasinnya?");
  });

  it("obrolan dibatasi 5 balasan AI; selebihnya disimpan sebagai dilewati", async () => {
    await deliver(payload("t0"));
    let prev = "t0";
    for (let i = 1; i <= 5; i++) {
      await skipGap();
      await deliver(payload(`t${i}`, { repliedTo: await replyIdOf(prev) }));
      prev = `t${i}`;
    }
    const all = await rows<{ commentId: string; status: string; depth: number; error: string | null }>(
      `SELECT "commentId", status, depth, error FROM "ThreadsComment" ORDER BY depth`
    );
    expect(all.map((r) => r.status)).toEqual(["DIBALAS", "DIBALAS", "DIBALAS", "DIBALAS", "DIBALAS", "DILEWATI"]);
    expect(all[5]).toMatchObject({ commentId: "t5", depth: 5, error: "Obrolan sudah panjang, tidak dibalas lagi." });
  });
});

describe("pembantu", () => {
  it("parseWebhook menerima bentuk dokumentasi, larik, dan entry/changes; mengabaikan topik lain", () => {
    expect(parseWebhook(payload("k1"))).toEqual([
      { mediaId: "m1", commentId: "k1", repliedTo: null, username: "pembaca", text: "Sama banget, Senin tuh berat", commentedAt: "2026-10-19T02:55:00.000" },
    ]);
    expect(parseWebhook([payload("k1"), payload("k2")]).map((r) => r.commentId)).toEqual(["k1", "k2"]);
    expect(parseWebhook({ entry: [{ changes: [{ field: "replies", value: payload("k3").values.value }] }] }).map((r) => r.commentId)).toEqual(["k3"]);
    expect(parseWebhook(payload("k5", { repliedTo: "r9" }))[0].repliedTo).toBe("r9");
    expect(parseWebhook({ values: { field: "mentions", value: payload("k4").values.value } })).toEqual([]);
  });

  it("validSignature hanya menerima HMAC-SHA256 App Secret atas isi mentah", () => {
    expect(validSignature("{}", sign("{}"), SECRET)).toBe(true);
    expect(validSignature("{ }", sign("{}"), SECRET)).toBe(false);
    expect(validSignature("{}", null, SECRET)).toBe(false);
    expect(validSignature("{}", sign("{}"), "")).toBe(false);
  });

  it("cleanReply membuang tanda kutip dan hashtag, menolak link dan teks kosong", () => {
    expect(cleanReply('"Iya bener banget #senin"')).toBe("Iya bener banget");
    expect(cleanReply("cek di shopee.co.id ya")).toBeNull();
    expect(cleanReply("   ")).toBeNull();
  });
});
