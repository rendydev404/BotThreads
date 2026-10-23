/**
 * Gerbang kualitas autopilot (murni, tanpa I/O): pemeriksaan deterministik yang harus dilewati
 * setiap draf sebelum boleh masuk antrean tanpa disentuh manusia. Aturan teks dasar (panjang,
 * placeholder, kemiripan dengan postingan akun sendiri) sudah dikerjakan `screenDrafts`; di sini
 * ditambah pagar yang khusus diperlukan saat tidak ada manusia yang membaca dulu:
 *
 * 1. klaim     - harga, persen, dan kata promo hanya boleh bila ada di sumber fakta akun.
 * 2. terlarang - topik sensitif bawaan dan daftar kata terlarang workspace.
 * 3. kembar    - tidak mirip draf akun lain pada hari yang sama (jaringan satu brand rawan terlihat spam).
 * 4. bentuk    - panjang dan placeholder diperiksa ulang (draf bisa saja diedit sebelum disetujui).
 * 5. asli      - tidak menyalin frasa (6 kata berurutan) dari contoh gaya yang ada di prompt.
 * 6. affiliate  - (slot affiliate saja) tanpa link, tanpa ajakan jualan keras, dan produknya disebut.
 */
import type { GateCheckDTO } from "./autopilot-types";
import { copiedPhrase } from "./style-types";
import { DRAFT_MAX_CHARS, PLACEHOLDER, THREADS_MAX_TEXT, charLength, jaccard } from "./threads-text";

/** Draf autopilot antar-akun pada hari yang sama tidak boleh semirip ini. */
export const PEER_SIMILARITY_LIMIT = 0.6;

/** Topik yang tidak boleh disentuh konten otomatis (isu sensitif dan kabar duka). */
export const DEFAULT_BANNED_TERMS = [
  "pemilu", "pilpres", "pilkada", "capres", "cawapres", "caleg", "partai politik", "kampanye politik",
  "kafir", "penistaan agama", "rasis", "sara",
  "gempa", "tsunami", "banjir bandang", "longsor", "korban jiwa", "korban tewas", "meninggal dunia",
  "berduka", "turut berduka", "tragedi", "kecelakaan maut", "bunuh diri",
  "menyembuhkan", "obat kanker", "anti kanker", "pasti sembuh",
  "judi", "slot gacor", "togel", "pinjol",
];

/**
 * Kata terlarang bawaan untuk satu akun: tema akun dari pemilik adalah aturan tertinggi, jadi kata bawaan yang
 * disebut sendiri oleh tema (mis. tema membahas "pemilu") tidak lagi diblokir untuk akun itu.
 */
export function defaultBannedFor(brief: string | null | undefined): string[] {
  if (!brief?.trim()) return DEFAULT_BANNED_TERMS;
  return DEFAULT_BANNED_TERMS.filter((t) => bannedHits(brief, [t]).length === 0);
}

const PROMO_WORD =
  /(?<![\p{L}\p{N}])(promo|diskon|cashback|voucher|vocer|gratis|free ongkir|potongan harga|harga coret|buy\s*1|beli\s*1|beli\s+satu\s+gratis|grand\s+opening|flash\s+sale|giveaway)(?![\p{L}\p{N}])/giu;

const MONEY =
  /(?<![\p{L}\p{N}])(?:rp\.?\s?)(\d[\d.,]*)\s?(rb|ribu|k|jt|juta)?(?![\p{L}])|(?<![\p{L}\p{N}.,])(\d[\d.,]*)\s?(rb|ribu|jt|juta|k)(?![\p{L}\p{N}])/giu;

const PERCENT = /(?<![\p{L}\p{N}.,])(\d{1,3})\s?(?:%|persen)(?![\p{L}\p{N}])/giu;

const MULTIPLIER: Record<string, number> = { rb: 1000, ribu: 1000, k: 1000, jt: 1_000_000, juta: 1_000_000 };

/** "15.000", "15rb", "Rp 15,5 ribu" -> nilai rupiah; null bila bukan angka yang wajar. */
function moneyValue(digits: string, unit: string | undefined): number | null {
  const mult = unit ? MULTIPLIER[unit.toLowerCase()] ?? 1 : 1;
  // Dengan satuan, koma/titik adalah desimal ("15,5 rb"); tanpa satuan, keduanya pemisah ribuan ("15.000").
  const num = mult > 1 ? Number(digits.replace(",", ".")) : Number(digits.replace(/[.,]/g, ""));
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * mult);
}

/** Semua nominal uang di dalam teks (dalam rupiah). */
export function moneyValues(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(MONEY)) {
    const v = moneyValue(m[1] ?? m[3], m[2] ?? m[4]);
    if (v !== null) out.push(v);
  }
  return out;
}

/** Persentase di dalam teks; "100%" dilewati karena lazim sebagai ungkapan ("100% setuju"), bukan klaim. */
const percentValues = (text: string): number[] =>
  [...text.matchAll(PERCENT)].map((m) => Number(m[1])).filter((n) => n !== 100);

const promoWords = (text: string): string[] => [
  ...new Set([...text.matchAll(PROMO_WORD)].map((m) => m[1].toLowerCase().replace(/\s+/g, " "))),
];

/**
 * Klaim di draf yang tidak ada di sumber fakta: nominal harga, persentase, dan kata promo.
 * `sources` adalah kalimat fakta akun dan butir knowledge base.
 */
export function unsupportedClaims(text: string, sources: string[]): string[] {
  const corpus = sources.join("\n");
  const knownMoney = new Set(moneyValues(corpus));
  const knownPercent = new Set(percentValues(corpus));
  const knownPromo = new Set(promoWords(corpus));
  const out: string[] = [];
  for (const v of new Set(moneyValues(text))) {
    if (!knownMoney.has(v)) out.push(`harga Rp ${v.toLocaleString("id-ID")}`);
  }
  for (const v of new Set(percentValues(text))) {
    if (!knownPercent.has(v)) out.push(`angka ${v}%`);
  }
  for (const w of promoWords(text)) {
    if (!knownPromo.has(w)) out.push(`kata "${w}"`);
  }
  return out;
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Kata/frasa terlarang yang muncul utuh (bukan bagian dari kata lain) di dalam teks. */
export function bannedHits(text: string, terms: string[]): string[] {
  const hits: string[] = [];
  for (const raw of terms) {
    const term = raw.trim().toLowerCase();
    if (term.length < 3) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(term).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu");
    if (re.test(text)) hits.push(term);
  }
  return hits;
}

/** Link di teks: postingan utama affiliate tidak boleh memuatnya (link dikirim di balasan pertama). */
const URL_LIKE = /https?:\/\/|www\.|(?<![\p{L}\p{N}@])[\p{L}\p{N}-]+\.(?:com|co\.id|id|ee|net|shop|link|ly)(?![\p{L}\p{N}])/iu;

/** Ajakan jualan keras yang membuat postingan terasa seperti iklan. */
const HARD_SELL = [
  "beli sekarang", "buruan", "checkout", "check out", "co sekarang", "klik link", "klik tautan", "link di bio",
  "cek bio", "keranjang kuning", "keranjang oren", "order sekarang", "pesan sekarang", "jangan sampai kehabisan",
  "stok terbatas", "harga termurah", "dijamin", "wajib punya", "wajib beli",
];

/** Kata bermakna dari nama produk (>= 4 huruf); nama pendek dipakai utuh. */
function productWords(nama: string): string[] {
  const words = nama.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4);
  return words.length ? words : [nama.toLowerCase().trim()].filter(Boolean);
}

/** Masalah postingan utama affiliate; daftar kosong bila aman. */
export function affiliateProblems(text: string, nama: string): string[] {
  const out: string[] = [];
  if (URL_LIKE.test(text)) out.push("memuat link (link dikirim di balasan, bukan di postingan)");
  const sell = bannedHits(text, HARD_SELL);
  if (sell.length) out.push(`ajakan jualan keras: ${sell.join(", ")}`);
  const lower = text.toLowerCase();
  if (!productWords(nama).some((w) => lower.includes(w))) out.push(`produk "${nama}" tidak disebut`);
  return out;
}

export interface GateInput {
  text: string;
  /** Kalimat fakta akun + knowledge base: satu-satunya sumber harga dan promo yang sah. */
  sources: string[];
  /** Draf autopilot akun lain pada hari yang sama. */
  peers: string[];
  /** Kata terlarang tambahan milik workspace. */
  bannedTerms?: string[];
  /** Tema akun: kata terlarang bawaan yang disebut tema tidak diblokir (tema adalah aturan tertinggi). */
  brief?: string | null;
  /** Slot affiliate: nama produk yang harus disebut. */
  affiliate?: { nama: string };
  /** Teks contoh gaya yang ada di prompt: draf tidak boleh menyalin frasanya (anti-jiplak). */
  exemplars?: string[];
}

/** Draf yang berbagi sekian kata berurutan dengan contoh gaya dianggap menjiplak. */
export const COPY_NGRAM = 6;

export interface GateResult {
  ok: boolean;
  checks: GateCheckDTO[];
  /** Ringkasan alasan gagal untuk catatan tulis ulang dan log; null bila lolos. */
  reason: string | null;
}

export function runGate(input: GateInput): GateResult {
  const text = input.text.trim();
  const checks: GateCheckDTO[] = [];

  const length = charLength(text);
  const shapeProblem =
    length < 15
      ? "Teks terlalu pendek."
      : length > THREADS_MAX_TEXT
        ? `Teks ${length} karakter, melebihi ${THREADS_MAX_TEXT}.`
        : PLACEHOLDER.test(text)
          ? "Masih ada placeholder yang harus diisi."
          : null;
  checks.push({
    key: "bentuk",
    label: "Panjang dan kelengkapan teks",
    ok: !shapeProblem,
    detail: shapeProblem ?? `${length} dari ${DRAFT_MAX_CHARS} karakter.`,
  });

  const claims = unsupportedClaims(text, input.sources);
  checks.push({
    key: "klaim",
    label: "Harga dan promo sesuai fakta akun",
    ok: claims.length === 0,
    ...(claims.length ? { detail: `Tidak ada di fakta akun: ${claims.join(", ")}.` } : {}),
  });

  const banned = bannedHits(text, [...defaultBannedFor(input.brief), ...(input.bannedTerms ?? [])]);
  checks.push({
    key: "terlarang",
    label: "Bebas topik sensitif",
    ok: banned.length === 0,
    ...(banned.length ? { detail: `Memuat: ${banned.join(", ")}.` } : {}),
  });

  const closest = input.peers.reduce((max, p) => Math.max(max, jaccard(text, p)), 0);
  checks.push({
    key: "kembar",
    label: "Berbeda dari akun lain hari ini",
    ok: closest < PEER_SIMILARITY_LIMIT,
    ...(closest >= PEER_SIMILARITY_LIMIT
      ? { detail: `Kemiripan ${Math.round(closest * 100)}% dengan draf akun lain.` }
      : {}),
  });

  if (input.exemplars?.length) {
    // Yang ditiru dari contoh gaya adalah ritme dan layout; frasa yang sama persis berarti menjiplak.
    const phrase = copiedPhrase(text, input.exemplars, COPY_NGRAM);
    checks.push({
      key: "asli",
      label: "Tidak menyalin contoh gaya",
      ok: !phrase,
      ...(phrase ? { detail: `Draf menyalin frasa dari contoh gaya: "${phrase}". Tulis dengan kata sendiri.` } : {}),
    });
  }

  if (input.affiliate) {
    const problems = affiliateProblems(text, input.affiliate.nama);
    checks.push({
      key: "affiliate",
      label: "Affiliate terasa natural",
      ok: problems.length === 0,
      ...(problems.length ? { detail: `Postingan affiliate ${problems.join("; ")}.` } : {}),
    });
  }

  const failed = checks.filter((c) => !c.ok);
  return {
    ok: failed.length === 0,
    checks,
    reason: failed.length ? failed.map((c) => c.detail ?? c.label).join(" ") : null,
  };
}
