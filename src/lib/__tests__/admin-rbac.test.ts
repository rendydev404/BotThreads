/**
 * Peran admin platform dan hak akses per modul (sql/014_admin_rbac.sql): route asli + SQL asli di
 * Postgres in-memory, dengan sesi asli. Memastikan izin ditegakkan di server DAN di database, dan
 * perilaku super admin lama (sql/010) tetap sama setelah berkas ini dipasang.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./helpers/pg";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@supabase/supabase-js", async () =>
  (await import("./helpers/pg")).supabaseMock(() => h.db as TestDb, undefined, {
    DashboardUser: `SELECT id, username, name, email, "isActive", "passwordHash" FROM "DashboardUser" ORDER BY "createdAt", id`,
  })
);

import { NextRequest } from "next/server";
import { bootDb, pgRpc, useTestSupabaseEnv } from "./helpers/pg";
import { SESSION_COOKIE, createSessionToken } from "../auth";
import { forgetPlatform, platformCtx } from "../platform";
import { forgetMembership } from "../request-ctx";
import { forgetUserStatus } from "../users";
import { GET as auditGET } from "@/app/api/admin/audit/route";
import { GET as billingGET } from "@/app/api/admin/billing/route";
import { GET as contentGET } from "@/app/api/admin/content/route";
import { GET as overviewGET } from "@/app/api/admin/overview/route";
import { GET as plansGET } from "@/app/api/admin/plans/route";
import { GET as rolesGET, POST as rolesPOST } from "@/app/api/admin/roles/route";
import { GET as settingsGET, PUT as settingsPUT } from "@/app/api/admin/settings/route";
import { POST as userPOST } from "@/app/api/admin/users/[id]/route";
import { GET as usersGET, POST as usersPOST } from "@/app/api/admin/users/route";
import { POST as workspacePOST } from "@/app/api/admin/workspaces/[id]/route";
import { GET as meGET } from "@/app/api/auth/me/route";

let db: TestDb;
const REPO = path.resolve(__dirname, "../../..");
const T0 = new Date("2026-10-15T03:00:00Z").getTime();

const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
const json = async <T = Record<string, unknown>>(res: Response): Promise<T> => (await res.json()) as T;
const param = (id: string) => ({ params: Promise.resolve({ id }) });

const tokens = new Map<string, string>();
async function req(user: string | null, url: string, method = "GET", body?: unknown): Promise<NextRequest> {
  if (user && !tokens.has(user)) {
    const hash = (await rows<{ passwordHash: string }>(`SELECT "passwordHash" FROM "DashboardUser" WHERE id = $1`, [user]))[0].passwordHash;
    tokens.set(user, await createSessionToken(user, hash));
  }
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", ...(user ? { cookie: `${SESSION_COOKIE}=${tokens.get(user)}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const act = async (admin: string, target: string, body: unknown) => userPOST(await req(admin, `/api/admin/users/${target}`, "POST", body), param(target));
/** Cache konteks platform dibuang supaya perubahan peran langsung terbaca (di produksi: TTL 30 detik). */
const fresh = () => {
  forgetPlatform();
  forgetMembership();
  forgetUserStatus("u-dua");
};

beforeAll(async () => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  useTestSupabaseEnv();
  process.env.AUTH_SECRET = "uji-rahasia-yang-panjangnya-lebih-dari-32-karakter";
  process.env.CONTENT_PUBLISH_ENABLED = "false";

  db = await bootDb([]);
  h.db = db;
  await db.exec(`
    INSERT INTO "Workspace" VALUES ('wsA', 'Brand Utama', 'utama');
    INSERT INTO "DashboardUser" (id, username, email, name, "passwordHash", "createdAt") VALUES
      ('u-admin', 'admin', 'admin@contoh.id', 'Admin Utama', 'hash-admin', '2026-01-01'),
      ('u-dua', 'dua', 'dua@contoh.id', 'Orang Kedua', 'hash-dua', '2026-02-01'),
      ('u-tiga', 'tiga', 'tiga@contoh.id', NULL, 'hash-tiga', '2026-03-01');
  `);
  // sql/014 dipasang dua kali: harus idempoten.
  for (const f of ["002_dashboard_post_log", "003_dashboard_rpc", "005_autopilot", "006_autopilot_radar", "007_autopilot_learning", "008_multiuser", "009_signup", "010_superadmin", "011_plans", "012_billing_and_integrations", "014_admin_rbac", "014_admin_rbac"]) {
    await db.exec(fs.readFileSync(path.join(REPO, `sql/${f}.sql`), "utf8"));
  }
  await db.exec(`INSERT INTO "DashboardMembership" ("userId", "workspaceId", role) VALUES ('u-tiga', 'wsA', 'OWNER') ON CONFLICT DO NOTHING;`);
});

describe("pemasangan", () => {
  it("super admin lama tetap super admin dengan semua izin; lima peran bawaan tersedia", async () => {
    const ctx = await platformCtx("u-admin");
    expect(ctx).toMatchObject({ superadmin: true, platformRole: "SUPERADMIN", izin: ["*"] });
    expect((await platformCtx("u-dua")).superadmin).toBe(false);
    const r = await json<{ installed: boolean; roles: { id: string; anggota: number }[]; staff: { username: string }[] }>(await rolesGET(await req("u-admin", "/api/admin/roles")));
    expect(r.installed).toBe(true);
    expect(r.roles.map((x) => x.id)).toEqual(["SUPERADMIN", "ADMIN", "SUPPORT", "KEUANGAN", "AUDITOR"]);
    expect(r.roles[0].anggota).toBe(1);
    expect(r.staff.map((s) => s.username)).toEqual(["admin"]);
  });
});

describe("hak eksekusi fungsi", () => {
  it("server dashboard (service_role) bisa memanggil semua fungsi baru; anon dan authenticated tidak", async () => {
    const calls = [
      `SELECT dash_sa_roles()`,
      `SELECT dash_sa_staff()`,
      `SELECT dash_sa_izin_valid()`,
      `SELECT dash_sa_ctx('u-admin')`,
      `SELECT dash_sa_role_delete('x', 'X', now()::timestamp)`,
      `SELECT dash_sa_user_platform_role('x', 'y', NULL, now()::timestamp)`,
      `SELECT dash_sa_user_update('x', 'y', '{}'::jsonb, now()::timestamp)`,
      `SELECT dash_sa_user_create('x', '{"username":"a","passwordHash":"b"}'::jsonb, now()::timestamp)`,
    ];
    for (const role of ["service_role", "anon", "authenticated"]) {
      for (const sql of calls) {
        await db.exec(`SET ROLE ${role}`);
        const ok = await db.query(sql).then(
          () => true,
          (e: Error) => (/permission denied/.test(e.message) ? false : Promise.reject(e))
        );
        await db.exec(`RESET ROLE`);
        expect(ok, `${role}: ${sql}`).toBe(role === "service_role");
      }
    }
  });
});

describe("peran staf dan izin per modul", () => {
  it("Super Admin memberi peran Dukungan; staf itu hanya bisa membuka modul yang diizinkan", async () => {
    expect((await act("u-admin", "u-dua", { action: "role", role: "SUPPORT" })).status).toBe(200);
    fresh();
    const ctx = await platformCtx("u-dua");
    expect(ctx.superadmin).toBe(true);
    expect(ctx.platformRole).toBe("SUPPORT");
    expect(ctx.izin).toContain("pengguna.kelola");

    const me = await json<{ superadmin: boolean; admin: { role: string; izin: string[] } }>(await meGET(await req("u-dua", "/api/auth/me")));
    expect(me.superadmin).toBe(true);
    expect(me.admin.role).toBe("SUPPORT");

    const allowed: [string, () => Promise<Response>][] = [
      ["overview", async () => overviewGET(await req("u-dua", "/api/admin/overview"))],
      ["users", async () => usersGET(await req("u-dua", "/api/admin/users"))],
      ["content", async () => contentGET(await req("u-dua", "/api/admin/content"))],
      ["audit", async () => auditGET(await req("u-dua", "/api/admin/audit"))],
      // Daftar paket dipakai modul Workspace, jadi cukup izin workspace.lihat.
      ["plans", async () => plansGET(await req("u-dua", "/api/admin/plans"))],
    ];
    for (const [name, run] of allowed) expect((await run()).status, name).toBe(200);

    const denied: [string, () => Promise<Response>][] = [
      ["settings", async () => settingsGET(await req("u-dua", "/api/admin/settings"))],
      ["settings put", async () => settingsPUT(await req("u-dua", "/api/admin/settings", "PUT", { autopilotGlobal: false }))],
      ["billing", async () => billingGET(await req("u-dua", "/api/admin/billing"))],
      ["roles", async () => rolesGET(await req("u-dua", "/api/admin/roles"))],
      ["suspend", async () => workspacePOST(await req("u-dua", "/api/admin/workspaces/wsA", "POST", { action: "suspend", reason: "coba tangguhkan" }), param("wsA"))],
      ["plan", async () => workspacePOST(await req("u-dua", "/api/admin/workspaces/wsA", "POST", { action: "plan", planId: null, until: null }), param("wsA"))],
      ["grant", async () => act("u-dua", "u-tiga", { action: "grant" })],
      ["role", async () => act("u-dua", "u-tiga", { action: "role", role: "ADMIN" })],
    ];
    for (const [name, run] of denied) expect((await run()).status, name).toBe(403);
    expect(await rows(`SELECT "platformRole" FROM "DashboardUser" WHERE id = 'u-tiga'`)).toEqual([{ platformRole: null }]);
    expect(await rows(`SELECT "autopilotGlobal" FROM "PlatformSettings"`)).toEqual([{ autopilotGlobal: true }]);

    // Izin pengguna.kelola: boleh membuat tautan reset password.
    const reset = await json<{ path: string }>(await act("u-dua", "u-tiga", { action: "reset" }));
    expect(reset.path).toMatch(/^\/reset-password\//);
  });

  it("database menolak sendiri staf yang mencoba mengatur peran (pertahanan lapis kedua)", async () => {
    const now = new Date(T0).toISOString();
    expect(await pgRpc(db, "dash_sa_user_platform_role", { p_actor: "u-dua", p_target: "u-dua", p_role: "SUPERADMIN", p_now: now })).toBe("FORBIDDEN");
    expect(await pgRpc(db, "dash_sa_user_role", { p_actor: "u-dua", p_target: "u-dua", p_super: true, p_now: now })).toBe("FORBIDDEN");
    expect(await pgRpc(db, "dash_sa_role_upsert", { p_actor: "u-dua", p_role: { id: "X", nama: "Iseng", izin: [] }, p_now: now })).toBe("FORBIDDEN");
    expect(await rows(`SELECT "platformRole" FROM "DashboardUser" WHERE id = 'u-dua'`)).toEqual([{ platformRole: "SUPPORT" }]);
  });

  it("staf yang diblokir langsung kehilangan akses konsol", async () => {
    await db.exec(`UPDATE "DashboardUser" SET "bannedAt" = now(), "isActive" = false WHERE id = 'u-dua'`);
    fresh();
    expect((await platformCtx("u-dua")).superadmin).toBe(false);
    await db.exec(`UPDATE "DashboardUser" SET "bannedAt" = NULL, "isActive" = true WHERE id = 'u-dua'`);
    fresh();
    expect((await platformCtx("u-dua")).superadmin).toBe(true);
  });
});

describe("pengelolaan peran", () => {
  it("Super Admin membuat, mengubah, dan menghapus peran kustom; izin tak dikenal dan peran sistem ditolak", async () => {
    const post = async (body: unknown) => rolesPOST(await req("u-admin", "/api/admin/roles", "POST", body));
    expect((await post({ action: "save", role: { id: "KONTEN", nama: "Moderator Konten", izin: ["konten.lihat", "konten.kelola"] } })).status).toBe(200);
    expect((await post({ action: "save", role: { id: "KONTEN", nama: "Moderator Konten", izin: ["konten.lihat", "akses.kelola"] } })).status).toBe(400);
    expect((await post({ action: "save", role: { id: "SUPERADMIN", nama: "Dibajak", izin: ["konten.lihat"] } })).status).toBe(409);
    expect((await post({ action: "save", role: { id: "KONTEN", nama: "Moderator Konten", izin: ["konten.lihat"] } })).status).toBe(200);
    expect(await rows(`SELECT izin FROM "PlatformRole" WHERE id = 'KONTEN'`)).toEqual([{ izin: ["konten.lihat"] }]);

    expect((await act("u-admin", "u-dua", { action: "role", role: "KONTEN" })).status).toBe(200);
    expect((await post({ action: "delete", id: "KONTEN" })).status).toBe(409);
    expect((await act("u-admin", "u-dua", { action: "role", role: null })).status).toBe(200);
    expect((await post({ action: "delete", id: "KONTEN" })).status).toBe(200);
    expect((await post({ action: "delete", id: "SUPERADMIN" })).status).toBe(409);

    const audit = await rows<{ action: string }>(`SELECT action FROM "PlatformAuditLog" WHERE "targetType" = 'AKSES' ORDER BY "createdAt", action`);
    expect(audit.map((a) => a.action).sort()).toEqual(["AKSES_PERAN_BUAT", "AKSES_PERAN_HAPUS", "AKSES_PERAN_UBAH"]);
  });

  it("Super Admin tidak bisa mengubah perannya sendiri, dan super admin terakhir terlindungi", async () => {
    expect((await act("u-admin", "u-admin", { action: "role", role: null })).status).toBe(409);
    expect((await act("u-admin", "u-tiga", { action: "role", role: "SUPERADMIN" })).status).toBe(200);
    // Sekarang ada dua super admin: satu boleh diturunkan, tetapi bukan yang terakhir.
    expect((await act("u-admin", "u-tiga", { action: "role", role: "AUDITOR" })).status).toBe(200);
    await db.exec(`UPDATE "DashboardUser" SET "platformRole" = 'SUPERADMIN' WHERE id = 'u-tiga'`);
    await db.exec(`UPDATE "DashboardUser" SET "isActive" = false WHERE id = 'u-tiga'`);
    expect(await pgRpc(db, "dash_sa_user_platform_role", { p_actor: "u-tiga", p_target: "u-admin", p_role: null, p_now: new Date(T0).toISOString() })).toBe("FORBIDDEN");
    // Super admin nonaktif boleh diturunkan oleh super admin aktif (bukan "yang terakhir").
    expect((await act("u-admin", "u-tiga", { action: "role", role: null })).status).toBe(200);
    await db.exec(`UPDATE "DashboardUser" SET "isActive" = true WHERE id = 'u-tiga'`);
    fresh();
  });
});

describe("buat dan ubah pengguna", () => {
  it("admin membuat akun baru (dengan peran bila Super Admin), username/email ganda ditolak", async () => {
    const create = async (user: string, body: unknown) => usersPOST(await req(user, "/api/admin/users", "POST", body));
    const res = await create("u-admin", { username: "Auditor.Satu", email: "AUDIT@contoh.id", name: "Auditor <b>", password: "rahasia-panjang-1", role: "AUDITOR" });
    expect(res.status).toBe(201);
    const { id } = await json<{ id: string }>(res);
    expect(await rows(`SELECT username, email, name, "platformRole" FROM "DashboardUser" WHERE id = $1`, [id])).toEqual([
      { username: "auditor.satu", email: "audit@contoh.id", name: "Auditor b", platformRole: "AUDITOR" },
    ]);
    expect((await create("u-admin", { username: "auditor.satu", password: "rahasia-panjang-1" })).status).toBe(409);
    expect((await create("u-admin", { username: "lain", email: "audit@contoh.id", password: "rahasia-panjang-1" })).status).toBe(409);
    expect((await create("u-admin", { username: "pendek", password: "123" })).status).toBe(400);

    // Staf Dukungan boleh membuat akun, tetapi tidak boleh memberi peran admin.
    expect((await act("u-admin", "u-dua", { action: "role", role: "SUPPORT" })).status).toBe(200);
    fresh();
    expect((await create("u-dua", { username: "pelanggan", password: "rahasia-panjang-1", role: "ADMIN" })).status).toBe(403);
    expect((await create("u-dua", { username: "pelanggan", password: "rahasia-panjang-1" })).status).toBe(201);
    expect(await rows(`SELECT "platformRole" FROM "DashboardUser" WHERE username = 'pelanggan'`)).toEqual([{ platformRole: null }]);
  });

  it("mengubah nama dan email; email milik orang lain ditolak; tercatat di audit", async () => {
    expect((await act("u-admin", "u-tiga", { action: "update", name: "Tiga Baru", email: "TIGA.baru@contoh.id" })).status).toBe(200);
    expect(await rows(`SELECT name, email FROM "DashboardUser" WHERE id = 'u-tiga'`)).toEqual([{ name: "Tiga Baru", email: "tiga.baru@contoh.id" }]);
    expect((await act("u-admin", "u-tiga", { action: "update", email: "dua@contoh.id" })).status).toBe(409);
    expect((await act("u-admin", "u-tiga", { action: "update", email: "bukan-email" })).status).toBe(400);
    expect(await rows(`SELECT count(*)::int AS n FROM "PlatformAuditLog" WHERE action = 'PENGGUNA_UBAH'`)).toEqual([{ n: 1 }]);
  });

  it("saringan STAF menampilkan semua pemegang peran admin", async () => {
    const page = await json<{ items: { username: string; platformRole: string | null }[] }>(await usersGET(await req("u-admin", "/api/admin/users?status=STAF")));
    expect(page.items.map((u) => `${u.username}:${u.platformRole}`).sort()).toEqual(["admin:SUPERADMIN", "auditor.satu:AUDITOR", "dua:SUPPORT"]);
  });
});
