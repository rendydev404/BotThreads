/**
 * Klien LLM dengan failover berlapis.
 *
 * 1. Router Hermes (9Router, API bergaya OpenAI). Model "combo" merotasi beberapa model hulu, dan
 *    sebagian balasannya kosong walau HTTP 200 (finish_reason "in_progress") atau berisi catatan
 *    berpikir model. Karena itu setiap balasan diperiksa lalu diulang: rotasi combo membuat
 *    percobaan berikutnya jatuh ke model hulu lain.
 * 2. Gemini langsung sebagai cadangan. Kuota gratis dihitung per model; saat satu model kena
 *    429/404/5xx, lanjut ke model berikutnya dan model itu "diistirahatkan" sementara.
 *
 * Mode JSON (opsional): `responseSchema` memaksa keluaran terstruktur. Hasil di-parse dan (bila ada)
 * divalidasi lewat `validate`; kegagalan parse/validasi dicoba ulang tanpa mengistirahatkan model
 * (bukan salah kuota).
 *
 * Env: HERMES_API_KEY, HERMES_BASE_URL (atau HERMES_HOST + NINE_ROUTER_PORT), HERMES_MODELS,
 * GEMINI_API_KEY, GEMINI_MODELS.
 */

const DEFAULT_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.7-flash",
  "gemini-3.1-flash-lite",
];
const DEFAULT_HERMES_MODELS = ["hermes-combo"];

const COOLDOWN_QUOTA_MS = 30 * 60 * 1000; // kuota habis
const COOLDOWN_ERROR_MS = 2 * 60 * 1000; // error sementara / model tak tersedia
const blockedUntil = new Map<string, number>();

/** Percobaan per model Hermes sebelum pindah ke model/penyedia berikutnya. */
const HERMES_ATTEMPTS = 3;
/** Router dianggap mati setelah sekian kegagalan koneksi beruntun; dilewati sementara. */
const BREAKER_THRESHOLD = 4;
const BREAKER_OPEN_MS = 60 * 1000;
/** Sisa waktu minimal supaya satu percobaan masih layak dimulai. */
const MIN_ATTEMPT_MS = 1500;
const hermesBreaker = { failures: 0, openUntil: 0 };

export interface GeminiContent {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

export interface GeminiResult {
  text: string;
  model: string;
  /** Terisi pada mode JSON: hasil parse yang lolos `validate`. */
  json?: unknown;
  /** Jumlah percobaan sampai berhasil (untuk log/observabilitas). */
  attempts?: number;
  /** Mode `googleSearch`: domain sumber yang benar-benar dibuka Google Search (grounding). */
  groundedDomains?: string[];
}

/** Subset OpenAPI schema yang dipahami Gemini (tipe HURUF BESAR). */
export interface GeminiSchema {
  type: "OBJECT" | "ARRAY" | "STRING" | "INTEGER" | "NUMBER" | "BOOLEAN";
  description?: string;
  properties?: Record<string, GeminiSchema>;
  items?: GeminiSchema;
  required?: string[];
  enum?: string[];
  nullable?: boolean;
}

export interface GenerateOptions {
  system: string;
  contents: GeminiContent[];
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  /** Batas total semua percobaan; lewat dari ini berhenti dan mengembalikan null. */
  deadlineMs?: number;
  /** Aktifkan keluaran JSON terstruktur. */
  responseSchema?: GeminiSchema;
  /** Kembalikan false bila hasil parse tidak layak sehingga percobaan berikutnya dijalankan. */
  validate?: (json: unknown) => boolean;
  /** Pembatalan dari pemanggil (mis. klien menutup koneksi). */
  signal?: AbortSignal;
  /** Kirim percobaan sejajar bila belum ada balasan setelah sekian ms (memangkas latensi ekor). */
  hedgeMs?: number;
  /**
   * Izinkan model mencari di Google (grounding) untuk fakta terkini. Hanya lewat Gemini langsung (router
   * Hermes tidak punya alat pencarian). Skema JSON tidak dikirim sebagai `responseSchema` (tidak semua
   * model menerimanya bersama alat), melainkan sebagai instruksi format lalu di-parse seperti biasa.
   */
  googleSearch?: boolean;
}

const listEnv = (name: string): string[] | null => {
  const list = process.env[name]
    ?.split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return list?.length ? list : null;
};

const modelChain = (): string[] => listEnv("GEMINI_MODELS") ?? DEFAULT_MODELS;

function hermesConfig(): { url: string; key: string; models: string[] } | null {
  const key = process.env.HERMES_API_KEY || process.env.HERMES_CUSTOM_76_13_193_138_20128_API_KEY;
  const host = process.env.HERMES_HOST;
  const port = process.env.NINE_ROUTER_PORT;
  const base = process.env.HERMES_BASE_URL || (host && port ? `http://${host}:${port}/v1` : "");
  if (!key || !base) return null;
  return {
    url: `${base.replace(/\/+$/, "")}/chat/completions`,
    key,
    models: listEnv("HERMES_MODELS") ?? DEFAULT_HERMES_MODELS,
  };
}

/** Buang pagar kode ```json yang kadang membungkus keluaran. */
function stripFence(text: string): string {
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text.trim());
  return (m ? m[1] : text).trim();
}

/** Buang blok berpikir yang ikut terbawa di isi balasan sebagian model. */
export const stripReasoning = (text: string): string =>
  text
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .replace(/^[\s\S]*<\/think(?:ing)?>/i, "")
    .trim();

/**
 * Ambil nilai JSON dari balasan model: langsung, di dalam pagar kode, atau objek/array seimbang
 * pertama di tengah teks lain. Melempar bila tidak ada JSON yang valid.
 */
export function extractJson(raw: string): unknown {
  const text = stripFence(stripReasoning(raw));
  try {
    return JSON.parse(text);
  } catch {
    /* lanjut cari potongan JSON di dalam teks */
  }
  for (let start = 0; start < text.length; start++) {
    const open = text[start];
    if (open !== "{" && open !== "[") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error("JSON tidak ditemukan");
}

/** Ringkasan skema satu baris untuk model yang tidak memahami `responseSchema` Gemini. */
export function describeSchema(s: GeminiSchema): string {
  if (s.type === "OBJECT") {
    const required = new Set(s.required ?? []);
    const fields = Object.entries(s.properties ?? {}).map(
      ([k, v]) => `"${k}"${required.has(k) ? "" : "?"}: ${describeSchema(v)}`
    );
    return `{ ${fields.join(", ")} }`;
  }
  if (s.type === "ARRAY") return `[ ${s.items ? describeSchema(s.items) : "any"} ]`;
  const base = s.enum?.length ? s.enum.map((e) => `"${e}"`).join(" | ") : s.type.toLowerCase();
  return s.description ? `${base} (${s.description})` : base;
}

const jsonInstruction = (schema: GeminiSchema): string =>
  `\n\nFORMAT KELUARAN: balas HANYA satu nilai JSON valid tanpa teks pembuka, penutup, atau pagar kode. Tanda "?" berarti boleh dikosongkan. Bentuk:\n${describeSchema(schema)}`;

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true }
    );
  });

const withTimeout = (ms: number, signal?: AbortSignal): AbortSignal =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

/** Periksa isi balasan; null bila tidak layak (kosong, bukan JSON, atau di luar skema). */
function accept(raw: string, model: string, opts: GenerateOptions, attempts: number): GeminiResult | null {
  const text = stripReasoning(raw);
  if (!text) return null;
  if (!opts.responseSchema) return { text, model, attempts };
  let json: unknown;
  try {
    json = extractJson(text);
  } catch {
    return null;
  }
  if (opts.validate && !opts.validate(json)) return null;
  return { text, model, json, attempts };
}

/**
 * Jalankan sampai `max` percobaan dan ambil hasil layak pertama. Percobaan berikutnya dimulai saat
 * yang berjalan gagal, atau setelah `hedgeMs` tanpa balasan (hedging: permintaan kedua dikirim
 * sejajar supaya satu model hulu yang lambat tidak menahan antrean). Sisanya dibatalkan.
 */
export function firstSuccess<T>(
  max: number,
  hedgeMs: number | null,
  run: (attempt: number, signal: AbortSignal) => Promise<T | null>,
  parent?: AbortSignal
): Promise<T | null> {
  return new Promise((resolve) => {
    const ctrl = new AbortController();
    let started = 0;
    let pending = 0;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (value: T | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ctrl.abort();
      resolve(value);
    };
    const settle = (value: T | null) => {
      pending--;
      if (value !== null) finish(value);
      else if (started < max) launch();
      else if (pending === 0) finish(null);
    };
    const launch = () => {
      if (done || started >= max) return;
      const attempt = ++started;
      pending++;
      clearTimeout(timer);
      if (hedgeMs && started < max) timer = setTimeout(launch, hedgeMs);
      run(attempt, ctrl.signal).then(settle, () => settle(null));
    };

    if (parent?.aborted) return resolve(null);
    parent?.addEventListener("abort", () => finish(null), { once: true });
    launch();
  });
}

async function viaHermes(opts: GenerateOptions, startedAt: number): Promise<GeminiResult | null> {
  const cfg = hermesConfig();
  if (!cfg || Date.now() < hermesBreaker.openUntil) return null;

  const system = opts.responseSchema ? opts.system + jsonInstruction(opts.responseSchema) : opts.system;
  const messages = [
    { role: "system", content: system },
    ...opts.contents.map((c) => ({
      role: c.role === "model" ? "assistant" : "user",
      content: c.parts.map((p) => p.text).join("\n"),
    })),
  ];
  let jsonMode = !!opts.responseSchema;
  // Kunci ditolak atau router dinyatakan mati: percobaan tersisa tidak dijalankan.
  let giveUp = false;

  const once = (model: string) => async (attempt: number, signal: AbortSignal): Promise<GeminiResult | null> => {
    const remaining = opts.deadlineMs ? opts.deadlineMs - (Date.now() - startedAt) : Infinity;
    if (giveUp || remaining < MIN_ATTEMPT_MS) return null;

    let reason: string;
    let transport = false;
    try {
      const res = await fetch(cfg.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
        signal: withTimeout(Math.min(opts.timeoutMs ?? 30_000, remaining), signal),
        body: JSON.stringify({
          model,
          messages,
          temperature: opts.temperature ?? 0.5,
          max_tokens: opts.maxOutputTokens ?? 3000,
          stream: false,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
      });

      if (res.ok) {
        hermesBreaker.failures = 0;
        const data = await res.json();
        const choice = data.choices?.[0];
        const upstream = typeof data.model === "string" && data.model ? data.model : model;
        const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
        const result = accept(content, upstream, opts, attempt);
        if (result) return result;
        reason = content.trim()
          ? `keluaran tidak valid (${upstream})`
          : `balasan kosong (${upstream}, finish=${choice?.finish_reason ?? "?"})`;
      } else if (res.status === 401 || res.status === 403) {
        giveUp = true;
        console.warn(`[llm] hermes menolak kunci API (${res.status}); pindah ke cadangan`);
        return null;
      } else if (res.status === 400 && jsonMode) {
        // Model hulu tertentu menolak response_format; instruksi JSON di prompt tetap berlaku.
        jsonMode = false;
        reason = "response_format ditolak";
      } else {
        transport = res.status >= 500;
        reason = `HTTP ${res.status}`;
      }
    } catch (err) {
      if (signal.aborted) return null; // dibatalkan: percobaan lain sudah menang atau pemanggil berhenti
      transport = true;
      reason = (err as Error).name === "TimeoutError" ? "timeout" : (err as Error).message;
    }

    if (transport && ++hermesBreaker.failures >= BREAKER_THRESHOLD) {
      hermesBreaker.failures = 0;
      hermesBreaker.openUntil = Date.now() + BREAKER_OPEN_MS;
      giveUp = true;
      console.warn(`[llm] hermes ${model}: ${reason}; router dilewati ${BREAKER_OPEN_MS / 1000} detik`);
      return null;
    }
    console.warn(`[llm] hermes ${model} percobaan ${attempt}/${HERMES_ATTEMPTS}: ${reason}`);
    // Balasan kosong/tidak valid langsung diulang (rotasi combo); galat koneksi diberi jeda acak.
    if (transport && attempt < HERMES_ATTEMPTS) await sleep(300 * attempt + Math.random() * 400, signal);
    return null;
  };

  for (const model of cfg.models) {
    const result = await firstSuccess(HERMES_ATTEMPTS, opts.hedgeMs ?? null, once(model), opts.signal);
    if (result || giveUp || opts.signal?.aborted) return result;
  }
  return null;
}

async function viaGemini(opts: GenerateOptions, startedAt: number): Promise<GeminiResult | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const now = Date.now();
  const all = modelChain();
  // Kuota pencarian Google (grounding) terpisah dari kuota biasa: dicatat dengan kunci sendiri, supaya
  // kuota pencarian yang habis tidak membuat model diistirahatkan untuk panggilan biasa.
  const restKey = (m: string) => (opts.googleSearch ? `${m}#search` : m);
  const ready = all.filter((m) => (blockedUntil.get(restKey(m)) ?? 0) <= now);
  const resting = all.filter((m) => !ready.includes(m));
  let attempts = 0;

  // Model yang sedang istirahat dicoba paling akhir, bukan dibuang total; kecuali untuk pencarian, yang
  // kuotanya habis per kunci API dan tidak pulih dalam hitungan menit (pemanggil punya jalur cadangan).
  for (const model of opts.googleSearch ? ready : [...ready, ...resting]) {
    if (opts.signal?.aborted) return null;
    const remaining = opts.deadlineMs ? opts.deadlineMs - (Date.now() - startedAt) : Infinity;
    if (remaining < MIN_ATTEMPT_MS) break;
    attempts++;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          signal: withTimeout(Math.min(opts.timeoutMs ?? 20_000, remaining), opts.signal),
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: opts.googleSearch && opts.responseSchema ? opts.system + jsonInstruction(opts.responseSchema) : opts.system }],
            },
            contents: opts.contents,
            ...(opts.googleSearch ? { tools: [{ google_search: {} }] } : {}),
            generationConfig: {
              temperature: opts.temperature ?? 0.5,
              maxOutputTokens: opts.maxOutputTokens ?? 3000,
              ...(opts.responseSchema && !opts.googleSearch
                ? { responseMimeType: "application/json", responseSchema: opts.responseSchema }
                : {}),
            },
          }),
        }
      );

      if (!res.ok) {
        const quota = res.status === 429;
        blockedUntil.set(restKey(model), Date.now() + (quota ? COOLDOWN_QUOTA_MS : COOLDOWN_ERROR_MS));
        console.warn(`[llm] gemini ${model} -> ${res.status}, mencoba model berikutnya`);
        continue;
      }

      const data = await res.json();
      const parts: Array<{ text?: string; thought?: boolean }> =
        data.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .filter((p) => !p.thought && p.text)
        .map((p) => p.text)
        .join("")
        .trim();

      const result = accept(text, model, opts, attempts);
      if (result && opts.googleSearch) result.groundedDomains = groundedDomains(data);
      if (result) return result;
      console.warn(`[llm] gemini ${model} membalas kosong/tidak valid, mencoba model berikutnya`);
    } catch (err) {
      if (opts.signal?.aborted) return null;
      blockedUntil.set(restKey(model), Date.now() + COOLDOWN_ERROR_MS);
      console.warn(`[llm] gemini ${model} gagal:`, (err as Error).message);
    }
  }
  return null;
}

/** Domain sumber grounding (judul potongan web Gemini berisi nama domain, mis. "detik.com"). */
export function groundedDomains(data: unknown): string[] {
  const chunks = (data as { candidates?: { groundingMetadata?: { groundingChunks?: { web?: { title?: unknown } }[] } }[] })
    ?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const out = new Set<string>();
  for (const c of chunks) {
    const t = c?.web?.title;
    if (typeof t === "string" && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t.trim())) out.add(t.trim().toLowerCase().replace(/^www\./, ""));
  }
  return [...out];
}

/** Hasil pertama yang layak dari Hermes lalu Gemini; null bila semua penyedia gagal. */
export async function generateWithFailover(opts: GenerateOptions): Promise<GeminiResult | null> {
  const startedAt = Date.now();
  // Pencarian Google hanya tersedia di Gemini langsung.
  if (opts.googleSearch) return viaGemini(opts, startedAt);
  return (await viaHermes(opts, startedAt)) ?? (await viaGemini(opts, startedAt));
}
