/**
 * Super admin sistem (sql/010_superadmin.sql): route asli + SQL asli di Postgres in-memory, dengan sesi
 * ASLI (token bertanda tangan), supaya blokir dan "keluarkan dari semua perangkat" teruji sampai ke
 * pemeriksaan sesi. Yang di-mock hanya transport database.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
import { upsertConfigs } from "../autopilot-store";
import { runTick } from "../autopilot-tick";
import { DEFAULT_SETTINGS } from "../autopilot-types";
import { forgetPlatform, platformCtx } from "../platform";
import { forgetMembership } from "../request-ctx";
import { hashToken, resetPassword } from "../team-service";
import { forgetUserStatus, getSessionUserId } from "../users";
import { GET as auditGET } from "@/app/api/admin/audit/route";
import { GET as overviewGET } from "@/app/api/admin/overview/route";
import { GET as settingsGET, PUT as settingsPUT } from "@/app/api/admin/settings/route";
import { GET as sourcesGET, POST as sourcesPOST } from "@/app/api/admin/sources/route";
import { POST as userPOST } from "@/app/api/admin/users/[id]/route";
import { GET as usersGET } from "@/app/api/admin/users/route";
import { POST as workspacePOST } from "@/app/api/admin/workspaces/[id]/route";
import { GET as workspacesGET } from "@/app/api/admin/workspaces/route";
import { GET as meGET } from "@/app/api/auth/me/route";
import { POST as registerPOST } from "@/app/api/auth/register/route";
import { GET as accountsGET } from "@/app/api/threads/accounts/route";

let db: TestDb;
const REPO = path.resolve(__dirname, "../../..");
const T0 = new Date("2026-10-13T03:00:00Z").getTime();
let clock = T0;
/** Maju `seconds` detik (cache 30-60 detik ikut kedaluwarsa bila lebih dari 61). */
const advance = (seconds: number) => {
  clock += seconds * 1000;
  vi.setSystemTime(clock);
};

const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
const json = async <T = Record<string, unknown>>(res: Response): Promise<T> => (await res.json()) as T;
const param = (id: string) => ({ params: Promise.resolve({ id }) });

/** Token sesi asli untuk pengguna itu (seperti yang diterbitkan saat login). */
async function tokenFor(userId: string): Promise<string> {
  const hash = (await rows<{ passwordHash: string }>(`SELECT "passwordHash" FROM "DashboardUser" WHERE id = $1`, [userId]))[0].passwordHash;
  return createSessionToken(userId, hash);
}
const tokens = new Map<string, string>();
async function req(user: string | null, url: string, method = "GET", body?: unknown): Promise<NextRequest> {
  if (user && !tokens.has(user)) tokens.set(user, await tokenFor(user));
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", ...(user ? { cookie: `${SESSION_COOKIE}=${tokens.get(user)}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const act = async (admin: string, target: string, body: unknown) => userPOST(await req(admin, `/api/admin/users/${target}`, "POST", body), param(target));
const actWs = async (admin: string, ws: string, body: unknown) => workspacePOST(await req(admin, `/api/admin/workspaces/${ws}`, "POST", body), param(ws));
const visible = async (user: string) =>
  (await json<{ accounts: { id: string }[] }>(await accountsGET(await req(user, "/api/threads/accounts")))).accounts.map((a) => a.id).sort();

const addAccount = (id: string, ws: string) => `
  INSERT INTO "Outlet" VALUES ('o-${id}', '${ws}', 'Cabang ${id}', true);
  INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "accessExpiresAt", scopes)
    VALUES ('${id}', '${ws}', 'akun_${id}', 'Akun ${id}', '2099-01-01', '{threads_content_publish}');
  INSERT INTO "SocialAccount" VALUES ('s-${id}', 'o-${id}', '${id}');`;

beforeAll(async () => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  useTestSupabaseEnv();
  process.env.AUTH_SECRET = "uji-rahasia-yang-panjangnya-lebih-dari-32-karakter";
  process.env.CONTENT_PUBLISH_ENABLED = "false";
  delete process.env.CONTENT_PUBLISH_TEST_ACCOUNTS;
  delete process.env.EXCLUDED_THREADS_ACCOUNTS;

  db = await bootDb([]);
  h.db = db;
  await db.exec(`
    INSERT INTO "Workspace" VALUES ('wsA', 'Brand Utama', 'utama'), ('wsB', 'Brand Cabang', 'cabang');
    ${addAccount("a1", "wsA")} ${addAccount("a2", "wsA")} ${addAccount("b1", "wsB")}
    INSERT INTO "DashboardUser" (id, username, email, name, "passwordHash", "createdAt") VALUES
      ('u-admin', 'admin', 'admin@contoh.id', 'Admin Utama', 'hash-admin', '2026-01-01'),
      ('u-dua', 'dua', 'dua@contoh.id', 'Orang Kedua', 'hash-dua', '2026-02-01'),
      ('u-tiga', 'tiga', 'tiga@contoh.id', NULL, 'hash-tiga', '2026-03-01');
  `);
  for (const f of ["002_dashboard_post_log", "003_dashboard_rpc", "005_autopilot", "006_autopilot_radar", "007_autopilot_learning", "008_multiuser", "009_signup", "010_superadmin", "010_superadmin"]) {
    await db.exec(fs.readFileSync(path.join(REPO, `sql/${f}.sql`), "utf8"));
  }
});

afterAll(() => {
  delete process.env.SIGNUP_ENABLED;
});

describe("pemasangan dan penjagaan", () => {
  it("pengguna aktif tertua menjadi satu-satunya super admin; pemasangan ulang tidak menambah", async () => {
    expect(await rows(`SELECT username FROM "DashboardUser" WHERE "platformRole" = 'SUPERADMIN'`)).toEqual([{ username: "admin" }]);
    expect((await platformCtx("u-admin")).superadmin).toBe(true);
    expect((await platformCtx("u-dua")).superadmin).toBe(false);
  });

  it("semua endpoint admin menolak yang bukan super admin (403) dan yang tanpa sesi (401)", async () => {
    const calls: [string, () => Promise<Response>][] = [
      ["overview", async () => overviewGET(await req("u-dua", "/api/admin/overview"))],
      ["users", async () => usersGET(await req("u-dua", "/api/admin/users"))],
      ["user action", async () => act("u-dua", "u-tiga", { action: "ban", reason: "coba-coba saja" })],
      ["workspaces", async () => workspacesGET(await req("u-dua", "/api/admin/workspaces"))],
      ["workspace action", async () => actWs("u-dua", "wsA", { action: "suspend", reason: "coba-coba saja" })],
      ["sources", async () => sourcesGET(await req("u-dua", "/api/admin/sources"))],
      ["source link", async () => sourcesPOST(await req("u-dua", "/api/admin/sources", "POST", { workspaceId: "wsB", tenantId: null }))],
      ["settings", async () => settingsGET(await req("u-dua", "/api/admin/settings"))],
      ["settings put", async () => settingsPUT(await req("u-dua", "/api/admin/settings", "PUT", { autopilotGlobal: false }))],
      ["audit", async () => auditGET(await req("u-dua", "/api/admin/audit"))],
    ];
    for (const [name, run] of calls) expect((await run()).status, name).toBe(403);
    expect((await overviewGET(await req(null, "/api/admin/overview"))).status).toBe(401);
    // Tidak ada yang berubah akibat percobaan itu.
    expect(await rows(`SELECT count(*)::int AS n FROM "DashboardUser" WHERE "bannedAt" IS NOT NULL`)).toEqual([{ n: 0 }]);
    expect(await rows(`SELECT count(*)::int AS n FROM "WorkspaceSettings" WHERE "suspendedAt" IS NOT NULL`)).toEqual([{ n: 0 }]);
  });

  it("fungsi SQL menolak sendiri pelaku yang bukan super admin (pertahanan lapis kedua)", async () => {
    const now = new Date(clock).toISOString();
    expect(await pgRpc(db, "dash_sa_user_ban", { p_actor: "u-dua", p_target: "u-tiga", p_reason: "langsung ke database", p_now: now })).toBe("FORBIDDEN");
    expect(await pgRpc(db, "dash_sa_workspace_suspend", { p_actor: "u-dua", p_ws: "wsA", p_reason: "langsung", p_now: now })).toBe("FORBIDDEN");
    expect(await pgRpc(db, "dash_sa_settings_set", { p_actor: "u-dua", p_patch: { autopilotGlobal: false }, p_now: now })).toBeNull();
  });
});

describe("ringkasan dan daftar", () => {
  it("ringkasan platform menghitung pengguna, workspace, dan akun", async () => {
    const o = await json<{ users: Record<string, number>; workspaces: Record<string, number>; accounts: Record<string, number>; flags: Record<string, unknown> }>(
      await overviewGET(await req("u-admin", "/api/admin/overview"))
    );
    expect(o.users).toMatchObject({ total: 3, aktif: 3, diblokir: 0, superadmin: 1 });
    expect(o.workspaces).toMatchObject({ total: 1, ditangguhkan: 0 });
    expect(o.accounts).toEqual({ total: 3, tanpaPemilik: 0 });
    expect(o.flags).toEqual({ signupOpen: true, autopilotGlobal: true, announcement: null });
  });

  it("daftar pengguna: pencarian, saringan status, dan paginasi kursor tanpa baris ganda", async () => {
    await db.exec(
      Array.from({ length: 30 }, (_, i) => `INSERT INTO "DashboardUser" (id, username, email, "passwordHash", "createdAt") VALUES ('m-${i}', 'massal${i}', 'massal${i}@contoh.id', 'x', '2026-04-01'::timestamp + interval '${i} minutes');`).join("\n")
    );
    type Page = { items: { id: string; username: string; workspaces: unknown[] }[]; nextCursor: string | null; me: string };
    const first = await json<Page>(await usersGET(await req("u-admin", "/api/admin/users")));
    expect(first.items).toHaveLength(25);
    expect(first.me).toBe("u-admin");
    expect(first.nextCursor).toBeTruthy();
    const second = await json<Page>(await usersGET(await req("u-admin", `/api/admin/users?cursor=${encodeURIComponent(first.nextCursor!)}`)));
    const ids = [...first.items, ...second.items].map((u) => u.id);
    expect(new Set(ids).size).toBe(33);
    expect(second.nextCursor).toBeNull();

    const found = await json<Page>(await usersGET(await req("u-admin", "/api/admin/users?q=Orang")));
    expect(found.items.map((u) => u.username)).toEqual(["dua"]);
    // Karakter pola LIKE diperlakukan sebagai teks biasa.
    expect((await json<Page>(await usersGET(await req("u-admin", "/api/admin/users?q=%25")))).items).toEqual([]);
    const admins = await json<Page>(await usersGET(await req("u-admin", "/api/admin/users?status=SUPERADMIN")));
    expect(admins.items.map((u) => u.username)).toEqual(["admin"]);
    expect((await usersGET(await req("u-admin", "/api/admin/users?status=ASAL"))).status).toBe(400);
    await db.exec(`DELETE FROM "DashboardUser" WHERE id LIKE 'm-%'`);
  });
});

describe("pengguna: blokir, sesi, peran", () => {
  it("blokir butuh alasan, tidak bisa untuk diri sendiri, dan langsung menggugurkan sesi", async () => {
    const victim = await tokenFor("u-tiga");
    expect(await getSessionUserId(victim)).toBe("u-tiga");

    expect((await act("u-admin", "u-tiga", { action: "ban" })).status).toBe(400);
    expect((await act("u-admin", "u-tiga", { action: "ban", reason: "abc" })).status).toBe(400);
    expect((await act("u-admin", "u-admin", { action: "ban", reason: "mencoba diri sendiri" })).status).toBe(409);
    expect((await act("u-admin", "tidak-ada", { action: "ban", reason: "pengguna hantu" })).status).toBe(404);

    advance(5);
    expect((await act("u-admin", "u-tiga", { action: "ban", reason: "Menyebar spam ke banyak akun" })).status).toBe(200);
    expect(await getSessionUserId(victim)).toBeNull();
    expect(await platformCtx("u-tiga")).toMatchObject({ banned: true, bannedReason: "Menyebar spam ke banyak akun" });
    expect((await act("u-admin", "u-tiga", { action: "ban", reason: "dua kali blokir" })).status).toBe(409);
    expect((await accountsGET(new NextRequest("http://localhost/api/threads/accounts", { headers: { cookie: `${SESSION_COOKIE}=${victim}` } }))).status).toBe(401);

    // Buka blokir mengaktifkan akun, tetapi sesi lama tetap gugur: harus masuk lagi.
    advance(5);
    expect((await act("u-admin", "u-tiga", { action: "unban" })).status).toBe(200);
    expect(await getSessionUserId(victim)).toBeNull();
    advance(5);
    expect(await getSessionUserId(await tokenFor("u-tiga"))).toBe("u-tiga");
    expect((await act("u-admin", "u-tiga", { action: "unban" })).status).toBe(409);
  });

  it("keluarkan dari semua perangkat: sesi lama gugur tanpa mengganti password", async () => {
    const old = await tokenFor("u-dua");
    expect(await getSessionUserId(old)).toBe("u-dua");
    advance(10);
    expect((await act("u-admin", "u-dua", { action: "logout" })).status).toBe(200);
    expect(await getSessionUserId(old)).toBeNull();
    advance(10);
    const fresh = await tokenFor("u-dua");
    expect(await getSessionUserId(fresh)).toBe("u-dua");
    tokens.set("u-dua", fresh);
    expect(await rows(`SELECT "passwordHash" FROM "DashboardUser" WHERE id = 'u-dua'`)).toEqual([{ passwordHash: "hash-dua" }]);
  });

  it("peran super admin: beri, cabut, super admin terakhir terlindungi, sesama super admin tidak bisa diblokir", async () => {
    expect((await act("u-admin", "u-admin", { action: "revoke" })).status).toBe(409); // terakhir
    expect((await act("u-admin", "u-dua", { action: "grant" })).status).toBe(200);
    expect((await platformCtx("u-dua")).superadmin).toBe(true);
    expect((await overviewGET(await req("u-dua", "/api/admin/overview"))).status).toBe(200);
    expect((await act("u-admin", "u-dua", { action: "grant" })).status).toBe(409); // sudah
    expect((await act("u-admin", "u-dua", { action: "ban", reason: "sesama super admin" })).status).toBe(409);
    // Sekarang ada dua: yang lama boleh dicabut oleh yang baru, lalu yang baru menjadi yang terakhir.
    expect((await act("u-dua", "u-admin", { action: "revoke" })).status).toBe(200);
    expect((await overviewGET(await req("u-admin", "/api/admin/overview"))).status).toBe(403);
    expect((await act("u-dua", "u-dua", { action: "revoke" })).status).toBe(409);
    expect((await act("u-dua", "u-admin", { action: "grant" })).status).toBe(200);
    expect((await act("u-admin", "u-dua", { action: "revoke" })).status).toBe(200);

    // Akun yang diblokir tidak bisa dijadikan super admin.
    expect((await act("u-admin", "u-tiga", { action: "ban", reason: "untuk uji peran" })).status).toBe(200);
    expect((await act("u-admin", "u-tiga", { action: "grant" })).status).toBe(409);
    expect((await act("u-admin", "u-tiga", { action: "unban" })).status).toBe(200);
  });

  it("tautan reset password: sekali tampil, hanya hash yang tersimpan, bisa dipakai", async () => {
    const res = await json<{ path: string; expiresAt: string }>(await act("u-admin", "u-tiga", { action: "reset" }));
    const token = res.path.split("/").pop()!;
    expect(res.path).toBe(`/reset-password/${token}`);
    const stored = await rows<{ tokenHash: string; createdBy: string }>(`SELECT "tokenHash", "createdBy" FROM "DashboardPasswordReset" WHERE "userId" = 'u-tiga'`);
    expect(stored).toEqual([{ tokenHash: hashToken(token), createdBy: "u-admin" }]);
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(await resetPassword(token, "password-baru-yang-panjang")).toEqual({ ok: true });
    expect(await resetPassword(token, "password-baru-yang-panjang")).toMatchObject({ ok: false, status: 404 });
    forgetUserStatus("u-tiga");
  });
});

describe("workspace: tangguhkan dan anggota", () => {
  it("penangguhan menutup akses anggota dan mematikan autopilot; pemulihan mengembalikan keduanya", async () => {
    expect(await visible("u-dua")).toEqual(["a1", "a2", "b1"]);
    expect((await actWs("u-admin", "wsA", { action: "suspend" })).status).toBe(400);
    expect((await actWs("u-admin", "ws-hantu", { action: "suspend", reason: "workspace tidak ada" })).status).toBe(404);
    expect((await actWs("u-admin", "wsA", { action: "suspend", reason: "Tagihan belum dibayar" })).status).toBe(200);

    const me = await json<{ hasAccess: boolean; suspended: { reason: string } | null; superadmin: boolean }>(await meGET(await req("u-dua", "/api/auth/me")));
    expect(me).toMatchObject({ hasAccess: false, suspended: { reason: "Tagihan belum dibayar" }, superadmin: false });
    expect(await visible("u-dua")).toEqual([]);
    expect(await rows(`SELECT "autopilotAktif" FROM "WorkspaceSettings" WHERE "workspaceId" = 'wsA'`)).toEqual([{ autopilotAktif: false }]);
    // Super admin tetap bisa membuka panelnya walau workspace-nya sendiri ditangguhkan.
    expect((await overviewGET(await req("u-admin", "/api/admin/overview"))).status).toBe(200);
    expect((await actWs("u-admin", "wsA", { action: "suspend", reason: "dua kali tangguh" })).status).toBe(409);

    expect((await actWs("u-admin", "wsA", { action: "unsuspend" })).status).toBe(200);
    expect(await visible("u-dua")).toEqual(["a1", "a2", "b1"]);
    expect(await rows(`SELECT "autopilotAktif", "suspendedAt" FROM "WorkspaceSettings" WHERE "workspaceId" = 'wsA'`)).toEqual([{ autopilotAktif: true, suspendedAt: null }]);
    expect((await actWs("u-admin", "wsA", { action: "unsuspend" })).status).toBe(409);
  });

  it("anggota workspace bisa diatur dan dikeluarkan lewat email atau username", async () => {
    await db.exec(`INSERT INTO "DashboardUser" (id, username, email, "passwordHash") VALUES ('u-baru', 'baru', 'baru@contoh.id', 'hash-baru')`);
    expect(await visible("u-baru")).toEqual([]);
    expect((await actWs("u-admin", "wsA", { action: "member", identifier: "tidak@ada.id", role: "EDITOR" })).status).toBe(404);
    expect((await actWs("u-admin", "wsA", { action: "member", identifier: "baru@contoh.id", role: "RAJA" })).status).toBe(400);
    expect((await actWs("u-admin", "wsA", { action: "member", identifier: "Baru@Contoh.id", role: "EDITOR" })).status).toBe(200);
    expect(await visible("u-baru")).toEqual(["a1", "a2", "b1"]);

    type List = { items: { id: string; anggota: number; akun: number; members: { username: string; role: string }[] }[] };
    const list = await json<List>(await workspacesGET(await req("u-admin", "/api/admin/workspaces")));
    const wsA = list.items.find((w) => w.id === "wsA")!;
    expect(wsA).toMatchObject({ akun: 3 });
    expect(wsA.members.find((m) => m.username === "baru")).toMatchObject({ role: "EDITOR" });

    expect((await actWs("u-admin", "wsA", { action: "member", identifier: "baru", role: null })).status).toBe(200);
    expect(await visible("u-baru")).toEqual([]);
    expect((await actWs("u-admin", "wsA", { action: "member", identifier: "baru", role: null })).status).toBe(409);
  });
});

describe("sumber akun (workspace SukaPost)", () => {
  it("workspace SukaPost baru tidak terlihat sampai ditautkan; memindahkannya mematikan autopilot akunnya", async () => {
    await db.exec(`INSERT INTO "Workspace" VALUES ('wsC', 'Klien Baru', 'klien'); ${addAccount("c1", "wsC")}`);
    advance(61);
    const o = await json<{ accounts: { tanpaPemilik: number } }>(await overviewGET(await req("u-admin", "/api/admin/overview")));
    expect(o.accounts.tanpaPemilik).toBe(1);
    expect(await visible("u-dua")).toEqual(["a1", "a2", "b1"]);

    type Sources = { items: { workspaceId: string; akun: number; tenantId: string | null; pemimpin: boolean }[] };
    const before = await json<Sources>(await sourcesGET(await req("u-admin", "/api/admin/sources")));
    expect(before.items.find((s) => s.workspaceId === "wsC")).toMatchObject({ akun: 1, tenantId: null, pemimpin: false });
    expect(before.items.find((s) => s.workspaceId === "wsA")).toMatchObject({ tenantId: "wsA", pemimpin: true });

    const link = async (workspaceId: string, tenantId: string | null) => sourcesPOST(await req("u-admin", "/api/admin/sources", "POST", { workspaceId, tenantId }));
    expect((await link("ws-hantu", "wsA")).status).toBe(404);
    expect((await link("wsC", "tenant-hantu")).status).toBe(404);
    expect((await link("wsA", null)).status).toBe(409); // pemimpin kelompok
    expect((await link("wsC", "wsA")).status).toBe(200);
    expect(await visible("u-dua")).toEqual(["a1", "a2", "b1", "c1"]);
    expect((await link("wsC", "wsA")).status).toBe(409); // sudah

    // Akun yang autopilot-nya menyala ikut dimatikan saat sumbernya dilepas dari tenant.
    await upsertConfigs([{ accountId: "c1", workspaceId: "wsA", ...DEFAULT_SETTINGS, mode: "OTOMATIS" }], "u-admin", new Date(clock));
    expect((await link("wsC", null)).status).toBe(200);
    expect(await rows(`SELECT "workspaceId", mode FROM "AutopilotConfig" WHERE "accountId" = 'c1'`)).toEqual([{ workspaceId: "wsC", mode: "MATI" }]);
    expect(await visible("u-dua")).toEqual(["a1", "a2", "b1"]);
  });
});

describe("pengaturan sistem", () => {
  it("menutup pendaftaran dari panel berlaku walau saklar server menyala", async () => {
    process.env.SIGNUP_ENABLED = "true";
    const register = async () =>
      registerPOST(
        new NextRequest("http://localhost/api/auth/register", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${Math.floor(Math.random() * 250)}` },
          body: JSON.stringify({ email: `p${clock}@contoh.id`, username: `p${clock}`, brand: "Brand Uji", password: "rahasia-panjang-1" }),
        })
      );
    expect((await settingsPUT(await req("u-admin", "/api/admin/settings", "PUT", {}))).status).toBe(400);
    expect((await settingsPUT(await req("u-admin", "/api/admin/settings", "PUT", { signupOpen: "ya" }))).status).toBe(400);
    const closed = await json<{ flags: { signupOpen: boolean } }>(await settingsPUT(await req("u-admin", "/api/admin/settings", "PUT", { signupOpen: false })));
    expect(closed.flags.signupOpen).toBe(false);
    expect((await register()).status).toBe(403);
    expect((await settingsPUT(await req("u-admin", "/api/admin/settings", "PUT", { signupOpen: true }))).status).toBe(200);
    advance(1);
    expect((await register()).status).toBe(201);
  });

  it("pengumuman tampil di profil semua pengguna dan bisa dikosongkan", async () => {
    const long = "x".repeat(301);
    expect((await settingsPUT(await req("u-admin", "/api/admin/settings", "PUT", { announcement: long }))).status).toBe(400);
    expect((await settingsPUT(await req("u-admin", "/api/admin/settings", "PUT", { announcement: "  Pemeliharaan <b>malam</b> ini pukul 23.00  " }))).status).toBe(200);
    forgetMembership();
    expect((await json<{ announcement: string | null }>(await meGET(await req("u-dua", "/api/auth/me")))).announcement).toBe("Pemeliharaan b malam /b ini pukul 23.00");
    expect((await settingsPUT(await req("u-admin", "/api/admin/settings", "PUT", { announcement: "" }))).status).toBe(200);
    forgetMembership();
    expect((await json<{ announcement: string | null }>(await meGET(await req("u-dua", "/api/auth/me")))).announcement).toBeNull();
  });

  it("saklar darurat autopilot global menghentikan perencanaan untuk semua workspace", async () => {
    await upsertConfigs([{ accountId: "a1", workspaceId: "wsA", ...DEFAULT_SETTINGS, mode: "OTOMATIS" }], "u-admin", new Date(clock));
    expect((await settingsPUT(await req("u-admin", "/api/admin/settings", "PUT", { autopilotGlobal: false }))).status).toBe(200);
    const stopped = await runTick({ now: new Date(clock) });
    expect(stopped.ok).toBe(true);
    expect(stopped.counts).toMatchObject({ dijedaPlatform: 1 });
    expect(await rows(`SELECT count(*)::int AS n FROM "AutopilotSlot" WHERE "accountId" = 'a1'`)).toEqual([{ n: 0 }]);

    expect((await settingsPUT(await req("u-admin", "/api/admin/settings", "PUT", { autopilotGlobal: true }))).status).toBe(200);
    advance(360);
    forgetPlatform();
    const resumed = await runTick({ now: new Date(clock) });
    expect(resumed.counts.dijedaPlatform).toBeUndefined();
    expect((await rows<{ n: number }>(`SELECT count(*)::int AS n FROM "AutopilotSlot" WHERE "accountId" = 'a1'`))[0].n).toBeGreaterThanOrEqual(3);
  });
});

describe("audit platform", () => {
  it("setiap tindakan tercatat dengan pelaku, sasaran, dan rinciannya; paginasi tanpa baris ganda", async () => {
    type Audit = { items: { id: string; action: string; actorName: string; targetType: string; targetId: string | null; detail: Record<string, unknown> }[]; nextCursor: string | null };
    // Tambah beberapa tindakan supaya catatannya melewati satu halaman (25 baris).
    for (let i = 0; i < 6; i++) {
      advance(1);
      expect((await settingsPUT(await req("u-admin", "/api/admin/settings", "PUT", { announcement: i < 5 ? `Pengumuman ${i}` : "" }))).status).toBe(200);
    }
    const first = await json<Audit>(await auditGET(await req("u-admin", "/api/admin/audit")));
    expect(first.items).toHaveLength(25);
    const second = await json<Audit>(await auditGET(await req("u-admin", `/api/admin/audit?cursor=${encodeURIComponent(first.nextCursor!)}`)));
    const all = [...first.items, ...second.items];
    expect(new Set(all.map((a) => a.id)).size).toBe(all.length);
    const actions = new Set(all.map((a) => a.action));
    for (const a of ["SUPERADMIN_AWAL", "PENGGUNA_BLOKIR", "PENGGUNA_BUKA_BLOKIR", "PENGGUNA_KELUARKAN", "SUPERADMIN_BERI", "SUPERADMIN_CABUT", "PENGGUNA_TAUTAN_RESET", "WORKSPACE_TANGGUHKAN", "WORKSPACE_PULIHKAN", "WORKSPACE_ANGGOTA_ATUR", "WORKSPACE_ANGGOTA_HAPUS", "SUMBER_TAUTKAN", "SISTEM_PENGATURAN"]) {
      expect(actions.has(a), a).toBe(true);
    }
    const ban = all.find((a) => a.action === "PENGGUNA_BLOKIR" && a.detail.alasan === "Menyebar spam ke banyak akun")!;
    expect(ban).toMatchObject({ actorName: "Admin Utama", targetType: "PENGGUNA", targetId: "u-tiga", detail: { username: "tiga" } });
    // Percobaan yang ditolak tidak meninggalkan catatan palsu.
    expect(all.some((a) => a.detail.alasan === "langsung ke database" || a.detail.alasan === "coba-coba saja")).toBe(false);
  });
});
