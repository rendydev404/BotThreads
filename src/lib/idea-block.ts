/**
 * Blok ide postingan dari asisten AI (murni, tanpa I/O). Model menulis tiap draf sebagai
 * blok kode berbahasa `ide` dan klien merendernya sebagai kartu:
 *
 *   ```ide
 *   akun: @username
 *   sudut: Prompt praktis
 *   jam: 18:00
 *   alasan: Tiru post 13.437 views ...
 *   ---
 *   Teks postingan. Prompt AI diapit [PROMPT] ... [/PROMPT].
 *   ```
 *
 * Format baris (bukan JSON) dipilih supaya tanda kutip dan kurung di dalam prompt tidak
 * merusak parsing.
 */

import { PLACEHOLDER, SENTENCE_BREAK } from "./threads-text";

export const IDEA_LANG = "ide";

export interface PostIdea {
  /** Username tanpa @, null bila draf umum. */
  account: string | null;
  angle: string;
  /** Jam WIB 0-23 dan menit, null bila tidak disebut/tidak valid. */
  time: { h: number; m: number } | null;
  reason: string;
  /** Teks mentah, masih memuat penanda [PROMPT]. */
  body: string;
}

const KEYS: Record<string, "account" | "angle" | "time" | "reason"> = {
  akun: "account",
  account: "account",
  sudut: "angle",
  angle: "angle",
  jam: "time",
  waktu: "time",
  time: "time",
  alasan: "reason",
  kenapa: "reason",
  reason: "reason",
};

function parseTime(raw: string): PostIdea["time"] {
  const m = /(\d{1,2})(?:[.:](\d{2}))?/.exec(raw);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  return h >= 0 && h <= 23 && min >= 0 && min <= 59 ? { h, m: min } : null;
}

/** Null bila blok tidak berisi teks postingan. */
export function parseIdea(source: string): PostIdea | null {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const sep = lines.findIndex((l) => /^\s*-{3,}\s*$/.test(l));
  const head = sep >= 0 ? lines.slice(0, sep) : [];
  const body = (sep >= 0 ? lines.slice(sep + 1) : lines)
    .join("\n")
    .trim()
    // Model kadang ikut menyalin label petunjuk format ("teks postingan ...:").
    .replace(/^<?teks postingan[^:\n]*:\s*/i, "")
    .trim();
  if (!body) return null;

  const idea: PostIdea = { account: null, angle: "", time: null, reason: "", body };
  for (const line of head) {
    const kv = /^\s*([a-z]+)\s*:\s*(.*)$/i.exec(line);
    const key = kv && KEYS[kv[1].toLowerCase()];
    if (!kv || !key) continue;
    const value = kv[2].trim();
    if (key === "account") idea.account = value.replace(/^<?@?/, "").split(/[\s;>]/)[0] || null;
    else if (key === "time") idea.time = parseTime(value);
    else idea[key] = value;
  }
  return idea;
}

export type IdeaSegment = { kind: "text" | "prompt"; text: string };

const PROMPT_BLOCK = /\[PROMPT\]([\s\S]*?)(?:\[\/PROMPT\]|$)/gi;

/** Pecah teks menjadi bagian biasa dan bagian prompt (untuk ditampilkan berbeda). */
export function ideaSegments(body: string): IdeaSegment[] {
  const out: IdeaSegment[] = [];
  let last = 0;
  for (const m of body.matchAll(PROMPT_BLOCK)) {
    const before = body.slice(last, m.index).trim();
    if (before) out.push({ kind: "text", text: before });
    const prompt = m[1].trim();
    if (prompt) out.push({ kind: "prompt", text: prompt });
    last = m.index + m[0].length;
  }
  const rest = body.slice(last).trim();
  if (rest) out.push({ kind: "text", text: rest });
  return out;
}

/** Teks siap posting: penanda prompt dibuang, isinya tetap. */
export const ideaPostText = (body: string): string =>
  ideaSegments(body)
    .map((s) => s.text)
    .join("\n\n");

/** Jadwal berikutnya untuk jam WIB tersebut (hari ini bila masih >= 15 menit lagi, selain itu besok). */
export function nextWibSlot(time: PostIdea["time"], now = new Date()): Date {
  const WIB = 7 * 3_600_000;
  if (!time) return new Date(Math.ceil((now.getTime() + 3_600_000) / 900_000) * 900_000);
  const wib = new Date(now.getTime() + WIB);
  let at = Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate(), time.h, time.m) - WIB;
  if (at < now.getTime() + 15 * 60_000) at += 86_400_000;
  return new Date(at);
}

/** Isi pesan untuk tombol Salin: blok ide diubah jadi teks biasa. */
export function ideaPlainText(content: string): string {
  return content.replace(/```ide[^\n]*\n([\s\S]*?)(?:```|$)/g, (_, src: string) => {
    const idea = parseIdea(src);
    if (!idea) return "";
    const head = [idea.account && `@${idea.account}`, idea.angle, idea.time && `${pad(idea.time.h)}:${pad(idea.time.m)} WIB`]
      .filter(Boolean)
      .join(" · ");
    return `${head ? `${head}\n` : ""}${ideaPostText(idea.body)}${idea.reason ? `\nAlasan: ${idea.reason}` : ""}\n`;
  });
}

const pad = (n: number) => String(n).padStart(2, "0");

/* ------------------------------------------------------------------ placeholder */

const IDEA_FENCE = /```ide[^\n]*\n([\s\S]*?)(?:```|$)/g;

/** Teks yang dinilai: semua isi kecuali bagian [PROMPT] (template prompt boleh punya variabel). */
const withoutPrompts = (s: string) => s.replace(PROMPT_BLOCK, " ");

/** Jawaban asisten masih memuat placeholder seperti "[isi detail lokasi]" (di luar bagian prompt). */
export function hasPlaceholder(content: string): boolean {
  return PLACEHOLDER.test(withoutPrompts(content));
}

const dropPlaceholderSentences = (text: string): string =>
  text
    .split("\n")
    .map((line) =>
      line
        .split(SENTENCE_BREAK)
        .filter((s) => !PLACEHOLDER.test(s))
        .join(" ")
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * Jaring terakhir: buang kalimat berplaceholder dari jawaban; blok ide yang isinya jadi terlalu
 * pendek dibuang utuh. Bagian [PROMPT] tidak disentuh.
 */
export function stripPlaceholders(content: string): string {
  const fenced = content.replace(IDEA_FENCE, (_whole, src: string) => {
    const lines = src.replace(/\r\n/g, "\n").split("\n");
    const sep = lines.findIndex((l) => /^\s*-{3,}\s*$/.test(l));
    const head = sep >= 0 ? lines.slice(0, sep).join("\n") + "\n" : "";
    const body = (sep >= 0 ? lines.slice(sep + 1) : lines).join("\n");
    const cleaned = ideaSegments(body)
      .map((s) => (s.kind === "prompt" ? `[PROMPT]\n${s.text}\n[/PROMPT]` : dropPlaceholderSentences(s.text)))
      .filter(Boolean)
      .join("\n\n");
    if (ideaPostText(cleaned).replace(/\s/g, "").length < 15) return "";
    return `\`\`\`ide\n${head}${head ? "---\n" : ""}${cleaned}\n\`\`\``;
  });
  // Prosa di luar blok ide.
  return fenced
    .split(/(```[\s\S]*?```)/g)
    .map((part) => (part.startsWith("```") ? part : dropPlaceholderSentences(part)))
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
