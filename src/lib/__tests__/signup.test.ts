/**
 * Pendaftaran mandiri (sql/009_signup.sql): route asli + SQL asli di Postgres in-memory. Pendaftar
 * mendapat workspace baru miliknya sendiri dan tidak boleh melihat data workspace yang sudah ada.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./helpers/pg";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@supabase/supabase-js", async () => (await import("./helpers/pg")).supabaseMock(() => h.db as TestDb));

// Sesi tiruan: nilai cookie `session` langsung menjadi id pengguna.
vi.mock("@/lib/users", async (original) => ({
  ...(await original<typeof import("@/lib/users")>()),
  getSessionUserId: async (cookie: string | undefined) => cookie || null,
}));

import { NextRequest } from "next/server";
import { bootDb, useTestSupabaseEnv } from "./helpers/pg";
import { GET as meGET } from "@/app/api/auth/me/route";
import { POST as registerPOST } from "@/app/api/auth/register/route";
import { GET as overviewGET } from "@/app/api/autopilot/overview/route";
import { GET as teamGET } from "@/app/api/team/route";
import { GET as accountsGET } from "@/app/api/threads/accounts/route";

let db: TestDb;
let ip = 0;
const post = (body: unknown) =>
  registerPOST(
    new NextRequest("http://localhost/api/auth/register", {
      method: "POST",
      // IP berbeda tiap permintaan supaya pembatas laju (5 per jam) tidak ikut diuji di sini.
      headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${++ip}` },
      body: JSON.stringify(body),
    })
  );
const get = (user: string, url: string) => new NextRequest(`http://localhost${url}`, { headers: { cookie: `session=${user}` } });
const json = async <T = Record<string, unknown>>(res: Response): Promise<T> => (await res.json()) as T;
const valid = { email: "Baru@Contoh.id", username: "Pendatang", name: "Pendatang Baru", brand: "  Kedai   <b>Kopi</b> ", password: "rahasia-panjang-1" };

beforeAll(async () => {
  useTestSupabaseEnv();
  process.env.AUTH_SECRET = "uji-rahasia-yang-panjangnya-lebih-dari-32-karakter";
  delete process.env.CONTENT_PUBLISH_TEST_ACCOUNTS;
  delete process.env.EXCLUDED_THREADS_ACCOUNTS;
  db = await bootDb([]);
  h.db = db;
  // Organisasi yang sudah ada lebih dulu, lalu semua SQL dipasang (seperti di produksi).
  await db.exec(`
    INSERT INTO "Workspace" VALUES ('wsA', 'Brand Lama', 'lama');
    INSERT INTO "Outlet" VALUES ('o1', 'wsA', 'Cabang 1', true);
    INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "accessExpiresAt", scopes)
      VALUES ('a1', 'wsA', 'akun_lama', 'Akun Lama', '2099-01-01', '{threads_content_publish}');
    INSERT INTO "SocialAccount" VALUES ('s1', 'o1', 'a1');
    INSERT INTO "DashboardUser" (id, username, email, "passwordHash") VALUES ('u-lama', 'lama', 'lama@contoh.id', 'x');
  `);
  for (const f of ["002_dashboard_post_log", "003_dashboard_rpc", "005_autopilot", "006_autopilot_radar", "007_autopilot_learning", "008_multiuser", "009_signup"]) {
    const fs = await import("node:fs");
    const path = await import("node:path");
    await db.exec(fs.readFileSync(path.resolve(__dirname, "../../..", `sql/${f}.sql`), "utf8"));
  }
});

afterAll(() => {
  delete process.env.SIGNUP_ENABLED;
});

describe("pendaftaran mandiri", () => {
  it("mati secara bawaan: tidak ada akun yang dibuat", async () => {
    delete process.env.SIGNUP_ENABLED;
    expect((await post(valid)).status).toBe(403);
    expect((await db.query(`SELECT count(*)::int AS n FROM "DashboardUser"`)).rows[0]).toEqual({ n: 1 });
  });

  it("validasi masukan", async () => {
    process.env.SIGNUP_ENABLED = "true";
    expect((await post({ ...valid, email: "bukan-email" })).status).toBe(400);
    expect((await post({ ...valid, username: "A B" })).status).toBe(400);
    expect((await post({ ...valid, password: "pendek" })).status).toBe(400);
    expect((await post({ ...valid, brand: " " })).status).toBe(400);
    expect((await db.query(`SELECT count(*)::int AS n FROM "DashboardUser"`)).rows[0]).toEqual({ n: 1 });
  });

  it("berhasil: akun + workspace baru, pendaftar menjadi Pemilik, sesi dipasang, password tidak tersimpan polos", async () => {
    const res = await post(valid);
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    const user = (await db.query<{ id: string; email: string; username: string; passwordHash: string; lastWorkspaceId: string }>(
      `SELECT id, email, username, "passwordHash", "lastWorkspaceId" FROM "DashboardUser" WHERE username = 'pendatang'`
    )).rows[0];
    expect(user).toMatchObject({ email: "baru@contoh.id", username: "pendatang" });
    expect(user.passwordHash).not.toContain(valid.password);
    expect(user.lastWorkspaceId).toMatch(/^dws_[0-9a-f]{32}$/);
    expect((await db.query(`SELECT "workspaceId", role FROM "DashboardMembership" WHERE "userId" = $1`, [user.id])).rows).toEqual([
      { workspaceId: user.lastWorkspaceId, role: "OWNER" },
    ]);
    expect((await db.query(`SELECT "namaBrand" FROM "WorkspaceSettings" WHERE "workspaceId" = $1`, [user.lastWorkspaceId])).rows).toEqual([
      { namaBrand: "Kedai b Kopi /b" },
    ]);
  });

  it("email atau username yang sudah dipakai ditolak tanpa membuat workspace yatim", async () => {
    expect((await post({ ...valid, username: "lain" })).status).toBe(409); // email sama (beda huruf besar)
    expect((await post({ ...valid, email: "lain@contoh.id" })).status).toBe(409); // username sama
    expect((await post({ ...valid, email: "LAMA@contoh.id", username: "lain2" })).status).toBe(409); // email pengguna lama
    expect((await db.query(`SELECT count(*)::int AS n FROM "DashboardUser"`)).rows[0]).toEqual({ n: 2 });
    expect((await db.query(`SELECT count(*)::int AS n FROM "WorkspaceSettings" WHERE "workspaceId" LIKE 'dws_%'`)).rows[0]).toEqual({ n: 1 });
  });

  it("pendaftar baru tidak melihat akun, autopilot, atau tim milik workspace yang sudah ada", async () => {
    const id = (await db.query<{ id: string }>(`SELECT id FROM "DashboardUser" WHERE username = 'pendatang'`)).rows[0].id;
    const me = await json<{ role: string; hasAccess: boolean; accountCount: number; workspaces: { nama: string }[] }>(await meGET(get(id, "/api/auth/me")));
    expect(me).toMatchObject({ role: "OWNER", hasAccess: true, accountCount: 0 });
    expect(me.workspaces.map((w) => w.nama)).toEqual(["Kedai b Kopi /b"]);
    expect((await json<{ accounts: unknown[] }>(await accountsGET(get(id, "/api/threads/accounts")))).accounts).toEqual([]);
    expect((await json<{ accounts: unknown[] }>(await overviewGET(get(id, "/api/autopilot/overview")))).accounts).toEqual([]);
    const team = await json<{ members: { username: string }[] }>(await teamGET(get(id, "/api/team")));
    expect(team.members.map((m) => m.username)).toEqual(["pendatang"]);
    // Pengguna lama tetap hanya di tenant lamanya dan tetap melihat akunnya.
    expect((await json<{ accounts: { id: string }[] }>(await accountsGET(get("u-lama", "/api/threads/accounts")))).accounts.map((a) => a.id)).toEqual(["a1"]);
  });
});
