import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootDb, pgClient, pgRpc, useTestSupabaseEnv, type TestDb } from "./helpers/pg";

let pg: TestDb;
const storage = vi.hoisted(() => ({
  objects: new Map<string, { body: Buffer; opts: Record<string, unknown> }>(),
  removed: [] as string[][],
  fail: null as string | null,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => pgClient(() => pg).rpc(fn, args),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: Buffer, opts: Record<string, unknown>) => {
          if (storage.fail) return { data: null, error: { message: storage.fail } };
          storage.objects.set(`${bucket}/${path}`, { body, opts });
          return { data: { path }, error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
        remove: async (paths: string[]) => {
          storage.removed.push(paths);
          if (storage.fail) return { data: null, error: { message: storage.fail } };
          for (const p of paths) storage.objects.delete(`${bucket}/${p}`);
          return { data: [], error: null };
        },
      }),
    },
  }),
}));

import { deleteMediaFiles, mediaUsedKeys, rememberMediaUse, uploadMediaImage } from "../media-store";

const T0 = new Date("2026-10-01T10:00:00Z");
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);

beforeAll(async () => {
  useTestSupabaseEnv();
  pg = await bootDb(["sql/037_media_use.sql"]);
});

beforeEach(async () => {
  await pg.exec(`DELETE FROM "MediaUse"`);
  storage.objects.clear();
  storage.removed = [];
  storage.fail = null;
});

describe("sql/037 MediaUse", () => {
  it("idempoten dan RLS aktif", async () => {
    const again = await bootDb(["sql/037_media_use.sql", "sql/037_media_use.sql"]);
    const rls = await again.query<{ relrowsecurity: boolean }>(`SELECT relrowsecurity FROM pg_class WHERE relname = 'MediaUse'`);
    expect(rls.rows[0].relrowsecurity).toBe(true);
  });

  it("remember meng-upsert usedAt; used hanya kunci akun itu sejak batas waktu", async () => {
    await pgRpc(pg, "dash_media_remember", { p_account: "a1", p_keys: ["k1", "k2", "k2", ""], p_now: T0 });
    await pgRpc(pg, "dash_media_remember", { p_account: "a2", p_keys: ["k3"], p_now: T0 });
    await pgRpc(pg, "dash_media_remember", { p_account: "a1", p_keys: ["k1"], p_now: day(20) });
    const rows = await pg.query<{ imageKey: string }>(`SELECT "imageKey" FROM "MediaUse" WHERE "accountId" = 'a1' ORDER BY 1`);
    expect(rows.rows.map((r) => r.imageKey)).toEqual(["k1", "k2"]);

    expect(await pgRpc(pg, "dash_media_used", { p_account: "a1", p_keys: ["k1", "k2", "k3"], p_since: day(-30) })).toEqual(["k1", "k2"]);
    // k2 dipakai 25 hari sebelum batas; k1 diperbarui pada hari ke-20.
    expect(await pgRpc(pg, "dash_media_used", { p_account: "a1", p_keys: ["k1", "k2"], p_since: day(5) })).toEqual(["k1"]);
    expect(await pgRpc(pg, "dash_media_used", { p_account: "a1", p_keys: ["zz"], p_since: day(-30) })).toEqual([]);
  });

  it("catatan lebih tua dari 90 hari dibuang saat akun yang sama mencatat lagi", async () => {
    await pgRpc(pg, "dash_media_remember", { p_account: "a1", p_keys: ["lama"], p_now: day(-100) });
    await pgRpc(pg, "dash_media_remember", { p_account: "a2", p_keys: ["lama"], p_now: day(-100) });
    await pgRpc(pg, "dash_media_remember", { p_account: "a1", p_keys: ["baru"], p_now: T0 });
    const rows = await pg.query<{ k: string }>(`SELECT "accountId" || ':' || "imageKey" AS k FROM "MediaUse" ORDER BY 1`);
    expect(rows.rows.map((r) => r.k)).toEqual(["a1:baru", "a2:lama"]);
  });

  it("pencarian memakai kunci utama (accountId, imageKey)", async () => {
    const idx = await pg.query<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE tablename = 'MediaUse'`);
    expect(idx.rows.map((r) => r.indexdef).join(" ")).toMatch(/\("accountId", "imageKey"\)/);
  });
});

describe("media-store", () => {
  it("mediaUsedKeys / rememberMediaUse lewat RPC", async () => {
    expect(await mediaUsedKeys("a1", [], T0)).toEqual(new Set());
    await rememberMediaUse("a1", ["k1", "k1"], T0);
    expect(await mediaUsedKeys("a1", ["k1", "k9"], day(-1))).toEqual(new Set(["k1"]));
  });

  it("unggah JPEG ke bucket threads-media dan kembalikan URL publik", async () => {
    const url = await uploadMediaImage("ws/ideas/i1/abc.jpg", Buffer.from([1, 2, 3]));
    expect(url).toBe("https://proj.supabase.co/storage/v1/object/public/threads-media/ws/ideas/i1/abc.jpg");
    expect(storage.objects.get("threads-media/ws/ideas/i1/abc.jpg")?.opts).toMatchObject({ contentType: "image/jpeg", upsert: true });
    storage.fail = "Bucket not writable";
    await expect(uploadMediaImage("x.jpg", Buffer.from([1]))).rejects.toThrow("Storage: Bucket not writable");
  });

  it("hapus berkas per 1.000, kembar dibuang, 'not found' diabaikan", async () => {
    const paths = Array.from({ length: 1500 }, (_, i) => `p/${i}.jpg`);
    await deleteMediaFiles([...paths, "p/0.jpg", ""]);
    expect(storage.removed.map((c) => c.length)).toEqual([1000, 500]);
    await deleteMediaFiles([]);
    expect(storage.removed).toHaveLength(2);
    storage.fail = "Object not found";
    await expect(deleteMediaFiles(["a.jpg"])).resolves.toBeUndefined();
    storage.fail = "permission denied";
    await expect(deleteMediaFiles(["a.jpg"])).rejects.toThrow("permission denied");
  });
});
