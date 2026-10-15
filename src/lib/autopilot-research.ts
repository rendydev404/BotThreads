/**
 * Langkah riset dan penyusunan ide dalam tick autopilot.
 *
 * RISET  - menyegarkan sinyal radar bila sudah basi (pemenang jaringan, tren pencarian, momen).
 * IDE    - mengisi ulang bank ide akun yang stoknya menipis, beberapa akun per tick.
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
import type { PublishAccount } from "./publish-accounts";
import { builtinMomentSignals, fetchGoogleTrends, trendsToSignals } from "./radar-sources";
import {
  activeKnowledge,
  insertIdeas,
  listSignals,
  loadIdeaContext,
  pruneRadar,
  syncMoments,
  syncWinners,
  upsertSignals,
  type ActiveKnowledge,
  type RadarState,
  type SignalRow,
} from "./radar-store";
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
  const anyStale = stale(radar.lastCapture.JARINGAN, now) || stale(radar.lastCapture.MOMEN, now) || stale(radar.lastCapture.GTRENDS, now);
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
    jobs.push(
      guard(
        "sinyalTren",
        fetchGoogleTrends().then((items) => upsertSignals(trendsToSignals(items, now, extraBannedTerms()), now))
      )
    );
  }
  if (jobs.length === 0) return;
  await Promise.all(jobs);
  // Bersih-bersih menumpang jadwal riset (tiap 3 jam), tidak tiap tick.
  await pruneRadar(now).catch(() => undefined);
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
 * Isi ulang bank ide akun yang stoknya di bawah kebutuhan `IDEA_STOCK_DAYS` hari, paling tipis dulu.
 * Dibatasi `IDEA_ACCOUNTS_PER_TICK` akun per tick supaya beban AI tersebar.
 */
export async function refillIdeas(
  state: AutopilotState,
  accounts: Map<string, PublishAccount>,
  radar: RadarState,
  now: Date,
  deadline: number,
  counts: Counts
): Promise<void> {
  const need = [...state.configs.values()]
    .filter(
      (c) =>
        c.mode !== "MATI" &&
        !c.pausedReason &&
        (state.workspaceActive.get(c.workspaceId) ?? true) &&
        accounts.get(c.accountId)?.ready &&
        (radar.ideaCounts.get(c.accountId) ?? 0) < c.postsPerDay * IDEA_STOCK_DAYS &&
        now.getTime() - (lastIdeaAttempt.get(c.accountId) ?? 0) >= IDEA_RETRY_MS
    )
    .sort((a, b) => (radar.ideaCounts.get(a.accountId) ?? 0) - (radar.ideaCounts.get(b.accountId) ?? 0))
    .slice(0, IDEA_ACCOUNTS_PER_TICK);
  if (need.length === 0 || Date.now() >= deadline) return;

  const ids = need.map((c) => c.accountId);
  const workspaces = [...new Set(need.map((c) => c.workspaceId))];
  const [context, knowledge, statRows, ...signalLists] = await Promise.all([
    loadIdeaContext(ids, now),
    loadKnowledge(need, now),
    // Skema belajar belum dipasang atau kosong: ide dinilai tanpa komponen kinerja (0,5).
    loadLearnStats(ids, now).catch(() => [] as StatRow[]),
    ...workspaces.map((w) => listSignals({ workspaceId: w, sources: null, now, cursor: null, limit: SIGNALS_FOR_IDEAS })),
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
    const signals = selectSignals(signalsByWorkspace.get(config.workspaceId) ?? [], config.accountId);
    const recents = context.recents.get(config.accountId) ?? [];
    const topics = context.topics.get(config.accountId) ?? [];
    try {
      const raws = await askIdeas(
        buildIdeaPrompt({
          account,
          config,
          signals,
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
    } catch (err) {
      bump(counts, "ideGagal");
      console.error(`[autopilot] ide @${account.username ?? account.id}:`, err instanceof Error ? err.message : err);
    }
  });
}
