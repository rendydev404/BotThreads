/**
 * Verifikasi jawaban AI terhadap data yang diberikan ke model: angka dan @akun yang disebut harus
 * ada di konteks. Murni (tanpa I/O) supaya mudah diuji. Dipakai route chat untuk satu kali
 * perbaikan otomatis bila jawaban memuat angka/akun yang tidak bisa dibuktikan dari data.
 */

/** Angka minimal yang diperiksa; angka kecil (persen, jam, urutan) terlalu sering turunan. */
const MIN_CHECKED = 100;
/** Toleransi pembulatan: 1,5% atau minimal 1 satuan. */
const REL_TOLERANCE = 0.015;

const NUMBER_RE = /\d+(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g;

function parse(raw: string): number {
  return Number(raw.replace(/\./g, "").replace(",", "."));
}

/** Angka (format id-ID) di teks. Angka sesudah "=" atau "≈" dianggap hasil hitung yang ditunjukkan. */
export function extractNumbers(text: string, opts: { skipDerived?: boolean } = {}): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const raw = m[0];
    const idx = m.index ?? 0;
    if (opts.skipDerived && /[=≈→]\s*$/.test(text.slice(Math.max(0, idx - 3), idx))) continue;
    // Bagian dari tanggal ISO atau jam: dilewati
    if (/^\d{4}-\d{2}-\d{2}/.test(text.slice(idx, idx + 10))) continue;
    if (text[idx + raw.length] === ":" || text[idx - 1] === ":") continue;
    const n = parse(raw);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Himpunan angka sah: semua angka dari teks sumber (data, pertanyaan, riwayat). */
export function numberPool(...sources: string[]): number[] {
  const set = new Set<number>();
  for (const s of sources) for (const n of extractNumbers(s)) set.add(n);
  return [...set];
}

const isYear = (n: number, raw: boolean) => raw && n >= 1990 && n <= 2100;

/** Angka di jawaban yang tidak ditemukan di pool (dengan toleransi pembulatan). */
export function unverifiedNumbers(answer: string, pool: number[]): number[] {
  const bad = new Set<number>();
  for (const n of extractNumbers(answer, { skipDerived: true })) {
    if (n < MIN_CHECKED || isYear(n, Number.isInteger(n))) continue;
    const ok = pool.some((c) => Math.abs(n - c) <= Math.max(1, Math.abs(c) * REL_TOLERANCE));
    if (!ok) bad.add(n);
  }
  return [...bad];
}

/** @akun yang disebut jawaban tetapi tidak ada di daftar akun (huruf kecil). */
export function unknownHandles(answer: string, known: Set<string>): string[] {
  const bad = new Set<string>();
  for (const m of answer.matchAll(/@([A-Za-z0-9_.]{2,40})/g)) {
    const h = m[1].replace(/\.+$/, "").toLowerCase();
    if (h && !known.has(h)) bad.add(h);
  }
  return [...bad];
}

export interface AnswerCheck {
  ok: boolean;
  numbers: number[];
  handles: string[];
}

export function checkAnswer(answer: string, pool: number[], knownHandles: Set<string>): AnswerCheck {
  const numbers = unverifiedNumbers(answer, pool);
  const handles = unknownHandles(answer, knownHandles);
  return { ok: numbers.length === 0 && handles.length === 0, numbers, handles };
}

/** Pesan perbaikan untuk model: sebut temuan verifikasi dan minta tulis ulang berbasis data. */
export function correctionPrompt(check: AnswerCheck): string {
  const fmt = (n: number) => n.toLocaleString("id-ID");
  const parts: string[] = [];
  if (check.numbers.length) {
    parts.push(`angka berikut tidak ditemukan di data: ${check.numbers.slice(0, 8).map(fmt).join(", ")}`);
  }
  if (check.handles.length) {
    parts.push(`akun berikut tidak ada di data: ${check.handles.slice(0, 8).map((h) => "@" + h).join(", ")}`);
  }
  return `Verifikasi otomatis menemukan ${parts.join("; ")}. Tulis ulang jawaban yang sama secara lengkap dengan format yang sama. Pakai hanya angka dan akun yang ada di DATA. Bila angka adalah hasil hitung, tulis hitungannya dengan "=", misalnya "12.000 / 40 = 300". Hapus klaim yang tidak bisa dibuktikan dari data. Jangan menyebut bahwa ini perbaikan.`;
}
