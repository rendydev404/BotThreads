/**
 * Langkah riset dan penyusunan ide dalam tick autopilot.
 *
 * RISET  - menyegarkan sinyal radar bila sudah basi (pemenang jaringan, tren pencarian, momen).
 * NICHE  - mencari tren yang lagi naik di niche tiap akun (tema dan pilar di pengaturan, atau
 *          disimpulkan dari postingan akun), beberapa akun per tick.
 * IDE    - mengisi ulang bank ide akun yang stoknya menipis atau yang trennya baru diperbarui.
 *
 * Keduanya tambahan: bila sumber luar gagal, AI tidak membalas, atau skema radar belum dipasang,
 * langkah ini dilewati dan penulisan tetap berjalan dengan topik dari gaya akun.
 */
import { extraBannedTerms } from "./autopilot-config";
import {
  IDEAS_PER_CALL,
  IDEA_STOCK_DAYS,
  askIdeas,
  buildIdeaPrompt,
  screenIdeas,
  selectSignals,
} from "./autopilot-ideas";
import { buildStats, ideaPerformance, loadLearnStats, type StatRow } from "./autopilot-learning";
import { randomUUID } from "node:crypto";
import { acquireLease, type AutopilotState, type ConfigRow } from "./autopilot-store";
import { nicheKey, nicheProfile, nicheTopicsToSignals, researchNiche, type NicheProfile } from "./niche-trends";
import type { PublishAccount } from "./publish-accounts";
import { builtinMomentSignals, fetchGoogleTrends, trendsToSignals, type SignalDraft } from "./radar-sources";
import { captureThreadsViral } from "./threads-trends";
import { captureWebTrends } from "./web-trends";
import {
  activeKnowledge,
  insertIdeas,
  listNicheSignals,
  listSignals,
  loadIdeaContext,
  pruneRadar,
  retireStaleIdeas,
  syncMoments,
  syncWinners,
  upsertSignals,
  type ActiveKnowledge,
  type RadarState,
  type SignalRow,
} from "./radar-store";
import type { SignalSource } from "./radar-types";
import { wibDayKey, wibParts } from "./scheduling";

const HOUR_MS = 60 * 60 * 1000;
/** Sinyal disegarkan paling sering tiap 3 jam. */
const RESEARCH_INTERVAL_MS = 3 * HOUR_MS;
/** Tren pencarian hanya diambil pada jam orang aktif (WIB). */
const RESEARCH_FIRST_HOUR = 5;
const RESEARCH_LAST_HOUR = 21;
/** Akun yang diisi ulang idenya per tick (satu panggilan AI per akun). */
const IDEA_ACCOUNTS_PER_TICK = 4;
const IDEA_CONCURRENCY = 2;
const SIGNALS_FOR_IDEAS = 80;
/**
 * Jeda sebelum mencoba mengisi ulang ide akun yang sama lagi. Tanpa ini, akun yang idenya terus
 * ditolak (mis. AI mengulang topik lama) akan memanggil AI di setiap tick.
 */
const IDEA_RETRY_MS = HOUR_MS;
const lastIdeaAttempt = new Map<string, number>();
/**
 * Tren baru masuk setelah ide akun terakhir disusun: bank ide diisi ulang walau stoknya masih cukup,
 * paling sering tiap 6 jam per akun dan selama stok belum melimpah. Tanpa ini ide hanya dibuat saat
 * stok habis, sehingga tren yang sedang panas sering basi sebelum sempat dipakai.
 */
const TREND_REFRESH_MS = 6 * HOUR_MS;
/** Batas stok untuk penyegaran karena tren: longgar, supaya ide lama tanpa tren tidak menahan ide tren baru. */
const TREND_REFRESH_MAX_DAYS = IDEA_STOCK_DAYS + 4;
const TREND_SOURCES = ["THREADS_SEARCH", "WEB", "GTRENDS"] as const;
const lastIdeaFill = new Map<string, number>();
/** Sumber sinyal bersama (global dan milik workspace) untuk prompt ide; tren niche dibaca terpisah per akun. */
const SHARED_SOURCES: SignalSource[] = ["JARINGAN", "GTRENDS", "WEB", "THREADS_SEARCH", "MOMEN", "MANUAL"];

/** Tren niche tiap akun dicari ulang paling sering tiap 8 jam, pada jam aktif. */
export const NICHE_REFRESH_MS = 8 * HOUR_MS;
/** Niche yang diriset per tick (sejajar; akun bertema sama berbagi satu riset). */
const NICHE_PER_TICK = 4;
/** Sinyal niche terbaru per akun yang dibaca untuk prompt ide. */
const NICHE_SIGNALS_PER_ACCOUNT = 10;
const NICHE_DEADLINE_MS = 80_000;
/** Riset niche hanya dimulai bila sisa anggaran tick masih cukup untuk ide dan penulisan slot. */
const NICHE_MIN_BUDGET_MS = 150_000;
/** Riset gagal (AI tidak membalas) dicoba lagi setelah ini; berhasil tetapi kosong menunggu jadwal biasa. */
const NICHE_RETRY_MS = HOUR_MS;
/** Waktu paling awal riset niche akun boleh dicoba lagi (di memori; hilang saat server dimulai ulang). */
const nicheNextTry = new Map<string, number>();

type Counts = Record<string, number>;
const bump = (c: Counts, key: string, n = 1): void => {
  if (n) c[key] = (c[key] ?? 0) + n;
};

const stale = (last: Date | undefined, now: Date): boolean => !last || now.getTime() - last.getTime() >= RESEARCH_INTERVAL_MS;

/**
 * Segarkan sinyal yang sudah basi, paling sering tiap 3 jam (dijaga lease `riset`, supaya sumber yang
 * sedang kosong atau gagal tidak dicoba lagi di setiap tick). Tiap sumber berdiri sendiri: satu gagal
 * tidak menghentikan yang lain.
 */
export async function runResearch(radar: RadarState, now: Date, counts: Counts): Promise<void> {
  const hour = wibParts(now).h;
  const anyStale =
    stale(radar.lastCapture.JARINGAN, now) ||
    stale(radar.lastCapture.MOMEN, now) ||
    stale(radar.lastCapture.GTRENDS, now) ||
    stale(radar.lastCapture.WEB, now);
  if (!anyStale) return;
  if (!(await acquireLease("riset", randomUUID(), now, new Date(now.getTime() + RESEARCH_INTERVAL_MS)))) return;
  const jobs: Promise<void>[] = [];
  const guard = (name: string, job: Promise<number>) =>
    job.then(
      (n) => bump(counts, name, n),
      (err) => {
        bump(counts, "risetGagal");
        console.error(`[autopilot] riset ${name}:`, err instanceof Error ? err.message : err);
      }
    );

  if (stale(radar.lastCapture.JARINGAN, now)) jobs.push(guard("sinyalJaringan", syncWinners(now)));
  if (stale(radar.lastCapture.MOMEN, now)) {
    jobs.push(
      guard(
        "sinyalMomen",
        Promise.all([upsertSignals(builtinMomentSignals(now), now), syncMoments(now, wibDayKey(now))]).then(([a, b]) => a + b)
      )
    );
  }
  if (hour >= RESEARCH_FIRST_HOUR && hour <= RESEARCH_LAST_HOUR && stale(radar.lastCapture.GTRENDS, now)) {
    const trends = fetchGoogleTrends();
    jobs.push(guard("sinyalTren", trends.then((items) => upsertSignals(trendsToSignals(items, now, extraBannedTerms()), now))));
    // Viral di Threads: posting terpopuler untuk topik yang sedang naik (butuh izin pencarian publik dari Meta).
    jobs.push(
      guard(
        "viralThreads",
        trends.then(async (items) => {
          const { signals, status } = await captureThreadsViral(items, now, extraBannedTerms());
          if (status !== "ok") console.info(`[autopilot] viral Threads dilewati: ${status === "no_token" ? "belum ada akun berizin pencarian" : "izin pencarian publik Threads belum disetujui Meta"}`);
          return signals.length ? upsertSignals(signals, now) : 0;
        })
      )
    );
  }
  // Viral di medsos: obrolan yang sedang ramai di Threads/medsos Indonesia, dicari AI lewat Google Search.
  if (hour >= RESEARCH_FIRST_HOUR && hour <= RESEARCH_LAST_HOUR && stale(radar.lastCapture.WEB, now)) {
    jobs.push(guard("viralMedsos", captureWebTrends(now, extraBannedTerms()).then((signals) => upsertSignals(signals, now))));
  }
  if (jobs.length === 0) return;
  await Promise.all(jobs);
  // Bersih-bersih menumpang jadwal riset (tiap 3 jam), tidak tiap tick.
  await pruneRadar(now).catch(() => undefined);
}

/* ------------------------------------------------------------------ tren niche */

/** Akun yang autopilotnya berjalan dan siap diisi ide. */
function activeConfigs(state: AutopilotState, accounts: Map<string, PublishAccount>): ConfigRow[] {
  return [...state.configs.values()].filter(
    (c) =>
      c.mode !== "MATI" &&
      !c.pausedReason &&
      (state.workspaceActive.get(c.workspaceId) ?? true) &&
      !!accounts.get(c.accountId)?.ready
  );
}

export interface NicheState {
  /** sql/027 terpasang (riset dan sinyal niche tersedia). */
  installed: boolean;
  /**
   * Akun yang tren nichenya basi dan menunggu riset, yang paling mendesak dulu. Idenya ditunda sampai
   * riset selesai (atau gagal), supaya disusun dari tren niche yang baru, bukan yang sudah basi.
   */
  due: ConfigRow[];
}

/**
 * Tentukan akun yang perlu diriset ulang tren nichenya. Tanpa query: waktu riset terakhir per akun sudah
 * ikut di `radar.nicheAt` (dash_radar_state). Tanpa sql/027, kunci Gemini, atau di luar jam aktif, tidak
 * ada yang menunggu dan ide disusun dari tren yang ada.
 */
export function planNiche(state: AutopilotState, accounts: Map<string, PublishAccount>, radar: RadarState, now: Date): NicheState {
  const nicheAt = radar.nicheAt;
  if (!nicheAt) return { installed: false, due: [] };
  const hour = wibParts(now).h;
  if (!process.env.GEMINI_API_KEY || hour < RESEARCH_FIRST_HOUR || hour > RESEARCH_LAST_HOUR) return { installed: true, due: [] };
  const last = (c: ConfigRow) => nicheAt.get(c.accountId)?.getTime() ?? 0;
  const critical = (c: ConfigRow) => (radar.ideaCounts.get(c.accountId) ?? 0) < c.postsPerDay;
  // Pemilik akun sudah menulis tema atau pilar: nichenya jelas, risetnya paling bermanfaat.
  const themed = (c: ConfigRow) => !!c.brief || c.pillars.length > 0;
  // Radar memakai profil niche akun walau Autopilot mati. Akun tanpa profil eksplisit tetap perlu
  // Autopilot aktif agar postingan terakhirnya menjadi dasar inferensi niche.
  const due = [...state.configs.values()]
    .filter((c) => {
      const hasProfile = !!c.brief || c.pillars.length > 0;
      const researchEnabled = hasProfile || (c.mode !== "MATI" && !c.pausedReason);
      return researchEnabled && (state.workspaceActive.get(c.workspaceId) ?? true) && !!accounts.get(c.accountId)?.ready;
    })
    .filter((c) => now.getTime() - last(c) >= NICHE_REFRESH_MS && now.getTime() >= (nicheNextTry.get(c.accountId) ?? 0))
    // Akun yang idenya hampir habis dulu, lalu yang bertema, lalu yang paling lama tidak diriset.
    .sort((a, b) => Number(critical(b)) - Number(critical(a)) || Number(themed(b)) - Number(themed(a)) || last(a) - last(b));
  return { installed: true, due };
}

export interface NicheJob {
  profile: NicheProfile;
  targets: ConfigRow[];
}

/** Kelompokkan akun yang perlu diriset: akun dengan tema dan pilar yang sama persis berbagi satu riset. */
export function nicheJobs(
  due: ConfigRow[],
  recents: Map<string, string[]>,
  limit: number
): { jobs: NicheJob[]; skipped: ConfigRow[] } {
  const jobs: NicheJob[] = [];
  const byKey = new Map<string, NicheJob>();
  const skipped: ConfigRow[] = [];
  for (const c of due) {
    const profile = nicheProfile(c, recents.get(c.accountId) ?? []);
    if (!profile) {
      skipped.push(c);
      continue;
    }
    const key = nicheKey(profile);
    const shared = key ? byKey.get(key) : undefined;
    if (shared) {
      shared.targets.push(c);
      continue;
    }
    if (jobs.length >= limit) continue;
    const job = { profile, targets: [c] };
    jobs.push(job);
    if (key) byKey.set(key, job);
  }
  return { jobs, skipped };
}

/**
 * Riset tren niche untuk akun yang jatuh tempo, paling banyak `NICHE_PER_TICK` niche per tick dan
 * sejajar satu sama lain. Ide akun-akun ini disusun pada tick berikutnya (lihat `refillIdeas`).
 */
export async function researchNiches(niche: NicheState, now: Date, deadline: number, counts: Counts): Promise<void> {
  if (niche.due.length === 0 || deadline - Date.now() < NICHE_MIN_BUDGET_MS) return;
  // Profil hanya untuk akun yang mungkin diriset tick ini (akun bertema sama ikut dalam satu riset).
  const candidates = niche.due.slice(0, NICHE_PER_TICK * 4);
  const [context, kb] = await Promise.all([
    loadIdeaContext(candidates.map((c) => c.accountId), now),
    loadKnowledge(candidates, now).catch(() => new Map<string, AccountKnowledge>()),
  ]);
  const { jobs, skipped } = nicheJobs(candidates, context.recents, NICHE_PER_TICK);
  // Tanpa tema, pilar, maupun cukup postingan: tidak ada niche untuk diriset. Dicoba lagi pada jadwal biasa.
  for (const c of skipped) nicheNextTry.set(c.accountId, now.getTime() + NICHE_REFRESH_MS);
  if (jobs.length === 0) return;

  const extraBanned = extraBannedTerms();
  await Promise.all(
    jobs.map(async (job) => {
      for (const c of job.targets) nicheNextTry.set(c.accountId, now.getTime() + NICHE_RETRY_MS);
      try {
        const research = await researchNiche(job.profile, now, Math.min(NICHE_DEADLINE_MS, deadline - Date.now() - 60_000));
        bump(counts, "risetNiche");
        if (!research) {
          bump(counts, "risetNicheGagal");
          return;
        }
        const drafts: SignalDraft[] = job.targets.flatMap((c) =>
          nicheTopicsToSignals(research, { accountId: c.accountId, workspaceId: c.workspaceId, brief: c.brief }, now, [
            ...extraBanned,
            ...(kb.get(c.accountId)?.banned ?? []),
          ])
        );
        bump(counts, "trenNiche", await upsertSignals(drafts, now));
        // Berhasil (termasuk bila kosong karena niche sepi atau semua tersaring): tunggu jadwal biasa.
        for (const c of job.targets) nicheNextTry.set(c.accountId, now.getTime() + NICHE_REFRESH_MS);
      } catch (err) {
        bump(counts, "risetNicheGagal");
        console.error("[autopilot] riset niche:", err instanceof Error ? err.message : err);
      }
    })
  );
}

export interface NicheResearchResult {
  status: "no_profile" | "failed" | "ok";
  /** Sinyal tren niche yang tersimpan. */
  signals: number;
  /** Judul tren teratas, untuk ditampilkan di panel agen. */
  topics: string[];
}

/**
 * Riset tren niche untuk SATU akun sekarang juga (agen onboarding), tanpa menunggu jam aktif, anggaran
 * tick, atau mode autopilot. Jadwal riset akun ini di tick ikut digeser supaya tidak diulang sia-sia.
 */
export async function researchNicheFor(config: ConfigRow, recents: string[], now: Date, deadlineMs = NICHE_DEADLINE_MS): Promise<NicheResearchResult> {
  const profile = nicheProfile(config, recents);
  if (!profile) return { status: "no_profile", signals: 0, topics: [] };
  nicheNextTry.set(config.accountId, now.getTime() + NICHE_RETRY_MS);
  const [research, kb] = await Promise.all([
    researchNiche(profile, now, deadlineMs),
    loadKnowledge([config], now).catch(() => new Map<string, AccountKnowledge>()),
  ]);
  if (!research) return { status: "failed", signals: 0, topics: [] };
  const drafts = nicheTopicsToSignals(research, { accountId: config.accountId, workspaceId: config.workspaceId, brief: config.brief }, now, [
    ...extraBannedTerms(),
    ...(kb.get(config.accountId)?.banned ?? []),
  ]);
  const signals = drafts.length ? await upsertSignals(drafts, now) : 0;
  nicheNextTry.set(config.accountId, now.getTime() + NICHE_REFRESH_MS);
  return { status: "ok", signals, topics: drafts.slice(0, 5).map((d) => d.title) };
}

/** Butir knowledge base yang berlaku untuk satu akun, sudah dipilah menurut kegunaannya. */
export interface AccountKnowledge {
  /** Fakta, produk, dan promo: sumber klaim yang sah (gerbang + prompt). */
  sources: string[];
  /** Promo yang sedang berjalan. */
  promos: { judul: string; isi: string }[];
  /** Kata/frasa terlarang tambahan. */
  banned: string[];
}

export const EMPTY_KNOWLEDGE: AccountKnowledge = { sources: [], promos: [], banned: [] };

/** Kelompokkan butir knowledge base per akun (butir tingkat workspace berlaku untuk semua akunnya). */
export function groupKnowledge(rows: ActiveKnowledge[], accounts: { id: string; workspaceId: string }[]): Map<string, AccountKnowledge> {
  const out = new Map<string, AccountKnowledge>();
  for (const a of accounts) {
    const mine = rows.filter((r) => r.accountId === a.id || (r.accountId === null && r.workspaceId === a.workspaceId));
    const k: AccountKnowledge = { sources: [], promos: [], banned: [] };
    for (const r of mine) {
      if (r.jenis === "LARANGAN") {
        k.banned.push(...r.isi.split(/[\n,]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 3));
      } else {
        k.sources.push(`${r.judul}: ${r.isi}`);
        if (r.jenis === "PROMO") k.promos.push({ judul: r.judul, isi: r.isi });
      }
    }
    out.set(a.id, k);
  }
  return out;
}

/** Muat knowledge base untuk akun-akun tertentu; peta kosong bila skema radar belum dipasang. */
export async function loadKnowledge(configs: ConfigRow[], now: Date): Promise<Map<string, AccountKnowledge>> {
  if (configs.length === 0) return new Map();
  const rows = await activeKnowledge(configs.map((c) => c.accountId), wibDayKey(now));
  return groupKnowledge(rows, configs.map((c) => ({ id: c.accountId, workspaceId: c.workspaceId })));
}

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const run = async () => {
    while (next < items.length) await worker(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

/**
 * Isi ulang bank ide akun yang stoknya di bawah kebutuhan `IDEA_STOCK_DAYS` hari, atau yang trennya
 * (umum maupun niche) baru diperbarui sejak ide terakhir disusun. Paling tipis dulu, dibatasi
 * `IDEA_ACCOUNTS_PER_TICK` akun per tick supaya beban AI tersebar.
 *
 * Akun yang tren nichenya sedang menunggu riset ditunda (kecuali stoknya tinggal kurang dari sehari),
 * supaya idenya disusun dari tren niche yang baru, bukan dari tren yang sudah basi.
 */
export async function refillIdeas(
  state: AutopilotState,
  accounts: Map<string, PublishAccount>,
  radar: RadarState,
  niche: NicheState,
  now: Date,
  deadline: number,
  counts: Counts
): Promise<void> {
  const sharedTrendAt = Math.max(0, ...TREND_SOURCES.map((src) => radar.lastCapture[src]?.getTime() ?? 0));
  const waiting = new Set(niche.due.map((c) => c.accountId));
  const stock = (c: ConfigRow) => radar.ideaCounts.get(c.accountId) ?? 0;
  const low = (c: ConfigRow) => stock(c) < c.postsPerDay * IDEA_STOCK_DAYS;
  const trendDue = (c: ConfigRow) => {
    const filled = lastIdeaFill.get(c.accountId) ?? 0;
    const trendAt = Math.max(sharedTrendAt, radar.nicheAt?.get(c.accountId)?.getTime() ?? 0);
    return stock(c) < c.postsPerDay * TREND_REFRESH_MAX_DAYS && trendAt > filled && now.getTime() - filled >= TREND_REFRESH_MS;
  };
  const need = activeConfigs(state, accounts)
    .filter(
      (c) =>
        (low(c) || trendDue(c)) &&
        !waiting.has(c.accountId) &&
        now.getTime() - (lastIdeaAttempt.get(c.accountId) ?? 0) >= IDEA_RETRY_MS
    )
    // Stok yang menipis didahulukan, lalu yang paling sedikit idenya.
    .sort((a, b) => Number(low(b)) - Number(low(a)) || stock(a) - stock(b))
    .slice(0, IDEA_ACCOUNTS_PER_TICK);
  await fillIdeasFor(need, accounts, niche.installed, now, deadline, counts);
}

/**
 * Susun ide untuk akun-akun tertentu (tanpa syarat stok atau mode autopilot). Dipakai `refillIdeas` di tick
 * dan oleh agen onboarding saat akun baru dihubungkan, supaya bank idenya langsung terisi hari itu juga.
 */
export async function fillIdeasFor(
  need: ConfigRow[],
  accounts: Map<string, PublishAccount>,
  nicheInstalled: boolean,
  now: Date,
  deadline: number,
  counts: Counts
): Promise<void> {
  if (need.length === 0 || Date.now() >= deadline) return;

  const ids = need.map((c) => c.accountId);
  const workspaces = [...new Set(need.map((c) => c.workspaceId))];
  const [context, knowledge, statRows, nicheSignals, ...signalLists] = await Promise.all([
    loadIdeaContext(ids, now),
    loadKnowledge(need, now),
    // Skema belajar belum dipasang atau kosong: ide dinilai tanpa komponen kinerja (0,5).
    loadLearnStats(ids, now).catch(() => [] as StatRow[]),
    // Tren niche dibaca per akun (bukan lewat daftar workspace) supaya tidak berebut batas baris.
    nicheInstalled
      ? listNicheSignals(ids, now, NICHE_SIGNALS_PER_ACCOUNT).catch(() => new Map<string, SignalRow[]>())
      : new Map<string, SignalRow[]>(),
    ...workspaces.map((w) => listSignals({ workspaceId: w, sources: SHARED_SOURCES, now, cursor: null, limit: SIGNALS_FOR_IDEAS })),
  ]);
  const signalsByWorkspace = new Map<string, SignalRow[]>(workspaces.map((w, i) => [w, signalLists[i]]));
  const extraBanned = extraBannedTerms();
  const stats = buildStats(statRows);

  await pool(need, IDEA_CONCURRENCY, async (config) => {
    if (Date.now() >= deadline) return;
    lastIdeaAttempt.set(config.accountId, now.getTime());
    const account = accounts.get(config.accountId)!;
    const kb = knowledge.get(config.accountId);
    const banned = [...extraBanned, ...(kb?.banned ?? [])];
    const signals = selectSignals(
      [...(signalsByWorkspace.get(config.workspaceId) ?? []), ...(nicheSignals.get(config.accountId) ?? [])],
      config.accountId
    );
    const recents = context.recents.get(config.accountId) ?? [];
    const topics = context.topics.get(config.accountId) ?? [];
    try {
      const raws = await askIdeas(
        buildIdeaPrompt({
          account,
          config,
          signals,
          samples: recents.slice(0, 8),
          avoid: [...topics, ...recents.slice(0, 30)],
          facts: kb?.sources ?? [],
          count: IDEAS_PER_CALL,
        })
      );
      bump(counts, "putaranAi");
      if (!raws) {
        bump(counts, "ideGagal");
        return;
      }
      lastIdeaFill.set(config.accountId, now.getTime());
      const ideas = screenIdeas({
        raws,
        account: { id: config.accountId, workspaceId: config.workspaceId },
        config,
        signals,
        existingTopics: topics,
        recentPosts: recents,
        bannedTerms: banned,
        performance: ideaPerformance(stats.get(config.accountId)),
        now,
      });
      bump(counts, "ideBaru", await insertIdeas(ideas, now));
      // Cukup ide tren niche baru untuk sehari: ide lama yang tidak menumpang tren niche diganti, supaya
      // bank ide tidak dipenuhi ide generik atau tren umum yang sudah basi. Tanpa sql/028 dilewati.
      const nicheIds = new Set((nicheSignals.get(config.accountId) ?? []).map((s) => s.id));
      const fresh = ideas.filter((i) => i.signalIds.some((id) => nicheIds.has(id))).length;
      if (fresh >= config.postsPerDay) {
        bump(counts, "ideLamaDiganti", await retireStaleIdeas(config.accountId, now, now).catch(() => 0));
      }
    } catch (err) {
      bump(counts, "ideGagal");
      console.error(`[autopilot] ide @${account.username ?? account.id}:`, err instanceof Error ? err.message : err);
    }
  });
}
