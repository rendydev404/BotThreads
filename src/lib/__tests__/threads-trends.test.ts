/**
 * "Viral di Threads" (threads-trends.ts): posting terpopuler per topik tren, dengan pengaman bahwa
 * hasil yang hanya berisi posting akun sendiri (izin pencarian publik belum disetujui) tidak disimpan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ accounts: [] as { username: string; accessToken: string; scopes: string[] }[] }));

vi.mock("../supabase", () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    not: () => chain,
    limit: () => Promise.resolve({ data: h.accounts, error: null }),
  };
  return { db: () => ({ from: () => chain }) };
});
vi.mock("../threads-token", () => ({ decryptThreadsToken: (s: string) => `tok:${s}` }));

import { threadsAuthorFromUrl } from "../radar-types";
import type { TrendItem } from "../radar-sources";
import { captureThreadsViral, viralToSignals } from "../threads-trends";

const NOW = new Date("2026-10-15T05:00:00Z");
const topic = (keyword: string, rank: number): TrendItem => ({ keyword, rank, traffic: 20000, context: null });
const post = (id: string, username: string, text = "Teks posting yang cukup panjang untuk ditampilkan") => ({
  id,
  username,
  text,
  permalink: `https://www.threads.com/@${username}/post/${id}`,
  timestamp: "2026-10-15T03:00:00+0000",
});

let responses: Record<string, unknown[]>;
beforeEach(() => {
  process.env.THREADS_SEARCH_USERNAME = "akunsaya";
  h.accounts = [{ username: "akunsaya", accessToken: "enc", scopes: ["threads_basic", "threads_keyword_search"] }];
  responses = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) => {
      const q = new URL(String(url)).searchParams.get("q") ?? "";
      return new Response(JSON.stringify({ data: responses[q] ?? [] }), { status: 200 });
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("threadsAuthorFromUrl", () => {
  it("membaca username dari permalink Threads dan menolak tautan lain", () => {
    expect(threadsAuthorFromUrl("https://www.threads.com/@Budi.Santoso/post/DAbc_12")).toBe("budi.santoso");
    expect(threadsAuthorFromUrl("https://threads.net/@kopi/post/X1")).toBe("kopi");
    expect(threadsAuthorFromUrl("https://evil.example/@kopi/post/X1")).toBeNull();
    expect(threadsAuthorFromUrl(null)).toBeNull();
  });
});

describe("viralToSignals", () => {
  it("maksimal 3 posting per topik, buang tanpa permalink, teks pendek, atau topik sensitif", () => {
    const posts = [
      post("1", "a"),
      { ...post("2", "b"), permalink: "https://example.com/x" },
      post("3", "c", "pendek"),
      post("4", "d", "Berita korupsi pejabat yang sedang ramai dibahas warganet"),
      post("5", "e"),
      post("6", "f"),
      post("7", "g"),
    ];
    const out = viralToSignals(topic("timnas", 1), posts, 10, NOW);
    expect(out.map((s) => (s.raw as { username: string }).username)).toEqual(["a", "e", "f"]);
    expect(out[0]).toMatchObject({ source: "THREADS_SEARCH", workspaceId: null, title: "timnas", url: "https://www.threads.com/@a/post/1" });
    expect(out[0].hash).toBe("THREADS_SEARCH:2026-10-15:1");
    expect(out[0].score).toBeGreaterThan(out[2].score);
  });
});

describe("captureThreadsViral", () => {
  it("izin pencarian publik belum disetujui: hasil hanya posting sendiri tidak disimpan", async () => {
    responses = { timnas: [post("1", "akunsaya")], kuliner: [] };
    const r = await captureThreadsViral([topic("timnas", 1), topic("kuliner", 2)], NOW);
    expect(r).toEqual({ signals: [], status: "not_approved" });
  });

  it("izin aktif: posting akun lain disimpan, posting sendiri disaring", async () => {
    responses = { timnas: [post("1", "akunsaya"), post("2", "warga1"), post("3", "warga2")] };
    const r = await captureThreadsViral([topic("timnas", 1)], NOW);
    expect(r.status).toBe("ok");
    expect(r.signals.map((s) => (s.raw as { username: string }).username)).toEqual(["warga1", "warga2"]);
  });

  it("tanpa akun berizin pencarian tidak memanggil Threads sama sekali", async () => {
    h.accounts = [{ username: "akunsaya", accessToken: "enc", scopes: ["threads_basic"] }];
    const r = await captureThreadsViral([topic("timnas", 1)], NOW);
    expect(r.status).toBe("no_token");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("token akun pelanggan tidak dipakai: hanya akun THREADS_SEARCH_USERNAME, tanpa env tidak mencari", async () => {
    h.accounts = [{ username: "pelanggan1", accessToken: "enc", scopes: ["threads_basic", "threads_keyword_search"] }];
    expect((await captureThreadsViral([topic("timnas", 1)], NOW)).status).toBe("no_token");
    delete process.env.THREADS_SEARCH_USERNAME;
    h.accounts = [{ username: "akunsaya", accessToken: "enc", scopes: ["threads_basic", "threads_keyword_search"] }];
    expect((await captureThreadsViral([topic("timnas", 1)], NOW)).status).toBe("no_token");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("topik sensitif tidak dicari", async () => {
    await captureThreadsViral([topic("demo buruh", 1), topic("kopi susu", 2)], NOW);
    const asked = (fetch as unknown as { mock: { calls: [URL][] } }).mock.calls.map(([u]) => new URL(String(u)).searchParams.get("q"));
    expect(asked).toEqual(["kopi susu"]);
  });
});
