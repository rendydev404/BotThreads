import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootDb, pgRpc, type TestDb } from "./helpers/pg";

/** Fungsi baca rencana posting (sql/021) di Postgres sungguhan: bentuk keluaran, lingkup, dan indeks. */
describe("sql/021 rencana posting", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await bootDb([
      "sql/002_dashboard_post_log.sql",
      "sql/003_dashboard_rpc.sql",
      "sql/005_autopilot.sql",
      "sql/006_autopilot_radar.sql",
      "sql/021_autopilot_plan_view.sql",
    ]);
    const draft = (text: string, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ text, angle: "sudut", pillar: "Edukasi", checks: [{ key: "x", ok: true }], ...extra }).replace(/'/g, "''");
    await db.exec(`
      INSERT INTO "AutopilotSlot" (id, "workspaceId", "accountId", "dayKey", "slotIndex", "slotAt", hour, status, "ideaId", draft) VALUES
        ('s1', 'ws1', 'a1', '2026-10-17', 0, '2026-10-17 04:00', 11, 'TERANTRE', 'i1', '${draft("halo pagi", { idea: { id: "i1", topik: "sarapan" }, topicKey: "sarapan" })}'),
        ('s2', 'ws1', 'a1', '2026-10-17', 1, '2026-10-17 09:00', 16, 'TERANTRE', NULL, '${draft("promo sore", { promo: true })}'),
        ('s3', 'ws1', 'a2', '2026-10-17', 0, '2026-10-17 05:00', 12, 'TERANTRE', NULL, '${draft("produk", { affiliate: { nama: "Botol minum" } })}'),
        ('s4', 'ws1', 'a1', '2026-10-17', 2, '2026-10-17 12:00', 19, 'DIRENCANAKAN', NULL, NULL),
        ('s5', 'ws2', 'a9', '2026-10-17', 0, '2026-10-17 04:00', 11, 'TERANTRE', NULL, '${draft("milik workspace lain")}'),
        ('s6', 'ws1', 'a1', '2026-10-18', 0, '2026-10-18 04:00', 11, 'TERANTRE', NULL, '${draft("besok")}');
      INSERT INTO "TrendSignal" (id, source, title, summary, url, score, hash, "capturedAt", "expiresAt") VALUES
        ('t1', 'WEB', 'bubur diaduk', 'warganet debat', 'https://detik.com/a', 0.9, 'h1', now(), now() + interval '1 day'),
        ('t2', 'GTRENDS', 'tanggal tua', NULL, NULL, 0.6, 'h2', now(), now() + interval '1 day');
      INSERT INTO "ContentIdea" (id, "workspaceId", "accountId", topik, "topicKey", sudut, "formulaHook", pilar, "signalIds", score, "scoreDetail", "expiresAt", "createdAt", "updatedAt") VALUES
        ('i1', 'ws1', 'a1', 'sarapan', 'sarapan', 'pagi', 'pertanyaan', 'Edukasi', '{t1,t2}', 0.8, '{"viral":0.75,"alasan":"semua orang sarapan"}', now() + interval '1 day', now(), now()),
        ('i2', 'ws1', 'a1', 'ide lama', 'ide lama', NULL, NULL, NULL, '{}', 0.5, '{"sinyal":0.3}', now() + interval '1 day', now(), now()),
        ('i3', 'ws2', 'a9', 'milik lain', 'milik lain', NULL, NULL, NULL, '{}', 0.5, '{"viral":"bukan angka"}', now() + interval '1 day', now(), now());
    `);
  });
  afterAll(() => db?.close());

  it("dash_ap_plan_drafts: hanya hari, workspace, dan akun yang diminta; kolom tampilan saja", async () => {
    const rows = await pgRpc<Record<string, unknown>[]>(db, "dash_ap_plan_drafts", {
      p_workspace: "ws1",
      p_day: "2026-10-17",
      p_account_ids: ["a1", "a2", "a9"],
    });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(Object.keys(byId).sort()).toEqual(["s1", "s2", "s3"]);
    expect(byId.s1).toEqual({
      id: "s1",
      ideaId: "i1",
      text: "halo pagi",
      angle: "sudut",
      pillar: "Edukasi",
      promo: false,
      topik: "sarapan",
      topicKey: "sarapan",
      affiliate: null,
    });
    expect(byId.s2).toMatchObject({ promo: true, topik: null });
    expect(byId.s3).toMatchObject({ affiliate: "Botol minum" });
    // Tanpa workspace (super admin), lingkup akun tetap berlaku.
    const all = await pgRpc<{ id: string }[]>(db, "dash_ap_plan_drafts", { p_workspace: null, p_day: "2026-10-17", p_account_ids: ["a9"] });
    expect(all.map((r) => r.id)).toEqual(["s5"]);
  });

  it("dash_radar_signal_briefs dan dash_idea_details", async () => {
    const signals = await pgRpc<{ id: string }[]>(db, "dash_radar_signal_briefs", { p_ids: ["t1", "t2", "tidak-ada"] });
    expect(signals.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "t1", source: "WEB", title: "bubur diaduk", summary: "warganet debat", url: "https://detik.com/a" },
      { id: "t2", source: "GTRENDS", title: "tanggal tua", summary: null, url: null },
    ]);

    const ideas = await pgRpc<Record<string, unknown>[]>(db, "dash_idea_details", { p_ids: ["i1", "i2", "i3"], p_workspace: "ws1" });
    const byId = Object.fromEntries(ideas.map((r) => [r.id, r]));
    expect(Object.keys(byId).sort()).toEqual(["i1", "i2"]);
    expect(byId.i1).toMatchObject({ signalIds: ["t1", "t2"], viral: 0.75, alasan: "semua orang sarapan", formulaHook: "pertanyaan" });
    expect(byId.i2).toMatchObject({ viral: null, alasan: null, signalIds: [] });
    // Nilai viral yang bukan angka tidak diteruskan.
    const other = await pgRpc<Record<string, unknown>[]>(db, "dash_idea_details", { p_ids: ["i3"], p_workspace: null });
    expect(other[0]).toMatchObject({ viral: null });
  });

  it("draf satu hari memakai indeks hari (bukan pindai seluruh tabel)", async () => {
    await db.exec(`
      INSERT INTO "AutopilotSlot" (id, "workspaceId", "accountId", "dayKey", "slotIndex", "slotAt", hour, status, draft)
      SELECT 'x' || g, 'ws' || (g % 40), 'acc' || (g % 300), DATE '2026-01-01' + (g % 280), (g / 300) % 6,
             TIMESTAMP '2026-01-01' + (g || ' minutes')::interval, 10, 'TERBIT', '{"text":"x"}'::jsonb
      FROM generate_series(1, 20000) g ON CONFLICT DO NOTHING;
      ANALYZE "AutopilotSlot";
    `);
    const plan = await db.query<{ "QUERY PLAN": string }>(`
      EXPLAIN SELECT s.id FROM "AutopilotSlot" s
      WHERE s."dayKey" = DATE '2026-10-17' AND s."workspaceId" = 'ws1' AND s."accountId" = ANY(ARRAY['a1','a2']) AND s.draft IS NOT NULL`);
    const text = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    expect(text).toMatch(/Index|Bitmap/);
    expect(text).not.toMatch(/Seq Scan on "AutopilotSlot"/);
  });
});
