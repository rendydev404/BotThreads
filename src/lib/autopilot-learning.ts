/**
 * Loop belajar autopilot: hasil posting (views dibanding kebiasaan akun) dipakai untuk memilih ide,
 * formula hook, dan pilar berikutnya, serta mendeteksi posting viral dan kinerja yang anjlok.
 *
 * Skor satu posting = ln((views+1)/(median akun+1)), jadi 0 berarti "seperti biasanya", +0,69 berarti
 * dua kali lipat. Rata-rata per kategori disusutkan (Bayes) ke rata-rata jaringan supaya kategori
 * dengan sedikit posting tidak langsung menang; bobot penyusutan sama dengan pemilihan jam terbaik.
 */
import { randomUUID } from "node:crypto";
import { topicKey } from "./autopilot-ideas";
import { MissingAutopilotSchemaError, acquireLease, isMissingAutopilotSchema, missingSchemaFile } from "./autopilot-store";
import { rpc, utc } from "@/lib/supabase";
import { insertIdeas } from "./radar-store";
import { hookLabel } from "./radar-types";

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

export type LearnDim = "formulaHook" | "pilar" | "jam" | "jenisSlot";

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

/** Kalimat "pola yang terbukti" untuk prompt penulis: kategori dengan cukup posting dan hasil di atas biasanya. */
export function provenPatterns(rows: StatRow[], accountId: string, stats: AccountStats | undefined): string[] {
  if (!stats) return [];
  const mine = rows.filter((r) => r.aid === accountId && r.n >= PROVEN_MIN_POSTS && (r.dim === "formulaHook" || r.dim === "pilar"));
  return mine
    .map((r) => ({ r, s: stats.score(r.dim, r.val) ?? 0 }))
    .filter((x) => x.s >= PROVEN_MIN_SCORE)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map(({ r, s }) =>
      r.dim === "formulaHook"
        ? `Pembuka gaya "${hookLabel(r.val) ?? r.val}" rata-rata ${fmtMult(s)} views biasa (${r.n} posting).`
        : `Pilar "${r.val}" rata-rata ${fmtMult(s)} views biasa (${r.n} posting).`
    );
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
 */
export async function runLearning(now: Date, counts: Counts): Promise<void> {
  const due = await acquireLease("belajar", randomUUID(), now, new Date(now.getTime() + LEARN_INTERVAL_MS));
  if (!due) return;

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
  dim: LearnDim;
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
