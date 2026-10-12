/**
 * Klien Gemini dengan failover antar-model.
 * Kuota gratis dihitung per model; saat satu model kena 429/404/5xx,
 * otomatis lanjut ke model berikutnya dan model itu "diistirahatkan" sementara.
 *
 * Mode JSON (opsional): `responseSchema` memaksa keluaran terstruktur. Hasil di-parse dan
 * (bila ada) divalidasi lewat `validate`; kegagalan parse/validasi berpindah ke model berikutnya
 * tanpa mengistirahatkan model (bukan salah kuota).
 */

const DEFAULT_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.7-flash",
  "gemini-3.1-flash-lite",
];

const COOLDOWN_QUOTA_MS = 30 * 60 * 1000; // kuota habis
const COOLDOWN_ERROR_MS = 2 * 60 * 1000; // error sementara / model tak tersedia
const blockedUntil = new Map<string, number>();

export interface GeminiContent {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

export interface GeminiResult {
  text: string;
  model: string;
  /** Terisi pada mode JSON: hasil parse yang lolos `validate`. */
  json?: unknown;
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

function modelChain(): string[] {
  const fromEnv = process.env.GEMINI_MODELS?.split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return fromEnv?.length ? fromEnv : DEFAULT_MODELS;
}

/** Buang pagar kode ```json yang kadang membungkus keluaran. */
function stripFence(text: string): string {
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text.trim());
  return (m ? m[1] : text).trim();
}

export async function generateWithFailover(opts: {
  system: string;
  contents: GeminiContent[];
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  /** Batas total semua percobaan model; lewat dari ini berhenti dan mengembalikan null. */
  deadlineMs?: number;
  /** Aktifkan keluaran JSON terstruktur. */
  responseSchema?: GeminiSchema;
  /** Kembalikan false bila hasil parse tidak layak sehingga model berikutnya dicoba. */
  validate?: (json: unknown) => boolean;
}): Promise<GeminiResult | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const startedAt = Date.now();
  const now = startedAt;
  const all = modelChain();
  // Model yang sedang istirahat dicoba paling akhir, bukan dibuang total.
  const ready = all.filter((m) => (blockedUntil.get(m) ?? 0) <= now);
  const resting = all.filter((m) => !ready.includes(m));

  for (const model of [...ready, ...resting]) {
    const remaining = opts.deadlineMs ? opts.deadlineMs - (Date.now() - startedAt) : Infinity;
    if (remaining < 1500) break;
    const timeout = Math.min(opts.timeoutMs ?? 20_000, remaining);

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          signal: AbortSignal.timeout(timeout),
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: opts.system }] },
            contents: opts.contents,
            generationConfig: {
              temperature: opts.temperature ?? 0.5,
              maxOutputTokens: opts.maxOutputTokens ?? 3000,
              ...(opts.responseSchema
                ? { responseMimeType: "application/json", responseSchema: opts.responseSchema }
                : {}),
            },
          }),
        }
      );

      if (!res.ok) {
        const quota = res.status === 429;
        blockedUntil.set(
          model,
          Date.now() + (quota ? COOLDOWN_QUOTA_MS : COOLDOWN_ERROR_MS)
        );
        console.warn(`Gemini ${model} -> ${res.status}, mencoba model berikutnya`);
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

      if (!text) {
        console.warn(`Gemini ${model} membalas kosong, mencoba model berikutnya`);
        continue;
      }
      if (!opts.responseSchema) return { text, model };

      let json: unknown;
      try {
        json = JSON.parse(stripFence(text));
      } catch {
        console.warn(`Gemini ${model} membalas JSON tidak valid, mencoba model berikutnya`);
        continue;
      }
      if (opts.validate && !opts.validate(json)) {
        console.warn(`Gemini ${model} membalas JSON di luar skema, mencoba model berikutnya`);
        continue;
      }
      return { text, model, json };
    } catch (err) {
      blockedUntil.set(model, Date.now() + COOLDOWN_ERROR_MS);
      console.warn(`Gemini ${model} gagal:`, (err as Error).message);
    }
  }
  return null;
}
