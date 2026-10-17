/**
 * "Viral di medsos": obrolan yang SEDANG ramai di Threads dan media sosial Indonesia, dicari AI lewat
 * Google Search (grounding Gemini).
 *
 * Kenapa perlu: Threads tidak punya API topik tren, dan pencarian publik Threads butuh izin Meta yang
 * belum tentu ada. Tren pencarian Google saja sering berupa berita/olahraga yang tidak cocok untuk
 * konten obrolan. Sumber ini mengisi celah itu dengan topik yang memang sedang dibicarakan warganet,
 * beserta alasan kenapa ramai, supaya ide yang dibuat bisa menumpang tren yang nyata.
 *
 * Hasil AI hanyalah DATA inspirasi: disaring dari topik sensitif dan berita keras, URL hanya dipakai bila
 * domainnya benar-benar dibuka Google Search, dan teksnya tidak pernah disalin ke draf.
 */
import { DEFAULT_BANNED_TERMS, bannedHits } from "./autopilot-gate";
import { generateWithFailover, type GeminiSchema } from "./gemini";
import { HARD_NEWS_TERMS, cleanExternal, type SignalDraft } from "./radar-sources";
import { wibDayKey } from "./scheduling";

const HOUR_MS = 60 * 60 * 1000;
/** Obrolan medsos cepat basi: dipakai paling lama 36 jam. */
export const WEB_TREND_TTL_MS = 36 * HOUR_MS;
export const WEB_TRENDS_MAX = 14;

export const WEB_TREND_CATEGORIES = [
  "hiburan",
  "humor",
  "kuliner",
  "gaya hidup",
  "hubungan",
  "kerja",
  "keuangan",
  "teknologi",
  "olahraga",
  "kecantikan",
  "parenting",
  "lainnya",
] as const;

const PLATFORMS = ["Threads", "X", "TikTok", "Instagram", "umum"] as const;

const SYSTEM = `Anda peneliti tren media sosial Indonesia. Pakai Google Search untuk menemukan obrolan, meme, tantangan, dan topik yang SEDANG ramai dibahas warganet Indonesia, utamakan yang ramai di Threads.

CARA MENCARI
- Cari beberapa kali dengan kata kunci seperti "viral di Threads hari ini", "ramai di Threads", "trending media sosial Indonesia", "viral TikTok Indonesia", "warganet ramai bahas", ditambah tanggal hari ini.
- Hanya ambil topik yang dibahas dalam 48 jam terakhir. Abaikan artikel lama.
- Utamakan topik obrolan yang bisa diikuti akun brand atau kreator: keresahan sehari-hari, meme, istilah baru, perdebatan ringan, kebiasaan, makanan, hiburan, hubungan, kerja, keuangan pribadi.

JANGAN AMBIL
Politik, pemilu, pejabat, hukum, kriminal, kasus, bencana, kecelakaan, kabar duka, SARA, judi, pinjol, konten dewasa, dan gosip yang menyerang orang biasa.

ISI TIAP TOPIK
- judul: nama topik singkat seperti yang dipakai warganet (maks 80 karakter).
- ringkasan: apa yang sedang terjadi, faktual dan netral (maks 220 karakter).
- alasan: kenapa orang Indonesia ramai membahasnya / sudut yang bikin relate (maks 160 karakter).
- platform: tempat paling ramai.
- kategori: satu dari daftar.
- panas: 1-5, seberapa ramai sekarang (5 = dibahas di mana-mana hari ini).
- url: satu tautan artikel sumber bila ada, kosongkan bila tidak yakin.`;

const SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    topics: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          judul: { type: "STRING" },
          ringkasan: { type: "STRING" },
          alasan: { type: "STRING" },
          platform: { type: "STRING", enum: [...PLATFORMS] },
          kategori: { type: "STRING", enum: [...WEB_TREND_CATEGORIES] },
          panas: { type: "INTEGER" },
          url: { type: "STRING" },
        },
        required: ["judul", "ringkasan", "alasan", "platform", "kategori", "panas"],
      },
    },
  },
  required: ["topics"],
};

interface RawTopic {
  judul?: unknown;
  ringkasan?: unknown;
  alasan?: unknown;
  platform?: unknown;
  kategori?: unknown;
  panas?: unknown;
  url?: unknown;
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? cleanExternal(v, max) : "");

/** URL dipakai hanya bila https dan domainnya termasuk sumber yang benar-benar dibuka Google Search. */
export function trustedUrl(raw: unknown, domains: string[]): string | null {
  if (typeof raw !== "string" || domains.length === 0) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return domains.some((d) => host === d || host.endsWith(`.${d}`)) ? u.toString().slice(0, 500) : null;
  } catch {
    return null;
  }
}

/** Skor 0..1: tingkat keramaian, sedikit lebih tinggi bila ramainya di Threads (platform tujuan). */
export const webTrendScore = (panas: number, platform: string): number =>
  Math.round(Math.min(0.97, 0.42 + 0.1 * Math.min(5, Math.max(1, panas)) + (platform === "Threads" ? 0.05 : 0)) * 100) / 100;

/** Keluaran AI -> draf sinyal global (murni: saringan, normalisasi, skor). */
export function webTopicsToSignals(raws: RawTopic[], domains: string[], now: Date, extraBanned: string[] = []): SignalDraft[] {
  const day = wibDayKey(now);
  const banned = [...DEFAULT_BANNED_TERMS, ...HARD_NEWS_TERMS, ...extraBanned];
  const seen = new Set<string>();
  const out: SignalDraft[] = [];
  for (const r of raws) {
    const title = str(r.judul, 80);
    const summary = str(r.ringkasan, 220);
    const alasan = str(r.alasan, 160);
    if (title.length < 3 || summary.length < 10) continue;
    if (bannedHits(`${title} ${summary} ${alasan}`, banned).length) continue;
    const key = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const platform = typeof r.platform === "string" && (PLATFORMS as readonly string[]).includes(r.platform) ? r.platform : "umum";
    const kategori =
      typeof r.kategori === "string" && (WEB_TREND_CATEGORIES as readonly string[]).includes(r.kategori) ? r.kategori : "lainnya";
    const panas = typeof r.panas === "number" && Number.isFinite(r.panas) ? Math.round(Math.min(5, Math.max(1, r.panas))) : 3;
    out.push({
      workspaceId: null,
      source: "WEB",
      title,
      // Alasan ikut di ringkasan supaya terbaca perencana ide dan pengguna di Radar.
      summary: alasan ? `${summary} Kenapa ramai: ${alasan}` : summary,
      url: trustedUrl(r.url, domains),
      rank: out.length + 1,
      score: webTrendScore(panas, platform),
      raw: { platform, kategori, panas, alasan },
      hash: `WEB:${day}:${key}`,
      expiresAt: new Date(now.getTime() + WEB_TREND_TTL_MS).toISOString(),
    });
    if (out.length >= WEB_TRENDS_MAX) break;
  }
  return out;
}

const dateLabel = (now: Date): string =>
  new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);

/**
 * Satu putaran riset "Viral di medsos". Mengembalikan draf sinyal (kosong bila tidak ada kunci Gemini atau
 * AI tidak membalas). Satu panggilan AI ber-grounding per putaran riset (paling sering tiap 3 jam).
 */
export async function captureWebTrends(now: Date, extraBanned: string[] = []): Promise<SignalDraft[]> {
  if (!process.env.GEMINI_API_KEY) return [];
  const reply = await generateWithFailover({
    system: SYSTEM,
    contents: [
      {
        role: "user",
        parts: [{ text: `Hari ini ${dateLabel(now)} (WIB). Cari ${WEB_TRENDS_MAX} topik yang sedang viral di Threads dan media sosial Indonesia sekarang.` }],
      },
    ],
    googleSearch: true,
    responseSchema: SCHEMA,
    validate: (json) => Array.isArray((json as { topics?: unknown })?.topics),
    temperature: 0.3,
    maxOutputTokens: 6000,
    timeoutMs: 60_000,
    deadlineMs: 90_000,
  });
  if (!reply) return [];
  const raws = ((reply.json as { topics?: RawTopic[] }).topics ?? []).filter((x) => typeof x === "object" && x !== null);
  return webTopicsToSignals(raws, reply.groundedDomains ?? [], now, extraBanned);
}
