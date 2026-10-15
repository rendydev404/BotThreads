/**
 * Masuk/daftar dengan Google sampai akun + workspace baru terbuat (route callback asli + SQL asli).
 * Regresi: di produksi "DashboardUser".id tidak punya default database (tabel dibuat Prisma), dan
 * pendaftaran gagal dengan 23502 "null value in column id". Harness meniru tabel itu apa adanya.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./helpers/pg";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@supabase/supabase-js", async () => (await import("./helpers/pg")).supabaseMock(() => h.db as TestDb));

import { NextRequest } from "next/server";
import { bootDb, useTestSupabaseEnv } from "./helpers/pg";
import { OAUTH_COOKIE, encodeOauthCookie, newOauthState } from "../google-oauth";
import { GET as callbackGET } from "@/app/api/auth/google/callback/route";

let db: TestDb;
const REPO = path.resolve(__dirname, "../../..");
const rows = async <T>(sql: string): Promise<T[]> => (await db.query<T>(sql)).rows;

/** Google tiruan: token + userinfo untuk akun yang sedang "login". */
let googleUser = { sub: "g-111", email: "Owner@SS.com", email_verified: true, name: "Owner SS" };
function fakeFetch(input: string | URL | Request): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const reply = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  if (url.startsWith("https://oauth2.googleapis.com/token")) return reply({ access_token: "akses-uji" });
  if (url.startsWith("https://openidconnect.googleapis.com/v1/userinfo")) return reply(googleUser);
  return Promise.resolve(new Response("{}", { status: 404 }));
}

let ip = 0;
function callback() {
  const state = newOauthState("/", null, true);
  return callbackGET(
    new NextRequest(`http://localhost:3001/api/auth/google/callback?code=kode-uji&state=${state.state}`, {
      headers: { cookie: `${OAUTH_COOKIE}=${encodeOauthCookie(state)}`, "x-forwarded-for": `10.1.0.${++ip}` },
    })
  );
}

beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  useTestSupabaseEnv();
  process.env.AUTH_SECRET = "uji-rahasia-yang-panjangnya-lebih-dari-32-karakter";
  process.env.GOOGLE_CLIENT_ID = "klien-uji.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "rahasia-uji";
  process.env.SIGNUP_ENABLED = "true";
  delete process.env.APP_URL;
  db = await bootDb([]);
  h.db = db;
  await db.exec(`INSERT INTO "DashboardUser" (id, username, email, "passwordHash") VALUES ('u-lama', 'lama', 'lama@contoh.id', 'x');`);
  for (const f of ["002_dashboard_post_log", "003_dashboard_rpc", "005_autopilot", "006_autopilot_radar", "007_autopilot_learning", "008_multiuser", "009_signup", "010_superadmin"]) {
    await db.exec(fs.readFileSync(path.join(REPO, `sql/${f}.sql`), "utf8"));
  }
});

afterAll(() => {
  vi.unstubAllGlobals();
  for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SIGNUP_ENABLED"]) delete process.env[k];
});

describe("daftar dengan Google", () => {
  it("email baru ➜ akun + workspace baru dibuat, Google tertaut, sesi dipasang", async () => {
    const res = await callback();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3001/");
    expect(res.headers.get("set-cookie")).toMatch(/session=/);

    const [u] = await rows<{ id: string; email: string; googleSub: string; lastWorkspaceId: string }>(
      `SELECT id, email, "googleSub", "lastWorkspaceId" FROM "DashboardUser" WHERE email = 'owner@ss.com'`
    );
    expect(u.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(u.googleSub).toBe("g-111");
    const member = await rows<{ role: string }>(
      `SELECT role FROM "DashboardMembership" WHERE "userId" = '${u.id}' AND "workspaceId" = '${u.lastWorkspaceId}'`
    );
    expect(member).toEqual([{ role: "OWNER" }]);
  });

  it("login Google berikutnya masuk ke akun yang sama tanpa membuat akun baru", async () => {
    const res = await callback();
    expect(res.headers.get("location")).toBe("http://localhost:3001/");
    expect(await rows(`SELECT count(*)::int AS n FROM "DashboardUser" WHERE email = 'owner@ss.com'`)).toEqual([{ n: 1 }]);
  });

  it("email yang sudah punya akun (daftar biasa) ditautkan, bukan diduplikasi", async () => {
    googleUser = { sub: "g-222", email: "lama@contoh.id", email_verified: true, name: "Lama" };
    const res = await callback();
    expect(res.headers.get("location")).toBe("http://localhost:3001/");
    expect(await rows(`SELECT "googleSub" FROM "DashboardUser" WHERE id = 'u-lama'`)).toEqual([{ googleSub: "g-222" }]);
  });
});

describe("sql/013 untuk basis data produksi", () => {
  it("fungsi lama yang menyisipkan pengguna tanpa id langsung bekerja setelah default dipasang", async () => {
    const oldInsert = `INSERT INTO "DashboardUser" (username, email, "passwordHash", "isActive", "updatedAt")
                       VALUES ('tanpa_id', 'tanpa-id@contoh.id', 'x', true, now())`;
    await expect(db.exec(oldInsert)).rejects.toThrow(/null value in column "id"/);
    await db.exec(fs.readFileSync(path.join(REPO, "sql/013_fix_dashboard_user_id.sql"), "utf8"));
    await db.exec(fs.readFileSync(path.join(REPO, "sql/013_fix_dashboard_user_id.sql"), "utf8"));
    await db.exec(oldInsert);
    expect(await rows(`SELECT count(*)::int AS n FROM "DashboardUser" WHERE username = 'tanpa_id'`)).toEqual([{ n: 1 }]);
  });
});
