/**
 * Asisten AI (Studio AI): susun prompt PERAN akun Threads yang lengkap dari data akun yang sebenarnya
 * (postingan terbaru, performa, fakta brand, Profil AI saat ini, pelajaran gaya). Hasilnya:
 * - dokumen markdown untuk pengguna, dengan prompt utuh di blok ```prompt (siap disalin);
 * - versi ringkas untuk Profil AI (peran <= BRIEF_MAX_CHARS, kategori topik, gaya sapaan) yang bisa
 *   diterapkan sekali klik. Menerapkan Profil AI memicu agen pencari ide otomatis.
 */
import { BRIEF_MAX_CHARS, VOICE_STYLES, type VoiceStyle } from "./autopilot-types";
import { topLessons } from "./account-memory";
import { getAccountFacts } from "./account-facts";
import { getAccountDetail } from "./chat-context";
import { generateWithFailover, type GeminiSchema } from "./gemini";
import { listPublishAccounts, type PublishAccount } from "./publish-accounts";
import { adviceContext } from "./chat-router";
import { loadIdeaContext } from "./radar-store";
import { db } from "./supabase";

/** Blok penutup jawaban AI berisi versi Profil AI (diambil server, tidak ditampilkan mentah). */
const PROFILE_LANG = "profil";
export const ROLE_PROMPT_LANG = "prompt";
const MAX_PILLARS = 6;

export interface RolePromptProfile {
  accountId: string;
  handle: string;
  /** Profil AI yang tersimpan sekarang, supaya pengguna melihat apa yang berubah sebelum menerapkan. */
  current?: { brief: string; pillars: string[]; voiceStyle: VoiceStyle | null };
  brief: string;
  pillars: string[];
  voiceStyle: VoiceStyle | null;
}

export type RolePromptReply =
  | { kind: "ask"; message: string }
  | { kind: "done"; message: string; profile: RolePromptProfile | null; model: string | null };

// Cadangan kata kunci bila router AI tidak menjawab. "isi profil (gw)" / "prompt profil" juga prompt peran.
const ROLE_WORDS = /(role|peran|persona|karakter|identitas|profil\s*ai|(?:isi|prompt)\s+(?:untuk\s+)?(?:isi\s+)?profil|system\s*prompt|brief|tema\s+akun|gaya\s+akun)/i;
const ASK_WORDS = /(buat|bikin|buatin|bikinin|susun|saran|rekomendasi|generate|tulis|kasih|minta|perbaiki|upgrade|tingkatkan|optimalkan)/i;
/** "prompt gambar", "postingan tentang prompt" dsb. adalah permintaan konten, bukan prompt peran. */
const CONTENT_WORDS = /(gambar|image|foto|video|midjourney|postingan|posting|draf|draft|caption|konten)/i;

/** Pesan meminta prompt peran/persona untuk akun (bukan prompt untuk isi postingan). */
export function isRolePromptRequest(text: string): boolean {
  if (text.length > 600 || !ASK_WORDS.test(text)) return false;
  if (ROLE_WORDS.test(text)) return true;
  return /\bprompt\b/i.test(text) && /\bakun\b/i.test(text) && !CONTENT_WORDS.test(text);
}

const handleOf = (a: Pick<PublishAccount, "username" | "displayName">): string => `@${a.username ?? a.displayName}`;

function pickAccount(text: string, accounts: PublishAccount[], filter: string | null): PublishAccount | null {
  const q = text.toLowerCase();
  const named = accounts
    .filter((a) => a.username && q.includes(`@${a.username.toLowerCase()}`))
    .sort((a, b) => (b.username?.length ?? 0) - (a.username?.length ?? 0))[0];
  if (named) return named;
  const byFilter = filter ? accounts.find((a) => a.id === filter || a.username === filter.replace(/^@/, "")) : undefined;
  if (byFilter) return byFilter;
  return accounts.length === 1 ? accounts[0] : null;
}

const SYSTEM = `Anda prompt engineer senior untuk akun Threads Indonesia. Tugas: menyusun PROMPT PERAN (system prompt) yang lengkap untuk SATU akun, supaya AI yang menulis postingan akun ini terdengar persis seperti pemiliknya dan menghasilkan konten yang ramai.

Sumber kebenaran hanya DATA AKUN di pesan pengguna. Jangan mengarang fakta (harga, lokasi, angka, prestasi) yang tidak ada di data. Bila data tipis, tulis aturan yang tetap berguna tanpa fakta karangan.

Tulis jawaban dalam markdown, Bahasa Indonesia, tanpa emoji, dengan urutan PERSIS ini:
## Prompt peran untuk <@akun>
Satu kalimat: untuk apa prompt ini dan dari data apa disusun.
### Ringkasan akun
Tabel markdown 2 kolom (Aspek | Isi): Peran, Audiens, Nada, Kategori topik, Gaya sapaan. Isi dari data.
### Prompt lengkap
Satu blok kode berbahasa \`prompt\` (\`\`\`prompt ... \`\`\`) berisi prompt utuh siap salin, ditulis sebagai instruksi ke AI ("Kamu adalah ..."), memuat bagian berjudul huruf besar:
IDENTITAS & PERAN, AUDIENS, TUJUAN AKUN, KATEGORI TOPIK (tiap kategori + contoh sudut), GAYA BAHASA & SAPAAN (kata ganti, panjang kalimat, kosakata khas dari postingan akun), STRUKTUR POSTINGAN (hook kalimat pertama, isi, penutup/ajakan; panjang ideal), POLA YANG TERBUKTI (dari postingan dengan performa terbaik di data), ATURAN WAJIB, LARANGAN (termasuk pelajaran gaya dari pemilik akun), FAKTA YANG BOLEH DIKUTIP (hanya dari data; tulis "tidak ada" bila kosong), CONTOH (2 contoh postingan pendek bergaya akun ini, isi boleh baru tapi tanpa fakta karangan).
Panjang prompt 350-700 kata. Konkret, bukan nasihat umum.
### Cara memakai
2-3 poin singkat: tempel prompt ini sebagai instruksi AI, dan versi ringkasnya bisa langsung diterapkan ke Profil AI akun lewat tombol di bawah jawaban.

TERAKHIR, tutup dengan satu blok kode berbahasa \`profil\` (tidak akan ditampilkan ke pengguna) dengan format persis:
\`\`\`profil
peran: <PADATAN dari "Prompt lengkap" di atas (bukan salinan Profil AI saat ini), 350-600 karakter, satu paragraf: identitas & peran, audiens, tujuan, nada & ciri bahasa, pola hook/penutup yang terbukti, larangan utama>
kategori: <3-${MAX_PILLARS} kategori topik, dipisah titik koma, tiap kategori 2-40 karakter>
sapaan: <salah satu: ${Object.keys(VOICE_STYLES).join(", ")}>
\`\`\``;

function parseProfile(block: string, account: PublishAccount): RolePromptProfile | null {
  const get = (key: string) => new RegExp(`^${key}\\s*:\\s*(.+)$`, "im").exec(block)?.[1]?.trim() ?? "";
  const full = get("peran").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
  // Lebih dari batas Profil AI: potong di akhir kalimat terakhir yang muat, bukan di tengah kata.
  const cut = full.slice(0, BRIEF_MAX_CHARS);
  const end = cut.lastIndexOf(". ");
  const brief = full.length <= BRIEF_MAX_CHARS ? full : end > BRIEF_MAX_CHARS * 0.6 ? cut.slice(0, end + 1) : cut;
  const seen = new Set<string>();
  const pillars = get("kategori")
    .split(/[;\n]/)
    .map((p) => p.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 2 && p.length <= 40 && !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()))
    .slice(0, MAX_PILLARS);
  const voice = get("sapaan").toLowerCase().replace(/[^a-z_]/g, "");
  if (brief.length < 20) return null;
  return {
    accountId: account.id,
    handle: handleOf(account),
    brief,
    pillars,
    voiceStyle: voice in VOICE_STYLES ? (voice as VoiceStyle) : null,
  };
}

const PROFILE_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    peran: { type: "STRING" },
    kategori: { type: "ARRAY", items: { type: "STRING" } },
    sapaan: { type: "STRING" },
  },
  required: ["peran", "kategori"],
};

/**
 * Cadangan bila model melewatkan blok ```profil: ringkas prompt yang SUDAH ditulis menjadi Profil AI
 * (keluaran JSON terstruktur), supaya versi Profil AI selalu sejalan dengan prompt yang dilihat pengguna.
 */
async function profileFromPrompt(markdown: string, account: PublishAccount): Promise<RolePromptProfile | null> {
  const res = await generateWithFailover({
    system: `Padatkan prompt peran akun Threads berikut menjadi Profil AI. peran: satu paragraf 350-600 karakter berisi identitas & peran, audiens, tujuan, nada & ciri bahasa, pola hook/penutup yang terbukti, dan larangan utama dari prompt itu. kategori: 3-${MAX_PILLARS} kategori topik (2-40 karakter). sapaan: salah satu dari ${Object.keys(VOICE_STYLES).join(", ")}. Hanya dari isi prompt, jangan menambah hal baru.`,
    contents: [{ role: "user", parts: [{ text: markdown.slice(0, 12_000) }] }],
    temperature: 0.2,
    maxOutputTokens: 700,
    deadlineMs: 20_000,
    responseSchema: PROFILE_SCHEMA,
    validate: (j) => typeof (j as { peran?: unknown })?.peran === "string",
  }).catch(() => null);
  const json = res?.json as { peran?: string; kategori?: unknown[]; sapaan?: string } | undefined;
  if (!json?.peran) return null;
  const kategori = (json.kategori ?? []).filter((k): k is string => typeof k === "string").join("; ");
  return parseProfile(`peran: ${json.peran.replace(/\s+/g, " ")}\nkategori: ${kategori}\nsapaan: ${json.sapaan ?? ""}`, account);
}

/** Pisahkan blok ```profil dari jawaban; sisanya ditampilkan ke pengguna. */
function splitProfile(text: string): { visible: string; profileBlock: string | null } {
  const re = new RegExp("```" + PROFILE_LANG + "\\s*\\n([\\s\\S]*?)```", "i");
  const m = re.exec(text);
  if (!m) return { visible: text.trim(), profileBlock: null };
  return { visible: text.replace(m[0], "").trim(), profileBlock: m[1] };
}

/** Bagian tambahan bila pengguna sekaligus meminta saran bahasan/curhat yang berpotensi ramai. */
const ADVICE_SECTION = `Pengguna JUGA meminta saran bahasan. Tambahkan bagian "### Bahasan yang berpotensi ramai" SEBELUM "### Cara memakai": 6-8 butir bernomor, tiap butir berisi judul bahasan tebal (curhat, cerita, opini, atau tips yang cocok untuk niche akun ini), satu kalimat kenapa berpotensi ramai di Threads (rasa relate, memancing balasan, atau menumpang tren), dan contoh kalimat pembuka bergaya akun ini dalam tanda kutip. Utamakan bahan dari TREN & IDE RADAR bila ada dan sebut bila sebuah butir menumpang tren. Jangan mengarang fakta, angka, atau pengalaman pemilik yang tidak ada di data; tulis sebagai sudut yang bisa diisi pemilik akun.`;

export async function buildRolePrompt(opts: {
  text: string;
  accountFilter: string | null;
  /** Pengguna juga meminta saran bahasan yang berpotensi ramai (router: also ADVICE). */
  advice?: boolean;
  now?: Date;
}): Promise<RolePromptReply> {
  const now = opts.now ?? new Date();
  const accounts = await listPublishAccounts();
  if (accounts.length === 0) return { kind: "ask", message: "Belum ada akun Threads yang terhubung. Hubungkan akun dulu di halaman **Akun Threads**." };
  const account = pickAccount(opts.text, accounts, opts.accountFilter);
  if (!account) {
    const list = accounts
      .slice(0, 12)
      .map((a) => `- ${handleOf(a)}${a.outletNama ? ` (${a.outletNama})` : ""}`)
      .join("\n");
    return {
      kind: "ask",
      message: `Prompt peran disusun per akun supaya gayanya pas. Untuk akun yang mana? Sebut akunnya, misalnya **buatkan prompt peran untuk ${handleOf(accounts[0])}**.\n\n${list}`,
    };
  }

  const handle = handleOf(account);
  const [detail, context, facts, lessons, config, trends] = await Promise.all([
    getAccountDetail(handle, []).catch(() => ""),
    loadIdeaContext([account.id], now).catch(() => null),
    getAccountFacts().catch(() => new Map<string, string[]>()),
    topLessons([account.id], 15).catch(() => new Map()),
    db()
      .from("AutopilotConfig")
      .select("brief, pillars, voiceStyle")
      .eq("accountId", account.id)
      .maybeSingle()
      .then((r) => (r.data ?? null) as { brief: string | null; pillars: { key: string }[] | null; voiceStyle: string | null } | null),
    opts.advice ? adviceContext([account], now).catch(() => "") : Promise.resolve(""),
  ]);
  const recents = (context?.recents.get(account.id) ?? []).slice(0, 15);
  const lessonLines = ((lessons.get(account.id) ?? []) as { lesson: string }[]).map((l) => `- ${l.lesson}`);
  const factLines = (facts.get(account.id) ?? []).slice(0, 15).map((f) => `- ${f}`);

  const data = [
    `AKUN: ${handle} (nama tampilan: ${account.displayName}${account.outletNama ? `, cabang/brand: ${account.outletNama}` : ""})`,
    `PROFIL AI SAAT INI (hanya acuan; versi baru harus LEBIH lengkap dan spesifik, jangan disalin): peran="${config?.brief ?? "-"}"; kategori=${(config?.pillars ?? []).map((p) => p.key).join(", ") || "-"}; sapaan=${config?.voiceStyle ?? "-"}`,
    `PERMINTAAN PENGGUNA: ${opts.text}`,
    detail ? `PERFORMA & POSTINGAN TERBAIK (dari database):\n${detail}` : "PERFORMA: belum ada data performa.",
    recents.length ? `POSTINGAN TERBARU AKUN (acuan gaya bahasa):\n${recents.map((t, i) => `${i + 1}. ${t.replace(/\s+/g, " ").slice(0, 400)}`).join("\n")}` : "POSTINGAN TERBARU: belum ada.",
    `FAKTA BRAND/AKUN:\n${factLines.join("\n") || "- tidak ada"}`,
    `PELAJARAN GAYA DARI PEMILIK AKUN (wajib dipatuhi):\n${lessonLines.join("\n") || "- belum ada"}`,
    ...(opts.advice ? [trends || "TREN & IDE RADAR: belum ada untuk akun ini; susun saran dari niche dan postingan akun."] : []),
  ].join("\n\n");

  const ask = `Susun prompt peran untuk ${handle}.${opts.advice ? `\n\n${ADVICE_SECTION}` : ""}`;
  const result = await generateWithFailover({
    system: SYSTEM,
    contents: [{ role: "user", parts: [{ text: `DATA AKUN:\n${data}\n\n${ask}` }] }],
    temperature: 0.5,
    maxOutputTokens: opts.advice ? 5500 : 4000,
    deadlineMs: 50_000,
  });
  if (!result) {
    return { kind: "done", message: "AI sedang tidak tersedia, jadi prompt peran belum bisa disusun. Coba lagi sebentar lagi.", profile: null, model: null };
  }
  const { visible, profileBlock } = splitProfile(result.text);
  const fromBlock = profileBlock ? parseProfile(profileBlock, account) : null;
  // Profil AI memakai PROMPT LENGKAP (blok ```prompt) selama muat di batas Profil AI, jadi yang diterapkan sama
  // persis dengan yang dibaca pengguna. Versi padat hanya cadangan bila prompt lengkapnya tidak ada/terlalu panjang.
  const full = new RegExp("```" + ROLE_PROMPT_LANG + "\\s*\\n([\\s\\S]*?)```", "i").exec(visible)?.[1]?.trim() ?? "";
  const fullFits = full.length >= 200 && full.length <= BRIEF_MAX_CHARS;
  // Kategori & sapaan dari blok profil; tanpa blok (atau versi padatnya cuma parafrase profil lama), padatkan ulang.
  const base = fromBlock && (fullFits || fromBlock.brief.length >= 300) ? fromBlock : ((await profileFromPrompt(visible, account)) ?? fromBlock);
  const profile = base && (fullFits ? { ...base, brief: full } : base);
  const voice = config?.voiceStyle && config.voiceStyle in VOICE_STYLES ? (config.voiceStyle as VoiceStyle) : null;
  return {
    kind: "done",
    message: visible,
    profile: profile && {
      ...profile,
      current: { brief: config?.brief ?? "", pillars: (config?.pillars ?? []).map((p) => p.key), voiceStyle: voice },
    },
    model: result.model,
  };
}
