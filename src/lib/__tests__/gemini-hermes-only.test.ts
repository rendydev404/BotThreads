import { afterEach, describe, expect, it, vi } from "vitest";
import { generateWithFailover } from "../gemini";

describe("generateWithFailover providers: hermes", () => {
  const ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ENV };
    vi.unstubAllGlobals();
  });

  const opts = {
    system: "s",
    contents: [{ role: "user" as const, parts: [{ text: "u" }] }],
    responseSchema: { type: "OBJECT" as const, properties: { ok: { type: "BOOLEAN" as const } }, required: ["ok"] },
  };

  const setup = (hermesStatus: number) => {
    process.env.HERMES_API_KEY = "k";
    process.env.HERMES_BASE_URL = "http://router-hermes-only.test/v1";
    process.env.GEMINI_API_KEY = "g";
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("generativelanguage")
        ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 })
        : new Response("galat", { status: hermesStatus })
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("Hermes ditolak: null, Gemini tidak pernah dipanggil", async () => {
    const fetchMock = setup(401);
    expect(await generateWithFailover({ ...opts, providers: "hermes" })).toBeNull();
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("generativelanguage"))).toBe(true);
  });

  it("bawaan tetap jatuh ke Gemini", async () => {
    const fetchMock = setup(401);
    expect((await generateWithFailover(opts))?.json).toEqual({ ok: true });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("generativelanguage"))).toBe(true);
  });

  it("Hermes belum diatur: null tanpa panggilan jaringan", async () => {
    const fetchMock = setup(200);
    delete process.env.HERMES_API_KEY;
    delete process.env.HERMES_CUSTOM_76_13_193_138_20128_API_KEY;
    expect(await generateWithFailover({ ...opts, providers: "hermes" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
