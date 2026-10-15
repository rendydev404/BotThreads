/**
 * Uji integrasi layanan radar/ide/knowledge base terhadap SQL asli (sql/005 + 006 di Postgres
 * in-memory): validasi masukan, lingkup workspace dan akun, paginasi, dan audit.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./helpers/pg";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@supabase/supabase-js", async () => (await import("./helpers/pg")).supabaseMock(() => h.db as TestDb));

import { bootDb, useTestSupabaseEnv } from "./helpers/pg";
import { insertIdeas, upsertSignals } from "../radar-store";
import {
  actOnIdea,
  addManualSignal,
  listIdeaPage,
  listKnowledgePage,
  listMomentPage,
  listSignalPage,
  removeKnowledge,
  removeManualSignal,
  removeMoment,
  saveKnowledge,
  saveMoment,
} from "../radar-service";
import type { RequestCtx } from "../request-ctx";

const NOW = new Date("2026-10-13T04:00:00Z");
let db: TestDb;

const owner: RequestCtx = { userId: "u-owner", workspaceId: "ws1", role: "OWNER", accountIds: null };
const scoped: RequestCtx = { userId: "u-cabang", workspaceId: "ws1", role: "EDITOR", accountIds: ["a2"] };
const other: RequestCtx = { userId: "u-lain", workspaceId: "ws2", role: "OWNER", accountIds: null };

const count = async (sql: string): Promise<number> => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`)).rows[0].n;

beforeAll(async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  useTestSupabaseEnv();
  delete process.env.CONTENT_PUBLISH_TEST_ACCOUNTS;
  delete process.env.EXCLUDED_THREADS_ACCOUNTS;
  db = await bootDb(["sql/002_dashboard_post_log.sql", "sql/003_dashboard_rpc.sql", "sql/005_autopilot.sql", "sql/006_autopilot_radar.sql"]);
  h.db = db;
  await db.exec(
    [
      ["1", "ws1"],
      ["2", "ws1"],
      ["3", "ws2"],
    ]
      .map(
        ([n, ws]) => `
INSERT INTO "Outlet" VALUES ('o${n}', '${ws}', 'Cabang ${n}', true);
INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "accessExpiresAt", scopes)
  VALUES ('a${n}', '${ws}', 'akun${n}', 'Akun ${n}', '2027-01-01', '{threads_content_publish}');
INSERT INTO "SocialAccount" VALUES ('s${n}', 'o${n}', 'a${n}');`
      )
      .join("\n")
  );
});

describe("sinyal radar", () => {
  it("inspirasi manual divalidasi, dibersihkan, dan disimpan untuk workspace pengguna", async () => {
    expect(await addManualSignal(owner, { text: "pendek" }, NOW)).toMatchObject({ ok: false, status: 400 });
    expect(await addManualSignal(owner, { text: "ramai banget bahas pemilu minggu ini di linimasa" }, NOW)).toMatchObject({ ok: false, status: 400 });
    expect(await addManualSignal(owner, { text: "ide bagus dari akun lain", url: "javascript:alert(1)" }, NOW)).toMatchObject({ ok: false, status: 400 });

    const text = "postingan orang soal <b>kebiasaan makan siang</b> di kantor yang relate banget";
    expect(await addManualSignal(owner, { text, url: "https://www.threads.net/@x/post/1" }, NOW)).toEqual({ ok: true });
    // Tempel ulang teks yang sama tidak menggandakan.
    expect(await addManualSignal(owner, { text }, NOW)).toEqual({ ok: true });
    const rows = await db.query<{ title: string; workspaceId: string; createdBy: string }>(`SELECT title, "workspaceId", "createdBy" FROM "TrendSignal" WHERE source = 'MANUAL'`);
    expect(rows.rows).toEqual([{ title: "postingan orang soal kebiasaan makan siang di kantor yang relate banget", workspaceId: "ws1", createdBy: "u-owner" }]);
  });

  it("daftar memuat sinyal global dan milik workspace sendiri saja, terbaru dulu, berpaginasi", async () => {
    const exp = new Date(NOW.getTime() + 86_400_000).toISOString();
    await upsertSignals(
      [
        ...Array.from({ length: 22 }, (_, i) => ({ workspaceId: null, source: "GTRENDS" as const, title: `tren ${i}`, score: 0.5, hash: `g${i}`, expiresAt: exp })),
        { workspaceId: "ws2", source: "MANUAL" as const, title: "rahasia workspace dua", score: 0.5, hash: "m-ws2", expiresAt: exp },
        { workspaceId: null, source: "GTRENDS" as const, title: "sudah basi", score: 0.5, hash: "basi", expiresAt: new Date(NOW.getTime() - 1000).toISOString() },
      ],
      new Date(NOW.getTime() + 1000)
    );
    const first = await listSignalPage(owner, { source: null, cursor: null }, NOW);
    expect(first.installed).toBe(true);
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toBeTruthy();
    expect(first.lastCapture.GTRENDS).toBeTruthy();
    const second = await listSignalPage(owner, { source: null, cursor: first.nextCursor }, NOW);
    const all = [...first.items, ...second.items];
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    expect(all.map((s) => s.title)).not.toContain("rahasia workspace dua");
    expect(all.map((s) => s.title)).not.toContain("sudah basi");
    expect(all.filter((s) => s.removable).map((s) => s.source)).toEqual(["MANUAL"]);

    expect((await listSignalPage(other, { source: "MANUAL", cursor: null }, NOW)).items.map((s) => s.title)).toEqual(["rahasia workspace dua"]);
  });

  it("hanya inspirasi manual milik workspace sendiri yang bisa dihapus", async () => {
    const mine = (await listSignalPage(owner, { source: "MANUAL", cursor: null }, NOW)).items[0];
    const trend = (await listSignalPage(owner, { source: "GTRENDS", cursor: null }, NOW)).items[0];
    expect(await removeManualSignal(other, mine.id)).toMatchObject({ ok: false, status: 404 });
    expect(await removeManualSignal(owner, trend.id)).toMatchObject({ ok: false, status: 404 });
    expect(await removeManualSignal(owner, mine.id)).toEqual({ ok: true });
    expect(await count(`"TrendSignal" WHERE id = '${mine.id}'`)).toBe(0);
  });
});

describe("momen kalender", () => {
  it("validasi tanggal dan rentang", async () => {
    expect(await saveMoment(owner, { nama: "x", mulai: "2026-10-20", selesai: "2026-10-21" }, NOW)).toMatchObject({ ok: false, status: 400 });
    expect(await saveMoment(owner, { nama: "Ulang tahun brand", mulai: "2026-10-22", selesai: "2026-10-20" }, NOW)).toMatchObject({ ok: false });
    expect(await saveMoment(owner, { nama: "Ulang tahun brand", mulai: "2026-10-01", selesai: "2026-10-05" }, NOW)).toMatchObject({ ok: false, error: "Momen sudah lewat." });
    expect(await saveMoment(owner, { nama: "Ulang tahun brand", mulai: "2026-10-20", selesai: "2027-01-20" }, NOW)).toMatchObject({ ok: false });
    expect(await saveMoment(owner, { nama: "Ulang tahun brand", mulai: "2026-13-45", selesai: "2026-10-20" }, NOW)).toMatchObject({ ok: false });
  });

  it("simpan, ubah, daftar per workspace, dan hapus beserta sinyalnya", async () => {
    const saved = await saveMoment(owner, { nama: "Ulang tahun brand", mulai: "2026-10-14", selesai: "2026-10-16", catatan: "5 tahun" }, NOW);
    if (!saved.ok) throw new Error(saved.error);
    // Balasan memuat baris yang tersimpan (sudah dinormalkan), supaya klien tidak perlu memuat ulang daftar.
    expect(saved.moment).toMatchObject({ nama: "Ulang tahun brand", mulai: "2026-10-14", selesai: "2026-10-16", catatan: "5 tahun" });
    const id = saved.moment.id;
    expect(await saveMoment(owner, { id, nama: "Ulang tahun ke-5", mulai: "2026-10-14", selesai: "2026-10-16" }, NOW)).toEqual({
      ok: true,
      moment: { id, nama: "Ulang tahun ke-5", mulai: "2026-10-14", selesai: "2026-10-16", catatan: null },
    });
    expect((await listMomentPage(owner, NOW)).items).toEqual([{ id: id, nama: "Ulang tahun ke-5", mulai: "2026-10-14", selesai: "2026-10-16", catatan: null }]);
    expect((await listMomentPage(other, NOW)).items).toEqual([]);
    // Workspace lain tidak bisa mengubah atau menghapus.
    expect(await saveMoment(other, { id: id, nama: "Dibajak", mulai: "2026-10-14", selesai: "2026-10-16" }, NOW)).toMatchObject({ ok: false, status: 404 });
    expect(await removeMoment(other, id)).toMatchObject({ ok: false, status: 404 });

    // Momen yang mulai dalam 3 hari menjadi sinyal MOMEN; ikut terhapus bersama momennya.
    await db.query(`SELECT dash_radar_sync_moments($1, '2026-10-13')`, [NOW.toISOString()]);
    expect(await count(`"TrendSignal" WHERE source = 'MOMEN' AND title = 'Ulang tahun ke-5'`)).toBe(1);
    expect(await removeMoment(owner, id)).toEqual({ ok: true });
    expect(await count(`"TrendSignal" WHERE source = 'MOMEN'`)).toBe(0);
  });
});

describe("knowledge base", () => {
  it("validasi: promo wajib bertanggal, jenis dan panjang diperiksa", async () => {
    expect(await saveKnowledge(owner, { jenis: "PROMO", judul: "Promo pelajar", isi: "Diskon 10% tiap Jumat" }, NOW)).toMatchObject({ ok: false, error: "Promo wajib punya tanggal berakhir." });
    expect(await saveKnowledge(owner, { jenis: "RAHASIA", judul: "x", isi: "y" }, NOW)).toMatchObject({ ok: false, status: 400 });
    expect(await saveKnowledge(owner, { jenis: "FAKTA", judul: "Jam buka", isi: "a".repeat(601) }, NOW)).toMatchObject({ ok: false, status: 400 });
    expect(await saveKnowledge(owner, { jenis: "FAKTA", judul: "Jam buka", isi: "10 pagi", accountId: "a3" }, NOW)).toMatchObject({ ok: false, status: 404 });
  });

  it("pemilik menyimpan butir workspace dan butir akun; larangan disimpan per baris; tercatat di audit", async () => {
    const fact = await saveKnowledge(owner, { jenis: "FAKTA", judul: "Jam buka", isi: "  10.00   sampai 22.00 " }, NOW);
    const promo = await saveKnowledge(owner, { jenis: "PROMO", judul: "Promo pelajar", isi: "Diskon 10% tiap Jumat", berlakuSampai: "2026-10-31", accountId: "a1" }, NOW);
    const ban = await saveKnowledge(owner, { jenis: "LARANGAN", judul: "Kata", isi: "murahan\n\n  kompetitor   sebelah " }, NOW);
    expect([fact.ok, promo.ok, ban.ok]).toEqual([true, true, true]);
    // Balasan memuat butir yang tersimpan (sudah dirapikan), supaya klien tidak perlu memuat ulang daftar.
    expect(fact.ok && fact.item).toMatchObject({ jenis: "FAKTA", judul: "Jam buka", isi: "10.00 sampai 22.00", accountId: null, berlakuSampai: null });
    expect(ban.ok && ban.item.isi).toBe("murahan\nkompetitor sebelah");
    const items = (await listKnowledgePage(owner)).items;
    expect(items.map((k) => [k.jenis, k.judul, k.isi, k.accountId, k.berlakuSampai])).toEqual([
      ["FAKTA", "Jam buka", "10.00 sampai 22.00", null, null],
      ["LARANGAN", "Kata", "murahan\nkompetitor sebelah", null, null],
      ["PROMO", "Promo pelajar", "Diskon 10% tiap Jumat", "a1", "2026-10-31"],
    ]);
    expect(await count(`"DashboardAuditLog" WHERE action = 'KNOWLEDGE_SIMPAN' AND actor = 'u-owner'`)).toBe(3);
  });

  it("pengguna berlingkup akun hanya melihat dan mengubah butir akunnya", async () => {
    const all = (await listKnowledgePage(owner)).items;
    const promoA1 = all.find((k) => k.accountId === "a1")!;
    const factWs = all.find((k) => k.jenis === "FAKTA")!;

    // Melihat: butir workspace (dibaca) + butir akunnya sendiri; butir akun lain tidak.
    expect((await listKnowledgePage(scoped)).items.map((k) => k.judul).sort()).toEqual(["Jam buka", "Kata"]);
    // Tidak boleh membuat butir tingkat workspace, mengubah butir akun lain, atau butir workspace.
    expect(await saveKnowledge(scoped, { jenis: "FAKTA", judul: "Semua akun", isi: "tidak boleh" }, NOW)).toMatchObject({ ok: false, status: 403 });
    expect(await saveKnowledge(scoped, { id: promoA1.id, jenis: "PROMO", judul: "Dibajak", isi: "x y z", berlakuSampai: "2026-10-31", accountId: "a2" }, NOW)).toMatchObject({ ok: false, status: 404 });
    expect(await saveKnowledge(scoped, { id: factWs.id, jenis: "FAKTA", judul: "Dibajak", isi: "x y z", accountId: "a2" }, NOW)).toMatchObject({ ok: false, status: 404 });
    expect(await removeKnowledge(scoped, promoA1.id, NOW)).toMatchObject({ ok: false, status: 404 });
    expect(await removeKnowledge(scoped, factWs.id, NOW)).toMatchObject({ ok: false, status: 404 });

    const own = await saveKnowledge(scoped, { jenis: "FAKTA", judul: "Alamat cabang 2", isi: "Jl. Mawar No. 2", accountId: "a2" }, NOW);
    if (!own.ok) throw new Error(own.error);
    expect(await removeKnowledge(scoped, own.item.id, NOW)).toEqual({ ok: true });
    expect(await removeKnowledge(other, factWs.id, NOW)).toMatchObject({ ok: false, status: 404 });
    expect((await listKnowledgePage(owner)).items).toHaveLength(3);
  });

  it("butir aktif untuk tick: butir workspace + butir akun, promo kedaluwarsa tidak ikut", async () => {
    await db.exec(`INSERT INTO "AutopilotConfig" ("accountId", "workspaceId") VALUES ('a1', 'ws1'), ('a2', 'ws1')`);
    const active = async (ids: string[], today: string) =>
      (await db.query<{ r: { jenis: string; accountId: string | null }[] }>(`SELECT dash_kb_active($1, $2) AS r`, [ids, today])).rows[0].r;
    expect((await active(["a1"], "2026-10-13")).map((k) => k.jenis).sort()).toEqual(["FAKTA", "LARANGAN", "PROMO"]);
    expect((await active(["a2"], "2026-10-13")).map((k) => k.jenis).sort()).toEqual(["FAKTA", "LARANGAN"]);
    expect((await active(["a1"], "2026-11-01")).map((k) => k.jenis).sort()).toEqual(["FAKTA", "LARANGAN"]);
  });
});

describe("bank ide", () => {
  const idea = (id: string, accountId: string, workspaceId: string, score: number) => ({
    id,
    workspaceId,
    accountId,
    topik: `topik ${id}`,
    topicKey: `topik ${id}`,
    sudut: null,
    formulaHook: "pertanyaan",
    pilar: null,
    signalIds: [],
    score,
    scoreDetail: { sinyal: 0.3, kebaruan: 1, kecocokan: 0.75, kinerja: 0.5 },
    expiresAt: new Date(NOW.getTime() + 7 * 86_400_000).toISOString(),
  });

  it("daftar dibatasi lingkup akun pengguna dan workspace", async () => {
    await insertIdeas([idea("i-a1", "a1", "ws1", 0.7), idea("i-a2", "a2", "ws1", 0.6), idea("i-a3", "a3", "ws2", 0.9)], NOW);
    const forOwner = await listIdeaPage(owner, { view: "ready", accountId: null, cursor: null });
    if ("ok" in forOwner) throw new Error(forOwner.error);
    expect(forOwner.items.map((i) => i.id).sort()).toEqual(["i-a1", "i-a2"]);
    expect(forOwner.items[0].account.username).toMatch(/^akun/);
    const forScoped = await listIdeaPage(scoped, { view: "ready", accountId: null, cursor: null });
    if ("ok" in forScoped) throw new Error(forScoped.error);
    expect(forScoped.items.map((i) => i.id)).toEqual(["i-a2"]);
    expect(await listIdeaPage(scoped, { view: "ready", accountId: "a1", cursor: null })).toMatchObject({ ok: false, status: 404 });
  });

  it("sematkan, lepas, tolak: hanya dalam lingkup dan hanya ide yang masih siap", async () => {
    expect(await actOnIdea(scoped, "i-a1", "pin", NOW)).toMatchObject({ ok: false, status: 409 });
    expect(await actOnIdea(other, "i-a1", "reject", NOW)).toMatchObject({ ok: false, status: 409 });
    expect(await actOnIdea(owner, "i-a1", "pin", NOW)).toEqual({ ok: true });
    let row = await db.query<{ pinnedBy: string | null; status: string }>(`SELECT "pinnedBy", status FROM "ContentIdea" WHERE id = 'i-a1'`);
    expect(row.rows[0]).toEqual({ pinnedBy: "u-owner", status: "BARU" });

    // Ide yang disematkan menjadi kandidat pertama meski skornya lebih rendah.
    await insertIdeas([idea("i-a1-tinggi", "a1", "ws1", 0.99)], NOW);
    const cand = (await db.query<{ r: { id: string }[] }>(`SELECT dash_idea_candidates($1, $2, 5) AS r`, [["a1"], NOW.toISOString()])).rows[0].r;
    expect(cand.map((c) => c.id)).toEqual(["i-a1", "i-a1-tinggi"]);

    expect(await actOnIdea(owner, "i-a1", "unpin", NOW)).toEqual({ ok: true });
    expect(await actOnIdea(owner, "i-a1", "reject", NOW)).toEqual({ ok: true });
    row = await db.query(`SELECT "pinnedBy", status FROM "ContentIdea" WHERE id = 'i-a1'`);
    expect(row.rows[0]).toEqual({ pinnedBy: null, status: "DITOLAK" });
    expect(await actOnIdea(owner, "i-a1", "pin", NOW)).toMatchObject({ ok: false, status: 409 });
    const dropped = await listIdeaPage(owner, { view: "dropped", accountId: null, cursor: null });
    if ("ok" in dropped) throw new Error(dropped.error);
    expect(dropped.items.map((i) => i.id)).toEqual(["i-a1"]);
  });

  it("bersih-bersih menandai ide lewat masa berlaku dan membuang sinyal lama", async () => {
    await insertIdeas([{ ...idea("i-basi", "a1", "ws1", 0.5), expiresAt: new Date(NOW.getTime() + 1000).toISOString() }], NOW);
    await db.query(`SELECT dash_radar_prune($1)`, [new Date(NOW.getTime() + 40 * 86_400_000).toISOString()]);
    expect((await db.query<{ status: string }>(`SELECT status FROM "ContentIdea" WHERE id = 'i-basi'`)).rows[0].status).toBe("KEDALUWARSA");
    expect(await count(`"TrendSignal"`)).toBe(0);
  });
});
