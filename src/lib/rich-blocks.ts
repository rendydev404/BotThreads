/**
 * Blok data kaya pada jawaban AI (murni, tanpa I/O). Model menulis blok kode berbahasa khusus:
 *
 *   ```bar                       ```stat
 *   Views 7 hari                 Total views | 260.926 | +18%
 *   @akun_a | 45.308 | +452%     Akun aktif | 32
 *   @akun_b | 12.100
 *   ```                          ```
 *
 * `bar` = diagram batang horizontal (lebar relatif ke nilai terbesar, atau 0 sampai 100 bila semua
 * persen). `stat` = deretan angka ringkas. Format baris dipilih agar tidak merusak bila model
 * menambah spasi atau lupa kolom opsional. Tabel GFM juga diparse di sini.
 */

export const BAR_LANG = "bar";
export const STAT_LANG = "stat";

/** Angka format id-ID ("45.308", "12,5%", "Rp 1.200.000") ➜ number; null bila tidak ada angka. */
export function toNumber(raw: string): number | null {
  const m = /-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?/.exec(raw.replace(/\s+/g, ""));
  if (!m) return null;
  const t = m[0];
  const thousands = /^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(t);
  const n = Number(thousands ? t.replace(/\./g, "").replace(",", ".") : t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export type Tone = "up" | "down" | "flat";

/** Nada perubahan dari teks seperti "+452%", "naik 13%", "-2%", "turun 5%". */
export function deltaTone(raw: string | undefined): Tone {
  if (!raw) return "flat";
  const t = raw.trim().toLowerCase();
  if (/^(\+|▲|↑|naik\b)/.test(t)) return "up";
  if (/^(-|−|–|▼|↓|turun\b)/.test(t)) return "down";
  return "flat";
}

export interface BarRow {
  label: string;
  /** Teks nilai persis seperti ditulis model (ditampilkan apa adanya). */
  valueText: string;
  value: number;
  /** Proporsi lebar 0..1. */
  ratio: number;
  note?: string;
}

export interface BarChartData {
  title: string | null;
  rows: BarRow[];
  percent: boolean;
}

const cells = (line: string) => line.split("|").map((c) => c.trim());

export function parseBars(source: string): BarChartData | null {
  const lines = source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  let title: string | null = null;
  const raw: Array<{ label: string; valueText: string; value: number; note?: string }> = [];

  for (const line of lines) {
    if (!line.includes("|")) {
      if (title === null && raw.length === 0) title = line.replace(/^#+\s*/, "");
      continue;
    }
    const [label, valueText, note] = cells(line);
    if (!label || valueText === undefined) continue;
    const value = toNumber(valueText);
    if (value === null) continue;
    raw.push({ label, valueText, value, note: note || undefined });
  }
  if (raw.length === 0) return null;

  const percent = raw.every((r) => r.valueText.includes("%"));
  const max = percent ? 100 : Math.max(...raw.map((r) => Math.abs(r.value)), 0);
  const rows: BarRow[] = raw.map((r) => ({
    ...r,
    ratio: max > 0 ? Math.min(1, Math.max(0, Math.abs(r.value) / max)) : 0,
  }));
  return { title, rows, percent };
}

export interface StatItem {
  label: string;
  value: string;
  note?: string;
}

export function parseStats(source: string): StatItem[] {
  const out: StatItem[] = [];
  for (const line of source.replace(/\r\n/g, "\n").split("\n")) {
    if (!line.includes("|")) continue;
    const [label, value, note] = cells(line);
    if (label && value) out.push({ label, value, note: note || undefined });
  }
  return out;
}

export type Align = "left" | "right" | "center";

export interface TableData {
  header: string[];
  align: Align[];
  rows: string[][];
}

const splitRow = (line: string): string[] => {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\" && t[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (t[i] === "|") {
      out.push(cur.trim());
      cur = "";
    } else cur += t[i];
  }
  out.push(cur.trim());
  return out;
};

const SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Baris pembuka tabel GFM: baris judul berpipa diikuti baris pemisah `---`. */
export function isTableStart(line: string, next: string | undefined): boolean {
  return !!next && line.includes("|") && SEPARATOR.test(next) && next.includes("-");
}

/** Baca tabel mulai dari `start`; kembalikan tabel dan indeks baris berikutnya. */
export function parseTable(lines: string[], start: number): { table: TableData; next: number } {
  const header = splitRow(lines[start]);
  const align: Align[] = splitRow(lines[start + 1]).map((c) =>
    c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left"
  );
  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
    const r = splitRow(lines[i]);
    // Samakan jumlah kolom dengan header
    while (r.length < header.length) r.push("");
    rows.push(r.slice(0, header.length));
    i++;
  }
  return { table: { header, align, rows }, next: i };
}

/** Kolom bernilai angka (untuk rata kanan dan angka tabular). */
export function numericColumns(t: TableData): boolean[] {
  return t.header.map((_, c) => {
    const vals = t.rows.map((r) => r[c]).filter((v) => v && v !== "-" && v !== "—");
    if (vals.length === 0) return false;
    const numeric = vals.filter((v) => /^[+\-−▲▼↑↓]?\s*(rp\.?\s*)?\d[\d.,\s]*(%|x|×|jt|rb|k)?\s*(views|view|post|menit|jam|kali)?$/i.test(v.replace(/\*\*/g, "")));
    return numeric.length / vals.length >= 0.7;
  });
}

export type CalloutKind = "note" | "tip" | "warning" | "key";

const CALLOUT_KINDS: Record<string, CalloutKind> = {
  NOTE: "note",
  CATATAN: "note",
  INFO: "note",
  TIP: "tip",
  TIPS: "tip",
  SARAN: "tip",
  WARNING: "warning",
  PERINGATAN: "warning",
  AWAS: "warning",
  IMPORTANT: "key",
  PENTING: "key",
  KESIMPULAN: "key",
  TEMUAN: "key",
};

export const CALLOUT_LABEL: Record<CalloutKind, string> = {
  note: "Catatan",
  tip: "Saran",
  warning: "Perhatian",
  key: "Temuan utama",
};

/** Kutipan berpenanda `[!TIP] Judul` ➜ callout; null untuk kutipan biasa. */
export function parseCallout(quote: string): { kind: CalloutKind; title: string; body: string } | null {
  const m = /^\[!([A-Za-z]+)\][ \t]*([^\n]*)\n?([\s\S]*)$/.exec(quote.trim());
  if (!m) return null;
  const kind = CALLOUT_KINDS[m[1].toUpperCase()];
  if (!kind) return null;
  return { kind, title: m[2].trim() || CALLOUT_LABEL[kind], body: m[3].trim() };
}

/** Teks polos untuk tombol Salin: blok bar/stat jadi baris "label: nilai". */
export function richBlocksPlainText(content: string): string {
  return content.replace(/```(bar|stat)[^\n]*\n([\s\S]*?)(?:```|$)/g, (_all, lang: string, src: string) => {
    if (lang === "bar") {
      const d = parseBars(src);
      if (!d) return "";
      return `${d.title ? `${d.title}\n` : ""}${d.rows.map((r) => `${r.label}: ${r.valueText}${r.note ? ` (${r.note})` : ""}`).join("\n")}\n`;
    }
    return `${parseStats(src)
      .map((s) => `${s.label}: ${s.value}${s.note ? ` (${s.note})` : ""}`)
      .join("\n")}\n`;
  });
}
