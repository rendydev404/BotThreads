/**
 * Postingan bergambar (sql/039 + sql/040): pengaturan per akun (validasi, nilai bawaan baris lama, simpan-baca
 * lewat store), kebijakan porsi gambar `imageAllowed`, dan penyapu berkas sementara yatim `runMediaCleanup` di
 * Postgres in-memory (storage.objects tiruan). Hapus berkas di-mock; SQL yang diuji persis berkas aslinya.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./helpers/pg";

const h = vi.hoisted(() => ({ db: null as unknown, deleted: [] as string[][], failDelete: false }));

vi.mock("@supabase/supabase-js", async () => {
  const { supabaseMock } = await import("./helpers/pg");
  return supabaseMock(() => h.db as TestDb);
});

vi.mock("../media-store", () => ({
  deleteMediaFiles: async (paths: string[]) => {
    if (h.failDelete) throw new Error("storage mati");
    h.deleted.push([...paths]);
    // Seperti Storage API: objeknya hilang dari storage.objects.
    await (h.db as TestDb).query(`DELETE FROM storage.objects WHERE bucket_id = 'threads-media' AND name = ANY($1)`, [paths]);
  },
}));

import { bootDb, pgRpc, useTestSupabaseEnv } from "./helpers/pg";
import { parseSettingsPatch } from "../autopilot-config";
import { loadState, upsertConfigs } from "../autopilot-store";
import { DEFAULT_SETTINGS } from "../autopilot-types";
import { runMediaCleanup } from "../media-cleanup";
import { clearMediaPolicyCache, imageAllowed, loadMediaPolicy, mediaShareAllows } from "../media-policy";

const REPO = path.resolve(__dirname, "../../..");
const NOW = new Date("2026-10-22T05:00:00Z");
const ts = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * 3_600_000).toISOString().replace("Z", "");

let db: TestDb;

beforeAll(async () => {
  useTestSupabaseEnv();
  db = await bootDb([
    "sql/002_dashboard_post_log.sql",
    "sql/003_dashboard_rpc.sql",
    "sql/005_autopilot.sql",
    "sql/006_autopilot_radar.sql",
    "sql/033_idea_preview.sql",
  ]);
  h.db = db;
  await db.exec(`
    INSERT INTO "Workspace" VALUES ('ws1', 'Brand', 'brand');
    INSERT INTO "Outlet" VALUES ('o1', 'ws1', 'Cabang 1', true), ('o2', 'ws1', 'Cabang 2', true), ('o3', 'ws1', 'Cabang 3', true);
    INSERT INTO "ThreadsAccount" (id, "workspaceId", username) VALUES ('a1', 'ws1', 'satu'), ('a2', 'ws1', 'dua'), ('a3', 'ws1', 'tiga');
    INSERT INTO "SocialAccount" VALUES ('s1', 'o1', 'a1'), ('s2', 'o2', 'a2'), ('s3', 'o3', 'a3');
  `);
  // Baris lama dibuat sebelum sql/039 dipasang (kolom gambar belum ada).
  await upsertConfigs([{ accountId: "a1", workspaceId: "ws1", ...DEFAULT_SETTINGS, mode: "TINJAU" }], "u1", NOW);
  await db.exec(fs.readFileSync(path.join(REPO, "sql/039_media_policy.sql"), "utf8"));
  // Idempoten.
  await db.exec(fs.readFileSync(path.join(REPO, "sql/039_media_policy.sql"), "utf8"));
  for (let i = 0; i < 2; i++) await db.exec(fs.readFileSync(path.join(REPO, "sql/040_media_tmp.sql"), "utf8"));
  // Tiruan kecil tabel Supabase Storage (PGlite tidak punya skema storage).
  await db.exec(`
    CREATE SCHEMA storage;
    CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text,
                                  created_at timestamptz DEFAULT now(), UNIQUE (bucket_id, name));
  `);
});

/* ------------------------------------------------------------------ data pembantu */

let seq = 0;
async function post(
  account: "a1" | "a2" | "a3",
  o: { at: number; media?: "IMAGE" | "CAROUSEL"; paths?: string[]; status?: string; dispatch?: string; source?: string; updatedAt?: number }
): Promise<string> {
  const id = `p${++seq}`;
  const s = account.replace("a", "s");
  const paths = o.paths ?? [];
  const arr = (list: string[]) => (list.length ? `ARRAY[${list.map((p) => `'${p}'`).join(",")}]::text[]` : `'{}'::text[]`);
  await db.exec(`
    INSERT INTO "ScheduledPost" (id, "workspaceId", caption, "mediaType", "mediaUrls", "mediaPaths", "tayangPada", status, source, "updatedAt")
    VALUES ('${id}', 'ws1', 'teks', '${o.media ?? "TEXT"}', ${arr(paths.map((p) => `https://cdn.uji/${p}`))}, ${arr(paths)},
            '${ts(o.at)}', '${o.status ?? "MENUNGGU"}', '${o.source ?? "DASHBOARD_AI"}', '${ts(o.updatedAt ?? o.at)}');
    INSERT INTO "PostDispatch" (id, "postId", "outletId", "socialAccountId", publisher, status)
    VALUES ('d-${id}', '${id}', 'o1', '${s}', 'THREADS', '${o.dispatch ?? "MENUNGGU"}');
  `);
  return id;
}

const one = async <T>(sql: string): Promise<T> => (await db.query<{ v: T }>(sql)).rows[0].v;

/* ------------------------------------------------------------------ pengaturan */

describe("pengaturan postingan bergambar", () => {
  const parse = (patch: unknown) => parseSettingsPatch(patch, DEFAULT_SETTINGS);

  it("bawaan OTOMATIS 30%; validasi mode dan persen", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ mediaMode: "OTOMATIS", mediaMaxPersen: 30 });
    expect(parse({ mediaMode: "MATI" })).toEqual({ ok: true, value: { ...DEFAULT_SETTINGS, mediaMode: "MATI" } });
    expect(parse({ mediaMaxPersen: 0 })).toMatchObject({ ok: true, value: { mediaMaxPersen: 0 } });
    expect(parse({ mediaMaxPersen: 100 })).toMatchObject({ ok: true, value: { mediaMaxPersen: 100 } });
    expect(parse({ mediaMaxPersen: 50 })).toMatchObject({ ok: true, value: { mediaMaxPersen: 50 } });
    expect(parse({ mediaMaxPersen: 101 })).toMatchObject({ ok: false });
    expect(parse({ mediaMaxPersen: -1 })).toMatchObject({ ok: false });
    expect(parse({ mediaMaxPersen: 12.5 })).toMatchObject({ ok: false });
    expect(parse({ mediaMaxPersen: "30" })).toMatchObject({ ok: false });
    expect(parse({ mediaMode: "TINJAU" })).toMatchObject({ ok: false });
  });

  it("baris lama mendapat nilai bawaan; simpan-baca lewat store; field yang tidak dikirim dipertahankan", async () => {
    let state = await loadState("ws1", "2026-10-22", "2026-10-22");
    expect(state.configs.get("a1")).toMatchObject({ mode: "TINJAU", mediaMode: "OTOMATIS", mediaMaxPersen: 30 });

    await upsertConfigs([{ accountId: "a1", workspaceId: "ws1", ...DEFAULT_SETTINGS, mode: "TINJAU", mediaMode: "MATI", mediaMaxPersen: 50 }], "u1", NOW);
    state = await loadState("ws1", "2026-10-22", "2026-10-22");
    expect(state.configs.get("a1")).toMatchObject({ mediaMode: "MATI", mediaMaxPersen: 50 });

    // Pemanggil lama (tanpa kolom gambar): nilai tersimpan tetap, baris baru memakai bawaan.
    const { mediaMode, mediaMaxPersen, ...legacy } = DEFAULT_SETTINGS;
    void mediaMode;
    void mediaMaxPersen;
    await pgRpc(db, "dash_ap_config_upsert", {
      p_items: [{ accountId: "a1", workspaceId: "ws1", ...legacy, mode: "TINJAU" }, { accountId: "a3", workspaceId: "ws1", ...legacy }],
      p_user: "u1",
      p_now: NOW,
    });
    state = await loadState("ws1", "2026-10-22", "2026-10-22");
    expect(state.configs.get("a1")).toMatchObject({ mediaMode: "MATI", mediaMaxPersen: 50 });
    expect(state.configs.get("a3")).toMatchObject({ mediaMode: "OTOMATIS", mediaMaxPersen: 30 });

    // CHECK di database menolak nilai di luar batas.
    await expect(
      upsertConfigs([{ accountId: "a3", workspaceId: "ws1", ...DEFAULT_SETTINGS, mediaMaxPersen: 101 }], "u1", NOW)
    ).rejects.toThrow(/mediaMaxPersen_check/);
  });
});

/* ------------------------------------------------------------------ kebijakan porsi */

describe("imageAllowed", () => {
  beforeEach(() => clearMediaPolicyCache());

  it("aturan murni: MATI/0% tidak pernah, tanpa posting boleh, di bawah batas boleh", () => {
    expect(mediaShareAllows({ mode: "MATI", maxPersen: 100, total: 0, gambar: 0 })).toBe(false);
    expect(mediaShareAllows({ mode: "OTOMATIS", maxPersen: 0, total: 0, gambar: 0 })).toBe(false);
    expect(mediaShareAllows({ mode: "OTOMATIS", maxPersen: 30, total: 0, gambar: 0 })).toBe(true);
    expect(mediaShareAllows({ mode: "OTOMATIS", maxPersen: 30, total: 10, gambar: 2 })).toBe(true);
    expect(mediaShareAllows({ mode: "OTOMATIS", maxPersen: 30, total: 10, gambar: 3 })).toBe(false);
  });

  it("menghitung posting dashboard akun 7 hari terakhir + yang akan datang", async () => {
    // a2: belum punya konfigurasi -> bawaan OTOMATIS 30%.
    expect(await imageAllowed("a2", NOW)).toBe(true);

    await post("a2", { at: -24, media: "IMAGE", dispatch: "TERBIT", status: "SELESAI" });
    await post("a2", { at: -48, dispatch: "TERBIT", status: "SELESAI" });
    await post("a2", { at: 5 });
    await post("a2", { at: 30 });
    // Tidak dihitung: lebih dari 7 hari lalu, dispatch GAGAL, bukan posting dashboard.
    await post("a2", { at: -24 * 8, media: "CAROUSEL", dispatch: "TERBIT", status: "SELESAI" });
    await post("a2", { at: -10, media: "IMAGE", dispatch: "GAGAL", status: "GAGAL" });
    await post("a2", { at: -10, media: "IMAGE", source: "AUTO_SUKA" });

    expect(await loadMediaPolicy("a2", NOW)).toEqual({ mode: "OTOMATIS", maxPersen: 30, total: 4, gambar: 1 });
    // Hasil di-cache 60 detik: tetap "boleh" dari bacaan pertama.
    expect(await imageAllowed("a2", NOW)).toBe(true);
    clearMediaPolicyCache("a2");
    expect(await imageAllowed("a2", NOW)).toBe(true); // 25% < 30%

    await post("a2", { at: 10, media: "CAROUSEL" }); // 2/5 = 40%
    expect(await imageAllowed("a2", new Date(NOW.getTime() + 30_000))).toBe(true); // masih cache
    expect(await imageAllowed("a2", new Date(NOW.getTime() + 61_000))).toBe(false);

    await upsertConfigs([{ accountId: "a2", workspaceId: "ws1", ...DEFAULT_SETTINGS, mediaMaxPersen: 50 }], "u1", NOW);
    clearMediaPolicyCache();
    expect(await imageAllowed("a2", NOW)).toBe(true); // 40% < 50%

    await upsertConfigs([{ accountId: "a2", workspaceId: "ws1", ...DEFAULT_SETTINGS, mediaMode: "MATI", mediaMaxPersen: 100 }], "u1", NOW);
    clearMediaPolicyCache();
    expect(await imageAllowed("a2", NOW)).toBe(false);
  });
});

/* ------------------------------------------------------------------ pembersihan */

describe("runMediaCleanup: sapu berkas sementara yatim (sql/040)", () => {
  /** Berkas di storage.objects tiruan; umur dalam jam relatif terhadap NOW. */
  const object = (name: string, ageHours: number, bucket = "threads-media") =>
    db.query(`INSERT INTO storage.objects (bucket_id, name, created_at) VALUES ($1, $2, $3)`, [
      bucket,
      name,
      new Date(NOW.getTime() - ageHours * 3_600_000).toISOString(),
    ]);
  const names = async () =>
    (await db.query<{ name: string }>(`SELECT bucket_id || ':' || name AS name FROM storage.objects ORDER BY 1`)).rows.map((r) => r.name);

  beforeEach(async () => {
    h.deleted = [];
    h.failDelete = false;
    await db.exec(`DELETE FROM "PostDispatch"; DELETE FROM "ScheduledPost"; DELETE FROM storage.objects;`);
  });

  it("menghapus berkas tmp > 2 jam yang tidak dipegang posting yang masih diterbitkan", async () => {
    const menunggu = await post("a3", { at: -1, media: "IMAGE" });
    const terbit = await post("a3", { at: -3, media: "IMAGE", status: "SELESAI", dispatch: "TERBIT" });
    const sebagian = await post("a3", { at: -1, media: "CAROUSEL" });
    await db.exec(`
      UPDATE "ScheduledPost" SET "mediaPaths" = ARRAY['tmp/${menunggu}/0.jpg'] WHERE id = '${menunggu}';
      UPDATE "ScheduledPost" SET "mediaPaths" = ARRAY['tmp/${sebagian}/0.jpg'] WHERE id = '${sebagian}';
    `);
    await object(`tmp/${menunggu}/0.jpg`, 3); // masih diterbitkan: tetap
    await object(`tmp/${terbit}/0.jpg`, 3); // sudah terbit (hapus langsung gagal): disapu
    await object(`tmp/${sebagian}/0.jpg`, 3); // tercatat: tetap
    await object(`tmp/${sebagian}/1.jpg`, 3); // tidak tercatat: disapu
    await object("tmp/posting-terhapus/0.jpg", 5); // posting dibatalkan/terhapus: disapu
    await object("tmp/baru/0.jpg", 1); // belum 2 jam: tetap
    await object("ws1/ideas/i1/k0.jpg", 100); // bukan berkas sementara: tidak disentuh
    await object("tmp/x/0.jpg", 100, "bucket-lain"); // bucket lain: tidak disentuh

    const counts: Record<string, number> = {};
    await runMediaCleanup(NOW, counts, Date.now() + 10_000);
    expect(h.deleted.flat().sort()).toEqual(["tmp/posting-terhapus/0.jpg", `tmp/${sebagian}/1.jpg`, `tmp/${terbit}/0.jpg`].sort());
    expect(counts.mediaDihapus).toBe(3);
    expect(await names()).toEqual(
      [
        `threads-media:tmp/${menunggu}/0.jpg`,
        `threads-media:tmp/${sebagian}/0.jpg`,
        "threads-media:tmp/baru/0.jpg",
        "threads-media:ws1/ideas/i1/k0.jpg",
        "bucket-lain:tmp/x/0.jpg",
      ].sort()
    );

    // Putaran berikutnya tidak ada pekerjaan lagi.
    h.deleted = [];
    await runMediaCleanup(NOW, counts, Date.now() + 10_000);
    expect(h.deleted).toEqual([]);
    expect(counts.mediaDihapus).toBe(3);
  });

  it("paling banyak 50 per putaran, yang tertua dulu; batas waktu dihormati; galat storage tidak dilempar", async () => {
    for (let i = 0; i < 60; i++) await object(`tmp/p${i}/0.jpg`, 3 + i / 10);
    const counts: Record<string, number> = {};

    await runMediaCleanup(NOW, counts, Date.now() - 1);
    expect(h.deleted).toEqual([]);

    h.failDelete = true;
    await expect(runMediaCleanup(NOW, counts, Date.now() + 10_000)).resolves.toBeUndefined();
    expect(counts.mediaGalat).toBe(1);
    expect(counts.mediaDihapus).toBeUndefined();
    expect(await names()).toHaveLength(60);

    h.failDelete = false;
    await runMediaCleanup(NOW, counts, Date.now() + 10_000);
    expect(h.deleted).toHaveLength(1);
    expect(h.deleted[0]).toHaveLength(50);
    expect(h.deleted[0][0]).toBe("tmp/p59/0.jpg"); // tertua
    expect(counts.mediaDihapus).toBe(50);
    await runMediaCleanup(NOW, counts, Date.now() + 10_000);
    expect(counts.mediaDihapus).toBe(60);
    expect(await names()).toEqual([]);
  });

  it("tanpa skema storage (uji/PGlite): kosong; pembersihan lama sql/039 dan indeksnya sudah dibuang", async () => {
    const fresh = await bootDb([]);
    await fresh.exec(`SET check_function_bodies = off`);
    const sql = fs.readFileSync(path.join(REPO, "sql/040_media_tmp.sql"), "utf8");
    await fresh.exec(sql);
    await fresh.exec(sql);
    expect(await pgRpc(fresh, "dash_media_tmp_orphans", { p_before: NOW, p_limit: 50 })).toEqual([]);

    const left = await one<number>(
      `SELECT count(*)::int AS v FROM pg_proc WHERE proname IN ('dash_media_cleanup_claim', 'dash_media_cleanup_done', 'dash_media_path_free')`
    );
    expect(left).toBe(0);
    const idx = await one<number>(
      `SELECT count(*)::int AS v FROM pg_indexes WHERE indexname IN ('ContentIdea_media_idx', 'ScheduledPost_dash_media_idx')`
    );
    expect(idx).toBe(0);
  });
});
