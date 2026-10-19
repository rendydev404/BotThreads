/**
 * Uji integrasi tren niche: tick asli + SQL asli (sql/002, 003, 005, 006, 027 di Postgres in-memory).
 * Yang di-mock hanya batas sistem: transport ke database (rpc -> PGlite) dan API LLM.
 *
 * Alur yang diuji: tick pertama meriset tren yang lagi naik di niche tiap akun (tema dari pengaturan, atau
 * disimpulkan dari postingan bila tema kosong) dan menunda ide akun itu; tick berikutnya menyusun ide dari
 * tren niche tersebut, dengan rujukan sinyal yang tersimpan.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./helpers/pg";

const h = vi.hoisted(() => ({
  db: null as unknown,
  calls: [] as string[],
  nichePrompts: [] as string[],
  ideaPrompts: [] as string[],
  llmCalls: 0,
}));

vi.mock("@supabase/supabase-js", async () => (await import("./helpers/pg")).supabaseMock(() => h.db as TestDb, h.calls));

vi.mock("@/lib/gemini", async (original) => ({
  ...(await original<typeof import("@/lib/gemini")>()),
  generateWithFailover: vi.fn(async (opts: { system: string; contents: { parts: { text: string }[] }[] }) => {
    const prompt = opts.contents[0].parts[0].text;
    const handle = /AKUN: @(\S+)/.exec(prompt)?.[1] ?? "x";
    h.llmCalls++;
    if (opts.system.startsWith("Anda peneliti tren untuk SATU niche")) {
      h.nichePrompts.push(prompt);
      const ai = prompt.includes("teknologi AI");
      const topics = ai
        ? [
            { judul: "Rilis agen coding baru", ringkasan: "Agen coding baru dirilis kemarin dan ramai dicoba developer.", alasan: "Developer membandingkan dengan alat lama.", panas: 5, url: "https://www.theverge.com/ai/agen" },
            { judul: "Debat prompt panjang vs pendek", ringkasan: "Warganet ramai berdebat soal panjang prompt yang ideal minggu ini.", alasan: "Semua pengguna AI punya kebiasaan sendiri.", panas: 4 },
          ]
        : [
            { judul: "Menu bekal viral telur gulung", ringkasan: "Ibu-ibu ramai membagikan bekal telur gulung warna-warni sejak kemarin.", alasan: "Gampang ditiru dan anak suka.", panas: 4 },
            { judul: "Hasil pilkada di kota", ringkasan: "Penghitungan suara pilkada berlangsung hari ini di banyak kota.", alasan: "Ramai dibahas.", panas: 5 },
          ];
      const json = { niche: ai ? "teknologi AI untuk developer" : "ibu rumah tangga dan bekal anak", topics };
      return { text: JSON.stringify(json), json, model: "llm-uji", groundedDomains: ["theverge.com"] };
    }
    if (opts.system.startsWith("Anda peneliti tren media sosial")) {
      const json = { topics: [] };
      return { text: JSON.stringify(json), json, model: "llm-uji" };
    }
    if (opts.system.startsWith("Anda editor media sosial")) {
      const json = { hook: 4, relevansi: 4, alami: 5, risiko: [], catatan: "" };
      return { text: JSON.stringify(json), json, model: "llm-uji" };
    }
    if (opts.system.startsWith("Anda perencana konten")) {
      h.ideaPrompts.push(prompt);
      // Nomor tren niche dari bagian prompt yang khusus untuk niche akun.
      const section = /TREN NAIK DI NICHE AKUN[^\n]*\n((?:\[\d+\][^\n]*\n?)+)/.exec(prompt)?.[1] ?? "";
      const nums = [...section.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]));
      const ideas = [1, 2, 3, 4].map((i) => ({
        topik: `${handle}tren${i}satu ${handle}tren${i}dua ${handle}tren${i}tiga obrolan hangat`,
        sudut: `arah ${i}`,
        formulaHook: "pertanyaan",
        pilar: "",
        sinyal: nums.length ? [nums[(i - 1) % nums.length]] : [],
        kecocokan: 4,
        potensiViral: 4,
        alasan: "lagi naik di niche akun",
      }));
      return { text: JSON.stringify({ ideas }), json: { ideas }, model: "llm-uji" };
    }
    const drafts = [1, 2, 3].map((n) => ({
      text: Array.from({ length: 10 }, (_, k) => `${handle}c${h.llmCalls}n${n}w${k}`).join(" ") + " gimana menurut kalian?",
      angle: `Sudut ${n}`,
      rationale: "Cocok dengan gaya akun",
      suggestedHourWib: 12,
      inspiredBy: 0,
    }));
    return { text: JSON.stringify({ drafts }), json: { drafts }, model: "llm-uji" };
  }),
}));

// Sumber tren luar tidak boleh benar-benar dipanggil dari uji.
vi.mock("@/lib/radar-sources", async (original) => ({
  ...(await original<typeof import("@/lib/radar-sources")>()),
  fetchGoogleTrends: vi.fn(async () => []),
}));

import { bootDb, useTestSupabaseEnv } from "./helpers/pg";
import { upsertConfigs } from "../autopilot-store";
import { runTick } from "../autopilot-tick";
import { DEFAULT_SETTINGS } from "../autopilot-types";
import { listSignalPage } from "../radar-service";
import type { RequestCtx } from "../request-ctx";

// Senin 19 Okt 2026, 10.00 WIB
const T0 = new Date("2026-10-19T03:00:00Z");
const MIN = 60_000;
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN);
const tick = async (minutes: number) => {
  vi.setSystemTime(at(minutes));
  h.calls.length = 0;
  return runTick({ now: at(minutes) });
};

let db: TestDb;

beforeAll(async () => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  useTestSupabaseEnv();
  process.env.GEMINI_API_KEY = "kunci-uji";
  // Google News (jalur cadangan riset) tidak boleh benar-benar dipanggil dari uji: umpan kosong.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("<rss><channel></channel></rss>", { status: 200 })));
  process.env.CONTENT_PUBLISH_ENABLED = "true";
  delete process.env.CONTENT_PUBLISH_TEST_ACCOUNTS;
  delete process.env.EXCLUDED_THREADS_ACCOUNTS;

  db = await bootDb([
    "sql/002_dashboard_post_log.sql",
    "sql/003_dashboard_rpc.sql",
    "sql/005_autopilot.sql",
    "sql/006_autopilot_radar.sql",
    "sql/027_radar_niche_trends.sql",
    "sql/028_idea_retire_stale.sql",
  ]);
  h.db = db;
  await db.exec(
    ["1", "2"]
      .map(
        (n) => `
INSERT INTO "Outlet" VALUES ('o${n}', 'ws1', 'Cabang ${n}', true);
INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "needsReconnect", "accessExpiresAt", scopes)
  VALUES ('a${n}', 'ws1', 'akun${n}', 'Akun ${n}', false, '2027-01-01', '{threads_basic,threads_content_publish}');
INSERT INTO "SocialAccount" VALUES ('s${n}', 'o${n}', 'a${n}');`
      )
      .join("\n")
  );
  // Akun 2 tanpa tema: nichenya disimpulkan dari postingan ini.
  await db.exec(
    `INSERT INTO "ThreadsPostStat" ("threadsAccountId", "mediaId", text, "postedAt", views) VALUES ${[
      "bekal anak hari ini nasi goreng bentuk beruang, semoga habis",
      "pagi-pagi udah ribut nyari kaus kaki anak yang hilang sebelah",
      "jadi ibu rumah tangga itu kerjaannya nggak ada jam pulangnya",
      "tips biar anak mau makan sayur tanpa drama di meja makan",
    ]
      .map((t, i) => `('a2', 'm-${i}', '${t}', '2026-10-1${i}T03:00:00', 1000)`)
      .join(", ")}`
  );

  const settings = { ...DEFAULT_SETTINGS, exploreRate: 0, mode: "OTOMATIS" as const };
  await upsertConfigs(
    [
      {
        accountId: "a1",
        workspaceId: "ws1",
        ...settings,
        voiceStyle: "gue_lo",
        brief: "Akun berita teknologi AI terbaru dan tips prompting untuk developer.",
      },
      { accountId: "a2", workspaceId: "ws1", ...settings },
    ],
    "u-admin",
    T0
  );
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
});

const nicheRows = async () =>
  (
    await db.query<{ id: string; accountId: string; workspaceId: string; title: string; url: string | null }>(
      `SELECT id, "accountId", "workspaceId", title, url FROM "TrendSignal" WHERE source = 'NICHE' ORDER BY "accountId", rank`
    )
  ).rows;

describe("tren niche dalam tick autopilot", () => {
  it("tick pertama meriset niche tiap akun dan menunda idenya sampai trennya ada", async () => {
    const r = await tick(0);
    expect(r.ok).toBe(true);
    expect(r.counts.risetNiche).toBe(2);
    // Tren politik pada niche akun 2 tersaring.
    expect(r.counts.trenNiche).toBe(3);

    const rows = await nicheRows();
    expect(rows.map((s) => [s.accountId, s.title])).toEqual([
      ["a1", "Rilis agen coding baru"],
      ["a1", "Debat prompt panjang vs pendek"],
      ["a2", "Menu bekal viral telur gulung"],
    ]);
    expect(rows.every((s) => s.workspaceId === "ws1")).toBe(true);
    expect(rows[0].url).toBe("https://www.theverge.com/ai/agen");

    // Tema dari pengaturan menjadi acuan; tanpa tema, contoh postingan yang dipakai.
    const forA1 = h.nichePrompts.find((p) => p.includes("teknologi AI"))!;
    expect(forA1).toContain("Tema dari pemilik akun: Akun berita teknologi AI terbaru dan tips prompting untuk developer.");
    const forA2 = h.nichePrompts.find((p) => !p.includes("teknologi AI"))!;
    expect(forA2).toContain("(tidak diisi, simpulkan dari contoh postingan)");
    expect(forA2).toContain("Contoh postingan terakhir (acuan niche):");
    expect(forA2).toContain("bekal anak hari ini nasi goreng bentuk beruang");

    // Ide belum disusun dari tren basi: menunggu tick berikutnya.
    expect(h.ideaPrompts).toHaveLength(0);
    expect(r.counts.ideBaru).toBeUndefined();
  });

  it("tick berikutnya menyusun ide dari tren niche, dengan gaya akun dan rujukan sinyal yang tersimpan", async () => {
    // Ide lama akun 1 dari sebelum riset niche: yang biasa diganti, yang disematkan pengguna dipertahankan.
    await db.exec(`
      INSERT INTO "ContentIdea" (id, "workspaceId", "accountId", topik, "topicKey", score, status, "pinnedBy", "expiresAt", "createdAt", "updatedAt")
      VALUES ('lama-biasa', 'ws1', 'a1', 'tips umum ngoding pakai AI', 'ai ngoding pakai tips umum', 0.5, 'BARU', NULL, '2026-10-26', '2026-10-18', '2026-10-18'),
             ('lama-sematan', 'ws1', 'a1', 'cerita debug semalam suntuk', 'cerita debug semalam suntuk', 0.5, 'BARU', 'u-admin', '2026-10-26', '2026-10-18', '2026-10-18')`);
    const r = await tick(5);
    expect(r.ok).toBe(true);
    expect(r.counts.risetNiche).toBeUndefined();
    expect(r.counts.ideBaru).toBe(8);
    expect(r.counts.ideLamaDiganti).toBe(1);
    const old = await db.query<{ id: string; status: string }>(`SELECT id, status FROM "ContentIdea" WHERE id LIKE 'lama-%' ORDER BY id`);
    expect(old.rows).toEqual([
      { id: "lama-biasa", status: "KEDALUWARSA" },
      { id: "lama-sematan", status: "BARU" },
    ]);

    const forA1 = h.ideaPrompts.find((p) => p.includes("AKUN: @akun1"))!;
    expect(forA1).toContain("IDE BERTREN MINIMAL");
    expect(forA1).toMatch(/TREN NAIK DI NICHE AKUN[^\n]*\n\[1\] Rilis agen coding baru/);
    expect(forA1).toContain('GAYA SAPAAN: Sapaan "gue" dan "lo"');
    expect(forA1).not.toContain("Menu bekal viral");
    const forA2 = h.ideaPrompts.find((p) => p.includes("AKUN: @akun2"))!;
    expect(forA2).toContain("TEMA AKUN: tidak diisi. Simpulkan niche dan audiens dari CONTOH POSTINGAN AKUN.");
    expect(forA2).toContain("CONTOH POSTINGAN AKUN");
    expect(forA2).not.toContain("Rilis agen coding baru");

    const rows = await nicheRows();
    const ideas = await db.query<{ accountId: string; signalIds: string[] }>(
      `SELECT "accountId", "signalIds" FROM "ContentIdea" WHERE id NOT LIKE 'lama-%' ORDER BY "accountId"`
    );
    expect(ideas.rows).toHaveLength(8);
    for (const idea of ideas.rows) {
      expect(idea.signalIds).toHaveLength(1);
      const ref = rows.find((s) => s.id === idea.signalIds[0]);
      expect(ref?.accountId).toBe(idea.accountId);
    }
  });

  it("Radar menampilkan tren niche hanya untuk akun yang boleh dilihat pengguna", async () => {
    const owner: RequestCtx = { userId: "u-owner", workspaceId: "ws1", role: "OWNER", accountIds: null };
    const scoped: RequestCtx = { userId: "u-cabang", workspaceId: "ws1", role: "EDITOR", accountIds: ["a2"] };
    const all = await listSignalPage(owner, { source: "NICHE", cursor: null }, at(6));
    expect(all.items.map((s) => s.accountId).sort()).toEqual(["a1", "a1", "a2"]);
    expect(all.lastCapture.NICHE).toBe(at(0).toISOString());
    const mine = await listSignalPage(scoped, { source: "NICHE", cursor: null }, at(6));
    expect(mine.items.map((s) => s.title)).toEqual(["Menu bekal viral telur gulung"]);
  });

  it("riset niche berikutnya baru setelah 8 jam", async () => {
    const r = await tick(4 * 60);
    expect(r.counts.risetNiche).toBeUndefined();
    // Tick sepi (tanpa riset dan tanpa ide baru) tidak membaca sinyal niche sama sekali.
    const quiet = await tick(4 * 60 + 5);
    expect(quiet.counts.risetNiche).toBeUndefined();
    expect(quiet.counts.putaranAi).toBeUndefined();
    expect(h.calls).not.toContain("dash_radar_niche");
    const later = await tick(8 * 60 + 5);
    expect(later.counts.risetNiche).toBe(2);
  });
});
