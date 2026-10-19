/**
 * Paket langganan (sql/011_plans.sql): route asli + SQL asli di Postgres in-memory. Batas paket harus
 * ditegakkan di server (autopilot, undangan tim, tick), bukan hanya ditampilkan.
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
import { runTick } from "../autopilot-tick";
import { forgetPlans } from "../plan";
import { POST as plansPOST, GET as adminPlansGET } from "@/app/api/admin/plans/route";
import { POST as workspacePOST, } from "@/app/api/admin/workspaces/[id]/route";
import { GET as workspacesGET } from "@/app/api/admin/workspaces/route";
import { PUT as autopilotPUT } from "@/app/api/autopilot/accounts/[id]/route";
import { GET as overviewGET } from "@/app/api/autopilot/overview/route";
import { GET as publicPlansGET } from "@/app/api/plans/route";
import { POST as teamPOST } from "@/app/api/team/route";
import { GET as planGET } from "@/app/api/workspace/plan/route";

let db: TestDb;
const REPO = path.resolve(__dirname, "../../..");
const T0 = new Date("2026-10-13T03:00:00Z").getTime();
let clock = T0;
const advance = (seconds: number) => {
  clock += seconds * 1000;
  vi.setSystemTime(clock);
};
const req = (user: string, url: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", cookie: `session=${user}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const json = async <T = Record<string, unknown>>(res: Response): Promise<T> => (await res.json()) as T;
const param = (id: string) => ({ params: Promise.resolve({ id }) });
const rows = async <T>(sql: string): Promise<T[]> => (await db.query<T>(sql)).rows;

const plan = (over: Record<string, unknown> = {}) => ({
  id: "hemat", nama: "Hemat", deskripsi: "Untuk satu brand kecil", hargaBulanan: 99000, maxAkun: 1, maxPostingPerHari: 2, maxAnggota: 2,
  modeOtomatis: false, publik: true, aktif: true, urutan: 1, ...over,
});
const savePlan = (user: string, p: Record<string, unknown>) => plansPOST(req(user, "/api/admin/plans", "POST", { action: "save", plan: p }));
const setAutopilot = (account: string, body: Record<string, unknown>) =>
  autopilotPUT(req("u-admin", `/api/autopilot/accounts/${account}`, "PUT", body), param(account));
const assign = (planId: string | null, until: string | null = null) =>
  workspacePOST(req("u-admin", "/api/admin/workspaces/wsA", "POST", { action: "plan", planId, until }), param("wsA"));

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
    INSERT INTO "Workspace" VALUES ('wsA', 'Brand Utama', 'utama');
    ${["a1", "a2"]
      .map(
        (a) => `INSERT INTO "Outlet" VALUES ('o-${a}', 'wsA', 'Cabang ${a}', true);
    INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "accessExpiresAt", scopes)
      VALUES ('${a}', 'wsA', 'akun_${a}', 'Akun ${a}', '2099-01-01', '{threads_content_publish}');
    INSERT INTO "SocialAccount" VALUES ('s-${a}', 'o-${a}', '${a}');`
      )
      .join("\n")}
    INSERT INTO "DashboardUser" (id, username, email, "passwordHash", "createdAt") VALUES
      ('u-admin', 'admin', 'admin@contoh.id', 'x', '2026-01-01'), ('u-biasa', 'biasa', 'biasa@contoh.id', 'x', '2026-02-01');
  `);
  for (const f of ["002_dashboard_post_log", "003_dashboard_rpc", "005_autopilot", "006_autopilot_radar", "007_autopilot_learning", "008_multiuser", "009_signup", "010_superadmin", "011_plans", "011_plans", "018_plan_labels", "018_plan_labels"]) {
    await db.exec(fs.readFileSync(path.join(REPO, `sql/${f}.sql`), "utf8"));
  }
});

describe("tanpa paket", () => {
  it("workspace tanpa paket dan tanpa paket bawaan tidak dibatasi; satu posting per hari kini diterima", async () => {
    const p = await json<{ plan: unknown; kedaluwarsa: boolean }>(await planGET(req("u-admin", "/api/workspace/plan")));
    expect(p).toMatchObject({ plan: null, kedaluwarsa: false });
    expect((await setAutopilot("a1", { mode: "OTOMATIS", postsPerDay: 6 })).status).toBe(200);
    expect((await setAutopilot("a2", { mode: "TINJAU", postsPerDay: 1 })).status).toBe(200);
    expect((await setAutopilot("a2", { postsPerDay: 0 })).status).toBe(400);
    expect((await json<{ items: unknown[] }>(await publicPlansGET())).items).toEqual([]);
  });
});

describe("mengelola paket", () => {
  it("hanya super admin yang boleh; masukan divalidasi", async () => {
    expect((await savePlan("u-biasa", plan())).status).toBe(403);
    expect((await adminPlansGET(req("u-biasa", "/api/admin/plans"))).status).toBe(403);
    expect((await savePlan("u-admin", plan({ id: "Kode Salah" }))).status).toBe(400);
    expect((await savePlan("u-admin", plan({ maxPostingPerHari: 9 }))).status).toBe(400);
    expect((await savePlan("u-admin", plan({ hargaBulanan: -1 }))).status).toBe(400);
    expect((await savePlan("u-admin", plan({ modeOtomatis: "ya" }))).status).toBe(400);
    expect(await rows(`SELECT count(*)::int AS n FROM "Plan"`)).toEqual([{ n: 0 }]);
  });

  it("paket tersimpan, bisa diubah, dan hanya yang aktif + publik tampil di halaman perkenalan", async () => {
    expect((await savePlan("u-admin", plan())).status).toBe(200);
    expect((await savePlan("u-admin", plan({ id: "pro", nama: "Pro", hargaBulanan: 349000, maxAkun: 10, maxPostingPerHari: 6, maxAnggota: 10, modeOtomatis: true, urutan: 2 }))).status).toBe(200);
    expect((await savePlan("u-admin", plan({ id: "internal", nama: "Internal", hargaBulanan: 0, maxAkun: 500, maxPostingPerHari: 6, maxAnggota: 500, modeOtomatis: true, publik: false, urutan: 9 }))).status).toBe(200);
    expect((await savePlan("u-admin", plan({ nama: "Hemat Sekali" }))).status).toBe(200);

    const pub = await json<{ items: { id: string; nama: string; hargaBulanan: number }[] }>(await publicPlansGET());
    expect(pub.items.map((p) => [p.id, p.nama, p.hargaBulanan])).toEqual([["hemat", "Hemat Sekali", 99000], ["pro", "Pro", 349000]]);
    const all = await json<{ installed: boolean; items: { id: string; dipakai: number; bawaan: boolean }[] }>(await adminPlansGET(req("u-admin", "/api/admin/plans")));
    expect(all.installed).toBe(true);
    expect(all.items.map((p) => p.id)).toEqual(["hemat", "pro", "internal"]);
  });
});

describe("batas paket ditegakkan di server", () => {
  it("paket bawaan berlaku untuk workspace tanpa paket sendiri: posting per hari, mode, dan jumlah akun", async () => {
    expect((await plansPOST(req("u-admin", "/api/admin/plans", "POST", { action: "default", id: "tidak-ada" }))).status).toBe(404);
    expect((await plansPOST(req("u-admin", "/api/admin/plans", "POST", { action: "default", id: "hemat" }))).status).toBe(200);

    const p = await json<{ plan: { id: string; maxAkun: number }; bawaan: boolean; pakai: { akun: number; anggota: number } }>(await planGET(req("u-admin", "/api/workspace/plan")));
    expect(p).toMatchObject({ plan: { id: "hemat", maxAkun: 1 }, bawaan: true, pakai: { akun: 2 } });
    // Batas di layar pengaturan autopilot ikut turun ke batas paket.
    expect((await json<{ limits: { maxPostsPerDay: number } }>(await overviewGET(req("u-admin", "/api/autopilot/overview")))).limits.maxPostsPerDay).toBe(2);

    const refused = async (account: string, body: Record<string, unknown>) => {
      const res = await setAutopilot(account, body);
      return [res.status, (await json<{ error?: string }>(res)).error ?? ""] as const;
    };
    expect(await refused("a1", { mode: "OTOMATIS", postsPerDay: 2 })).toEqual([403, expect.stringContaining("hanya mendukung mode Tinjau dulu")]);
    expect(await refused("a1", { mode: "TINJAU", postsPerDay: 3 })).toEqual([403, expect.stringContaining("paling banyak 2 posting")]);
    // Dua akun sudah menyala sebelum paket dipasang; menyalakan ulang salah satunya melebihi batas 1 akun.
    expect(await refused("a1", { mode: "TINJAU", postsPerDay: 2 })).toEqual([403, expect.stringContaining("autopilot di 1 akun")]);
    // Mematikan selalu boleh; setelah itu satu akun dalam batas diterima.
    expect((await setAutopilot("a2", { mode: "MATI" })).status).toBe(200);
    expect((await setAutopilot("a1", { mode: "TINJAU", postsPerDay: 2 })).status).toBe(200);
    expect(await rows(`SELECT "accountId", mode, "postsPerDay" FROM "AutopilotConfig" ORDER BY 1`)).toEqual([
      { accountId: "a1", mode: "TINJAU", postsPerDay: 2 },
      { accountId: "a2", mode: "MATI", postsPerDay: 1 },
    ]);
  });

  it("batas anggota tim menghitung undangan yang belum diterima", async () => {
    // Paket Hemat: 2 anggota. Sudah ada 2 (admin dan biasa, hasil pemasangan awal).
    const invite = (email: string) => teamPOST(req("u-admin", "/api/team", "POST", { email, role: "EDITOR" }));
    const res = await invite("ketiga@contoh.id");
    expect(res.status).toBe(403);
    expect((await json<{ error: string }>(res)).error).toContain("mengizinkan 2 anggota");
    expect(await rows(`SELECT count(*)::int AS n FROM "DashboardInvite"`)).toEqual([{ n: 0 }]);
  });

  it("paket khusus workspace mengalahkan paket bawaan dan tampil di daftar admin", async () => {
    expect((await assign("tidak-ada")).status).toBe(404);
    expect((await assign("pro")).status).toBe(200);
    expect((await setAutopilot("a1", { mode: "OTOMATIS", postsPerDay: 6 })).status).toBe(200);
    expect((await setAutopilot("a2", { mode: "OTOMATIS", postsPerDay: 4 })).status).toBe(200);
    expect((await teamPOST(req("u-admin", "/api/team", "POST", { email: "ketiga@contoh.id", role: "EDITOR" }))).status).toBe(201);
    const list = await json<{ items: { id: string; planId: string | null }[] }>(await workspacesGET(req("u-admin", "/api/admin/workspaces")));
    expect(list.items.find((w) => w.id === "wsA")?.planId).toBe("pro");
    // Paket yang masih dipakai tidak bisa dihapus.
    expect((await plansPOST(req("u-admin", "/api/admin/plans", "POST", { action: "delete", id: "pro" }))).status).toBe(409);
    expect((await plansPOST(req("u-admin", "/api/admin/plans", "POST", { action: "delete", id: "hemat" }))).status).toBe(409); // paket bawaan
    expect((await plansPOST(req("u-admin", "/api/admin/plans", "POST", { action: "delete", id: "internal" }))).status).toBe(200);
  });

  it("paket yang habis masa berlakunya menghentikan autopilot workspace itu sampai diperpanjang", async () => {
    expect((await assign("pro", new Date(clock + 3600_000).toISOString())).status).toBe(200);
    advance(2 * 3600);
    forgetPlans();
    const p = await json<{ kedaluwarsa: boolean }>(await planGET(req("u-admin", "/api/workspace/plan")));
    expect(p.kedaluwarsa).toBe(true);
    const res = await setAutopilot("a1", { mode: "OTOMATIS" });
    expect(res.status).toBe(403);
    expect((await json<{ error: string }>(res)).error).toContain("sudah habis");
    // Mematikan tetap boleh walau paket habis.
    expect((await setAutopilot("a2", { mode: "MATI" })).status).toBe(200);

    const tick = await runTick({ now: new Date(clock) });
    expect(tick.counts).toMatchObject({ paketHabis: 1 });
    expect(await rows(`SELECT count(*)::int AS n FROM "AutopilotSlot"`)).toEqual([{ n: 0 }]);

    // Diperpanjang tanpa batas waktu: tick berikutnya merencanakan lagi.
    expect((await assign("pro", null)).status).toBe(200);
    advance(360);
    const next = await runTick({ now: new Date(clock) });
    expect(next.counts.paketHabis).toBeUndefined();
    expect((await rows<{ n: number }>(`SELECT count(*)::int AS n FROM "AutopilotSlot" WHERE "accountId" = 'a1'`))[0].n).toBeGreaterThanOrEqual(1);
  });
});
