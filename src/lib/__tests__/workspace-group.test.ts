/**
 * Kelompok workspace (tenant): beberapa workspace auto-suka milik satu organisasi dikelola sebagai SATU
 * tenant di dashboard. SQL asli (sql/002-008) dipasang di Postgres in-memory pada data yang sudah ada,
 * seperti di produksi (tiga workspace, satu pengguna). Yang di-mock hanya transport database dan sesi.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
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
import { listPublishAccounts } from "../publish-accounts";
import { accountScope, tenantIdOf } from "../supabase";
import { makeScope, runScoped } from "../tenant-scope";
import { PUT as autopilotAccountPUT } from "@/app/api/autopilot/accounts/[id]/route";
import { GET as overviewGET } from "@/app/api/autopilot/overview/route";
import { GET as meGET } from "@/app/api/auth/me/route";
import { GET as accountsGET } from "@/app/api/threads/accounts/route";

let db: TestDb;
const REPO = path.resolve(__dirname, "../../..");
const T0 = new Date("2026-10-13T03:00:00Z");
const SQL = [
  "sql/002_dashboard_post_log.sql",
  "sql/003_dashboard_rpc.sql",
  "sql/005_autopilot.sql",
  "sql/006_autopilot_radar.sql",
  "sql/007_autopilot_learning.sql",
  "sql/008_multiuser.sql",
];
const install = async () => {
  for (const file of SQL) await db.exec(fs.readFileSync(path.join(REPO, file), "utf8"));
};

const req = (user: string, url: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", cookie: `session=${user}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const json = async <T = Record<string, unknown>>(res: Response): Promise<T> => (await res.json()) as T;
const rows = async <T>(sql: string): Promise<T[]> => (await db.query<T>(sql)).rows;

const addAccount = (id: string, ws: string) => `
  INSERT INTO "Outlet" VALUES ('o-${id}', '${ws}', 'Cabang ${id}', true);
  INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "accessExpiresAt", scopes)
    VALUES ('${id}', '${ws}', 'akun_${id}', 'Akun ${id}', '2099-01-01', '{threads_content_publish}');
  INSERT INTO "SocialAccount" VALUES ('s-${id}', 'o-${id}', '${id}');`;

const visibleAccounts = async (user: string) =>
  (await json<{ accounts: { id: string }[] }>(await accountsGET(req(user, "/api/threads/accounts")))).accounts.map((a) => a.id).sort();

/** Lewati masa cache (daftar akun 60 dtk, peta tenant 60 dtk, keanggotaan 30 dtk). */
let clock = T0.getTime();
const expireCaches = () => {
  clock += 61_000;
  vi.setSystemTime(clock);
};

beforeAll(async () => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  useTestSupabaseEnv();
  process.env.AUTH_SECRET = "uji-rahasia-yang-panjangnya-lebih-dari-32-karakter";
  process.env.CONTENT_PUBLISH_ENABLED = "true";
  delete process.env.CONTENT_PUBLISH_TEST_ACCOUNTS;
  delete process.env.EXCLUDED_THREADS_ACCOUNTS;

  db = await bootDb([]);
  h.db = db;
  // Data yang sudah ada sebelum fitur dipasang: satu organisasi dengan tiga workspace.
  await db.exec(`
    INSERT INTO "Workspace" VALUES ('wsA', 'Brand Utama', 'utama'), ('wsB', 'Brand Buzzer', 'buzzer'), ('wsC', 'Brand Post', 'post');
    ${["a1", "a2", "a3"].map((a) => addAccount(a, "wsA")).join("")}
    ${addAccount("b1", "wsB")}
    ${addAccount("c1", "wsC")}
    INSERT INTO "DashboardUser" (id, username, email, "passwordHash") VALUES ('u1', 'pemilik', 'pemilik@contoh.id', 'x');
  `);
  await install();
});

describe("pemasangan: workspace yang sudah ada menjadi satu tenant", () => {
  it("semua workspace berakun masuk satu kelompok, dipimpin workspace dengan akun terbanyak", async () => {
    expect(await rows(`SELECT "workspaceId", "groupId" FROM "DashboardWorkspaceGroup" ORDER BY 1`)).toEqual([
      { workspaceId: "wsA", groupId: "wsA" },
      { workspaceId: "wsB", groupId: "wsA" },
      { workspaceId: "wsC", groupId: "wsA" },
    ]);
    expect(await tenantIdOf("wsB")).toBe("wsA");
    expect(await tenantIdOf("ws-tak-dikenal")).toBe("ws-tak-dikenal");
    expect(await tenantIdOf(null)).toBeNull();
  });

  it("pengguna lama menjadi Pemilik satu tenant saja, dengan brand dari workspace pemimpin", async () => {
    expect(await rows(`SELECT "userId", "workspaceId", role FROM "DashboardMembership"`)).toEqual([{ userId: "u1", workspaceId: "wsA", role: "OWNER" }]);
    expect(await rows(`SELECT "workspaceId", "namaBrand" FROM "WorkspaceSettings"`)).toEqual([{ workspaceId: "wsA", namaBrand: "Brand Utama" }]);
    const me = await json<{ hasAccess: boolean; role: string; workspaces: unknown[] }>(await meGET(req("u1", "/api/auth/me")));
    // Jumlah akun di profil (dipakai sidebar) mencakup akun dari semua workspace anggota tenant.
    expect(me).toMatchObject({ hasAccess: true, role: "OWNER", accountCount: 5 });
    expect(me.workspaces).toHaveLength(1);
  });
});

describe("lingkup tenant mencakup semua workspace anggotanya", () => {
  it("akun dari ketiga workspace tampil bersama, baik lewat pembantu query maupun route", async () => {
    await runScoped(makeScope("wsA", null), async () => {
      expect((await accountScope()).visibleIds.sort()).toEqual(["a1", "a2", "a3", "b1", "c1"]);
      const accounts = await listPublishAccounts();
      expect(accounts.map((a) => a.id).sort()).toEqual(["a1", "a2", "a3", "b1", "c1"]);
      expect(new Set(accounts.map((a) => a.tenantId))).toEqual(new Set(["wsA"]));
      // Workspace asli tetap tersimpan: antrean posting harus ditulis ke workspace pemilik akunnya.
      expect(accounts.find((a) => a.id === "b1")?.workspaceId).toBe("wsB");
    });
    expect(await visibleAccounts("u1")).toEqual(["a1", "a2", "a3", "b1", "c1"]);
    const overview = await json<{ accounts: { id: string }[] }>(await overviewGET(req("u1", "/api/autopilot/overview")));
    expect(overview.accounts.map((a) => a.id).sort()).toEqual(["a1", "a2", "a3", "b1", "c1"]);
  });

  it("pengaturan autopilot akun di workspace anggota disimpan atas nama tenant", async () => {
    const res = await autopilotAccountPUT(req("u1", "/api/autopilot/accounts/b1", "PUT", { mode: "TINJAU" }), { params: Promise.resolve({ id: "b1" }) });
    expect(res.status).toBe(200);
    expect(await rows(`SELECT "accountId", "workspaceId", mode FROM "AutopilotConfig"`)).toEqual([{ accountId: "b1", workspaceId: "wsA", mode: "TINJAU" }]);
  });
});

describe("perubahan kelompok setelah pemasangan", () => {
  it("workspace baru tidak otomatis bergabung walau SQL dijalankan ulang; ia tenant terpisah", async () => {
    await db.exec(`INSERT INTO "Workspace" VALUES ('wsD', 'Organisasi Lain', 'lain'); ${addAccount("d1", "wsD")}`);
    await install();
    expect(await rows(`SELECT count(*)::int AS n FROM "DashboardWorkspaceGroup"`)).toEqual([{ n: 3 }]);
    // Pengguna lama tidak mendadak menjadi Pemilik organisasi yang muncul belakangan.
    expect(await rows(`SELECT "userId", "workspaceId" FROM "DashboardMembership"`)).toEqual([{ userId: "u1", workspaceId: "wsA" }]);

    expireCaches();
    expect(await visibleAccounts("u1")).toEqual(["a1", "a2", "a3", "b1", "c1"]);
    await runScoped(makeScope("wsD", null), async () => {
      expect((await accountScope()).visibleIds).toEqual(["d1"]);
      expect((await listPublishAccounts()).map((a) => a.id)).toEqual(["d1"]);
    });
    // Akun tenant lain tidak bisa diatur dari tenant ini.
    const res = await autopilotAccountPUT(req("u1", "/api/autopilot/accounts/d1", "PUT", { mode: "TINJAU" }), { params: Promise.resolve({ id: "d1" }) });
    expect(res.status).toBe(404);
  });

  it("workspace yang dikeluarkan dari kelompok langsung hilang dari tenant lama", async () => {
    await db.exec(`UPDATE "DashboardWorkspaceGroup" SET "groupId" = 'wsC' WHERE "workspaceId" = 'wsC'`);
    expireCaches();
    expect(await tenantIdOf("wsC")).toBe("wsC");
    expect(await visibleAccounts("u1")).toEqual(["a1", "a2", "a3", "b1"]);
    await runScoped(makeScope("wsC", null), async () => {
      expect((await accountScope()).visibleIds).toEqual(["c1"]);
    });
  });
});
