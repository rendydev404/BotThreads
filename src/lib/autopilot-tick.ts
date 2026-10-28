/**
 * Satu putaran autopilot (dipanggil penjadwal tiap 5 menit lewat /api/internal/autopilot/tick).
 *
 * Urutan: PENJAGA (jeda/lanjut akun) -> REKONSILIASI (selaraskan slot dengan antrean penerbit)
 * -> RENCANA (slot hari ini dan besok) -> TULIS (draf AI + gerbang + antre). Keadaan seluruhnya ada
 * di database, jadi putaran yang terputus tidak meninggalkan apa pun yang tidak bisa dilanjutkan:
 * - hanya satu tick berjalan pada satu waktu (lease `tick`);
 * - slot diklaim dengan FOR UPDATE SKIP LOCKED + lease, dan dipulihkan bila postingannya sudah diantre;
 * - rencana memakai kunci unik (akun, hari, urut), jadi aman diulang.
 *
 * Jumlah perjalanan ke database per tick tetap (tidak bertambah seiring jumlah akun); hanya penulisan
 * draf yang sebanding dengan jumlah slot yang jatuh tempo.
 */
import { randomUUID } from "node:crypto";
import { topLessons } from "./account-memory";
import {
  REVIEW_CUTOFF_MS,
  SLOT_LEASE_MS,
  TICK_BUDGET_MS,
  TICK_LEASE_MS,
  WRITE_LEAD_AUTO_MS,
  WRITE_LEAD_REVIEW_MS,
  extraBannedTerms,
  maxSlotsPerTick,
  lateBefore,
  writeConcurrency,
} from "./autopilot-config";
import { emptyAffiliateState, loadAffiliateState, type AffiliateState } from "./affiliate-store";
import { runAutoComments } from "./auto-comment";
import { criticEnabled } from "./autopilot-critic";
import {
  buildStats,
  loadLearnStats,
  notify,
  preferredFormats,
  provenPatterns,
  runLearning,
  type NotificationWrite,
  type StatRow,
} from "./autopilot-learning";
import type { TopicUse } from "./autopilot-ideas";
import { planDay } from "./autopilot-plan";
import {
  loadKnowledge,
  planNiche,
  refillIdeas,
  researchNiches,
  runResearch,
  type AccountKnowledge,
} from "./autopilot-research";
import {
  acquireLease,
  claimSlots,
  insertPlannedSlots,
  isMissingAutopilotSchema,
  loadState,
  logRun,
  pauseAccounts,
  peerTexts,
  reconcile,
  releaseLease,
  resumeAccounts,
  type AutopilotState,
  type ClaimedSlot,
  type ConfigRow,
  type PlannedSlotWrite,
} from "./autopilot-store";
import { MIN_GAP_MAX } from "./autopilot-types";
import { releaseSlot, writeSlot, type PeerDraft, type WriteContext } from "./autopilot-writer";
import { hourRowsForAccounts } from "./best-hours";
import { syncPendingInvoices } from "./billing";
import { CREATIVE_ANGLES, loadSharedContext } from "./content-ai";
import { WORKER_LATE_MS, isPublishEnabled } from "./content-config";
import { expiredTenants } from "./plan";
import { platformFlags } from "./platform";
import { listPublishAccounts, reasonText, type PublishAccount } from "./publish-accounts";
import { ideaCandidates, loadRadarState, signalBriefs, type IdeaCandidate, type SignalBrief } from "./radar-store";
import { startOfWibDay, wibDayKey } from "./scheduling";
import { listBrands, type WorkspaceBrand } from "./team-store";
import { refreshAvatars } from "./threads-avatars";
import { fetchSchedule } from "./threads-publish";

const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_LEASE = "tick";
/** Kegagalan AI beruntun sebelum sisa slot dilepas (penyedia AI sedang mati). */
const AI_FAIL_STREAK_LIMIT = 8;
const NOT_READY_PREFIX = "AKUN_TIDAK_SIAP";

export interface TickResult {
  ok: boolean;
  /** Terisi bila putaran dilewati (mis. tick lain masih berjalan). */
  skipped?: string;
  ms: number;
  counts: Record<string, number>;
  error?: string;
}

type Counts = Record<string, number>;
const bump = (c: Counts, key: string, n = 1): void => {
  if (n) c[key] = (c[key] ?? 0) + n;
};

/** Jalankan `worker` untuk semua item dengan paling banyak `limit` yang aktif bersamaan. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const run = async () => {
    while (next < items.length) await worker(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

const workspaceOn = (state: AutopilotState, workspaceId: string): boolean =>
  state.workspaceActive.get(workspaceId) ?? true;

/** Ide per akun yang dimuat untuk satu tick (cukup untuk beberapa slot + percobaan ulang). */
const IDEA_CANDIDATES_PER_ACCOUNT = 6;

/** Radar gagal dimuat: lanjut dengan nilai kosong, dan catat sekali di hitungan tick. */
const radarFallback =
  <T>(counts: Counts, empty: T) =>
  (err: unknown): T => {
    if (isMissingAutopilotSchema(err)) counts.radarBelumDipasang = 1;
    else {
      counts.risetGagal = (counts.risetGagal ?? 0) + 1;
      console.error("[autopilot] radar:", err instanceof Error ? err.message : err);
    }
    return empty;
  };

/* ------------------------------------------------------------------ penjaga */

/** Jeda akun yang tidak lagi siap diposting dan lanjutkan yang sudah siap kembali. */
async function guardAccounts(
  state: AutopilotState,
  accounts: Map<string, PublishAccount>,
  now: Date,
  counts: Counts
): Promise<void> {
  const active = [...state.configs.values()].filter((c) => c.mode !== "MATI");
  const byReason = new Map<string, ConfigRow[]>();
  for (const c of active) {
    const account = accounts.get(c.accountId);
    if (c.pausedReason || account?.ready) continue;
    const reason = `${NOT_READY_PREFIX}:${account?.reason ?? "TIDAK_DITEMUKAN"}`;
    byReason.set(reason, [...(byReason.get(reason) ?? []), c]);
  }
  const back = active.filter((c) => c.pausedReason?.startsWith(NOT_READY_PREFIX) && accounts.get(c.accountId)?.ready);

  await Promise.all([
    ...[...byReason].map(async ([reason, list]) => {
      const paused = new Set(await pauseAccounts(list.map((c) => c.accountId), reason, now));
      const hit = list.filter((c) => paused.has(c.accountId));
      for (const c of hit) c.pausedReason = reason;
      bump(counts, "dijeda", paused.size);
      await notify(hit.map((c) => pausedNotice(c, accounts.get(c.accountId), reason, now)), now);
    }),
    back.length
      ? resumeAccounts(back.map((c) => c.accountId), NOT_READY_PREFIX, now).then((ids) => {
          const resumed = new Set(ids);
          for (const c of back) if (resumed.has(c.accountId)) c.pausedReason = null;
          bump(counts, "dilanjutkan", resumed.size);
        })
      : Promise.resolve(),
  ]);
}

/** Notifikasi "akun dijeda": satu per akun per hari per alasan. */
function pausedNotice(c: ConfigRow, account: PublishAccount | undefined, reason: string, now: Date): NotificationWrite {
  const who = `@${account?.username ?? account?.displayName ?? "akun"}`;
  const failed = reason === "GAGAL_BERUNTUN";
  return {
    workspaceId: c.workspaceId,
    jenis: "AKUN_DIJEDA",
    judul: `Autopilot ${who} dijeda`,
    isi: failed
      ? "Tiga posting terakhir gagal terbit. Periksa akunnya, lalu simpan ulang pengaturan autopilot untuk melanjutkan."
      : `Akun belum siap diposting${account?.reason ? ` (${reasonText(account.reason)})` : ""}. Autopilot lanjut sendiri begitu akun siap lagi.`,
    tautan: "/autopilot",
    accountId: c.accountId,
    dedupeKey: `JEDA:${c.accountId}:${reason}:${wibDayKey(now)}`,
  };
}

/* ------------------------------------------------------------------ rencana */

/** Jeda sebelum hari yang sama dicoba direncanakan lagi untuk akun yang sama (pengaturan yang sama). */
const PLAN_RETRY_MS = 60 * 60 * 1000;
/** (akun | hari | versi pengaturan) -> kapan terakhir direncanakan. Mengubah pengaturan langsung dicoba lagi. */
const planAttempts = new Map<string, number>();

/** Slot yang belum ada untuk hari ini dan besok, dihitung perencana murni lalu disisipkan sekaligus. */
export async function planMissingSlots(
  state: AutopilotState,
  accounts: Map<string, PublishAccount>,
  now: Date
): Promise<number> {
  const days = [wibDayKey(now), wibDayKey(new Date(now.getTime() + DAY_MS))];
  const existing = new Map<string, number[]>();
  const takenByAccount = new Map<string, number[]>();
  for (const s of state.slots) {
    const key = `${s.accountId}|${s.dayKey}`;
    existing.set(key, [...(existing.get(key) ?? []), s.slotIndex]);
    if (s.status !== "DILEWATI" && s.status !== "DIBATALKAN") {
      takenByAccount.set(s.accountId, [...(takenByAccount.get(s.accountId) ?? []), Date.parse(s.slotAt)]);
    }
  }

  // Hari yang kurang slot DAN belum dicoba direncanakan dalam satu jam terakhir. Menjelang malam, hari
  // ini sering tidak bisa lagi dipenuhi; tanpa jeda ini perencanaan diulang sia-sia di setiap tick.
  const due = (c: ConfigRow, d: string): boolean =>
    (existing.get(`${c.accountId}|${d}`)?.length ?? 0) < c.postsPerDay &&
    now.getTime() - (planAttempts.get(`${c.accountId}|${d}|${c.updatedAt ?? ""}`) ?? 0) >= PLAN_RETRY_MS;
  const todo = [...state.configs.values()].filter((c) => {
    if (c.mode === "MATI" || c.pausedReason || !workspaceOn(state, c.workspaceId)) return false;
    if (!accounts.get(c.accountId)?.ready) return false;
    return days.some((d) => due(c, d));
  });
  if (todo.length === 0) return 0;

  const ids = todo.map((c) => c.accountId);
  const pad = MIN_GAP_MAX * 60_000;
  const dayStart = startOfWibDay(now).getTime();
  const [hours, schedule] = await Promise.all([
    hourRowsForAccounts(ids, now),
    fetchSchedule(ids, new Date(dayStart - pad), new Date(dayStart + 2 * DAY_MS + pad)),
  ]);
  for (const r of schedule) {
    takenByAccount.set(r.aid, [...(takenByAccount.get(r.aid) ?? []), r.at.getTime()]);
  }

  const items: PlannedSlotWrite[] = [];
  for (const c of todo) {
    const taken = takenByAccount.get(c.accountId) ?? [];
    for (const dayKey of days) {
      if (!due(c, dayKey)) continue;
      planAttempts.set(`${c.accountId}|${dayKey}|${c.updatedAt ?? ""}`, now.getTime());
      const plan = planDay({
        accountId: c.accountId,
        dayKey,
        now,
        settings: c,
        ownRows: hours.own.get(c.accountId) ?? [],
        networkRows: hours.network,
        takenMs: taken,
        usedIndexes: existing.get(`${c.accountId}|${dayKey}`) ?? [],
      });
      for (const s of plan.slots) {
        // Slot hari ini ikut menjadi pembatas jarak untuk rencana besok.
        taken.push(s.slotAt.getTime());
        items.push({
          id: randomUUID(),
          workspaceId: c.workspaceId,
          accountId: c.accountId,
          dayKey,
          slotIndex: s.slotIndex,
          slotAt: s.slotAt.toISOString(),
          hour: s.hour,
          kind: s.kind,
          reason: s.reason,
        });
      }
    }
  }
  if (planAttempts.size > 20_000) planAttempts.clear();
  return insertPlannedSlots(items, now);
}

/* ------------------------------------------------------------------ tulis */

export async function writeDueSlots(
  state: AutopilotState,
  accounts: Map<string, PublishAccount>,
  now: Date,
  deadline: number,
  counts: Counts,
  preclaimed?: ClaimedSlot[]
): Promise<void> {
  const claimed =
    preclaimed ??
    (await claimSlots({
      now,
      // Slot yang baru lewat jam tayangnya ikut diklaim: lebih baik terbit sedikit telat daripada kosong.
      minAt: lateBefore(now),
      untilAuto: new Date(now.getTime() + WRITE_LEAD_AUTO_MS),
      untilReview: new Date(now.getTime() + WRITE_LEAD_REVIEW_MS),
      leaseUntil: new Date(now.getTime() + SLOT_LEASE_MS),
      limit: maxSlotsPerTick(),
    }));
  bump(counts, "diklaim", claimed.length);
  if (claimed.length === 0) return;

  // Slot akun yang sama dikerjakan berurutan supaya draf kedua tahu isi draf pertama.
  const groups = new Map<string, ClaimedSlot[]>();
  for (const s of claimed) groups.set(s.accountId, [...(groups.get(s.accountId) ?? []), s]);
  const ids = [...groups.keys()];
  const today = wibDayKey(now);

  let streak = 0;
  let ctx: WriteContext;
  try {
    const configs = ids.map((id) => state.configs.get(id)).filter((c): c is ConfigRow => !!c);
    const firstDay = claimed.reduce((min, s) => (s.dayKey < min ? s.dayKey : min), today);
    const [shared, peerRows, knowledge, ideas, statRows, brands, affiliate] = await Promise.all([
      loadSharedContext(ids, now),
      peerTexts(null, today, today),
      // Radar belum dipasang atau sedang bermasalah: tulis tanpa ide dan tanpa knowledge base.
      loadKnowledge(configs, now).catch(radarFallback(counts, new Map<string, AccountKnowledge>())),
      ideaCandidates(ids, now, IDEA_CANDIDATES_PER_ACCOUNT).catch(radarFallback(counts, new Map<string, IdeaCandidate[]>())),
      loadLearnStats(ids, now).catch(radarFallback(counts, [] as StatRow[])),
      listBrands().catch(radarFallback(counts, new Map<string, WorkspaceBrand>())),
      // Affiliate belum dipasang (sql/019) atau bermasalah: semua slot ditulis sebagai postingan biasa.
      loadAffiliateState(ids, firstDay).catch((err): AffiliateState => {
        if (isMissingAutopilotSchema(err)) counts.affiliateBelumDipasang = 1;
        else {
          counts.affiliateGagal = 1;
          console.error("[autopilot] affiliate:", err instanceof Error ? err.message : err);
        }
        return emptyAffiliateState();
      }),
    ]);
    const stats = buildStats(statRows);
    // Memori gaya per akun (satu kueri berindeks); skema belum dipasang = tulis tanpa pelajaran gaya.
    const lessons = await topLessons(ids).catch(() => new Map<string, { lesson: string }[]>());
    // Konteks tren untuk ide yang akan ditulis (satu kueri; gagal = tulis tanpa konteks tren).
    const signals = await signalBriefs([...ideas.values()].flat().flatMap((i) => i.signalIds)).catch((err): Map<string, SignalBrief> => {
      if (isMissingAutopilotSchema(err)) counts.konteksTrenBelumDipasang = 1;
      else console.error("[autopilot] konteks tren:", err instanceof Error ? err.message : err);
      return new Map();
    });
    const workspaceOf = (aid: string) => state.configs.get(aid)?.workspaceId ?? accounts.get(aid)?.tenantId ?? "";
    const peers = new Map<string, PeerDraft[]>();
    const topicsToday: TopicUse[] = [];
    for (const r of peerRows) {
      if (r.topicKey) topicsToday.push({ aid: r.aid, topicKey: r.topicKey });
      if (!r.text) continue;
      const ws = workspaceOf(r.aid);
      peers.set(ws, [...(peers.get(ws) ?? []), { aid: r.aid, text: r.text }]);
    }
    ctx = {
      shared,
      accounts,
      configs: state.configs,
      peers,
      bannedTerms: extraBannedTerms(),
      workspaceBanned: new Map([...brands].map(([id, b]) => [id, b.topikTerlarang])),
      knowledge,
      ideas,
      signals,
      topicsToday,
      critic: criticEnabled(),
      proven: new Map(ids.map((id) => [id, provenPatterns(statRows, id, stats.get(id))])),
      formats: new Map(ids.map((id) => [id, preferredFormats(statRows, id, stats.get(id))])),
      lessons: new Map(ids.map((id) => [id, (lessons.get(id) ?? []).map((l) => l.lesson)])),
      affiliate,
      deadline,
      seed: Math.floor(Math.random() * CREATIVE_ANGLES.length),
      order: new Map(ids.map((id, i) => [id, i])),
      onAi: (ok) => {
        bump(counts, "putaranAi");
        streak = ok ? 0 : streak + 1;
      },
    };
  } catch (err) {
    // Konteks gagal dimuat: lepas semua slot supaya dicoba lagi pada tick berikutnya.
    await Promise.all(claimed.map((s) => releaseSlot(s, "Konteks akun gagal dimuat.")));
    throw err;
  }

  await pool([...groups.values()], writeConcurrency(), async (slots) => {
    for (const slot of slots) {
      if (Date.now() >= deadline || streak >= AI_FAIL_STREAK_LIMIT) {
        await releaseSlot(slot, streak >= AI_FAIL_STREAK_LIMIT ? "AI sedang tidak tersedia." : "Belum sempat ditulis pada putaran ini.");
        bump(counts, "dilepas");
        continue;
      }
      const outcome = await writeSlot(slot, ctx);
      bump(counts, outcome.kind);
    }
  });
}

/* ------------------------------------------------------------------ tick */

export async function runTick(opts: { now?: Date; budgetMs?: number } = {}): Promise<TickResult> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const deadline = started + (opts.budgetMs ?? TICK_BUDGET_MS);
  const holder = randomUUID();
  const counts: Counts = {};
  const done = (r: Omit<TickResult, "ms" | "counts">): TickResult => ({ ...r, ms: Date.now() - started, counts });

  let leased: boolean;
  try {
    leased = await acquireLease(TICK_LEASE, holder, now, new Date(now.getTime() + TICK_LEASE_MS));
  } catch (err) {
    if (isMissingAutopilotSchema(err)) return done({ ok: false, error: "Skema autopilot belum dipasang (sql/005_autopilot.sql)." });
    throw err;
  }
  if (!leased) return done({ ok: true, skipped: "Tick lain masih berjalan." });

  let error: string | undefined;
  try {
    const today = wibDayKey(now);
    const tomorrow = wibDayKey(new Date(now.getTime() + DAY_MS));
    const [state, accountList, flags, expired] = await Promise.all([loadState(null, today, tomorrow), listPublishAccounts(), platformFlags(), expiredTenants(now)]);
    // Paket yang habis masa berlakunya diperlakukan seperti workspace yang dijeda.
    for (const ws of expired) state.workspaceActive.set(ws, false);
    if (expired.size) bump(counts, "paketHabis", expired.size);
    // Saklar darurat super admin: yang sudah terantre tetap direkonsiliasi, tetapi tidak ada rencana,
    // riset, maupun tulisan baru untuk workspace mana pun.
    const stopped = !flags.autopilotGlobal;
    if (stopped) bump(counts, "dijedaPlatform");
    const accounts = new Map(accountList.map((a) => [a.id, a]));

    await guardAccounts(state, accounts, now, counts);

    const rec = await reconcile(
      now,
      new Date(now.getTime() + REVIEW_CUTOFF_MS),
      lateBefore(now),
      new Date(now.getTime() - WORKER_LATE_MS)
    );
    bump(counts, "terbit", rec.terbit);
    bump(counts, "gagalTerbit", rec.gagal);
    bump(counts, "dibatalkan", rec.dibatalkan);
    bump(counts, "kedaluwarsa", rec.tinjauLewat + rec.terlambat);
    bump(counts, "penerbitTelat", rec.penerbitTelat);
    if (rec.gagalBeruntun.length) {
      const paused = await pauseAccounts(rec.gagalBeruntun, "GAGAL_BERUNTUN", now);
      const hit = paused.map((id) => state.configs.get(id)).filter((c): c is ConfigRow => !!c);
      for (const c of hit) c.pausedReason = "GAGAL_BERUNTUN";
      bump(counts, "dijeda", paused.length);
      await notify(hit.map((c) => pausedNotice(c, accounts.get(c.accountId), "GAGAL_BERUNTUN", now)), now);
    }
    if (rec.penerbitTelat > 0) {
      // Satu pemberitahuan per workspace per jam selama penerbit belum mengambil antrean.
      const hourKey = now.toISOString().slice(0, 13);
      const workspaces = new Set([...state.configs.values()].filter((c) => c.mode !== "MATI").map((c) => c.workspaceId));
      await notify(
        [...workspaces].map((workspaceId) => ({
          workspaceId,
          jenis: "PENERBIT_TELAT" as const,
          judul: "Penerbit Threads terlambat",
          isi: `${rec.penerbitTelat} posting autopilot sudah lewat jadwal tetapi belum diambil penerbit. Autopilot berhenti menambah antrean sampai penerbit berjalan lagi.`,
          tautan: "/jadwal",
          dedupeKey: `TELAT:${workspaceId}:${hourKey}`,
        })),
        now
      );
    }

    // Belajar dari hasil posting (paling sering tiap 3 jam); tambahan, tidak boleh menahan tick.
    await runLearning(now, counts).catch((err) => {
      if (isMissingAutopilotSchema(err)) bump(counts, "belajarBelumDipasang");
      else {
        bump(counts, "belajarGagal");
        console.error("[autopilot] belajar:", err instanceof Error ? err.message : err);
      }
    });

    // Cadangan notifikasi Midtrans: tagihan menunggu dicocokkan ulang ke API Midtrans (tidak menahan tick).
    await syncPendingInvoices(20, now)
      .then((r) => r.paid > 0 && bump(counts, "tagihanLunas", r.paid))
      .catch((err) => console.error("[autopilot] cek tagihan:", err instanceof Error ? err.message : err));

    // URL foto profil CDN Meta kedaluwarsa ~4 hari; segarkan sebelum pecah (paling sering tiap 30 menit).
    await refreshAvatars(now)
      .then((r) => {
        if (r.refreshed) bump(counts, "avatarDisegarkan", r.refreshed);
        if (r.failed) bump(counts, "avatarGagal", r.failed);
      })
      .catch((err) => console.error("[autopilot] segarkan avatar:", err instanceof Error ? err.message : err));

    if (!stopped) bump(counts, "direncanakan", await planMissingSlots(state, accounts, now));

    // Riset dan bank ide bersifat tambahan: kegagalannya tidak boleh menahan penulisan.
    // Riset tren (tanpa AI, tanpa posting) tetap jalan walau saklar posting mati, supaya Radar > Tren Viral
    // selalu segar; bank ide memanggil AI, jadi hanya diisi bila posting memang menyala.
    if (!stopped) {
      try {
        const radar = await loadRadarState(now);
        await runResearch(radar, now, counts);
        if (isPublishEnabled()) {
          // Riset tren niche dan pengisian ide berjalan sejajar untuk akun yang berbeda: akun yang trennya
          // sedang diriset menunggu tick berikutnya, supaya penulisan slot tidak tertunda dua kali.
          const niche = planNiche(state, accounts, radar, now);
          await Promise.all([
            researchNiches(niche, now, deadline, counts).catch((err) => {
              bump(counts, "risetNicheGagal");
              console.error("[autopilot] riset niche:", err instanceof Error ? err.message : err);
            }),
            refillIdeas(state, accounts, radar, niche, now, deadline, counts),
          ]);
        }
      } catch (err) {
        if (isMissingAutopilotSchema(err)) bump(counts, "radarBelumDipasang");
        else {
          bump(counts, "risetGagal");
          console.error("[autopilot] riset/ide:", err instanceof Error ? err.message : err);
        }
      }
    }

    if (stopped) {
      // Sudah dicatat di atas; tidak ada yang ditulis.
    } else if (!isPublishEnabled()) {
      // Saklar posting mati: rencana tetap dibuat, tetapi tidak ada yang ditulis atau diantre.
      bump(counts, "saklarMati");
    } else if (rec.penerbitTelat === 0) {
      // Penerbit terlambat berarti antrean tidak diambil; menambah antrean hanya menumpuk masalah.
      await writeDueSlots(state, accounts, now, deadline, counts);
    }

    // Auto Komentar (sql/043): tunduk pada saklar darurat platform, saklar posting, paket habis, dan jeda workspace.
    // Kegagalannya tidak menahan tick (ditangani di dalam runAutoComments).
    if (!stopped && isPublishEnabled()) {
      const blocked = new Set([...state.workspaceActive].filter(([, on]) => !on).map(([id]) => id));
      await runAutoComments(now, deadline, counts, { blocked, accounts });
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "galat tak dikenal";
    console.error("[autopilot] tick gagal:", error);
  } finally {
    const finishedAt = new Date();
    await logRun({ startedAt: now, finishedAt, durasiMs: Date.now() - started, hitung: counts, ...(error ? { error: error.slice(0, 500) } : {}) }).catch(
      (err) => console.error("[autopilot] gagal mencatat tick:", err instanceof Error ? err.message : err)
    );
    await releaseLease(TICK_LEASE, holder).catch(() => undefined);
  }
  console.info(`[autopilot] tick ${Date.now() - started} ms ${JSON.stringify(counts)}${error ? ` galat: ${error}` : ""}`);
  return done(error ? { ok: false, error: "Tick gagal. Lihat log server." } : { ok: true });
}
