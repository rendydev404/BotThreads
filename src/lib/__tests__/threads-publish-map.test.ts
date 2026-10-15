/**
 * Pemetaan posting akun Threads yang dihubungkan dari dashboard (sql/016_threads_publish_map.sql):
 * SQL asli di Postgres in-memory dengan kolom tabel worker seperti di produksi (id tanpa default, enum Platform).
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { bootDb, pgRpc, type TestDb } from "./helpers/pg";

const REPO = path.resolve(__dirname, "../../..");
let db: TestDb;
const rows = async <T>(sql: string): Promise<T[]> => (await db.query<T>(sql)).rows;
const NOW = "2026-10-15T04:00:00.000Z";

beforeAll(async () => {
  db = await bootDb([]);
  // Kolom tambahan tabel worker (Prisma) yang dipakai fungsi ini.
  await db.exec(`
    CREATE TYPE "Platform" AS ENUM ('TIKTOK','INSTAGRAM','FACEBOOK','THREADS','YOUTUBE','X');
    ALTER TABLE "Outlet" ADD COLUMN kode text NOT NULL DEFAULT '', ADD COLUMN cluster text NOT NULL DEFAULT '',
      ADD COLUMN warna text NOT NULL DEFAULT '#ea580c', ADD COLUMN "createdAt" timestamp(3) NOT NULL DEFAULT now(),
      ADD COLUMN "updatedAt" timestamp(3) NOT NULL;
    CREATE UNIQUE INDEX "Outlet_workspaceId_kode_key" ON "Outlet" ("workspaceId", kode);
    ALTER TABLE "SocialAccount" ADD COLUMN platform "Platform" NOT NULL DEFAULT 'INSTAGRAM', ADD COLUMN handle text NOT NULL DEFAULT '',
      ADD COLUMN "isConnected" boolean NOT NULL DEFAULT true, ADD COLUMN "createdAt" timestamp(3) NOT NULL DEFAULT now(),
      ADD COLUMN "updatedAt" timestamp(3) NOT NULL DEFAULT now();
    ALTER TABLE "SocialAccount" ALTER COLUMN platform DROP DEFAULT;
    CREATE UNIQUE INDEX "SocialAccount_threadsAccountId_key" ON "SocialAccount" ("threadsAccountId");

    INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName") VALUES
      ('ta-dash', 'dws_abc', 'sinta_mayaaaa', 'Sinta Maya'),
      ('ta-worker', 'wsA', 'suka_jogja', 'Suka Jogja'),
      ('ta-baru', 'dws_abc', 'kedua', NULL);
  `);
  // Dipasang dua kali: harus idempoten.
  for (let i = 0; i < 2; i++) await db.exec(fs.readFileSync(path.join(REPO, "sql/016_threads_publish_map.sql"), "utf8"));
});

describe("dash_tc_publish_map", () => {
  it("perbaikan saat pemasangan hanya memetakan akun dari workspace dashboard, tanpa duplikat", async () => {
    const sa = await rows<{ threadsAccountId: string; platform: string; handle: string }>(
      `SELECT "threadsAccountId", platform::text, handle FROM "SocialAccount" ORDER BY "threadsAccountId"`
    );
    expect(sa).toEqual([
      { threadsAccountId: "ta-baru", platform: "THREADS", handle: "@kedua" },
      { threadsAccountId: "ta-dash", platform: "THREADS", handle: "@sinta_mayaaaa" },
    ]);
    expect(await rows(`SELECT kode, nama, cluster FROM "Outlet" ORDER BY kode`)).toEqual([
      { kode: "TH-KEDUA", nama: "kedua", cluster: "Threads" },
      { kode: "TH-SINTA_MAYAAAA", nama: "Sinta Maya", cluster: "Threads" },
    ]);
  });

  it("idempoten, memakai ulang cabang yang sudah ada, dan menolak akun yang tidak ada", async () => {
    const again = await pgRpc<{ status: string; created: boolean }>(db, "dash_tc_publish_map", { p_account: "ta-dash", p_now: NOW });
    expect(again).toMatchObject({ status: "OK", created: false });

    // Pemetaan dilepas tetapi cabangnya tetap: dipasang ulang ke cabang yang sama.
    await db.exec(`DELETE FROM "SocialAccount" WHERE "threadsAccountId" = 'ta-dash'`);
    const before = await rows<{ id: string }>(`SELECT id FROM "Outlet" WHERE kode = 'TH-SINTA_MAYAAAA'`);
    const res = await pgRpc<{ status: string; created: boolean; outletId: string }>(db, "dash_tc_publish_map", { p_account: "ta-dash", p_now: NOW });
    expect(res).toMatchObject({ status: "OK", created: true, outletId: before[0].id });
    expect(await rows(`SELECT count(*)::int AS n FROM "Outlet"`)).toEqual([{ n: 2 }]);

    expect(await pgRpc(db, "dash_tc_publish_map", { p_account: "tidak-ada", p_now: NOW })).toEqual({ status: "NOT_FOUND" });
  });

  it("hanya server dashboard (service_role) yang boleh memanggilnya", async () => {
    for (const role of ["service_role", "anon"]) {
      await db.exec(`SET ROLE ${role}`);
      const ok = await db.query(`SELECT dash_tc_publish_map('ta-worker', now()::timestamp)`).then(
        () => true,
        (e: Error) => (/permission denied/.test(e.message) ? false : Promise.reject(e))
      );
      await db.exec(`RESET ROLE`);
      expect(ok, role).toBe(role === "service_role");
    }
  });
});
