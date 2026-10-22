/**
 * Gambar pada preview ide (sql/038 + idea-preview.ts) terhadap SQL asli di Postgres in-memory:
 * preview otomatis mendapat gambar bila diizinkan, preview teks tetap jadi walau pencari gambar gagal,
 * ganti/hapus gambar (hanya data ide: tidak ada berkas yang disimpan atau dihapus), dan dash_idea_list
 * (versi sql/040) mengembalikan previewMedia.
 * Yang di-mock: transport database, AI penulis preview, pencari gambar, kebijakan gambar, dan storage.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./helpers/pg";
import type { PostMedia } from "../post-media";

const h = vi.hoisted(() => ({
  db: null as unknown,
  pick: vi.fn(),
  allowed: vi.fn(),
  del: vi.fn(),
  edit: vi.fn(),
}));

vi.mock("@supabase/supabase-js", async () => (await import("./helpers/pg")).supabaseMock(() => h.db as TestDb));
vi.mock("@/lib/news-image", () => ({ pickIdeaMedia: h.pick }));
vi.mock("@/lib/media-policy", () => ({ imageAllowed: h.allowed }));
vi.mock("@/lib/media-store", () => ({ deleteMediaFiles: h.del }));
vi.mock("@/lib/content-ai", () => ({ editCandidates: h.edit }));
vi.mock("@/lib/publish-accounts", () => ({
  getPublishAccountMap: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, { id, username: "akun1", displayName: "Akun 1" }]))),
}));

import { bootDb, pgRpc, useTestSupabaseEnv } from "./helpers/pg";
import { ideaMedia, ideaPreview } from "../idea-preview";
import { listIdeas } from "../radar-store";
import type { RequestCtx } from "../request-ctx";

const NOW = new Date("2026-10-13T04:00:00Z");
let db: TestDb;
const ctx: RequestCtx = { userId: "u1", workspaceId: "ws1", role: "OWNER", accountIds: null };

const media = (key: string, credit = "kompas.com"): PostMedia => ({
  type: "IMAGE",
  items: [
    {
      sourceUrl: `https://cdn.${credit}/foto/${key}.jpg`,
      credit,
      sourceKind: "NEWS",
      articleUrl: `https://${credit}/artikel-${key}`,
      articleTitle: `Artikel ${key}`,
      imageKey: key,
      width: 1080,
      height: 720,
    },
  ],
});

const TEXT = "Pagi ini aku nyoba bikin sambal matah sendiri dan ternyata gampang banget, kalian lebih suka pedas atau sedang?";

const addIdea = (id: string, status = "BARU", preview: unknown = null) =>
  db.query(
    `INSERT INTO "ContentIdea" (id, "workspaceId", "accountId", topik, "topicKey", sudut, status, preview, "expiresAt", "createdAt", "updatedAt")
     VALUES ($1, 'ws1', 'a1', 'sambal matah', 'sambal matah', 'resep rumahan', $2, $3, '2026-10-20', $4, $4)`,
    [id, status, preview === null ? null : JSON.stringify(preview), new Date(NOW.getTime() - Number(id.replace(/\D/g, "")) * 1000).toISOString()]
  );

const stored = async (id: string) =>
  (await db.query<{ preview: { text: string; media?: PostMedia | null } | null }>(`SELECT preview FROM "ContentIdea" WHERE id = $1`, [id])).rows[0]
    .preview;

beforeAll(async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  useTestSupabaseEnv();
  db = await bootDb([
    "sql/002_dashboard_post_log.sql",
    "sql/003_dashboard_rpc.sql",
    "sql/005_autopilot.sql",
    "sql/006_autopilot_radar.sql",
    "sql/033_idea_preview.sql",
    "sql/038_idea_media.sql",
    "sql/039_media_policy.sql",
    "sql/040_media_tmp.sql",
  ]);
  h.db = db;
});

beforeEach(() => {
  h.pick.mockReset();
  h.allowed.mockReset().mockResolvedValue(true);
  h.del.mockReset().mockResolvedValue(undefined);
  h.edit.mockReset().mockResolvedValue({ ok: true, result: { model: "llm-uji", candidates: [{ text: TEXT, topicTag: "Kuliner" }] } });
});

describe("preview ide dengan gambar", () => {
  it("menyimpan gambar bersama teks bila pengaturan akun mengizinkan", async () => {
    await addIdea("i1");
    h.pick.mockResolvedValue(media("k1"));
    const res = await ideaPreview(ctx, "i1", { regenerate: false }, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.preview.media?.items[0].imageKey).toBe("k1");
    expect(h.pick).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws1", accountId: "a1", ideaId: "i1", topik: "sambal matah", text: TEXT })
    );
    expect((await stored("i1"))?.media?.items[0].imageKey).toBe("k1");
    // Penulis preview memakai korpus gaya workspace ide (blok CONTOH GAYA THREADS).
    expect(h.edit).toHaveBeenCalledWith(expect.objectContaining({ action: "idea", workspaceId: "ws1" }), NOW);
  });

  it("tidak mencari gambar bila kebijakan gambar akun menolak", async () => {
    await addIdea("i2");
    h.allowed.mockResolvedValue(false);
    const res = await ideaPreview(ctx, "i2", { regenerate: false }, NOW);
    expect(res.ok && res.preview.text).toBe(TEXT);
    expect(res.ok && res.preview.media).toBeNull();
    expect(h.pick).not.toHaveBeenCalled();
  });

  it("preview teks tetap tersimpan walau pencari gambar gagal", async () => {
    await addIdea("i3");
    h.pick.mockRejectedValue(new Error("Hermes mati"));
    const res = await ideaPreview(ctx, "i3", { regenerate: false }, NOW);
    expect(res.ok).toBe(true);
    expect((await stored("i3"))?.text).toBe(TEXT);
    expect((await stored("i3"))?.media).toBeNull();
  });

  it("kebijakan gambar yang galat juga tidak menggagalkan preview", async () => {
    await addIdea("i4");
    h.allowed.mockRejectedValue(new Error("db putus"));
    const res = await ideaPreview(ctx, "i4", { regenerate: false }, NOW);
    expect(res.ok && res.preview.text).toBe(TEXT);
  });

  it("tulis ulang mengganti gambar tanpa menyentuh storage", async () => {
    await addIdea("i5", "BARU", { text: "teks lama yang sudah ada", topicTag: null, model: "m", at: NOW.toISOString(), media: media("lama") });
    h.pick.mockResolvedValue(media("baru"));
    const res = await ideaPreview(ctx, "i5", { regenerate: true }, NOW);
    expect(res.ok && res.preview.media?.items[0].imageKey).toBe("baru");
    expect(h.del).not.toHaveBeenCalled();
  });

  it("preview tersimpan dikembalikan tanpa memanggil AI atau pencari gambar", async () => {
    const res = await ideaPreview(ctx, "i1", { regenerate: false }, NOW);
    expect(res.ok && res.preview.media?.items[0].imageKey).toBe("k1");
    expect(h.edit).not.toHaveBeenCalled();
    expect(h.pick).not.toHaveBeenCalled();
  });
});

describe("ganti dan hapus gambar ide", () => {
  it("ganti: mencari gambar lain (tanpa gambar lama) lalu menyimpannya", async () => {
    await addIdea("i10", "BARU", { text: TEXT, topicTag: null, model: "m", at: NOW.toISOString(), media: media("g1") });
    h.pick.mockResolvedValue(media("g2", "detik.com"));
    const res = await ideaMedia(ctx, "i10", "ganti", {}, NOW);
    expect(res.ok && res.media?.items[0].imageKey).toBe("g2");
    expect(h.pick).toHaveBeenCalledWith(expect.objectContaining({ force: true, exclude: ["g1"], text: TEXT }));
    expect((await stored("i10"))?.media?.items[0]).toMatchObject({ imageKey: "g2", sourceUrl: "https://cdn.detik.com/foto/g2.jpg" });
    expect(h.del).not.toHaveBeenCalled();
  });

  it("ganti tanpa hasil: pesan jelas dan gambar lama tetap", async () => {
    h.pick.mockResolvedValue(null);
    const res = await ideaMedia(ctx, "i10", "ganti", {}, NOW);
    expect(res).toEqual({ ok: false, status: 422, error: expect.stringContaining("Gambar lama tetap dipakai") });
    expect((await stored("i10"))?.media?.items[0].imageKey).toBe("g2");
    expect(h.del).not.toHaveBeenCalled();
  });

  it("hapus: gambar dikosongkan", async () => {
    const res = await ideaMedia(ctx, "i10", "hapus", {}, NOW);
    expect(res).toEqual({ ok: true, media: null });
    expect((await stored("i10"))?.media).toBeNull();
    expect((await stored("i10"))?.text).toBe(TEXT);
    expect(h.del).not.toHaveBeenCalled();
  });

  it("tambah gambar pada ide yang belum punya gambar", async () => {
    h.pick.mockResolvedValue(media("g3"));
    const res = await ideaMedia(ctx, "i10", "ganti", {}, NOW);
    expect(res.ok && res.media?.items[0].imageKey).toBe("g3");
    expect(h.pick).toHaveBeenCalledWith(expect.objectContaining({ exclude: [] }));
  });

  it("menolak ide yang sudah tidak BARU dan ide di luar lingkup", async () => {
    await addIdea("i11", "DIPAKAI", { text: TEXT, topicTag: null, model: "m", at: NOW.toISOString() });
    expect(await ideaMedia(ctx, "i11", "hapus", {}, NOW)).toMatchObject({ ok: false, status: 409 });
    expect(await ideaMedia({ ...ctx, workspaceId: "ws2" }, "i10", "hapus", {}, NOW)).toMatchObject({ ok: false, status: 404 });
    expect(h.pick).not.toHaveBeenCalled();
  });

  it("gambar baru yang tidak muat bersama teks dibuang", async () => {
    const long = "kata ".repeat(99).trim();
    await addIdea("i12", "BARU", { text: long, topicTag: null, model: "m", at: NOW.toISOString() });
    h.pick.mockResolvedValue(media("g4", "sumber-yang-namanya-cukup-panjang.co.id"));
    const res = await ideaMedia(ctx, "i12", "ganti", {}, NOW);
    expect(res).toMatchObject({ ok: false, status: 422 });
    expect(h.del).not.toHaveBeenCalled();
    expect((await stored("i12"))?.media ?? null).toBeNull();
  });
});

describe("dash_idea_list: previewMedia", () => {
  it("ide BARU: gambar preview; ide terpakai: gambar posting sebenarnya", async () => {
    // Terpakai, posting bergambar di antrean, draf menyimpan media lengkap.
    await addIdea("i20", "DIPAKAI");
    // Terpakai, posting teks saja walau draf dulu punya gambar.
    await addIdea("i21", "DIPAKAI");
    // Terpakai, posting carousel tanpa media di draf (belum terbit): minimal tautan sumbernya.
    await addIdea("i22", "DIPAKAI");
    await db.exec(`
      INSERT INTO "ScheduledPost" (id, "workspaceId", caption, "mediaType", "mediaUrls") VALUES
        ('p20', 'ws1', 'x', 'IMAGE', '{https://cdn.uji/threads-media/s20.jpg}'),
        ('p21', 'ws1', 'x', 'TEXT', '{}'),
        ('p22', 'ws1', 'x', 'CAROUSEL', '{https://cdn.uji/a.jpg,https://cdn.uji/b.jpg}');
      INSERT INTO "AutopilotSlot" (id, "workspaceId", "accountId", "dayKey", "slotIndex", "slotAt", hour, status, draft, "postId") VALUES
        ('s20', 'ws1', 'a1', '2026-10-13', 0, '2026-10-13T05:00:00', 12, 'TERANTRE', '{"text":"posting 20","media":${JSON.stringify(media("s20"))}}', 'p20'),
        ('s21', 'ws1', 'a1', '2026-10-13', 1, '2026-10-13T06:00:00', 13, 'TERANTRE', '{"text":"posting 21","media":${JSON.stringify(media("s21"))}}', 'p21'),
        ('s22', 'ws1', 'a1', '2026-10-13', 2, '2026-10-13T07:00:00', 14, 'TERANTRE', '{"text":"posting 22"}', 'p22');
      UPDATE "ContentIdea" SET "usedBySlot" = 's' || substr(id, 2) WHERE id IN ('i20', 'i21', 'i22');
    `);
    await pgRpc(db, "dash_idea_media_set", { p_id: "i1", p_media: media("k9"), p_now: NOW });

    const used = new Map(
      (await listIdeas({ workspaceId: "ws1", accountIds: null, statuses: ["DIPAKAI"], cursor: null, limit: 50 })).map((r) => [r.id, r])
    );
    expect(used.get("i20")?.previewMedia?.items[0]).toMatchObject({ imageKey: "s20", credit: "kompas.com" });
    expect(used.get("i20")?.previewKind).toBe("POSTING");
    expect(used.get("i21")?.previewMedia).toBeNull();
    expect(used.get("i22")?.previewMedia).toMatchObject({
      type: "CAROUSEL",
      items: [{ sourceUrl: "https://cdn.uji/a.jpg", credit: "" }, { sourceUrl: "https://cdn.uji/b.jpg" }],
    });
    // Langsung dari SQL: item cadangan berbentuk {sourceUrl}.
    const raw = await pgRpc<{ id: string; previewMedia: unknown }[]>(db, "dash_idea_list", {
      p_workspace: "ws1",
      p_account_ids: null,
      p_statuses: ["DIPAKAI"],
      p_cursor_at: null,
      p_cursor_id: null,
      p_limit: 50,
    });
    expect(raw.find((r) => r.id === "i22")?.previewMedia).toEqual({
      type: "CAROUSEL",
      items: [{ sourceUrl: "https://cdn.uji/a.jpg" }, { sourceUrl: "https://cdn.uji/b.jpg" }],
    });

    const ready = new Map(
      (await listIdeas({ workspaceId: "ws1", accountIds: null, statuses: ["BARU"], cursor: null, limit: 50 })).map((r) => [r.id, r])
    );
    expect(ready.get("i1")?.previewMedia?.items[0].imageKey).toBe("k9");
    expect(ready.get("i2")?.previewMedia).toBeNull();
  });

  it("dash_idea_candidates membawa media preview untuk penulis autopilot", async () => {
    const rows = await pgRpc<{ id: string; preview: { media?: PostMedia } | null }[]>(db, "dash_idea_candidates", {
      p_ids: ["a1"],
      p_now: NOW,
      p_per: 20,
    });
    expect(rows.find((r) => r.id === "i1")?.preview?.media?.items[0].imageKey).toBe("k9");
  });
});
