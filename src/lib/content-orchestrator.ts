/**
 * Supervisor Multi-Agent Orchestrator: satu agen per akun Threads, dijalankan serentak dengan batas
 * konkurensi, hasilnya dipancarkan satu per satu (untuk SSE).
 *
 * Supervisor sengaja berupa kode biasa, bukan panggilan AI tambahan: ia memuat data semua akun
 * sekali, membagi sudut kreatif, menjaga papan bersama (pembuka draf yang sudah jadi) supaya topik
 * antar-akun tidak kembar, dan mengulang akun yang gagal satu putaran lagi. Tidak pernah menulis ke
 * antrean posting.
 */
import { CREATIVE_ANGLES, loadSharedContext, pickAngles, runAccountAgent } from "./content-ai";
import type { OrchestrateAgent, OrchestrateEvent } from "./content-types";
import { reasonText, type PublishAccount } from "./publish-accounts";

const intEnv = (name: string, fallback: number, min: number, max: number): number => {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/**
 * Panggilan AI serentak; router membagi beban ke beberapa model hulu. Terukur untuk 33 akun:
 * konkurensi 6 = 94 dtk, 10 = 73 dtk (p90 per agen naik dari 23 ke 29 dtk, jadi lebih tinggi lagi tidak sepadan).
 */
const concurrency = (): number => intEnv("ORCHESTRATE_CONCURRENCY", 10, 1, 16);
/** Putaran ulang untuk akun yang gagal berjalan lebih pelan supaya tidak memperparah limit. */
const RETRY_CONCURRENCY = 3;
const RETRY_PAUSE_MS = 1200;
/** Kegagalan beruntun tanpa satu pun keberhasilan di antaranya sebelum putaran dihentikan. */
const FAIL_STREAK_LIMIT = 8;

export interface OrchestrateInput {
  accounts: PublishAccount[];
  topic: string;
  fixedTime: { hour: number; minute: number } | null;
  avoid: string | null;
  signal: AbortSignal;
}

export interface OrchestrateSummary {
  ok: number;
  failed: number;
  skipped: number;
  ms: number;
}

/** Jalankan `worker` untuk semua item dengan paling banyak `limit` yang aktif bersamaan. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const run = async () => {
    while (next < items.length) await worker(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

export async function runOrchestration(
  input: OrchestrateInput,
  emit: (event: OrchestrateEvent) => void
): Promise<OrchestrateSummary> {
  const started = Date.now();
  const ready = input.accounts.filter((a) => a.ready);
  const agents: OrchestrateAgent[] = input.accounts.map((a) => ({
    id: a.id,
    username: a.username,
    displayName: a.displayName,
    avatarUrl: a.avatarUrl,
    ...(a.ready ? {} : { skipped: reasonText(a.reason) || "Akun belum siap diposting" }),
  }));
  emit({ type: "plan", agents, concurrency: concurrency() });

  const summary = (ok: number, failed: number): OrchestrateSummary => ({
    ok,
    failed,
    skipped: agents.length - ready.length,
    ms: Date.now() - started,
  });
  if (ready.length === 0) return summary(0, 0);

  const shared = await loadSharedContext(ready.map((a) => a.id));
  const seed = Math.floor(Math.random() * CREATIVE_ANGLES.length);
  const order = new Map(ready.map((a, i) => [a.id, i]));
  const peers: string[] = [];
  let ok = 0;
  // Pemutus arus: bila AI gagal beruntun (penyedia mati), sisa akun tidak ikut menunggu timeout.
  let streak = 0;

  const attempt = async (account: PublishAccount, pass: number): Promise<string | null> => {
    if (input.signal.aborted) return "Dihentikan sebelum selesai.";
    if (streak >= FAIL_STREAK_LIMIT) return "AI sedang tidak tersedia. Coba lagi sebentar lagi.";
    try {
      const out = await runAccountAgent(shared, {
        account,
        brief: input.topic,
        // Putaran ulang memakai sudut lain supaya tidak mengulang kandidat yang sama.
        angles: pickAngles(order.get(account.id) ?? 0, seed + (pass - 1) * 5),
        peers: [...peers],
        avoid: input.avoid,
        fixedTime: input.fixedTime,
        signal: input.signal,
      });
      if (!out.ok) {
        streak++;
        return out.error;
      }
      streak = 0;
      peers.push(out.draft.text);
      ok++;
      emit({ type: "draft", accountId: account.id, draft: out.draft });
      return null;
    } catch (err) {
      console.error(`[orchestrate] @${account.username ?? account.id}:`, err instanceof Error ? err.message : err);
      return "Terjadi kesalahan saat membuat draf.";
    }
  };

  const errors = new Map<string, string>();
  const failedFirst: PublishAccount[] = [];
  await pool(ready, concurrency(), async (account) => {
    emit({ type: "start", accountId: account.id });
    const error = await attempt(account, 1);
    if (error) {
      errors.set(account.id, error);
      failedFirst.push(account);
      // Gagal di putaran pertama belum final: tandai antre ulang supaya UI tidak menampilkan galat dulu.
      if (!input.signal.aborted) emit({ type: "retry", accountId: account.id, attempt: 2 });
    }
  });

  if (failedFirst.length && !input.signal.aborted) {
    await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
    await pool(failedFirst, RETRY_CONCURRENCY, async (account) => {
      const error = await attempt(account, 2);
      if (error) errors.set(account.id, error);
      else errors.delete(account.id);
    });
  }

  for (const [accountId, error] of errors) emit({ type: "error", accountId, error });
  console.info(
    `[orchestrate] ${ok}/${ready.length} draf, ${errors.size} gagal, ${Date.now() - started} ms, konkurensi ${concurrency()}`
  );
  return summary(ok, errors.size);
}
