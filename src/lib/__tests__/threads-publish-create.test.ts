import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (original) => ({
  ...(await original<typeof import("@/lib/supabase")>()),
  rpc: vi.fn(),
}));

import { rpc } from "@/lib/supabase";
import { createPosts } from "../threads-publish";

const NOW = new Date("2026-10-12T03:00:00Z");
const IN_1H = new Date(NOW.getTime() + 60 * 60_000).toISOString();
const IN_70M = new Date(NOW.getTime() + 70 * 60_000).toISOString();

const account = (id: string, over: Record<string, unknown> = {}) => ({
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
  ...over,
});

const inserted: unknown[][] = [];

beforeEach(() => {
  inserted.length = 0;
  vi.mocked(rpc).mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    switch (fn) {
      case "dash_publish_accounts":
        return [account("a"), account("b"), account("c", { needsReconnect: true }), account("e")] as never;
      case "dash_schedule":
        // Akun b sudah punya posting tepat 1 jam lagi (bentrok jarak minimal 60 menit).
        return [{ aid: "b", postId: "p0", at: IN_1H.replace("Z", ""), source: "TELEGRAM", caption: "lama" }] as never;
      case "dash_create_posts":
        inserted.push(args!.p_items as unknown[]);
        return (args!.p_items as unknown[]).length as never;
      default:
        return [] as never; // dash_replay, dash_recent_texts
    }
  });
});

const item = (threadsAccountId: string, text: string, publishAt = IN_1H) => ({
  threadsAccountId,
  text,
  topicTag: null,
  publishAt,
  aiModel: "uji",
  aiEdited: false,
});

const mixed = [
  item("a", "Draf untuk akun a yang lolos semua aturan"),
  item("b", "Draf untuk akun b yang bentrok jadwal", IN_70M),
  item("c", "Draf untuk akun c yang belum siap"),
  item("zzz", "Draf untuk akun yang tidak ada"),
];

describe("createPosts mode partial (jadwal massal orkestrator)", () => {
  it("item bermasalah dilewati per akun, sisanya tetap masuk antrean", async () => {
    const r = await createPosts({ userId: "u", idempotencyKey: "partial-1", items: mixed, partial: true }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.posts.map((p) => p.threadsAccountId)).toEqual(["a"]);
    expect(r.skipped?.map((s) => s.threadsAccountId).sort()).toEqual(["b", "c", "zzz"]);
    expect(r.skipped?.find((s) => s.threadsAccountId === "b")?.error).toContain("kurang dari 60 menit");
    expect(r.skipped?.find((s) => s.threadsAccountId === "c")?.error).toContain("belum siap");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toHaveLength(1);
  });

  it("teks identik ke akun lain dilewati, bukan menggagalkan kelompok", async () => {
    const same = "Teks yang sama persis untuk dua akun berbeda";
    const r = await createPosts(
      { userId: "u", idempotencyKey: "partial-2", items: [item("a", same), item("e", same)], partial: true },
      NOW
    );
    expect(r.ok && r.posts.map((p) => p.threadsAccountId)).toEqual(["a"]);
    expect(r.ok && r.skipped?.[0]).toMatchObject({ threadsAccountId: "e" });
  });

  it("semua item ditolak: tidak ada yang ditulis ke antrean", async () => {
    const r = await createPosts(
      { userId: "u", idempotencyKey: "partial-3", items: [mixed[1], mixed[2]], partial: true },
      NOW
    );
    expect(r).toMatchObject({ ok: true, posts: [] });
    expect(inserted).toHaveLength(0);
  });
});

describe("createPosts tanpa partial (perilaku lama)", () => {
  it("satu item tidak valid menggagalkan seluruh kiriman", async () => {
    const r = await createPosts({ userId: "u", idempotencyKey: "strict-1", items: mixed }, NOW);
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(inserted).toHaveLength(0);
  });

  it("pelanggaran jadwal dilaporkan dengan nama akun dan tidak menulis apa pun", async () => {
    const r = await createPosts({ userId: "u", idempotencyKey: "strict-2", items: [mixed[0], mixed[1]] }, NOW);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(!r.ok && r.error).toMatch(/^@b: Jarak/);
    expect(inserted).toHaveLength(0);
  });

  it("semua valid: satu transaksi untuk semua item", async () => {
    const r = await createPosts(
      { userId: "u", idempotencyKey: "strict-3", items: [mixed[0], item("e", "Draf lain untuk akun e")] },
      NOW
    );
    expect(r.ok && r.posts).toHaveLength(2);
    expect(r.ok && "skipped" in r).toBe(false);
    expect(inserted[0]).toHaveLength(2);
  });
});

describe("createPosts autoReschedule (sistem yang mengatur jadwal)", () => {
  // Kasus nyata 2026-10-12: draf orkestrator @sukashawarmacirendeu ditolak "jarak kurang dari 60 menit"
  // padahal sistem bisa menggesernya sendiri.
  it("bentrok jarak minimal digeser ke slot kosong terdekat, bukan ditolak", async () => {
    const r = await createPosts(
      { userId: "u", idempotencyKey: "auto-1", items: [mixed[1]], partial: true, autoReschedule: true },
      NOW
    );
    expect(r.ok && r.skipped).toEqual([]);
    const post = r.ok ? r.posts[0] : null;
    // Posting lama di akun b tayang IN_1H, jadi slot pertama yang lolos tepat 60 menit sesudahnya.
    expect(post).toMatchObject({ threadsAccountId: "b", rescheduledFrom: IN_70M });
    expect(post?.tayangPada).toBe(new Date(Date.parse(IN_1H) + 60 * 60_000).toISOString());
    expect(inserted[0]).toHaveLength(1);
  });

  it("'posting sekarang' yang bentrok menjadi terjadwal di slot berikutnya", async () => {
    const r = await createPosts(
      {
        userId: "u",
        idempotencyKey: "auto-2",
        items: [item("b", "Draf b yang diminta tayang sekarang", "now")],
        partial: true,
        autoReschedule: true,
      },
      new Date(Date.parse(IN_1H) - 10 * 60_000)
    );
    expect(r.ok && r.posts[0].rescheduledFrom).toBeTruthy();
    expect((inserted[0] as Record<string, unknown>[])[0]).toMatchObject({ action: "CREATE_SCHEDULED" });
  });
});
