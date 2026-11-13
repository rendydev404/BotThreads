/**
 * Moderasi balasan Threads (sql/046, izin threads_manage_replies): reply_control tersimpan dan ikut diklaim
 * penerbit, sembunyikan/tampilkan komentar, balas manual dengan kunci supaya tidak bentrok dengan AI.
 * SQL asli di Postgres in-memory.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseCreateBody } from "@/lib/content-validation";
import { bootDb, pgRpc, type TestDb } from "./helpers/pg";

const REPO = path.resolve(__dirname, "../../..");
let db: TestDb;

const NOW = "2026-11-13T02:00:00";

beforeAll(async () => {
  db = await bootDb(["sql/002_dashboard_post_log.sql", "sql/003_dashboard_rpc.sql", "sql/036_threads_media.sql"]);
  await db.exec(`
    ALTER TABLE "ThreadsAccount" ADD COLUMN "threadsUserId" text, ADD COLUMN "updatedAt" timestamp(3);
    CREATE TABLE "AutopilotConfig" ("accountId" text PRIMARY KEY, "workspaceId" text, mode text, brief text, "voiceStyle" text);
  `);
  for (const f of ["sql/023_threads_replies.sql", "sql/025_threads_reply_thread.sql"]) {
    await db.exec(fs.readFileSync(path.join(REPO, f), "utf8"));
  }
  // Dipasang dua kali: harus idempoten.
  const sql = fs.readFileSync(path.join(REPO, "sql/046_reply_moderation.sql"), "utf8");
  for (let i = 0; i < 2; i++) await db.exec(sql);
});

beforeEach(async () => {
  await db.exec(`
    DELETE FROM "ThreadsComment"; DELETE FROM "PostDispatch"; DELETE FROM "ScheduledPost"; DELETE FROM "ThreadsAccount";
    INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "threadsUserId", "accessToken", "accessExpiresAt")
      VALUES ('ta1', 'w1', 'akun', 'Akun', '1789', 'enc', '2026-12-31'), ('ta2', 'w2', 'lain', 'Lain', '2000', 'enc2', '2026-12-31');
    INSERT INTO "ThreadsComment" (id, "workspaceId", "accountId", "dispatchId", "postId", "mediaId", "commentId", username, text, "commentedAt", status)
      VALUES ('c1', 'w1', 'ta1', 'd1', 'p1', 'm1', 'r1', 'budi', 'Halo kak', '${NOW}', 'BARU'),
             ('c2', 'w1', 'ta1', 'd1', 'p1', 'm1', 'r2', 'sari', 'Mantap', '${NOW}', 'DIBALAS'),
             ('c3', 'w2', 'ta2', 'd2', 'p2', 'm2', 'r3', 'tono', 'Hai', '${NOW}', 'BARU');
  `);
});

const row = async (id: string) =>
  (
    await db.query<{ status: string; hidden: boolean; manualReply: boolean; replyText: string | null; replyId: string | null; error: string | null }>(
      `SELECT status, hidden, "manualReply", "replyText", "replyId", error FROM "ThreadsComment" WHERE id = $1`,
      [id]
    )
  ).rows[0];

describe("reply_control", () => {
  it("disimpan saat posting dibuat dan dikembalikan klaim penerbit", async () => {
    await pgRpc(db, "dash_create_posts", {
      p_items: [
        { postId: "p-rc", workspaceId: "w1", judul: "j", caption: "Halo", hashtags: [], tayangPada: "2026-11-13T01:00:00", batchId: "b", outletId: "o1", socialAccountId: "sa1", userId: "u", action: "CREATE_NOW", replyControl: "accounts_you_follow" },
        { postId: "p-all", workspaceId: "w1", judul: "j", caption: "Halo 2", hashtags: [], tayangPada: "2026-11-13T01:00:00", batchId: "b", outletId: "o1", socialAccountId: "sa1", userId: "u", action: "CREATE_NOW" },
      ],
    });
    const { rows } = await db.query<{ id: string; replyControl: string | null }>(`SELECT id, "replyControl" FROM "ScheduledPost" ORDER BY id`);
    expect(rows).toEqual([
      { id: "p-all", replyControl: null },
      { id: "p-rc", replyControl: "accounts_you_follow" },
    ]);
    await db.exec(`CREATE OR REPLACE FUNCTION dash_pub_finalize(p text, n timestamp) RETURNS void LANGUAGE sql AS 'SELECT NULL'`);
    const claimed = await pgRpc<{ postId: string; replyControl: string | null }[]>(db, "dash_pub_claim", {
      p_now: NOW,
      p_stale_before: "2026-11-13T01:50:00",
      p_expire_before: "2026-11-12T00:00:00",
      p_limit: 10,
    });
    expect(Object.fromEntries(claimed.map((c) => [c.postId, c.replyControl]))).toEqual({ "p-rc": "accounts_you_follow", "p-all": null });
  });

  it("nilai tak dikenal ditolak database dan validasi API", async () => {
    await expect(
      pgRpc(db, "dash_create_posts", {
        p_items: [{ postId: "x", workspaceId: "w1", caption: "a", tayangPada: NOW, socialAccountId: "s", userId: "u", action: "CREATE_NOW", replyControl: "semua" }],
      })
    ).rejects.toThrow(/replyControl/);
    const base = { idempotencyKey: "kunci-uji-123", items: [{ threadsAccountId: "a", text: "Halo", publishAt: "now" }] };
    const bad = parseCreateBody({ ...base, items: [{ ...base.items[0], replyControl: "semua" }] });
    expect(bad.ok).toBe(false);
    const ok = parseCreateBody({ ...base, items: [{ ...base.items[0], replyControl: "followers_only" }] });
    expect(ok.ok && ok.value.items[0].replyControl).toBe("followers_only");
    const everyone = parseCreateBody({ ...base, items: [{ ...base.items[0], replyControl: "everyone" }] });
    expect(everyone.ok && everyone.value.items[0].replyControl).toBeUndefined();
  });
});

describe("sembunyikan / tampilkan", () => {
  it("target hanya untuk akun yang boleh dilihat", async () => {
    expect(await pgRpc(db, "dash_reply_target", { p_id: "c3", p_account_ids: ["ta1"] })).toBeNull();
    const t = await pgRpc<{ commentId: string; account: { threadsUserId: string } }>(db, "dash_reply_target", { p_id: "c1", p_account_ids: ["ta1"] });
    expect(t.commentId).toBe("r1");
    expect(t.account.threadsUserId).toBe("1789");
  });

  it("komentar BARU yang disembunyikan tidak dibalas AI; tampilkan lagi tidak mengubah status", async () => {
    await pgRpc(db, "dash_reply_hide_set", { p_id: "c1", p_hidden: true, p_now: NOW });
    expect(await row("c1")).toMatchObject({ hidden: true, status: "DILEWATI", error: "Komentar disembunyikan." });
    await pgRpc(db, "dash_reply_hide_set", { p_id: "c1", p_hidden: false, p_now: NOW });
    expect(await row("c1")).toMatchObject({ hidden: false, status: "DILEWATI" });
    await pgRpc(db, "dash_reply_hide_set", { p_id: "c2", p_hidden: true, p_now: NOW });
    expect(await row("c2")).toMatchObject({ hidden: true, status: "DIBALAS" });
  });

  it("overview memuat hidden dan manualReply", async () => {
    await pgRpc(db, "dash_reply_hide_set", { p_id: "c2", p_hidden: true, p_now: NOW });
    const o = await pgRpc<{ items: { id: string; hidden: boolean; manualReply: boolean }[] }>(db, "dash_reply_overview", {
      p_account_ids: ["ta1"],
      p_limit: 10,
      p_now: NOW,
    });
    expect(o.items.map((i) => [i.id, i.hidden, i.manualReply]).sort()).toEqual([
      ["c1", false, false],
      ["c2", true, false],
    ]);
  });
});

describe("balas manual", () => {
  it("kunci mencegah bentrok, berhasil = DIBALAS manual", async () => {
    const t = await pgRpc<{ commentId: string; prevStatus: string }>(db, "dash_reply_manual_lock", { p_id: "c1", p_account_ids: ["ta1"], p_now: NOW });
    expect(t).toMatchObject({ commentId: "r1", prevStatus: "BARU" });
    expect((await row("c1")).status).toBe("MENULIS");
    // Sedang ditulis: kunci kedua (atau AI) tidak dapat.
    expect(await pgRpc(db, "dash_reply_manual_lock", { p_id: "c1", p_account_ids: ["ta1"], p_now: NOW })).toBeNull();
    // Akun lain tidak bisa.
    expect(await pgRpc(db, "dash_reply_manual_lock", { p_id: "c3", p_account_ids: ["ta1"], p_now: NOW })).toBeNull();
    await pgRpc(db, "dash_reply_manual_done", {
      p_id: "c1", p_ok: true, p_prev: "BARU", p_reply_text: "Halo juga!", p_reply_id: "rep9", p_error: null, p_now: NOW,
    });
    expect(await row("c1")).toMatchObject({ status: "DIBALAS", manualReply: true, replyText: "Halo juga!", replyId: "rep9", error: null });
  });

  it("gagal = kembali ke status semula dengan pesan galat", async () => {
    await pgRpc(db, "dash_reply_manual_lock", { p_id: "c2", p_account_ids: ["ta1"], p_now: NOW });
    await pgRpc(db, "dash_reply_manual_done", {
      p_id: "c2", p_ok: false, p_prev: "DIBALAS", p_reply_text: null, p_reply_id: null, p_error: "ditolak", p_now: NOW,
    });
    expect(await row("c2")).toMatchObject({ status: "DIBALAS", manualReply: false, error: "ditolak" });
  });
});
