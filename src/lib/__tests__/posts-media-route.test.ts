/**
 * GET /api/posts/media: gambar riwayat postingan diambil dari Threads API (bukan penyimpanan kita).
 * Route asli + withCtx asli + SQL multi-user asli di Postgres in-memory; yang di-mock hanya transport
 * database, pembacaan cookie sesi, dan fetch ke graph.threads.net.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./helpers/pg";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@supabase/supabase-js", async () => {
  const { pgClient } = await import("./helpers/pg");
  return {
    createClient: () =>
      pgClient(() => h.db as TestDb, {
        ThreadsAccount: `SELECT id, username, "workspaceId", "accessToken", "needsReconnect",
                                to_char("accessExpiresAt", 'YYYY-MM-DD"T"HH24:MI:SS') AS "accessExpiresAt"
                         FROM "ThreadsAccount" ORDER BY id`,
        ThreadsPostStat: `SELECT "mediaId", "mediaType", "threadsAccountId" FROM "ThreadsPostStat" ORDER BY "mediaId"`,
      }),
  };
});

// Sesi tiruan: nilai cookie `session` langsung menjadi id pengguna.
vi.mock("@/lib/users", async (original) => ({
  ...(await original<typeof import("@/lib/users")>()),
  getSessionUserId: async (cookie: string | undefined) => cookie || null,
}));

import { NextRequest } from "next/server";
import { bootDb } from "./helpers/pg";
import { forgetMembership } from "../request-ctx";
import { encryptThreadsToken } from "../threads-token";
import { GET } from "@/app/api/posts/media/route";

let db: TestDb;
const REPO = path.resolve(__dirname, "../../..");

type Media = Record<string, { type: string; images: { url: string; isVideo: boolean }[] }>;

const req = (user: string | null, ids: string[]) =>
  new NextRequest(`http://localhost/api/posts/media?ids=${ids.join(",")}`, {
    headers: user ? { cookie: `session=${user}` } : {},
  });

/** Graph API tiruan: jawaban per mediaId, mencatat panggilan dan jumlah panggilan serentak tertinggi. */
const graph = {
  calls: [] as { id: string; token: string }[],
  active: 0,
  peak: 0,
  fail: new Set<string>(),
};

function mockThreads(delayMs = 0) {
  graph.calls = [];
  graph.active = 0;
  graph.peak = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://graph.threads.net");
      expect(url.searchParams.get("fields")).toBe("media_type,media_url,thumbnail_url,children{media_type,media_url,thumbnail_url}");
      const id = url.pathname.split("/").pop() as string;
      graph.calls.push({ id, token: url.searchParams.get("access_token") ?? "" });
      graph.active++;
      graph.peak = Math.max(graph.peak, graph.active);
      try {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        if (graph.fail.has(id)) return Response.json({ error: { message: "Unsupported get request", code: 100 } }, { status: 400 });
        if (id.startsWith("car")) {
          return Response.json({
            id,
            media_type: "CAROUSEL_ALBUM",
            children: {
              data: [
                { media_type: "IMAGE", media_url: `https://cdn.threads.test/${id}-1.jpg` },
                { media_type: "VIDEO", media_url: `https://cdn.threads.test/${id}-2.mp4`, thumbnail_url: `https://cdn.threads.test/${id}-2.jpg` },
              ],
            },
          });
        }
        if (id.startsWith("vid")) {
          return Response.json({ id, media_type: "VIDEO", media_url: `https://cdn.threads.test/${id}.mp4`, thumbnail_url: `https://cdn.threads.test/${id}.jpg` });
        }
        return Response.json({ id, media_type: "IMAGE", media_url: `https://cdn.threads.test/${id}.jpg` });
      } finally {
        graph.active--;
      }
    })
  );
}

const json = async (res: Response) => (await res.json()) as { success: boolean; media?: Media; error?: string };

beforeAll(async () => {
  process.env.AUTH_SECRET = "uji-rahasia-yang-panjangnya-lebih-dari-32-karakter";
  process.env.SUPABASE_URL = "http://uji.lokal";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "kunci-uji";
  process.env.TOKEN_ENCRYPTION_KEY = "kunci-enkripsi-token-uji";
  delete process.env.EXCLUDED_THREADS_ACCOUNTS;

  db = await bootDb([
    "sql/002_dashboard_post_log.sql",
    "sql/003_dashboard_rpc.sql",
    "sql/005_autopilot.sql",
    "sql/006_autopilot_radar.sql",
    "sql/007_autopilot_learning.sql",
  ]);
  h.db = db;

  const tok = (s: string) => encryptThreadsToken(s);
  await db.exec(`INSERT INTO "Workspace" VALUES ('ws1', 'Brand Satu', 'brand-satu'), ('ws2', 'Brand Dua', 'brand-dua')`);
  // a4: token sudah kedaluwarsa (harus dilewati tanpa memanggil Threads).
  for (const [id, ws, expires] of [
    ["a1", "ws1", "2099-01-01"],
    ["a2", "ws1", "2099-01-01"],
    ["a3", "ws2", "2099-01-01"],
    ["a4", "ws1", "2000-01-01"],
  ]) {
    await db.query(
      `INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "accessExpiresAt", "accessToken")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, ws, `akun_${id}`, `Akun ${id}`, expires, tok(`token-${id}`)]
    );
  }
  await db.exec(fs.readFileSync(path.join(REPO, "sql/008_multiuser.sql"), "utf8"));
  await db.exec(`
    INSERT INTO "DashboardUser" (id, username, email, "passwordHash") VALUES
      ('u-owner', 'owner', 'owner@contoh.id', 'x'), ('u-editor', 'editor', 'editor@contoh.id', 'x'),
      ('u-lain', 'lain', 'lain@contoh.id', 'x');
    DELETE FROM "DashboardMembership";
    INSERT INTO "DashboardMembership" ("userId", "workspaceId", role, "accountScope") VALUES
      ('u-owner', 'ws1', 'OWNER', 'SEMUA'), ('u-editor', 'ws1', 'EDITOR', 'PILIHAN'), ('u-lain', 'ws2', 'OWNER', 'SEMUA');
    INSERT INTO "DashboardMemberAccount" VALUES ('u-editor', 'ws1', 'a2');
  `);
  forgetMembership();

  const stats: [string, string, string][] = [
    ["img1", "a1", "IMAGE"],
    ["img2", "a2", "IMAGE"],
    ["img3", "a3", "IMAGE"],
    ["car1", "a1", "CAROUSEL_ALBUM"],
    ["vid1", "a1", "VIDEO"],
    ["txt1", "a1", "TEXT_POST"],
    ["imgfail", "a1", "IMAGE"],
    ["imgok", "a1", "IMAGE"],
    ["imgexp", "a4", "IMAGE"],
    ["imgcache", "a1", "IMAGE"],
    ...Array.from({ length: 12 }, (_, i) => [`imgb${i}`, "a1", "IMAGE"] as [string, string, string]),
  ];
  for (const [mediaId, acc, type] of stats) {
    await db.query(`INSERT INTO "ThreadsPostStat" ("mediaId", "threadsAccountId", "mediaType") VALUES ($1, $2, $3)`, [mediaId, acc, type]);
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  graph.fail.clear();
});

describe("GET /api/posts/media", () => {
  it("menolak tanpa sesi dan memvalidasi id", async () => {
    mockThreads();
    expect((await GET(req(null, ["img1"]))).status).toBe(401);
    expect((await GET(req("u-owner", ["../x"]))).status).toBe(400);
    expect((await GET(req("u-owner", Array.from({ length: 26 }, (_, i) => `m${i}`)))).status).toBe(400);
    const empty = await GET(req("u-owner", []));
    expect(await json(empty)).toEqual({ success: true, media: {} });
    expect(graph.calls).toHaveLength(0);
  });

  it("hanya mediaId milik akun dalam lingkup pengguna; postingan teks tidak memanggil Threads", async () => {
    mockThreads();
    const res = await GET(req("u-owner", ["img1", "img2", "img3", "car1", "vid1", "txt1", "tidakada"]));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("private");
    const { media } = await json(res);
    expect(Object.keys(media ?? {}).sort()).toEqual(["car1", "img1", "img2", "vid1"]);
    expect(media?.img1).toEqual({ type: "IMAGE", images: [{ url: "https://cdn.threads.test/img1.jpg", isVideo: false }] });
    expect(media?.car1).toEqual({
      type: "CAROUSEL_ALBUM",
      images: [
        { url: "https://cdn.threads.test/car1-1.jpg", isVideo: false },
        { url: "https://cdn.threads.test/car1-2.jpg", isVideo: true },
      ],
    });
    // Video memakai thumbnail, bukan berkas videonya.
    expect(media?.vid1).toEqual({ type: "VIDEO", images: [{ url: "https://cdn.threads.test/vid1.jpg", isVideo: true }] });
    // Akun ws2 (img3) dan postingan teks tidak pernah ditanyakan ke Threads; token sesuai akun pemiliknya.
    expect(graph.calls.map((c) => c.id).sort()).toEqual(["car1", "img1", "img2", "vid1"]);
    expect(graph.calls.find((c) => c.id === "img2")?.token).toBe("token-a2");

    // Editor dengan lingkup akun a2 saja; pengguna workspace lain hanya melihat a3.
    expect(Object.keys((await json(await GET(req("u-editor", ["img1", "img2"])))).media ?? {})).toEqual(["img2"]);
    expect(Object.keys((await json(await GET(req("u-lain", ["img1", "img3"])))).media ?? {})).toEqual(["img3"]);
  });

  it("galat per id dibuang (bukan 500); token kedaluwarsa dilewati tanpa memanggil Threads", async () => {
    mockThreads();
    graph.fail.add("imgfail");
    const res = await GET(req("u-owner", ["imgfail", "imgok", "imgexp"]));
    expect(res.status).toBe(200);
    expect(Object.keys((await json(res)).media ?? {})).toEqual(["imgok"]);
    expect(graph.calls.map((c) => c.id).sort()).toEqual(["imgfail", "imgok"]);
  });

  it("hasil di-cache per mediaId: permintaan berikutnya tidak memanggil Threads lagi", async () => {
    mockThreads();
    const first = await json(await GET(req("u-owner", ["imgcache"])));
    expect(graph.calls).toHaveLength(1);
    const second = await json(await GET(req("u-owner", ["imgcache"])));
    expect(graph.calls).toHaveLength(1);
    expect(second.media).toEqual(first.media);
    // Cache tidak melewati lingkup: pengguna lain tetap tidak mendapat entri yang sudah tersimpan.
    expect((await json(await GET(req("u-lain", ["imgcache"])))).media).toEqual({});
  });

  it("satu permintaan gabungan, paling banyak 5 panggilan Threads serentak", async () => {
    mockThreads(20);
    const ids = Array.from({ length: 12 }, (_, i) => `imgb${i}`);
    const { media } = await json(await GET(req("u-owner", ids)));
    expect(Object.keys(media ?? {})).toHaveLength(12);
    expect(graph.calls).toHaveLength(12);
    expect(graph.peak).toBeLessThanOrEqual(5);
    expect(graph.peak).toBeGreaterThan(1);
  });
});
