/**
 * Penerbit Threads dashboard (src/lib/threads-publisher.ts + sql/022, 036, 040): SQL asli di Postgres
 * in-memory, API Threads dan gambar sumber tiruan lewat `fetch`, storage tiruan. Memastikan antrean terbit
 * tepat sekali, postingan basi dan non-dashboard tidak disentuh, galat token menandai akun untuk dihubungkan
 * ulang, dan gambar hanya diunggah sementara selama posting lalu dihapus.
 */
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./helpers/pg";

const h = vi.hoisted(() => ({
  db: null as unknown,
  /** Storage tiruan: path -> ukuran JPEG yang diunggah. */
  files: new Map<string, { width: number; bytes: number }>(),
  uploads: [] as string[],
  deletes: [] as string[][],
  failDelete: false,
  failUpload: false,
}));
vi.mock("@supabase/supabase-js", async () => (await import("./helpers/pg")).supabaseMock(() => h.db as TestDb));
vi.mock("../media-store", async (orig) => ({
  ...(await orig<typeof import("../media-store")>()),
  uploadMediaImage: async (path: string, jpeg: Buffer) => {
    if (h.failUpload) throw new Error("Storage: penuh");
    const meta = await sharp(jpeg).metadata();
    h.files.set(path, { width: meta.width ?? 0, bytes: jpeg.length });
    h.uploads.push(path);
    return `https://storage.uji/threads-media/${path}`;
  },
  deleteMediaFiles: async (paths: string[]) => {
    h.deletes.push([...paths]);
    if (h.failDelete) throw new Error("Storage: mati");
    for (const p of paths) h.files.delete(p);
  },
}));

import { bootDb, pgRpc, useTestSupabaseEnv } from "./helpers/pg";
import { encryptThreadsToken } from "../threads-token";
import { postText, runPublisher, withoutCredit } from "../threads-publisher";

let db: TestDb;
const NOW = new Date("2026-10-19T02:00:00Z");
const ts = (offsetMin: number) => new Date(NOW.getTime() + offsetMin * 60_000).toISOString().replace("Z", "");
const rows = async <T>(sql: string): Promise<T[]> => (await db.query<T>(sql)).rows;

/** API Threads tiruan: mencatat panggilan; status container diatur per uji. */
const api = {
  calls: [] as { url: string; body: string }[],
  status: "FINISHED",
  failCreate: null as null | { status: number; code: number },
  /** Gagalkan pembuatan container tertentu (galat sementara 500), mis. item carousel kedua. */
  failWhen: null as null | ((form: URLSearchParams, n: number) => boolean),
};
/** Gambar sumber tiruan (https://img.uji/...): "hilang" = 404, selain itu JPEG 1600x1000. */
let sourceJpeg: Buffer;
const imageFetches: string[] = [];
function fakeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url.startsWith("https://img.uji/")) {
    imageFetches.push(url);
    return Promise.resolve(
      url.includes("hilang")
        ? new Response("tidak ada", { status: 404 })
        : new Response(new Uint8Array(sourceJpeg), { headers: { "content-type": "image/jpeg" } })
    );
  }
  const body = init?.body ? String(init.body) : "";
  api.calls.push({ url, body });
  const json = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status }));
  if (url.endsWith("/threads") && init?.method === "POST") {
    if (api.failCreate) return json({ error: { message: "Token tidak berlaku", code: api.failCreate.code } }, api.failCreate.status);
    if (api.failWhen?.(new URLSearchParams(body), creates().length)) return json({ error: { message: "Galat server", code: 2 } }, 500);
    return json({ id: `c-${api.calls.length}` });
  }
  if (url.endsWith("/threads_publish")) return json({ id: `m-${new URLSearchParams(body).get("creation_id")}` });
  if (url.includes("fields=status")) return json({ status: api.status });
  if (url.includes("fields=permalink")) return json({ permalink: "https://www.threads.net/@akun/post/abc" });
  return json({ error: { message: "tak dikenal" } }, 404);
}

beforeAll(async () => {
  useTestSupabaseEnv();
  process.env.TOKEN_ENCRYPTION_KEY = "kunci-uji-penerbit";
  db = await bootDb(["sql/002_dashboard_post_log.sql", "sql/003_dashboard_rpc.sql"]);
  h.db = db;
  await db.exec(`
    ALTER TABLE "ThreadsAccount" ADD COLUMN "threadsUserId" text, ADD COLUMN "updatedAt" timestamp(3);
    ALTER TABLE "PostDispatch" ADD COLUMN "platformKind" text;
  `);
  // Dipasang dua kali: harus idempoten.
  const fs = await import("node:fs");
  const path = await import("node:path");
  // sql/040 ikut mengganti dash_idea_list (tabel ide tidak ada di uji ini): isi fungsi SQL tidak diperiksa.
  await db.exec(`SET check_function_bodies = off`);
  for (const file of ["022_threads_publisher.sql", "036_threads_media.sql", "040_media_tmp.sql"]) {
    const sql = fs.readFileSync(path.resolve(__dirname, `../../../sql/${file}`), "utf8");
    for (let i = 0; i < 2; i++) await db.exec(sql);
  }
  sourceJpeg = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg()
    .toBuffer();
});

beforeEach(async () => {
  process.env.CONTENT_PUBLISH_ENABLED = "true";
  api.calls = [];
  api.status = "FINISHED";
  api.failCreate = null;
  api.failWhen = null;
  imageFetches.length = 0;
  h.files.clear();
  h.uploads = [];
  h.deletes = [];
  h.failDelete = false;
  h.failUpload = false;
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  const token = encryptThreadsToken("token-asli");
  await db.exec(`
    DELETE FROM "PostDispatch"; DELETE FROM "ScheduledPost"; DELETE FROM "SocialAccount"; DELETE FROM "ThreadsAccount"; DELETE FROM "Outlet";
    INSERT INTO "Outlet" (id, "workspaceId", nama) VALUES ('o1', 'w1', 'Cabang Jogja');
    INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "threadsUserId", "accessToken", "accessExpiresAt", "updatedAt")
      VALUES ('ta1', 'w1', 'akun', '1789', '${token}', '2026-12-31', '${ts(-60)}');
    INSERT INTO "SocialAccount" (id, "outletId", "threadsAccountId") VALUES ('sa1', 'o1', 'ta1');
  `);
});

afterEach(() => vi.unstubAllGlobals());

async function post(
  id: string,
  tayangOffsetMin: number,
  over: { source?: string; caption?: string; hashtags?: string; mediaType?: string; mediaUrls?: string[] } = {}
) {
  const urls = over.mediaUrls ? `ARRAY[${over.mediaUrls.map((u) => `'${u}'`).join(",")}]::text[]` : "NULL";
  await db.exec(`
    INSERT INTO "ScheduledPost" (id, "workspaceId", judul, caption, hashtags, "mediaType", "mediaUrls", "tayangPada", status, source, "updatedAt")
      VALUES ('${id}', 'w1', 'j', '${over.caption ?? "Halo dari {nama_cabang}"}', ${over.hashtags ?? "ARRAY['#kuliner']"},
              '${over.mediaType ?? "TEXT"}', ${urls},
              '${ts(tayangOffsetMin)}', 'MENUNGGU', '${over.source ?? "DASHBOARD_AI"}', '${ts(-120)}');
    INSERT INTO "PostDispatch" (id, "postId", "outletId", "socialAccountId", publisher, status)
      VALUES ('d-${id}', '${id}', 'o1', 'sa1', 'THREADS', 'MENUNGGU');
  `);
}

const dispatch = (id: string) =>
  rows<{ status: string; platformPostId: string | null; platformContainerId: string | null; releaseUrl: string | null; pesanError: string | null; lockedAt: unknown }>(
    `SELECT status::text, "platformPostId", "platformContainerId", "releaseUrl", "pesanError", "lockedAt" FROM "PostDispatch" WHERE id = 'd-${id}'`
  ).then((r) => r[0]);
/** Panggilan pembuatan container (POST /threads) berikut isi formulirnya. */
const creates = () => api.calls.filter((c) => c.url.endsWith("/1789/threads")).map((c) => new URLSearchParams(c.body));
const postStatus = (id: string) => rows<{ status: string }>(`SELECT status::text FROM "ScheduledPost" WHERE id = '${id}'`).then((r) => r[0].status);

describe("runPublisher", () => {
  it("menerbitkan postingan jatuh tempo sekali: container, publish, permalink, posting SELESAI", async () => {
    await post("p1", -1);
    await post("nanti", 30);
    const res = await runPublisher({ now: NOW });
    expect(res.counts).toMatchObject({ diklaim: 1, TERBIT: 1 });

    const create = api.calls.find((c) => c.url.endsWith("/1789/threads"))!;
    const form = new URLSearchParams(create.body);
    expect(form.get("text")).toBe("Halo dari Cabang Jogja");
    expect(form.get("topic_tag")).toBe("kuliner");
    expect(form.get("access_token")).toBe("token-asli");

    expect(await dispatch("p1")).toMatchObject({
      status: "TERBIT",
      platformContainerId: expect.stringMatching(/^c-/),
      platformPostId: expect.stringMatching(/^m-c-/),
      releaseUrl: "https://www.threads.net/@akun/post/abc",
      lockedAt: null,
    });
    expect(await postStatus("p1")).toBe("SELESAI");
    expect((await dispatch("nanti")).status).toBe("MENUNGGU");

    // Putaran berikutnya tidak menerbitkan ulang.
    api.calls = [];
    expect((await runPublisher({ now: NOW })).counts.diklaim).toBe(0);
    expect(api.calls).toEqual([]);
  });

  it("container yang belum siap disimpan lalu diterbitkan di putaran berikutnya", async () => {
    await post("p2", -1);
    api.status = "IN_PROGRESS";
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ CONTAINER: 1 });
    expect(await dispatch("p2")).toMatchObject({ status: "MENUNGGU", platformContainerId: expect.stringMatching(/^c-/), lockedAt: null });
    expect(await postStatus("p2")).toBe("DIPROSES");

    api.status = "FINISHED";
    api.calls = [];
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ TERBIT: 1 });
    // Tahap 2 tidak membuat container baru.
    expect(api.calls.some((c) => c.url.endsWith("/1789/threads"))).toBe(false);
    expect(await postStatus("p2")).toBe("SELESAI");
  });

  it("container yang ternyata sudah PUBLISHED ditandai TERBIT tanpa publish ulang", async () => {
    await post("p3", -1);
    api.status = "IN_PROGRESS";
    await runPublisher({ now: NOW });
    api.status = "PUBLISHED";
    api.calls = [];
    await runPublisher({ now: NOW });
    expect(api.calls.some((c) => c.url.endsWith("/threads_publish"))).toBe(false);
    expect((await dispatch("p3")).status).toBe("TERBIT");
  });

  it("token dicabut: GAGAL dan akun ditandai hubungkan ulang", async () => {
    await post("p4", -1);
    api.failCreate = { status: 400, code: 190 };
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ GAGAL: 1 });
    expect((await dispatch("p4")).pesanError).toContain("Hubungkan ulang");
    expect(await postStatus("p4")).toBe("GAGAL");
    expect((await rows<{ needsReconnect: boolean }>(`SELECT "needsReconnect" FROM "ThreadsAccount" WHERE id = 'ta1'`))[0].needsReconnect).toBe(true);
  });

  it("galat sementara dicoba ulang, lalu GAGAL setelah batas percobaan", async () => {
    await post("p5", -1);
    api.failCreate = { status: 500, code: 2 };
    for (let i = 0; i < 2; i++) expect((await runPublisher({ now: NOW })).counts).toMatchObject({ ULANG: 1 });
    expect((await dispatch("p5")).status).toBe("MENUNGGU");
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ GAGAL: 1 });
  });

  it("postingan basi (lewat > 2 jam) dan postingan non-dashboard tidak diterbitkan", async () => {
    await post("basi", -180);
    await post("telegram", -1, { source: "TELEGRAM" });
    const res = await runPublisher({ now: NOW });
    expect(res.counts.diklaim).toBe(0);
    expect(api.calls).toEqual([]);
    expect(await dispatch("basi")).toMatchObject({ status: "GAGAL", pesanError: expect.stringContaining("Lewat jam tayang") });
    expect(await postStatus("basi")).toBe("GAGAL");
    expect((await dispatch("telegram")).status).toBe("MENUNGGU");
  });

  it("saklar posting mati: tidak menyentuh antrean", async () => {
    process.env.CONTENT_PUBLISH_ENABLED = "false";
    await post("p6", -1);
    expect((await runPublisher({ now: NOW })).skipped).toBeTruthy();
    expect(api.calls).toEqual([]);
    expect((await dispatch("p6")).status).toBe("MENUNGGU");
  });

  it("dispatch yang sedang dikunci proses lain tidak diambil sampai kuncinya basi", async () => {
    await post("p7", -1);
    await db.exec(`UPDATE "PostDispatch" SET "lockedAt" = '${ts(-2)}' WHERE id = 'd-p7'`);
    expect((await runPublisher({ now: NOW })).counts.diklaim).toBe(0);
    await db.exec(`UPDATE "PostDispatch" SET "lockedAt" = '${ts(-15)}' WHERE id = 'd-p7'`);
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ TERBIT: 1 });
  });
});

describe("runPublisher postingan bergambar (sql/036 + sql/040)", () => {
  const SRC = (n: number) => `https://img.uji/berita/${n}.jpg`;
  const HILANG = "https://img.uji/berita/hilang.jpg";
  const TMP = (postId: string, n: number) => `tmp/${postId}/${n}.jpg`;
  const PUBLIC = (postId: string, n: number) => `https://storage.uji/threads-media/${TMP(postId, n)}`;
  const media = (id: string) =>
    rows<{ mediaType: string; mediaUrls: string[]; mediaPaths: string[] }>(
      `SELECT "mediaType", "mediaUrls", COALESCE("mediaPaths", '{}') AS "mediaPaths" FROM "ScheduledPost" WHERE id = '${id}'`
    ).then((r) => r[0]);

  it("satu gambar: unduh sumber, unggah sementara, container memakai URL sementara, lalu berkas dan kolom gambar dibersihkan", async () => {
    await post("img1", -1, { mediaType: "IMAGE", mediaUrls: [SRC(1)], caption: "Banjir di {nama_cabang}\n\n📷 kompas.com" });
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ diklaim: 1, TERBIT: 1 });
    expect(imageFetches).toEqual([SRC(1)]);
    expect(h.uploads).toEqual([TMP("img1", 0)]);
    const [form] = creates();
    expect(creates()).toHaveLength(1);
    expect(form.get("media_type")).toBe("IMAGE");
    expect(form.get("image_url")).toBe(PUBLIC("img1", 0));
    expect(form.get("text")).toBe("Banjir di Cabang Jogja\n\n📷 kompas.com");
    expect(form.get("topic_tag")).toBe("kuliner");
    expect(await dispatch("img1")).toMatchObject({ status: "TERBIT", platformContainerId: expect.stringMatching(/^c-/) });
    expect(await postStatus("img1")).toBe("SELESAI");
    // Terbit: berkas sementara langsung dihapus, tautan sumber dan path dikosongkan, jenis media tetap.
    expect(h.deletes).toEqual([[TMP("img1", 0)]]);
    expect(h.files.size).toBe(0);
    expect(await media("img1")).toEqual({ mediaType: "IMAGE", mediaUrls: [], mediaPaths: [] });
  });

  it("gambar diolah ke JPEG 1080 sebelum diunggah", async () => {
    await post("img0", -1, { mediaType: "IMAGE", mediaUrls: [SRC(1)] });
    api.status = "IN_PROGRESS";
    await runPublisher({ now: NOW });
    expect(h.files.get(TMP("img0", 0))).toMatchObject({ width: 1080 });
  });

  it("gambar yang masih IN_PROGRESS: path tercatat, berkas tetap sampai terbit di putaran berikutnya", async () => {
    await post("img2", -1, { mediaType: "IMAGE", mediaUrls: [SRC(1)] });
    api.status = "IN_PROGRESS";
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ CONTAINER: 1 });
    expect(await media("img2")).toEqual({ mediaType: "IMAGE", mediaUrls: [SRC(1)], mediaPaths: [TMP("img2", 0)] });
    expect(h.files.has(TMP("img2", 0))).toBe(true);
    expect(h.deletes).toEqual([]);

    api.status = "FINISHED";
    api.calls = [];
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ TERBIT: 1 });
    expect(creates()).toHaveLength(0);
    expect(imageFetches).toHaveLength(1); // tahap 2 tidak mengunduh ulang
    expect(h.deletes).toEqual([[TMP("img2", 0)]]);
    expect(await media("img2")).toEqual({ mediaType: "IMAGE", mediaUrls: [], mediaPaths: [] });
  });

  it("carousel: item dibuat berurutan dengan URL sementara, lalu induk CAROUSEL dengan children yang benar", async () => {
    await post("car1", -1, { mediaType: "CAROUSEL", mediaUrls: [SRC(1), SRC(2), SRC(3)], caption: "Tiga foto\n\n📷 detik.com" });
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ TERBIT: 1 });
    const forms = creates();
    expect(forms).toHaveLength(4);
    for (const [i, f] of forms.slice(0, 3).entries()) {
      expect(f.get("media_type")).toBe("IMAGE");
      expect(f.get("is_carousel_item")).toBe("true");
      expect(f.get("image_url")).toBe(PUBLIC("car1", i));
      expect(f.get("text")).toBeNull();
    }
    // Id container tiruan = c-<urutan panggilan Threads>; item adalah panggilan ke-1, 2, 3.
    const parent = forms[3];
    expect(parent.get("media_type")).toBe("CAROUSEL");
    expect(parent.get("children")).toBe("c-1,c-2,c-3");
    expect(parent.get("text")).toBe("Tiga foto\n\n📷 detik.com");
    expect(parent.get("topic_tag")).toBe("kuliner");
    expect((await dispatch("car1")).platformContainerId).toBe("c-4");
    expect(h.deletes.flat().sort()).toEqual([0, 1, 2].map((n) => TMP("car1", n)));
  });

  it("carousel gagal di tengah: ULANG, berkas tercatat; putaran berikutnya mengunduh dan membuat ulang semuanya", async () => {
    await post("car2", -1, { mediaType: "CAROUSEL", mediaUrls: [SRC(1), SRC(2)] });
    api.failWhen = (_f, n) => n === 2;
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ ULANG: 1 });
    expect(await dispatch("car2")).toMatchObject({ status: "MENUNGGU", platformContainerId: null, pesanError: "Galat server" });
    expect(api.calls.some((c) => c.url.endsWith("/threads_publish"))).toBe(false);
    expect((await media("car2")).mediaPaths).toEqual([TMP("car2", 0), TMP("car2", 1)]);
    expect(h.deletes).toEqual([]);

    api.failWhen = null;
    api.calls = [];
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ TERBIT: 1 });
    const forms = creates();
    expect(forms.map((f) => f.get("media_type"))).toEqual(["IMAGE", "IMAGE", "CAROUSEL"]);
    expect(forms[2].get("children")).toBe("c-1,c-2");
    expect(imageFetches).toHaveLength(4);
    expect(await postStatus("car2")).toBe("SELESAI");
    expect(h.files.size).toBe(0);
  });

  it("sumber hilang: carousel menyusut, sisa satu menjadi IMAGE, tanpa gambar terbit sebagai teks tanpa kredit", async () => {
    await post("s3", -1, { mediaType: "CAROUSEL", mediaUrls: [SRC(1), HILANG, SRC(3)], caption: "Tiga\n\n📷 a.com · b.com" });
    await post("s2", -2, { mediaType: "CAROUSEL", mediaUrls: [HILANG, SRC(2)], caption: "Dua\n\n📷 a.com" });
    await post("s1", -3, { mediaType: "IMAGE", mediaUrls: [HILANG], caption: "Satu {nama_cabang}\n\n📷 kompas.com" });
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ diklaim: 3, TERBIT: 3 });
    const forms = creates();
    const byText = (t: string) => forms.find((f) => f.get("text") === t)!;

    // Teks: kredit dibuang, tanpa unggahan; jenis media di database tetap (riwayat membaca Threads).
    expect(byText("Satu Cabang Jogja").get("media_type")).toBe("TEXT");
    expect(byText("Satu Cabang Jogja").has("image_url")).toBe(false);
    expect(await media("s1")).toEqual({ mediaType: "IMAGE", mediaUrls: [], mediaPaths: [] });

    // Carousel 2 -> IMAGE dengan gambar yang tersisa (path memakai urutan asal).
    const single = byText("Dua\n\n📷 a.com");
    expect(single.get("media_type")).toBe("IMAGE");
    expect(single.get("image_url")).toBe(PUBLIC("s2", 1));

    // Carousel 3 -> carousel 2.
    const parent = byText("Tiga\n\n📷 a.com · b.com");
    expect(parent.get("media_type")).toBe("CAROUSEL");
    expect(parent.get("children")?.split(",")).toHaveLength(2);
    expect(forms.filter((f) => f.get("is_carousel_item")).map((f) => f.get("image_url"))).toEqual([PUBLIC("s3", 0), PUBLIC("s3", 2)]);

    expect(h.uploads.sort()).toEqual([TMP("s2", 1), TMP("s3", 0), TMP("s3", 2)].sort());
    expect(h.files.size).toBe(0);
  });

  it("gambar hilang dan teks hanya kredit: GAGAL", async () => {
    await post("kosong", -1, { mediaType: "IMAGE", mediaUrls: [HILANG], caption: "📷 kompas.com" });
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ GAGAL: 1 });
    expect((await dispatch("kosong")).pesanError).toContain("tidak punya teks");
    expect(creates()).toHaveLength(0);
  });

  it("GAGAL akhir: berkas dihapus, tautan sumber tetap; Coba lagi mengunduh ulang dan terbit", async () => {
    await post("gg", -1, { mediaType: "IMAGE", mediaUrls: [SRC(7)] });
    api.status = "ERROR";
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ GAGAL: 1 });
    expect(await postStatus("gg")).toBe("GAGAL");
    expect(h.deletes).toEqual([[TMP("gg", 0)]]);
    expect(await media("gg")).toEqual({ mediaType: "IMAGE", mediaUrls: [SRC(7)], mediaPaths: [] });

    expect(await pgRpc(db, "dash_retry_post", { p_id: "gg", p_user: "u1", p_now: ts(0), p_detail: {} })).toBe(true);
    api.status = "FINISHED";
    api.calls = [];
    imageFetches.length = 0;
    h.deletes = [];
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ TERBIT: 1 });
    expect(imageFetches).toEqual([SRC(7)]);
    expect(creates()[0].get("image_url")).toBe(PUBLIC("gg", 0));
    expect(h.deletes).toEqual([[TMP("gg", 0)]]);
    expect(await media("gg")).toEqual({ mediaType: "IMAGE", mediaUrls: [], mediaPaths: [] });
  });

  it("hapus berkas gagal tidak menggagalkan posting (disapu media-cleanup nanti)", async () => {
    await post("hd", -1, { mediaType: "IMAGE", mediaUrls: [SRC(1)] });
    h.failDelete = true;
    const res = await runPublisher({ now: NOW });
    expect(res.counts).toMatchObject({ TERBIT: 1 });
    expect(res.counts.galat).toBeUndefined();
    expect(await media("hd")).toEqual({ mediaType: "IMAGE", mediaUrls: [], mediaPaths: [] });
  });

  it("unggah storage gagal: dicoba ulang (path sudah tercatat), tanpa container", async () => {
    await post("up", -1, { mediaType: "IMAGE", mediaUrls: [SRC(1)] });
    h.failUpload = true;
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ ULANG: 1 });
    expect(await dispatch("up")).toMatchObject({ status: "MENUNGGU", platformContainerId: null, pesanError: "Storage: penuh" });
    expect((await media("up")).mediaPaths).toEqual([TMP("up", 0)]);
    expect(creates()).toHaveLength(0);
  });

  it("jumlah atau URL gambar tidak sah: GAGAL tanpa mengunduh atau memanggil Threads", async () => {
    await post("bad1", -1, { mediaType: "IMAGE", mediaUrls: [SRC(1), SRC(2)] });
    await post("bad2", -2, { mediaType: "CAROUSEL", mediaUrls: [SRC(1)] });
    await post("bad3", -3, { mediaType: "IMAGE", mediaUrls: ["http://img.uji/a.jpg"] });
    await post("bad4", -4, { mediaType: "IMAGE" });
    expect((await runPublisher({ now: NOW })).counts).toMatchObject({ diklaim: 4, GAGAL: 4 });
    expect(api.calls).toEqual([]);
    expect(imageFetches).toEqual([]);
    expect((await dispatch("bad1")).pesanError).toContain("tepat 1 gambar (ada 2)");
    expect((await dispatch("bad2")).pesanError).toContain("Carousel butuh 2-20 gambar (ada 1)");
    expect((await dispatch("bad3")).pesanError).toContain("https");
    expect((await dispatch("bad4")).pesanError).toContain("ada 0");
    expect(await postStatus("bad1")).toBe("GAGAL");
  });

  it("postingan teks tetap memakai container TEXT tanpa parameter gambar", async () => {
    await post("txt", -1);
    await runPublisher({ now: NOW });
    const [form] = creates();
    expect(form.get("media_type")).toBe("TEXT");
    expect(form.has("image_url")).toBe(false);
    expect(form.has("children")).toBe(false);
    expect(imageFetches).toEqual([]);
    expect(h.deletes).toEqual([]);
  });

  it("dash_pub_result TUNDA melepas kunci tanpa menambah percobaan; dash_pub_media_tmp menolak path asing", async () => {
    await post("td", -1, { mediaType: "IMAGE", mediaUrls: [SRC(1)] });
    await db.exec(`UPDATE "PostDispatch" SET "lockedAt" = '${ts(0)}', attempts = 1, "pesanError" = 'lama' WHERE id = 'd-td'`);
    expect(await pgRpc(db, "dash_pub_result", { p_id: "d-td", p_outcome: "TUNDA", p_patch: {}, p_now: ts(0) })).toBe("OK");
    expect(
      (await rows<{ attempts: number; lockedAt: unknown; status: string; pesanError: string }>(
        `SELECT attempts, "lockedAt", status::text, "pesanError" FROM "PostDispatch" WHERE id = 'd-td'`
      ))[0]
    ).toEqual({ attempts: 1, lockedAt: null, status: "MENUNGGU", pesanError: "lama" });

    await expect(pgRpc(db, "dash_pub_media_tmp", { p_post: "td", p_paths: ["ws1/ideas/x.jpg"] })).rejects.toThrow(/tidak valid/);
    await expect(pgRpc(db, "dash_pub_media_tmp", { p_post: "td", p_paths: ["tmp/lain/0.jpg"] })).rejects.toThrow(/tidak valid/);
    expect(await pgRpc(db, "dash_pub_media_tmp", { p_post: "td", p_paths: ["tmp/td/0.jpg"] })).toBe(true);
    // Posting yang sudah tidak menunggu terbit tidak dicatat.
    await db.exec(`UPDATE "PostDispatch" SET status = 'TERBIT' WHERE id = 'd-td'`);
    expect(await pgRpc(db, "dash_pub_media_tmp", { p_post: "td", p_paths: ["tmp/td/1.jpg"] })).toBeNull();
  });
});

describe("withoutCredit", () => {
  it("membuang baris kredit foto di akhir saja", () => {
    expect(withoutCredit("Halo\n\n📷 kompas.com · detik.com")).toBe("Halo");
    expect(withoutCredit("📷 di awal\nlalu teks")).toBe("📷 di awal\nlalu teks");
    expect(withoutCredit("Tanpa kredit ")).toBe("Tanpa kredit");
    expect(withoutCredit("📷 kompas.com")).toBe("");
  });
});

describe("postText", () => {
  it("mengganti tag cabang dan merapikan spasi", () => {
    expect(postText("  Mampir ke {nama_outlet} ya \n", "Suka Jogja")).toBe("Mampir ke Suka Jogja ya");
    expect(postText(null, null)).toBe("");
  });
});
