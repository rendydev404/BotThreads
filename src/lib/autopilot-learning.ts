/**
 * Loop belajar autopilot: hasil posting (views dibanding kebiasaan akun) dipakai untuk memilih ide,
 * formula hook, dan pilar berikutnya, serta mendeteksi posting viral dan kinerja yang anjlok.
 *
 * Skor satu posting = ln((views+1)/(median views+1)) + 0,5 * ln((balasan+1)/(median balasan+1)) terhadap
 * kebiasaan 30 hari akun (engagementScore, sql/042), jadi 0 berarti "seperti biasanya", +0,69 berarti
 * dua kali lipat. Rata-rata per kategori disusutkan (Bayes) ke rata-rata jaringan supaya kategori
 * dengan sedikit posting tidak langsung menang; bobot penyusutan sama dengan pemilihan jam terbaik.
 *
 * Selain formula hook/pilar/jam/jenis slot, autopilot juga belajar FORMAT dan LAYOUT postingan (sql/042):
 * tiap tick sebagian kecil hasil dilabeli detectFormat/layoutFeatures, lalu dash_learn_stats
 * menjadikannya dimensi format, panjang, baris, daftar, dan pembuka.
 */
import { randomUUID } from "node:crypto";
import { topicKey } from "./autopilot-ideas";
import { MissingAutopilotSchemaError, acquireLease, isMissingAutopilotSchema, missingSchemaFile } from "./autopilot-store";
import { rpc, utc } from "@/lib/supabase";
import { insertIdeas } from "./radar-store";
import { hookLabel } from "./radar-types";
import { POST_FORMATS, POST_FORMAT_LABEL, detectFormat, layoutFeatures, type LayoutFeatures, type PostFormat } from "./style-types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Hasil disinkronkan paling sering tiap 3 jam (metrik sumbernya sendiri berubah lebih jarang). */
export const LEARN_INTERVAL_MS = 3 * HOUR_MS;
/** Bobot penyusutan ke rata-rata pembanding (setara sekian posting). */
export const LEARN_PRIOR = 3;
/** Minimal posting supaya sebuah pola layak disebut "terbukti" di prompt. */
const PROVEN_MIN_POSTS = 3;
/** Minimal keunggulan (skor log) supaya layak disebut: kira-kira 1,15x views biasa. */
const PROVEN_MIN_SCORE = 0.14;
/** Minimal posting per kelompok gaya (format/layout): lebih berisik dari formula hook, jadi sedikit lebih ketat. */
const STYLE_MIN_POSTS = 4;
/** Paling banyak kalimat gaya (format + layout) di blok pola terbukti. */
const STYLE_MAX_LINES = 3;
/** Hasil yang dilabeli format/layout per tick (pelabelan murni regex, < 5 md untuk 50 teks). */
export const LABEL_BATCH = 50;
const FOLLOW_UP_TTL_MS = 3 * DAY_MS;

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await rpc<T>(fn, args);
  } catch (err) {
    if (isMissingAutopilotSchema(err)) throw new MissingAutopilotSchemaError(missingSchemaFile(err));
    throw err;
  }
}

/* ------------------------------------------------------------------ statistik (murni) */

/** Dimensi lama (juga tampil di ringkasan performa UI). */
export type BaseLearnDim = "formulaHook" | "pilar" | "jam" | "jenisSlot";
/**
 * Dimensi gaya dari label format/layout (sql/042): format = PostFormat; panjang = pendek|sedang|panjang
 * (<120 | 120-280 | >280 karakter); baris = 1|2-4|5+; daftar = ya|tidak; pembuka = kecil|kapital.
 */
export type StyleLearnDim = "format" | "panjang" | "baris" | "daftar" | "pembuka";
export type LearnDim = BaseLearnDim | StyleLearnDim;

export interface StatRow {
  /** null = rata-rata jaringan. */
  aid: string | null;
  dim: LearnDim;
  val: string;
  n: number;
  avg: number;
}

/** Rata-rata tersusut: sedikit data ditarik ke pembanding, banyak data mendekati rata-rata sendiri. */
export const shrunk = (n: number, avg: number, priorMean: number, prior = LEARN_PRIOR): number =>
  (n * avg + prior * priorMean) / (n + prior);

export interface AccountStats {
  /** Skor tersusut kategori ini di akun (0 = seperti biasanya); null bila belum ada data sama sekali. */
  score: (dim: LearnDim, val: string | null) => number | null;
  /** Jumlah posting akun pada kategori ini. */
  count: (dim: LearnDim, val: string | null) => number;
}

/** Susun pencari skor per akun dari baris statistik (akun + jaringan). */
export function buildStats(rows: StatRow[]): Map<string, AccountStats> {
  const network = new Map<string, StatRow>();
  const own = new Map<string, Map<string, StatRow>>();
  for (const r of rows) {
    const key = `${r.dim}|${r.val}`;
    if (r.aid === null) network.set(key, r);
    else own.set(r.aid, (own.get(r.aid) ?? new Map<string, StatRow>()).set(key, r));
  }
  const out = new Map<string, AccountStats>();
  for (const [aid, mine] of own) {
    out.set(aid, {
      count: (dim, val) => (val === null ? 0 : mine.get(`${dim}|${val}`)?.n ?? 0),
      score: (dim, val) => {
        if (val === null) return null;
        const a = mine.get(`${dim}|${val}`);
        const net = network.get(`${dim}|${val}`);
        if (!a && !net) return null;
        // Pembanding = rata-rata jaringan untuk kategori itu (sendirinya disusutkan ke 0).
        const prior = net ? shrunk(net.n, net.avg, 0) : 0;
        return a ? shrunk(a.n, a.avg, prior) : prior;
      },
    });
  }
  return out;
}

/** Skor log -1..1 ke 0..1 (0,5 = seperti biasanya) untuk komponen "kinerja" pada skor ide. */
export const toUnit = (score: number): number => Math.min(1, Math.max(0, 0.5 + score / 2));

/** Kinerja historis sebuah ide di akun ini: rata-rata formula hook dan pilarnya; 0,5 bila belum ada data. */
export function ideaPerformance(stats: AccountStats | undefined) {
  return (idea: { formulaHook: string | null; pilar: string | null }): number => {
    if (!stats) return 0.5;
    const parts = [stats.score("formulaHook", idea.formulaHook), stats.score("pilar", idea.pilar)].filter(
      (x): x is number => x !== null
    );
    return parts.length ? toUnit(parts.reduce((s, x) => s + x, 0) / parts.length) : 0.5;
  };
}

const fmtMult = (score: number): string => `${Math.exp(score).toFixed(1).replace(".", ",")}x`;

const isPostFormat = (v: string): v is PostFormat => (POST_FORMATS as readonly string[]).includes(v);

/** Dimensi layout yang dibandingkan antar-kelompok di prompt, beserta label kelompoknya. */
const LAYOUT_BUCKET_LABEL: Record<Exclude<StyleLearnDim, "format">, Record<string, string>> = {
  panjang: { pendek: "pendek (<120 karakter)", sedang: "sedang (120-280 karakter)", panjang: "panjang (>280 karakter)" },
  baris: { "1": "1 baris", "2-4": "2-4 baris", "5+": "5 baris atau lebih" },
  daftar: { ya: "berbentuk daftar (poin/nomor)", tidak: "tanpa daftar" },
  pembuka: { kecil: "yang dibuka huruf kecil", kapital: "yang dibuka huruf kapital" },
};
/** Selisih skor minimal antara kelompok layout terbaik dan terburuk supaya layak dibandingkan (~1,2x). */
const STYLE_MIN_GAP = 0.2;

/**
 * Kalimat gaya (format + layout) untuk blok pola terbukti, paling banyak STYLE_MAX_LINES: format terbaik,
 * layout terbaik, lalu sisanya yang terkuat.
 * Format: hanya yang cukup posting dan di atas biasanya. Layout: kelompok terbaik dibandingkan kelompok
 * terburuk di dimensi yang sama bila selisihnya berarti, atau disebut sendiri bila jelas di atas biasanya.
 */
function stylePatterns(rows: StatRow[], accountId: string, stats: AccountStats): string[] {
  type Line = { text: string; strength: number };
  const formats: Line[] = [];
  const layouts: Line[] = [];
  const scored = (dim: StyleLearnDim) =>
    rows
      .filter((r) => r.aid === accountId && r.dim === dim && r.n >= STYLE_MIN_POSTS)
      .map((r) => ({ r, s: stats.score(r.dim, r.val) ?? 0 }));

  for (const { r, s } of scored("format")) {
    if (!isPostFormat(r.val) || s < PROVEN_MIN_SCORE) continue;
    formats.push({
      text: `Di akun ini, ${POST_FORMAT_LABEL[r.val]} rata-rata ${fmtMult(s)} hasil biasa (views + balasan, ${r.n} postingan).`,
      strength: s,
    });
  }

  for (const dim of Object.keys(LAYOUT_BUCKET_LABEL) as (keyof typeof LAYOUT_BUCKET_LABEL)[]) {
    const labels = LAYOUT_BUCKET_LABEL[dim];
    const groups = scored(dim)
      .filter((x) => x.r.val in labels)
      .sort((a, b) => b.s - a.s);
    if (!groups.length) continue;
    const best = groups[0];
    const worst = groups.length > 1 ? groups[groups.length - 1] : null;
    if (worst && best.s >= 0 && best.s - worst.s >= STYLE_MIN_GAP) {
      layouts.push({
        text: `Postingan ${labels[best.r.val]} lebih berhasil daripada ${labels[worst.r.val]}: ${fmtMult(best.s)} vs ${fmtMult(worst.s)} hasil biasa (${best.r.n} vs ${worst.r.n} postingan).`,
        strength: best.s - worst.s,
      });
    } else if (best.s >= PROVEN_MIN_SCORE) {
      layouts.push({ text: `Postingan ${labels[best.r.val]} rata-rata ${fmtMult(best.s)} hasil biasa (${best.r.n} postingan).`, strength: best.s });
    }
  }

  // Beragam dulu: format terbaik dan layout terbaik dijamin tempat, sisanya diisi yang terkuat.
  const byStrength = (a: Line, b: Line) => b.strength - a.strength;
  formats.sort(byStrength);
  layouts.sort(byStrength);
  const head = [formats.shift(), layouts.shift()].filter((x): x is Line => !!x);
  return [...head, ...[...formats, ...layouts].sort(byStrength)].slice(0, STYLE_MAX_LINES).map((x) => x.text);
}

/**
 * Kalimat "pola yang terbukti" untuk prompt penulis: kategori dengan cukup posting dan hasil di atas biasanya
 * (formula hook/pilar, paling banyak 3), disusul pola gaya format/layout (paling banyak 3).
 */
export function provenPatterns(rows: StatRow[], accountId: string, stats: AccountStats | undefined): string[] {
  if (!stats) return [];
  const mine = rows.filter((r) => r.aid === accountId && r.n >= PROVEN_MIN_POSTS && (r.dim === "formulaHook" || r.dim === "pilar"));
  const base = mine
    .map((r) => ({ r, s: stats.score(r.dim, r.val) ?? 0 }))
    .filter((x) => x.s >= PROVEN_MIN_SCORE)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map(({ r, s }) =>
      r.dim === "formulaHook"
        ? `Pembuka gaya "${hookLabel(r.val) ?? r.val}" rata-rata ${fmtMult(s)} views biasa (${r.n} posting).`
        : `Pilar "${r.val}" rata-rata ${fmtMult(s)} views biasa (${r.n} posting).`
    );
  return [...base, ...stylePatterns(rows, accountId, stats)];
}

/**
 * Format yang terbukti berhasil di akun ini (untuk penulis): cukup posting (STYLE_MIN_POSTS) dan skor tersusut
 * di atas biasanya, urut skor tertinggi (seri: posting terbanyak). Kosong bila belum ada data yang cukup.
 */
export function preferredFormats(rows: StatRow[], accountId: string, stats = buildStats(rows).get(accountId)): PostFormat[] {
  if (!stats) return [];
  return rows
    .filter((r) => r.aid === accountId && r.dim === "format" && r.n >= STYLE_MIN_POSTS && isPostFormat(r.val))
    .map((r) => ({ f: r.val as PostFormat, n: r.n, s: stats.score("format", r.val) ?? 0 }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.n - a.n)
    .map((x) => x.f);
}

/* ------------------------------------------------------------------ pelabelan format/layout */

export interface OutcomeLabel {
  /** null untuk teks kosong (mis. posting media tanpa teks). */
  format: PostFormat | null;
  layout: LayoutFeatures;
}

/** Label satu teks hasil (murni). */
export function labelOutcome(text: string): OutcomeLabel {
  const layout = layoutFeatures(text);
  return { format: layout.chars > 0 ? detectFormat(text) : null, layout };
}

/**
 * Labeli paling banyak `limit` hasil yang belum berlabel (terbaru dulu, 60 hari). Idempoten: label yang sudah
 * ada tidak ditimpa. `more` = kemungkinan masih ada sisa (batch penuh).
 */
export async function labelOutcomes(now: Date, limit = LABEL_BATCH): Promise<{ labeled: number; more: boolean }> {
  const lim = Math.min(200, Math.max(1, Math.floor(limit)));
  const pending = await call<{ id: string; text: string | null }[]>("dash_learn_label_pending", { p_limit: lim, p_now: now });
  if (!pending.length) return { labeled: 0, more: false };
  const items = pending.map((p) => ({ id: p.id, ...labelOutcome(p.text ?? "") }));
  const labeled = await call<number>("dash_learn_label_set", { p_items: items });
  return { labeled, more: pending.length >= lim };
}

/**
 * Masih ada hasil yang mungkin belum berlabel di proses ini. Awalnya true (satu pemeriksaan per proses),
 * dinyalakan lagi tiap sinkron (hasil baru), dimatikan begitu satu batch tidak penuh. Jadi saat antrean
 * kosong, tick tidak membuang satu panggilan RPC pun.
 */
let labelBacklog = true;

async function labelStep(now: Date, counts: Counts): Promise<void> {
  try {
    const r = await labelOutcomes(now, LABEL_BATCH);
    bump(counts, "hasilDilabeli", r.labeled);
    labelBacklog = r.more;
  } catch (err) {
    // sql/042 belum dipasang atau galat lain: jangan hentikan tick, coba lagi setelah sinkron berikutnya.
    labelBacklog = false;
    if (isMissingAutopilotSchema(err)) bump(counts, "labelBelumDipasang");
    else console.error("[autopilot] label format:", err instanceof Error ? err.message : err);
  }
}

/* ------------------------------------------------------------------ akses data */

export const loadLearnStats = (accountIds: string[], now: Date) =>
  accountIds.length ? call<StatRow[]>("dash_learn_stats", { p_ids: accountIds, p_now: now }) : Promise.resolve([] as StatRow[]);

export interface ViralPost {
  postId: string;
  slotId: string;
  workspaceId: string;
  accountId: string;
  username: string | null;
  views: number;
  baseline: number;
  text: string;
  permalink: string | null;
  formulaHook: string | null;
  pilar: string | null;
}

export interface NotificationWrite {
  workspaceId: string;
  jenis: "VIRAL" | "AKUN_DIJEDA" | "MODE_DITURUNKAN" | "PENERBIT_TELAT";
  judul: string;
  isi?: string;
  tautan?: string;
  accountId?: string;
  dedupeKey: string;
}

/** Simpan notifikasi; kejadian dengan `dedupeKey` yang sama diabaikan. Kegagalan tidak menghentikan tick. */
export async function notify(items: NotificationWrite[], now: Date): Promise<number> {
  if (items.length === 0) return 0;
  try {
    return await call<number>("dash_notif_add", { p_items: items, p_now: now });
  } catch (err) {
    if (!(err instanceof MissingAutopilotSchemaError)) {
      console.error("[autopilot] notifikasi:", err instanceof Error ? err.message : err);
    }
    return 0;
  }
}

/* ------------------------------------------------------------------ langkah tick */

type Counts = Record<string, number>;
const bump = (c: Counts, key: string, n = 1): void => {
  if (n) c[key] = (c[key] ?? 0) + n;
};

const fmtViews = (n: number): string => n.toLocaleString("id-ID");

/**
 * BELAJAR: sinkronkan hasil posting, beri tahu dan tindak lanjuti posting viral, dan turunkan mode
 * akun yang kinerjanya anjlok. Dijalankan paling sering tiap 3 jam (dijaga lease `belajar`).
 * Pelabelan format/layout berjalan tiap tick selama masih ada antrean (paling banyak LABEL_BATCH per tick).
 */
export async function runLearning(now: Date, counts: Counts): Promise<void> {
  const due = await acquireLease("belajar", randomUUID(), now, new Date(now.getTime() + LEARN_INTERVAL_MS));
  if (due) {
    await syncOutcomes(now, counts);
    labelBacklog = true;
  }
  if (labelBacklog) await labelStep(now, counts);
}

async function syncOutcomes(now: Date, counts: Counts): Promise<void> {
  const viral = await call<ViralPost[]>("dash_learn_sync", { p_now: now });
  bump(counts, "viral", viral.length);
  if (viral.length) {
    await notify(
      viral.map((v) => ({
        workspaceId: v.workspaceId,
        jenis: "VIRAL" as const,
        judul: `Posting @${v.username ?? "akun"} sedang ramai: ${fmtViews(v.views)} views`,
        isi: `Biasanya sekitar ${fmtViews(v.baseline)} views. "${v.text.slice(0, 140)}"`,
        ...(v.permalink ? { tautan: v.permalink } : {}),
        accountId: v.accountId,
        dedupeKey: `VIRAL:${v.postId}`,
      })),
      now
    );
    // Ide lanjutan: akun yang sama melanjutkan obrolan selagi ramai (skor tinggi supaya dipakai di slot berikutnya).
    await insertIdeas(
      viral.map((v) => {
        const topik = `Lanjutkan obrolan dari postingan yang ramai: ${v.text.slice(0, 110)}`;
        return {
          id: `lanjutan-${v.postId}`,
          workspaceId: v.workspaceId,
          accountId: v.accountId,
          topik,
          topicKey: topicKey(topik),
          sudut: "tanggapi reaksi pembaca dan lanjutkan dari sudut yang belum dibahas",
          formulaHook: v.formulaHook,
          pilar: v.pilar,
          signalIds: [],
          score: 0.95,
          scoreDetail: { sinyal: 1, kebaruan: 0.8, kecocokan: 1, kinerja: 1 },
          expiresAt: new Date(now.getTime() + FOLLOW_UP_TTL_MS).toISOString(),
        };
      }),
      now
    ).catch((err) => console.error("[autopilot] ide lanjutan:", err instanceof Error ? err.message : err));
  }

  const drops = await call<string[]>("dash_learn_drops", { p_now: now });
  if (drops.length) {
    const demoted = await call<{ accountId: string; workspaceId: string }[]>("dash_ap_demote", { p_ids: drops, p_now: now });
    bump(counts, "modeDiturunkan", demoted.length);
    await notify(
      demoted.map((d) => ({
        workspaceId: d.workspaceId,
        jenis: "MODE_DITURUNKAN" as const,
        judul: "Autopilot diturunkan ke mode Tinjau",
        isi: "Views posting seminggu terakhir turun lebih dari separuh. Draf berikutnya menunggu persetujuan sampai Anda mengembalikannya ke Otomatis.",
        tautan: "/autopilot?tab=tinjau",
        accountId: d.accountId,
        dedupeKey: `TURUN:${d.accountId}:${now.toISOString().slice(0, 10)}`,
      })),
      now
    );
  }
}

/* ------------------------------------------------------------------ ringkasan untuk UI */

export interface PerformanceDim {
  /** dash_learn_summary hanya merangkum dimensi lama. */
  dim: BaseLearnDim;
  val: string;
  n: number;
  /** Rata-rata skor log (0 = seperti biasanya). */
  avg: number;
  avgViews: number;
}

export interface PerformanceSummary {
  dims: PerformanceDim[];
  autopilot: { n: number; avgViews: number; medianViews: number };
  lainnya: { n: number; avgViews: number; medianViews: number };
  viral: { postId: string; accountId: string; views: number; baseline: number; postedAt: string; formulaHook: string | null; pilar: string | null }[];
}

export async function loadPerformance(workspaceId: string | null, accountIds: string[] | null, now: Date): Promise<PerformanceSummary> {
  const raw = await call<PerformanceSummary>("dash_learn_summary", { p_workspace: workspaceId, p_account_ids: accountIds, p_now: now });
  return { ...raw, viral: raw.viral.map((v) => ({ ...v, postedAt: utc(v.postedAt).toISOString() })) };
}
