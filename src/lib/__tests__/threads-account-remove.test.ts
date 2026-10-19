/**
 * Hapus akun Threads dari dashboard (sql/026, dash_tc_remove): SQL asli di Postgres in-memory dengan tabel
 * worker tiruan (FK seperti Prisma auto-suka). Memastikan antrean posting + Autopilot akun dihentikan, riwayat
 * tetap ada, akun workspace lain tidak bisa dihapus, dan menghubungkan ulang menghidupkan cabangnya lagi.
 * Juga kuota akun paket (dash_plan_over_quota): mengikuti paket yang berlaku sekarang, termasuk saat paket diubah.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootDb, type TestDb } from "./helpers/pg";

let db: TestDb;
const NOW = "2026-10-19 07:00:00";
const one = async <T>(sql: string): Promise<T> => (await db.query<T>(sql)).rows[0];
const remove = (ws: string, acc: string) =>
  one<{ r: { status: string; username?: string; dibatalkan?: number } }>(
    `SELECT dash_tc_remove('${ws}', '${acc}', 'u1', '${NOW}') AS r`
  ).then((x) => x.r);

beforeAll(async () => {
  db = await bootDb([]);
  // Kolom/tabel worker yang dipakai fungsi, dengan aturan hapus seperti skema Prisma auto-suka.
  await db.exec(`
    ALTER TABLE "ThreadsAccount" ADD COLUMN "threadsUserId" text, ADD COLUMN "updatedAt" timestamp(3);
    ALTER TABLE "Outlet" ADD COLUMN kode text, ADD COLUMN cluster text, ADD COLUMN "createdAt" timestamp(3), ADD COLUMN "updatedAt" timestamp(3);
    DROP TABLE "SocialAccount";
    CREATE TABLE "SocialAccount" (id text PRIMARY KEY, "outletId" text, platform text, handle text,
      "threadsAccountId" text UNIQUE REFERENCES "ThreadsAccount"(id) ON DELETE SET NULL, "isConnected" boolean,
      "createdAt" timestamp(3), "updatedAt" timestamp(3));
    ALTER TABLE "PostDispatch" ADD CONSTRAINT pd_sa FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"(id) ON DELETE SET NULL;
    ALTER TABLE "ThreadsPostStat" ADD CONSTRAINT ps_ta FOREIGN KEY ("threadsAccountId") REFERENCES "ThreadsAccount"(id) ON DELETE CASCADE;
    CREATE TABLE "AutopilotConfig" ("accountId" text PRIMARY KEY, "workspaceId" text, mode text);
    CREATE TABLE "AutopilotSlot" (id text PRIMARY KEY, "accountId" text, status text, "skipReason" text, "leaseUntil" timestamp(3), "updatedAt" timestamp(3));
    CREATE TABLE "DashboardMemberAccount" ("userId" text, "workspaceId" text, "accountId" text);
    CREATE TABLE "ThreadsReplySetting" ("accountId" text PRIMARY KEY, aktif boolean);
    CREATE TABLE "DashboardAuditLog" (id bigserial, "workspaceId" text, actor text, action text, target text, detail jsonb, "createdAt" timestamp(3));
    ALTER TABLE "ThreadsAccount" ADD COLUMN "createdAt" timestamp(3);
    CREATE TABLE "Plan" (id text PRIMARY KEY, "maxAkun" integer);
    CREATE TABLE "WorkspaceSettings" ("workspaceId" text PRIMARY KEY, "planId" text);
    CREATE TABLE "PlatformSettings" (id integer PRIMARY KEY, "planBawaan" text);
    CREATE TABLE "DashboardWorkspaceGroup" ("workspaceId" text PRIMARY KEY, "groupId" text);
    CREATE TABLE "DashboardMembership" ("userId" text, "workspaceId" text);
  `);
  const fs = await import("node:fs");
  const path = await import("node:path");
  const sql = fs.readFileSync(path.resolve(__dirname, "../../../sql/026_threads_account_remove.sql"), "utf8");
  for (let i = 0; i < 2; i++) await db.exec(sql); // idempoten
});

beforeEach(async () => {
  await db.exec(`
    DELETE FROM "PostDispatch"; DELETE FROM "ScheduledPost"; DELETE FROM "SocialAccount"; DELETE FROM "ThreadsPostStat";
    DELETE FROM "ThreadsAccount"; DELETE FROM "Outlet"; DELETE FROM "AutopilotConfig"; DELETE FROM "AutopilotSlot";
    DELETE FROM "DashboardMemberAccount"; DELETE FROM "ThreadsReplySetting"; DELETE FROM "DashboardAuditLog";
    INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "threadsUserId")
      VALUES ('ta1', 'w1', 'kopi', 'Kopi', '111'), ('ta2', 'w-induk', 'induk', 'Induk', '222');
    INSERT INTO "Outlet" (id, "workspaceId", nama, kode, "isActive") VALUES ('o1', 'w1', 'Kopi', 'TH-KOPI', true);
    INSERT INTO "SocialAccount" (id, "outletId", platform, handle, "threadsAccountId", "isConnected") VALUES ('sa1', 'o1', 'THREADS', '@kopi', 'ta1', true);
    INSERT INTO "ScheduledPost" (id, "workspaceId", judul) VALUES ('p1', 'w1', 'a'), ('p2', 'w1', 'b');
    INSERT INTO "PostDispatch" (id, "postId", "outletId", "socialAccountId", publisher, status)
      VALUES ('d-antre', 'p1', 'o1', 'sa1', 'THREADS', 'MENUNGGU'), ('d-terbit', 'p2', 'o1', 'sa1', 'THREADS', 'TERBIT');
    INSERT INTO "ThreadsPostStat" ("threadsAccountId", "mediaId") VALUES ('ta1', 'm1');
    INSERT INTO "AutopilotConfig" VALUES ('ta1', 'w1', 'OTOMATIS');
    INSERT INTO "AutopilotSlot" (id, "accountId", status) VALUES ('s-rencana', 'ta1', 'DIRENCANAKAN'), ('s-terbit', 'ta1', 'TERBIT');
    INSERT INTO "DashboardMemberAccount" VALUES ('u2', 'w1', 'ta1');
    INSERT INTO "ThreadsReplySetting" VALUES ('ta1', true);
  `);
});

describe("dash_tc_remove", () => {
  it("menghapus akun, menghentikan antrean dan Autopilot, menyimpan riwayat", async () => {
    expect(await remove("w1", "ta1")).toEqual({ status: "OK", username: "kopi", dibatalkan: 2 });

    expect((await db.query(`SELECT 1 FROM "ThreadsAccount" WHERE id = 'ta1'`)).rows).toHaveLength(0);
    expect((await db.query(`SELECT 1 FROM "ThreadsPostStat"`)).rows).toHaveLength(0);
    expect((await db.query(`SELECT 1 FROM "SocialAccount"`)).rows).toHaveLength(0);
    expect((await db.query(`SELECT 1 FROM "AutopilotConfig" UNION ALL SELECT 1 FROM "DashboardMemberAccount" UNION ALL SELECT 1 FROM "ThreadsReplySetting"`)).rows).toHaveLength(0);

    const dispatch = (await db.query<{ id: string; status: string; socialAccountId: string | null; pesanError: string | null }>(
      `SELECT id, status::text AS status, "socialAccountId", "pesanError" FROM "PostDispatch" ORDER BY id`
    )).rows;
    expect(dispatch).toEqual([
      { id: "d-antre", status: "GAGAL", socialAccountId: null, pesanError: "Akun Threads dihapus dari dashboard." },
      { id: "d-terbit", status: "TERBIT", socialAccountId: null, pesanError: null },
    ]);
    const slots = (await db.query<{ id: string; status: string }>(`SELECT id, status FROM "AutopilotSlot" ORDER BY id`)).rows;
    expect(slots).toEqual([
      { id: "s-rencana", status: "DIBATALKAN" },
      { id: "s-terbit", status: "TERBIT" },
    ]);
    expect(await one(`SELECT "isActive" FROM "Outlet" WHERE id = 'o1'`)).toEqual({ isActive: false });
    expect(await one(`SELECT action, target FROM "DashboardAuditLog"`)).toEqual({ action: "THREADS_HAPUS", target: "ta1" });
  });

  it("akun workspace lain (kelompok tenant) dan akun tak dikenal ditolak tanpa mengubah apa pun", async () => {
    expect(await remove("w1", "ta2")).toEqual({ status: "BUKAN_MILIK" });
    expect(await remove("w1", "tidak-ada")).toEqual({ status: "NOT_FOUND" });
    expect((await db.query(`SELECT 1 FROM "ThreadsAccount"`)).rows).toHaveLength(2);
  });

  it("menghubungkan ulang setelah dihapus menghidupkan cabang lama, bukan membuat baru", async () => {
    await remove("w1", "ta1");
    await db.exec(`INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "threadsUserId") VALUES ('ta1b', 'w1', 'kopi', 'Kopi', '111')`);
    const r = await one<{ r: { status: string; outletId: string; created: boolean } }>(`SELECT dash_tc_publish_map('ta1b', '${NOW}') AS r`);
    expect(r.r).toMatchObject({ status: "OK", outletId: "o1", created: true });
    expect(await one(`SELECT "isActive" FROM "Outlet" WHERE id = 'o1'`)).toEqual({ isActive: true });
    expect((await db.query(`SELECT 1 FROM "Outlet"`)).rows).toHaveLength(1);
  });
});

describe("dash_plan_over_quota", () => {
  const over = async () => (await one<{ r: string[] }>(`SELECT dash_plan_over_quota() AS r`)).r;

  beforeEach(async () => {
    await db.exec(`
      DELETE FROM "SocialAccount"; DELETE FROM "ThreadsPostStat"; DELETE FROM "ThreadsAccount";
      DELETE FROM "Plan"; DELETE FROM "WorkspaceSettings"; DELETE FROM "PlatformSettings";
      DELETE FROM "DashboardWorkspaceGroup"; DELETE FROM "DashboardMembership";
      INSERT INTO "Plan" VALUES ('pro', 10), ('starter', 1);
      INSERT INTO "PlatformSettings" VALUES (1, 'starter');
      INSERT INTO "DashboardMembership" VALUES ('u1', 'w1'), ('u2', 'w2');
      INSERT INTO "WorkspaceSettings" VALUES ('w1', 'pro');
      -- w1 (paket pro): 8 akun, a1 terlama ... a8 terbaru.
      INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "threadsUserId", "createdAt")
        SELECT 'a' || g, 'w1', 'a' || g, 'A', 'u' || g, '2026-10-01'::timestamp + g * interval '1 day' FROM generate_series(1, 8) g;
      -- w2 tanpa paket = paket bawaan (starter, 1 akun); w-worker bukan tenant dashboard.
      INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "threadsUserId", "createdAt") VALUES
        ('b1', 'w2', 'b1', 'B', 'v1', '2026-10-01'), ('b2', 'w2', 'b2', 'B', 'v2', '2026-10-02'),
        ('c1', 'w-worker', 'c1', 'C', 'x1', '2026-10-01'), ('c2', 'w-worker', 'c2', 'C', 'x2', '2026-10-02');
    `);
  });

  it("dalam kuota tidak ada yang dihentikan; paket bawaan berlaku untuk workspace tanpa paket", async () => {
    expect(await over()).toEqual(["b2"]);
  });

  it("super admin menurunkan pro dari 10 ke 5 akun: 3 akun terbaru langsung di luar kuota", async () => {
    await db.exec(`UPDATE "Plan" SET "maxAkun" = 5 WHERE id = 'pro'`);
    expect(await over()).toEqual(["a6", "a7", "a8", "b2"]);
    // Hapus satu akun lama: akun berikutnya masuk kuota lagi.
    await db.exec(`DELETE FROM "ThreadsAccount" WHERE id = 'a1'`);
    expect(await over()).toEqual(["a7", "a8", "b2"]);
  });

  it("ganti paket lewat billing mengikuti paket baru; akun kelompok tenant ikut dihitung", async () => {
    await db.exec(`UPDATE "WorkspaceSettings" SET "planId" = 'starter' WHERE "workspaceId" = 'w1'`);
    expect(await over()).toEqual(["a2", "a3", "a4", "a5", "a6", "a7", "a8", "b2"]);
    await db.exec(`INSERT INTO "DashboardWorkspaceGroup" VALUES ('w2', 'w1')`);
    await db.exec(`UPDATE "WorkspaceSettings" SET "planId" = 'pro' WHERE "workspaceId" = 'w1'`);
    // w1 + w2 = 10 akun dalam satu tenant pro (10): semua dalam kuota.
    expect(await over()).toEqual([]);
  });

  it("daftar akun posting membawa tanda di luar kuota (satu kueri)", async () => {
    await db.exec(`UPDATE "Plan" SET "maxAkun" = 7 WHERE id = 'pro'`);
    const rows = (await one<{ r: { id: string; overQuota: boolean }[] }>(`SELECT dash_publish_accounts() AS r`)).r;
    expect(rows.filter((r) => r.overQuota).map((r) => r.id).sort()).toEqual(["a8", "b2"]);
  });
});
