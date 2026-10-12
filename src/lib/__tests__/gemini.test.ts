import { afterEach, describe, expect, it, vi } from "vitest";
import { describeSchema, extractJson, firstSuccess, generateWithFailover, stripReasoning } from "../gemini";

describe("extractJson", () => {
  it("JSON polos dan berpagar kode", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] });
  });

  it("mengambil objek di tengah teks pembuka dan penutup", () => {
    expect(extractJson('Berikut hasilnya:\n{"drafts":[{"text":"halo {teman}"}]}\nSemoga membantu.')).toEqual({
      drafts: [{ text: "halo {teman}" }],
    });
  });

  it("kurung di dalam string tidak mengacaukan pencarian", () => {
    expect(extractJson('catatan {"text":"a } b \\" c"} selesai')).toEqual({ text: 'a } b " c' });
  });

  it("membuang blok berpikir sebelum mem-parse", () => {
    expect(extractJson('<think>pilih {x}</think>{"ok":true}')).toEqual({ ok: true });
  });

  it("melempar bila tidak ada JSON", () => {
    expect(() => extractJson("2. **Drafting the Content (Threads Post):**")).toThrow();
  });
});

describe("stripReasoning", () => {
  it("membuang blok berpikir utuh maupun yang pembukanya terpotong", () => {
    expect(stripReasoning("<think>a</think>hasil")).toBe("hasil");
    expect(stripReasoning("sisa pikiran</think>\nhasil")).toBe("hasil");
  });
});

describe("describeSchema", () => {
  it("meringkas skema dengan penanda opsional", () => {
    const text = describeSchema({
      type: "OBJECT",
      properties: { text: { type: "STRING" }, hour: { type: "INTEGER" }, tag: { type: "STRING", description: "boleh kosong" } },
      required: ["text", "hour"],
    });
    expect(text).toBe('{ "text": string, "hour": integer, "tag"?: string (boleh kosong) }');
  });
});

describe("firstSuccess", () => {
  afterEach(() => vi.useRealTimers());

  it("mengulang berurutan sampai ada hasil", async () => {
    const run = vi.fn(async (attempt: number) => (attempt === 3 ? "ok" : null));
    expect(await firstSuccess(3, null, run)).toBe("ok");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("null bila semua percobaan gagal, termasuk yang melempar", async () => {
    const run = vi.fn(async (attempt: number) => {
      if (attempt === 2) throw new Error("putus");
      return null;
    });
    expect(await firstSuccess(3, null, run)).toBeNull();
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("hedging: percobaan kedua dikirim sejajar dan pemenang membatalkan yang lain", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const run = vi.fn((attempt: number, signal: AbortSignal) => {
      signals.push(signal);
      // Percobaan pertama menggantung; yang kedua selesai cepat.
      return attempt === 1 ? new Promise<string | null>(() => {}) : Promise.resolve("cepat");
    });
    const pending = firstSuccess(3, 1000, run);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBe("cepat");
    expect(run).toHaveBeenCalledTimes(2);
    expect(signals[0].aborted).toBe(true);
  });

  it("berhenti saat pemanggil membatalkan", async () => {
    const parent = new AbortController();
    const pending = firstSuccess(3, null, () => new Promise<string | null>(() => {}), parent.signal);
    parent.abort();
    expect(await pending).toBeNull();
  });
});

describe("generateWithFailover (router Hermes)", () => {
  const ENV = { ...process.env };
  const reply = (content: string, extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ model: "hulu-x", choices: [{ message: { content }, finish_reason: "stop", ...extra }] }), {
      status: 200,
    });

  afterEach(() => {
    process.env = { ...ENV };
    vi.unstubAllGlobals();
  });

  const setup = (responses: Response[]) => {
    process.env.HERMES_API_KEY = "k";
    process.env.HERMES_BASE_URL = "http://router.test/v1";
    delete process.env.GEMINI_API_KEY;
    const fetchMock = vi.fn(async () => responses.shift() ?? reply(""));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  const opts = {
    system: "s",
    contents: [{ role: "user" as const, parts: [{ text: "u" }] }],
    responseSchema: { type: "OBJECT" as const, properties: { text: { type: "STRING" as const } }, required: ["text"] },
    validate: (j: unknown) => typeof (j as { text?: unknown })?.text === "string",
  };

  it("balasan kosong (HTTP 200) diulang sampai model hulu lain menjawab", async () => {
    const fetchMock = setup([reply("", { finish_reason: "in_progress" }), reply('{"text":"halo"}')]);
    const result = await generateWithFailover(opts);
    expect(result).toMatchObject({ model: "hulu-x", json: { text: "halo" }, attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("catatan berpikir tanpa JSON ditolak lalu diulang", async () => {
    const fetchMock = setup([reply("2. **Drafting the Content:**"), reply('```json\n{"text":"siap"}\n```')]);
    expect((await generateWithFailover(opts))?.json).toEqual({ text: "siap" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("null (bukan teks sampah) bila semua percobaan tidak layak", async () => {
    const fetchMock = setup([reply(""), reply("bukan json"), reply('{"lain":1}')]);
    expect(await generateWithFailover(opts)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
