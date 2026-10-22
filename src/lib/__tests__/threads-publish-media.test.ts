/**
 * Postingan bergambar dari dashboard (src/lib/threads-publish.ts + sql/036_threads_media.sql): createPosts
 * menyimpan mediaType, tautan gambar asal (mediaUrls = sourceUrl; mediaPaths kosong karena berkas sementara
 * baru dibuat penerbit, sql/040) dan caption berkredit lewat dash_create_posts asli di Postgres in-memory;
 * editPost menjaga gambar dan baris kredit. Hanya daftar akun yang ditiru.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./helpers/pg";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/lib/supabase", async (original) => ({
  ...(await original<typeof import("@/lib/supabase")>()),
  rpc: vi.fn(),
  tenantIdOf: async (w: string | null) => w,
}));

import { rpc } from "@/lib/supabase";
import { bootDb, pgRpc } from "./helpers/pg";
import { createPosts, editPost } from "../threads-publish";
import type { PostMedia } from "../post-media";

let db: TestDb;
const NOW = new Date("2026-10-12T03:00:00Z");
const IN_3H = new Date(NOW.getTime() + 3 * 60 * 60_000).toISOString();

const account = (id: string) => ({
  id,
  username: id,
  displayName: id,
  avatarUrl: null,
  needsReconnect: false,
  accessExpiresAt: "2099-01-01T00:00:00",
  scopes: ["threads_content_publish"],
  socialAccountId: `sa-${id}`,
  outletId: `o-${id}`,
  outletNama: `Cabang ${id}`,
  outletActive: true,
  workspaceId: "w1",
});

const mediaItem = (n: number, credit: string) => ({
  sourceUrl: `https://cdn.${credit}/foto/${n}.jpg`,
  credit,
  sourceKind: "NEWS" as const,
  articleUrl: `https://${credit}/berita/${n}`,
  articleTitle: `Berita ${n}`,
  imageKey: `key-${n}`,
  width: 1080,
  height: 720,
});

const image: PostMedia = { type: "IMAGE", items: [mediaItem(1, "kompas.com")] };
const carousel: PostMedia = { type: "CAROUSEL", items: [mediaItem(1, "kompas.com"), mediaItem(2, "detik.com")] };

const item = (threadsAccountId: string, text: string, media?: PostMedia | null) => ({
  threadsAccountId,
  text,
  topicTag: null,
  publishAt: IN_3H,
  aiModel: "uji",
  aiEdited: false,
  ...(media !== undefined ? { media } : {}),
});

type Row = { id: string; caption: string; mediaType: string; mediaUrls: string[]; mediaPaths: string[] };
const stored = async (id: string): Promise<Row> =>
  (await db.query<Row>(`SELECT id, caption, "mediaType", "mediaUrls", "mediaPaths" FROM "ScheduledPost" WHERE id = $1`, [id])).rows[0];

beforeAll(async () => {
  db = await bootDb(["sql/002_dashboard_post_log.sql", "sql/003_dashboard_rpc.sql", "sql/036_threads_media.sql"]);
  h.db = db;
  await db.exec(`INSERT INTO "SocialAccount" (id, "outletId", "threadsAccountId") VALUES ('sa-a', 'o-a', 'a'), ('sa-b', 'o-b', 'b');`);
});

beforeEach(async () => {
  delete process.env.CONTENT_MIN_GAP_MINUTES;
  await db.exec(`DELETE FROM "PostDispatch"; DELETE FROM "ScheduledPost";`);
  vi.mocked(rpc).mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    if (fn === "dash_publish_accounts") return [account("a"), account("b")] as never;
    return pgRpc(h.db as TestDb, fn, args) as never;
  });
});

describe("createPosts dengan media", () => {
  it("menyimpan mediaType, tautan gambar asal (tanpa path berkas), dan caption berkredit", async () => {
    const r = await createPosts(
      {
        userId: "u",
        idempotencyKey: "media-1",
        items: [item("a", "Banjir rob di pesisir utara pagi ini", image), item("b", "Galeri festival kuliner akhir pekan", carousel)],
      },
      NOW
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [a, b] = await Promise.all(r.posts.map((p) => stored(p.postId)));
    expect(a).toMatchObject({
      caption: "Banjir rob di pesisir utara pagi ini\n\n📷 kompas.com",
      mediaType: "IMAGE",
      mediaUrls: [image.items[0].sourceUrl],
      mediaPaths: [],
    });
    expect(b).toMatchObject({
      caption: "Galeri festival kuliner akhir pekan\n\n📷 kompas.com · detik.com",
      mediaType: "CAROUSEL",
      mediaUrls: ["https://cdn.kompas.com/foto/1.jpg", "https://cdn.detik.com/foto/2.jpg"],
      mediaPaths: [],
    });
  });

  it("postingan teks tidak berubah: TEXT dengan array kosong, caption tanpa kredit", async () => {
    const r = await createPosts({ userId: "u", idempotencyKey: "media-2", items: [item("a", "Sekadar teks biasa", null)] }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await stored(r.posts[0].postId)).toMatchObject({ caption: "Sekadar teks biasa", mediaType: "TEXT", mediaUrls: [], mediaPaths: [] });
  });

  it("teks + kredit melebihi batas: ditolak, dan dilewati pada mode partial", async () => {
    const long = "a".repeat(495);
    const strict = await createPosts({ userId: "u", idempotencyKey: "media-3", items: [item("a", long, image)] }, NOW);
    expect(strict).toMatchObject({ ok: false, status: 400 });
    expect(!strict.ok && strict.error).toContain("Teks dan kredit foto");

    const partial = await createPosts(
      { userId: "u", idempotencyKey: "media-4", items: [item("a", long, image), item("b", "Teks pendek lolos", image)], partial: true },
      NOW
    );
    expect(partial.ok && partial.posts.map((p) => p.threadsAccountId)).toEqual(["b"]);
    expect(partial.ok && partial.skipped?.[0]).toMatchObject({ threadsAccountId: "a", error: expect.stringContaining("kredit foto") });
  });

  it("media tidak sah (IMAGE dengan dua gambar) ditolak", async () => {
    const bad = { type: "IMAGE", items: carousel.items } as PostMedia;
    const r = await createPosts({ userId: "u", idempotencyKey: "media-5", items: [item("a", "Teks", bad)] }, NOW);
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(!r.ok && r.error).toContain("gambar");
  });
});

describe("editPost postingan bergambar", () => {
  it("teks baru tanpa kredit: kredit dipasang lagi, gambar tetap, memori gaya tanpa kredit", async () => {
    const r = await createPosts({ userId: "u", idempotencyKey: "media-6", items: [item("a", "Teks awal berita", image)] }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const id = r.posts[0].postId;

    const e = await editPost({ userId: "u", postId: id, text: "Teks yang sudah diperbaiki" }, NOW);
    expect(e.ok).toBe(true);
    expect(await stored(id)).toMatchObject({
      caption: "Teks yang sudah diperbaiki\n\n📷 kompas.com",
      mediaType: "IMAGE",
      mediaUrls: [image.items[0].sourceUrl],
    });
    expect(e.ok && e.learn).toEqual({ accountId: "a", before: "Teks awal berita", after: "Teks yang sudah diperbaiki" });

    // Kredit yang masih ada tidak digandakan.
    await editPost({ userId: "u", postId: id, text: "Versi ketiga\n\n📷 kompas.com" }, NOW);
    expect((await stored(id)).caption).toBe("Versi ketiga\n\n📷 kompas.com");
  });

  it("postingan teks yang diakhiri baris 📷 tidak diberi kredit tambahan", async () => {
    const r = await createPosts({ userId: "u", idempotencyKey: "media-7", items: [item("a", "Foto kemarin\n\n📷 punyaku")] }, NOW);
    if (!r.ok) throw new Error(r.error);
    const id = r.posts[0].postId;
    await editPost({ userId: "u", postId: id, text: "Tanpa baris foto" }, NOW);
    expect((await stored(id)).caption).toBe("Tanpa baris foto");
  });
});
