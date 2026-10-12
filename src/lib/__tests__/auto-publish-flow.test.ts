/**
 * Alur posting otomatis di backend: POST /api/content/orchestrate dengan `publish` -> agen AI per akun
 * -> antrean (dash_create_posts). Yang di-mock hanya batas sistem: database (rpc/db Supabase) dan
 * API LLM. Tidak ada yang terkirim ke Threads; hasilnya dinilai dari peristiwa SSE dan baris yang
 * akan ditulis ke antrean.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const inserted: Record<string, unknown>[] = [];

// Rantai query PostgREST palsu: tabel DashboardUser mengembalikan pengguna aktif, tabel lain kosong.
function fakeQuery(table: string): unknown {
  let single = false;
  const chain: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          const data = table === "DashboardUser" ? { isActive: true, passwordHash: "hash-uji" } : single ? null : [];
          return (resolve: (v: unknown) => void) => resolve({ data, error: null });
        }
        if (prop === "maybeSingle" || prop === "single") single = true;
        return () => chain;
      },
    }
  );
  return chain;
}

vi.mock("@/lib/supabase", async (original) => ({
  ...(await original<typeof import("@/lib/supabase")>()),
  db: () => ({ from: (table: string) => fakeQuery(table) }),
  rpc: vi.fn(),
  excludedIdList: async () => null,
  scopedIds: async (ids?: string[]) => ids,
}));

vi.mock("@/lib/gemini", async (original) => ({
  ...(await original<typeof import("@/lib/gemini")>()),
  // LLM: tiap agen membalas 3 kandidat unik untuk akunnya (handle dibaca dari prompt).
  generateWithFailover: vi.fn(async (opts: { contents: { parts: { text: string }[] }[] }) => {
    const handle = /AKUN: @(\S+)/.exec(opts.contents[0].parts[0].text)?.[1] ?? "x";
    const drafts = [1, 2, 3].map((n) => ({
      text: `Sore ini ${handle} lagi nyobain resep saus versi ${n}, kalian tim pedas atau tim original?`,
      angle: `Sudut ${n}`,
      rationale: "Cocok dengan gaya akun",
      suggestedHourWib: 18,
      inspiredBy: 0,
    }));
    return { text: JSON.stringify({ drafts }), json: { drafts }, model: "llm-uji" };
  }),
}));

import { NextRequest } from "next/server";
import { rpc } from "@/lib/supabase";
import { SESSION_COOKIE, createSessionToken } from "@/lib/auth";
import type { OrchestrateEvent } from "@/lib/content-types";
import { POST } from "@/app/api/content/orchestrate/route";

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

let cookie = "";
beforeAll(async () => {
  process.env.AUTH_SECRET = "uji-rahasia-yang-panjangnya-lebih-dari-32-karakter";
  process.env.CONTENT_PUBLISH_ENABLED = "true";
  cookie = `${SESSION_COOKIE}=${await createSessionToken("user-uji", "hash-uji")}`;
});

beforeEach(() => {
  inserted.length = 0;
  vi.mocked(rpc).mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    switch (fn) {
      case "dash_publish_accounts":
        return [account("akun1"), account("akun2"), account("akun3"), account("rusak", { needsReconnect: true })] as never;
      case "dash_ai_context":
        return { style: [], weakest: [], recents: [], formats: [] } as never;
      case "dash_create_posts":
        inserted.push(...(args!.p_items as Record<string, unknown>[]));
        return (args!.p_items as unknown[]).length as never;
      default:
        return [] as never; // jam terbaik, antrean, replay, teks terbaru, tren jaringan
    }
  });
});

async function orchestrate(body: Record<string, unknown>) {
  const res = await POST(
    new NextRequest("http://localhost/api/content/orchestrate", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    })
  );
  if (res.status !== 200) return { status: res.status, events: [] as OrchestrateEvent[] };
  const events = (await res.text())
    .split("\n\n")
    .filter((c) => c.startsWith("data: "))
    .map((c) => JSON.parse(c.slice(6)) as OrchestrateEvent);
  return { status: res.status, events };
}

const queuedIds = (events: OrchestrateEvent[]) =>
  events.filter((e) => e.type === "queued").map((e) => (e as { accountId: string }).accountId).sort();

describe("posting otomatis dari prompt (backend)", () => {
  it("satu akun, posting sekarang: drafnya langsung masuk antrean terbit", async () => {
    const { status, events } = await orchestrate({ accountIds: ["akun1"], publish: { mode: "now", dayOffset: null, hourWib: null } });
    expect(status).toBe(200);
    expect(queuedIds(events)).toEqual(["akun1"]);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ action: "CREATE_NOW", socialAccountId: "sa-akun1" });
    expect(events.at(-1)?.type).toBe("done");
  });

  it("semua akun, dijadwalkan besok jam 19: akun siap diantrekan, akun rusak dilewati", async () => {
    const { events } = await orchestrate({ accountIds: null, publish: { mode: "schedule", dayOffset: 1, hourWib: 19 } });
    expect(queuedIds(events)).toEqual(["akun1", "akun2", "akun3"]);
    expect(inserted.map((i) => i.action)).toEqual(["CREATE_SCHEDULED", "CREATE_SCHEDULED", "CREATE_SCHEDULED"]);
    // 19.00 WIB = 12.00 UTC, sehari setelah hari ini (WIB).
    const tomorrowWib = new Date(Date.now() + 7 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
    for (const row of inserted) expect(row.tayangPada).toBe(`${tomorrowWib}T12:00:00.000Z`);
    const plan = events.find((e) => e.type === "plan") as Extract<OrchestrateEvent, { type: "plan" }>;
    expect(plan.agents.find((a) => a.id === "rusak")?.skipped).toBeTruthy();
    // "done" baru dikirim setelah semua antrean selesai.
    expect(events.findIndex((e) => e.type === "done")).toBeGreaterThan(events.findLastIndex((e) => e.type === "queued"));
  });

  it("tanpa perintah posting: hanya draf, tidak ada yang masuk antrean", async () => {
    const { events } = await orchestrate({ accountIds: null });
    expect(events.filter((e) => e.type === "draft")).toHaveLength(3);
    expect(queuedIds(events)).toEqual([]);
    expect(inserted).toHaveLength(0);
  });

  it("saklar posting mati: perintah posting ditolak sebelum AI berjalan", async () => {
    process.env.CONTENT_PUBLISH_ENABLED = "false";
    try {
      const { status } = await orchestrate({ accountIds: null, publish: { mode: "now", dayOffset: null, hourWib: null } });
      expect(status).toBe(403);
      expect(inserted).toHaveLength(0);
    } finally {
      process.env.CONTENT_PUBLISH_ENABLED = "true";
    }
  });
});
