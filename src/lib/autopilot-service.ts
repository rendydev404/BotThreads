/**
 * Layanan autopilot untuk route API: ringkasan, simpan pengaturan, pratinjau jam, daftar slot.
 * Semua fungsi menerima konteks pengguna (workspace, peran, lingkup akun) dan hanya mengembalikan
 * data yang boleh dilihat pengguna itu.
 */
import { TICK_STALE_MS, parseSettingsPatch } from "./autopilot-config";
import { planDay } from "./autopilot-plan";
import {
  MissingAutopilotSchemaError,
  defaultConfig,
  listSlots,
  loadState,
  setWorkspaceActive,
  upsertConfigs,
  type AutopilotState,
  type ConfigRow,
  type ConfigWrite,
} from "./autopilot-store";
import {
  DEFAULT_SETTINGS,
  type AutopilotAccountDTO,
  type AutopilotConfigDTO,
  type AutopilotOverviewResponse,
  type AutopilotSettings,
  type AutopilotSlotDTO,
  type PlanPreviewResponse,
  type SlotListResponse,
  type SlotStatus,
} from "./autopilot-types";
import { hourRowsForAccounts } from "./best-hours";
import { clearMediaPolicyCache } from "./media-policy";
import { isPublishEnabled, maxPostsPerDay } from "./content-config";
import { checkAutopilotAgainstPlan, planLimits } from "./plan";
import { listPublishAccounts, reasonText, type PublishAccount } from "./publish-accounts";
import { scopeAccounts, type RequestCtx } from "./request-ctx";
import { startOfWibDay, wibDayKey } from "./scheduling";
import { decodeCursor, encodeCursor, fetchSchedule, type Failure } from "./threads-publish";

const DAY_MS = 24 * 60 * 60 * 1000;
export const SLOT_PAGE_SIZE = 20;

const failure = (status: number, error: string, details?: string[]): Failure => ({
  ok: false,
  status,
  error,
  ...(details?.length ? { details } : {}),
});

const EMPTY_STATE: AutopilotState = {
  workspaceActive: new Map(),
  configs: new Map(),
  slots: [],
  lastRun: null,
  stats7d: new Map(),
};

/** Buang kolom internal (workspaceId) sebelum dikirim ke klien. */
const toConfigDTO = (c: ConfigRow): AutopilotConfigDTO => {
  const { workspaceId, ...dto } = c;
  void workspaceId;
  return dto;
};

/** Akun yang boleh dilihat pengguna. */
export async function visibleAccounts(ctx: RequestCtx): Promise<PublishAccount[]> {
  return scopeAccounts(ctx, await listPublishAccounts());
}

/* ------------------------------------------------------------------ ringkasan */

export async function getOverview(ctx: RequestCtx, now = new Date()): Promise<AutopilotOverviewResponse> {
  const today = wibDayKey(now);
  const tomorrow = wibDayKey(new Date(now.getTime() + DAY_MS));

  let installed = true;
  const [accounts, state, plan] = await Promise.all([
    visibleAccounts(ctx),
    loadState(ctx.workspaceId, today, tomorrow).catch((err) => {
      if (!(err instanceof MissingAutopilotSchemaError)) throw err;
      installed = false;
      return EMPTY_STATE;
    }),
    planLimits(ctx.workspaceId, now),
  ]);

  const visible = new Set(accounts.map((a) => a.id));
  const slots: AutopilotSlotDTO[] = state.slots
    .filter((s) => visible.has(s.accountId))
    .map((s) => ({
      id: s.id,
      accountId: s.accountId,
      dayKey: s.dayKey,
      slotIndex: s.slotIndex,
      slotAt: s.slotAt,
      hour: s.hour,
      kind: s.kind,
      status: s.status,
      reason: s.reason,
      skipReason: s.skipReason,
      lastError: s.lastError,
      postId: s.postId,
      attempt: s.attempt,
      criticScore: s.criticScore,
    }));

  const workspaces = new Set(accounts.map((a) => a.tenantId).filter((w): w is string => !!w));
  const lastRun = state.lastRun;
  return {
    success: true,
    installed,
    publishEnabled: isPublishEnabled(),
    workspaceActive: [...workspaces].every((w) => state.workspaceActive.get(w) ?? true),
    today,
    tomorrow,
    accounts: accounts.map(
      (a): AutopilotAccountDTO => ({
        id: a.id,
        username: a.username,
        displayName: a.displayName,
        avatarUrl: a.avatarUrl,
        outletNama: a.outletNama,
        ready: a.ready,
        ...(a.reason ? { reason: a.reason } : {}),
        config: state.configs.has(a.id) ? toConfigDTO(state.configs.get(a.id)!) : defaultConfig(a.id),
        stats7d: state.stats7d.get(a.id) ?? null,
      })
    ),
    slots,
    reviewCount: slots.filter((s) => s.status === "MENUNGGU_TINJAU").length,
    health: {
      lastRunAt: lastRun?.startedAt ?? null,
      lastRunMs: lastRun?.durasiMs ?? null,
      lastRunError: lastRun?.error ?? null,
      stale: !lastRun || now.getTime() - Date.parse(lastRun.startedAt) > TICK_STALE_MS,
      counts: lastRun?.hitung ?? {},
    },
    // Batas yang lebih ketat menang: batas server atau batas paket workspace.
    limits: { maxPostsPerDay: Math.min(maxPostsPerDay(), plan.plan?.maxPostingPerHari ?? Infinity) },
  };
}

/* ------------------------------------------------------------------ simpan pengaturan */

export type SaveResult =
  | {
      ok: true;
      saved: number;
      skipped: { accountId: string; error: string }[];
      /**
       * Akun yang perlu riset ulang + ide baru: peran/tema, kategori topik, atau gaya sapaan benar-benar
       * berubah, atau autopilotnya baru dinyalakan. Simpan ulang tanpa perubahan tidak memicu agen.
       */
      research: string[];
    }
  | Failure;

/** Bagian pengaturan yang menentukan isi ide (bukan jadwal). */
const topicOf = (s: Pick<AutopilotSettings, "brief" | "pillars" | "voiceStyle">): string =>
  JSON.stringify([(s.brief ?? "").trim(), [...s.pillars].map((p) => p.key.trim().toLowerCase()).sort(), s.voiceStyle ?? null]);

/**
 * Terapkan perubahan pengaturan ke satu atau banyak akun. Field yang tidak dikirim tidak berubah.
 * Akun yang tidak bisa dinyalakan (belum siap atau belum dipetakan) dilewati dan dilaporkan.
 */
export async function saveSettings(
  ctx: RequestCtx,
  accountIds: string[],
  patch: unknown,
  now = new Date()
): Promise<SaveResult> {
  const today = wibDayKey(now);
  const [accounts, state] = await Promise.all([visibleAccounts(ctx), loadState(ctx.workspaceId, today, today)]);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  if (accountIds.some((id) => !byId.has(id))) return failure(404, "Akun Threads tidak ditemukan.");

  const items: ConfigWrite[] = [];
  const skipped: { accountId: string; error: string }[] = [];
  const research: string[] = [];
  for (const id of accountIds) {
    const account = byId.get(id)!;
    const current = state.configs.get(id);
    const base: AutopilotSettings = current
      ? {
          mode: current.mode,
          postsPerDay: current.postsPerDay,
          slotStrategy: current.slotStrategy,
          fixedHours: current.fixedHours,
          minGapMinutes: current.minGapMinutes,
          activeDays: current.activeDays,
          exploreRate: current.exploreRate,
          pillars: current.pillars,
          promoRatio: current.promoRatio,
          voiceStyle: current.voiceStyle,
          brief: current.brief,
          mediaMode: current.mediaMode,
          mediaMaxPersen: current.mediaMaxPersen,
        }
      : DEFAULT_SETTINGS;
    const parsed = parseSettingsPatch(patch, base);
    if (!parsed.ok) return failure(400, parsed.error);
    const next = parsed.value;
    if (next.postsPerDay > maxPostsPerDay()) {
      return failure(400, `Batas dashboard ${maxPostsPerDay()} posting per akun per hari.`);
    }
    if (next.mode !== "MATI" && (!account.ready || !account.tenantId)) {
      skipped.push({ accountId: id, error: `Akun belum siap diposting (${reasonText(account.reason) || "belum dipetakan"}).` });
      continue;
    }
    if (!account.tenantId) {
      // Belum dipetakan ke cabang dan tetap mati: tidak ada yang perlu disimpan.
      skipped.push({ accountId: id, error: "Akun belum dipetakan ke cabang." });
      continue;
    }
    items.push({ accountId: id, workspaceId: account.tenantId, ...next });
    if (topicOf(next) !== topicOf(base) || (base.mode === "MATI" && next.mode !== "MATI")) research.push(id);
  }
  if (items.length === 0) {
    return skipped.length === 1 ? failure(409, skipped[0].error) : failure(409, "Tidak ada akun yang bisa diubah.", skipped.map((s) => s.error));
  }
  // Batas paket per workspace: posting per hari, mode Otomatis, dan jumlah akun ber-autopilot.
  for (const tenant of new Set(items.map((i) => i.workspaceId))) {
    const mine = items.filter((i) => i.workspaceId === tenant);
    const changing = new Set(mine.map((i) => i.accountId));
    const activeAfter =
      [...state.configs.values()].filter((c) => c.workspaceId === tenant && c.mode !== "MATI" && !changing.has(c.accountId)).length +
      mine.filter((i) => i.mode !== "MATI").length;
    const refused = checkAutopilotAgainstPlan(await planLimits(tenant, now, true), mine, activeAfter);
    if (refused) return failure(403, refused);
  }

  const saved = await upsertConfigs(items, ctx.userId, now);
  // Pengaturan gambar berlaku segera di proses ini (bukan menunggu cache 60 detik).
  for (const i of items) clearMediaPolicyCache(i.accountId);
  return { ok: true, saved, skipped, research };
}

/** Jeda atau lanjutkan autopilot untuk seluruh workspace yang terlihat pengguna. */
export async function setAllActive(ctx: RequestCtx, active: boolean, now = new Date()): Promise<number> {
  const accounts = await visibleAccounts(ctx);
  const workspaces = [...new Set(accounts.map((a) => a.tenantId).filter((w): w is string => !!w))];
  await Promise.all(workspaces.map((w) => setWorkspaceActive(w, active, ctx.userId, now)));
  return workspaces.length;
}

/* ------------------------------------------------------------------ pratinjau jam */

/**
 * Jam tayang besok bila pengaturan ini dipakai (belum disimpan), beserta alasan tiap jam.
 * Murni perhitungan: tidak menulis apa pun.
 */
export async function previewPlan(
  ctx: RequestCtx,
  accountId: string,
  patch: unknown,
  now = new Date()
): Promise<PlanPreviewResponse | Failure> {
  const account = (await visibleAccounts(ctx)).find((a) => a.id === accountId);
  if (!account) return failure(404, "Akun Threads tidak ditemukan.");
  const parsed = parseSettingsPatch(patch ?? {}, DEFAULT_SETTINGS);
  if (!parsed.ok) return failure(400, parsed.error);

  const dayStart = startOfWibDay(now).getTime() + DAY_MS;
  const pad = parsed.value.minGapMinutes * 60_000;
  const [hours, schedule] = await Promise.all([
    hourRowsForAccounts([accountId], now),
    fetchSchedule([accountId], new Date(dayStart - pad), new Date(dayStart + DAY_MS + pad)),
  ]);
  const dayKey = wibDayKey(new Date(dayStart));
  const plan = planDay({
    accountId,
    dayKey,
    now,
    settings: parsed.value,
    ownRows: hours.own.get(accountId) ?? [],
    networkRows: hours.network,
    takenMs: schedule.map((r) => r.at.getTime()),
    usedIndexes: [],
  });
  return {
    success: true,
    dayKey,
    source: plan.source,
    slots: plan.slots.map((s) => ({
      slotAt: s.slotAt.toISOString(),
      hour: s.hour,
      minute: s.minute,
      kind: s.kind,
      reason: s.reason,
    })),
  };
}

/* ------------------------------------------------------------------ daftar slot */

const REVIEW: SlotStatus[] = ["MENUNGGU_TINJAU"];
const HISTORY: SlotStatus[] = ["TERANTRE", "TERBIT", "GAGAL", "DILEWATI", "DIBATALKAN"];

/** Draf menunggu tinjauan (urut jam tayang terdekat) atau riwayat slot (terbaru dulu). */
export async function listSlotPage(
  ctx: RequestCtx,
  opts: { view: "review" | "history"; accountId: string | null; cursor: string | null }
): Promise<SlotListResponse | Failure> {
  const accounts = await visibleAccounts(ctx);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  if (opts.accountId && !byId.has(opts.accountId)) return failure(404, "Akun Threads tidak ditemukan.");

  const rows = await listSlots({
    workspaceId: ctx.workspaceId,
    // Lingkup akun pengguna ditegakkan di database, bukan disaring setelah paginasi.
    accountIds: opts.accountId ? [opts.accountId] : ctx.accountIds,
    statuses: opts.view === "review" ? REVIEW : HISTORY,
    cursor: decodeCursor(opts.cursor),
    desc: opts.view === "history",
    limit: SLOT_PAGE_SIZE,
  });
  const page = rows.slice(0, SLOT_PAGE_SIZE);
  const last = page.at(-1);
  return {
    success: true,
    items: page
      .filter((s) => byId.has(s.accountId))
      .map(({ workspaceId, ...s }) => {
        void workspaceId;
        const a = byId.get(s.accountId)!;
        return { ...s, account: { username: a.username, displayName: a.displayName, avatarUrl: a.avatarUrl } };
      }),
    nextCursor: rows.length > SLOT_PAGE_SIZE && last ? encodeCursor(new Date(last.slotAt), last.id) : null,
  };
}
