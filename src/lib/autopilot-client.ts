/**
 * Klien fetch bertipe untuk API autopilot. Aman dipakai di komponen "use client" (hanya mengimpor
 * tipe dan pembantu fetch). Galat dilempar sebagai `ContentApiError` dengan pesan Indonesia.
 */
import type {
  AutopilotOverviewResponse,
  AutopilotSettings,
  PlanPreviewResponse,
  SlotAction,
  SlotListResponse,
} from "./autopilot-types";
import { call } from "./content-client";

export const fetchAutopilotOverview = (signal?: AbortSignal) =>
  call<AutopilotOverviewResponse>("/api/autopilot/overview", { signal });

/** Ubah pengaturan satu akun; field yang tidak dikirim tidak berubah. */
export const saveAutopilotSettings = (accountId: string, settings: Partial<AutopilotSettings>) =>
  call<{ success: true }>(`/api/autopilot/accounts/${encodeURIComponent(accountId)}`, {
    method: "PUT",
    body: JSON.stringify(settings),
  });

export interface BulkResult {
  success: true;
  saved: number;
  /** Akun yang tidak bisa diubah (mis. belum siap diposting) beserta alasannya. */
  skipped: { accountId: string; error: string }[];
}

export const saveAutopilotBulk = (accountIds: string[], settings: Partial<AutopilotSettings>) =>
  call<BulkResult>("/api/autopilot/bulk", { method: "POST", body: JSON.stringify({ accountIds, settings }) });

/** Saklar "jeda semua" (false = jeda, true = lanjutkan). */
export const setAutopilotActive = (active: boolean) =>
  call<{ success: true; active: boolean }>("/api/autopilot/pause-all", {
    method: "POST",
    body: JSON.stringify({ active }),
  });

/** Jam tayang besok untuk pengaturan yang belum disimpan (tidak menulis apa pun). */
export const previewAutopilotPlan = (accountId: string, settings: Partial<AutopilotSettings>, signal?: AbortSignal) =>
  call<PlanPreviewResponse>("/api/autopilot/preview", {
    method: "POST",
    body: JSON.stringify({ accountId, settings }),
    signal,
  });

export function listAutopilotSlots(
  p: { view: "review" | "history"; accountId?: string | null; cursor?: string | null },
  signal?: AbortSignal
) {
  const q = new URLSearchParams({ view: p.view });
  if (p.accountId) q.set("accountId", p.accountId);
  if (p.cursor) q.set("cursor", p.cursor);
  return call<SlotListResponse>(`/api/autopilot/slots?${q}`, { signal });
}

/** Tindakan atas slot: setujui (teks boleh diedit), tolak, tulis ulang, atau lewati. */
export const actOnSlot = (slotId: string, action: SlotAction, edit?: { text?: string; topicTag?: string | null }) =>
  call<{ success: true }>(`/api/autopilot/slots/${encodeURIComponent(slotId)}`, {
    method: "POST",
    body: JSON.stringify({ action, ...(edit ?? {}) }),
  });
