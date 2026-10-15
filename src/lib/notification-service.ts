/**
 * Layanan notifikasi, ringkasan performa, dan kesehatan autopilot untuk route API. Semua dibatasi
 * lingkup pengguna (workspace dan akun).
 */
import { TICK_STALE_MS } from "./autopilot-config";
import { loadPerformance } from "./autopilot-learning";
import { visibleAccounts } from "./autopilot-service";
import { MissingAutopilotSchemaError, isMissingAutopilotSchema, missingSchemaFile, listRuns } from "./autopilot-store";
import { SLOT_KIND_LABEL, type SlotKind } from "./autopilot-types";
import { isPublishEnabled } from "./content-config";
import type {
  HealthResponse,
  NotificationDTO,
  NotificationListResponse,
  PerformanceResponse,
} from "./notification-types";
import { hookLabel } from "./radar-types";
import type { RequestCtx } from "./request-ctx";
import { rpc, utc } from "@/lib/supabase";
import { decodeCursor, encodeCursor } from "./threads-publish";

export const NOTIFICATION_PAGE_SIZE = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await rpc<T>(fn, args);
  } catch (err) {
    if (isMissingAutopilotSchema(err)) throw new MissingAutopilotSchemaError(missingSchemaFile(err));
    throw err;
  }
}

export async function listNotifications(ctx: RequestCtx, cursorRaw: string | null): Promise<NotificationListResponse> {
  const cursor = decodeCursor(cursorRaw);
  try {
    const raw = await call<{ items: (Omit<NotificationDTO, "createdAt"> & { createdAt: string })[]; unread: number }>(
      "dash_notif_list",
      {
        p_workspace: ctx.workspaceId,
        p_account_ids: ctx.accountIds,
        p_user: ctx.userId,
        p_cursor_at: cursor?.at ?? null,
        p_cursor_id: cursor?.id ?? null,
        p_limit: NOTIFICATION_PAGE_SIZE,
      }
    );
    const page = raw.items.slice(0, NOTIFICATION_PAGE_SIZE).map((n) => ({ ...n, createdAt: utc(n.createdAt).toISOString() }));
    const last = page.at(-1);
    return {
      success: true,
      installed: true,
      items: page,
      nextCursor: raw.items.length > NOTIFICATION_PAGE_SIZE && last ? encodeCursor(new Date(last.createdAt), last.id) : null,
      unread: raw.unread,
    };
  } catch (err) {
    if (err instanceof MissingAutopilotSchemaError) return { success: true, installed: false, items: [], nextCursor: null, unread: 0 };
    throw err;
  }
}

/** Tandai dibaca: id tertentu, atau semuanya bila `ids` null. Mengembalikan jumlah yang berubah. */
export async function markNotificationsRead(ctx: RequestCtx, ids: string[] | null): Promise<number> {
  try {
    return await call<number>("dash_notif_read", {
      p_ids: ids,
      p_workspace: ctx.workspaceId,
      p_account_ids: ctx.accountIds,
      p_user: ctx.userId,
    });
  } catch (err) {
    if (err instanceof MissingAutopilotSchemaError) return 0;
    throw err;
  }
}

const dimLabel = (dim: string, val: string): string => {
  if (dim === "formulaHook") return hookLabel(val) ?? val;
  if (dim === "jam") return `${val.padStart(2, "0")}.00 WIB`;
  if (dim === "jenisSlot") return SLOT_KIND_LABEL[val as SlotKind] ?? val;
  return val;
};

export async function getPerformance(ctx: RequestCtx, accountId: string | null, now = new Date()): Promise<PerformanceResponse | null> {
  const accounts = await visibleAccounts(ctx);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  if (accountId && !byId.has(accountId)) return null;
  const empty: PerformanceResponse = {
    success: true,
    installed: false,
    dims: [],
    autopilot: { n: 0, avgViews: 0, medianViews: 0 },
    lainnya: { n: 0, avgViews: 0, medianViews: 0 },
    viral: [],
  };
  try {
    const raw = await loadPerformance(ctx.workspaceId, accountId ? [accountId] : ctx.accountIds, now);
    return {
      success: true,
      installed: true,
      dims: raw.dims.map((d) => ({
        dim: d.dim,
        val: d.val,
        label: dimLabel(d.dim, d.val),
        n: d.n,
        // Skor log -> kelipatan views terhadap kebiasaan akun.
        multiplier: Math.round(Math.exp(d.avg) * 100) / 100,
        avgViews: d.avgViews,
      })),
      autopilot: raw.autopilot,
      lainnya: raw.lainnya,
      viral: raw.viral
        .filter((v) => byId.has(v.accountId))
        .map((v) => ({
          postId: v.postId,
          accountId: v.accountId,
          username: byId.get(v.accountId)?.username ?? null,
          views: v.views,
          baseline: v.baseline,
          postedAt: v.postedAt,
        })),
    };
  } catch (err) {
    if (err instanceof MissingAutopilotSchemaError) return empty;
    throw err;
  }
}

export async function getHealth(now = new Date()): Promise<HealthResponse> {
  const env = { serverNow: now.toISOString(), staleAfterMs: TICK_STALE_MS, publishEnabled: isPublishEnabled() };
  try {
    const runs = await listRuns(60);
    const recent = runs.filter((r) => now.getTime() - Date.parse(r.startedAt) <= DAY_MS);
    const sum = (key: string) => recent.reduce((s, r) => s + (r.hitung[key] ?? 0), 0);
    return {
      success: true,
      installed: true,
      ...env,
      runs: runs.slice(0, 30).map((r) => ({ id: r.id, startedAt: r.startedAt, durasiMs: r.durasiMs, hitung: r.hitung, error: r.error })),
      last24h: {
        ticks: recent.length,
        errors: recent.filter((r) => r.error).length,
        putaranAi: sum("putaranAi"),
        diantre: sum("diantre"),
        dilewati: sum("dilewati") + sum("kedaluwarsa"),
        avgMs: recent.length ? Math.round(recent.reduce((s, r) => s + r.durasiMs, 0) / recent.length) : 0,
      },
    };
  } catch (err) {
    if (err instanceof MissingAutopilotSchemaError) {
      return { success: true, installed: false, ...env, runs: [], last24h: { ticks: 0, errors: 0, putaranAi: 0, diantre: 0, dilewati: 0, avgMs: 0 } };
    }
    throw err;
  }
}
