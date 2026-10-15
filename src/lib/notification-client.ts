/**
 * Klien fetch bertipe untuk notifikasi, ringkasan performa, dan kesehatan autopilot. Aman dipakai di
 * komponen "use client".
 */
import { call } from "./content-client";
import type { HealthResponse, NotificationListResponse, PerformanceResponse } from "./notification-types";

export const fetchNotifications = (cursor?: string | null, signal?: AbortSignal) =>
  call<NotificationListResponse>(`/api/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { signal });

/** Tandai dibaca: id tertentu, atau semua bila `ids` tidak diisi. */
export const markNotificationsRead = (ids?: string[]) =>
  call<{ success: true; updated: number }>("/api/notifications", {
    method: "POST",
    body: JSON.stringify(ids?.length ? { ids } : { all: true }),
  });

export const fetchPerformance = (accountId?: string | null, signal?: AbortSignal) =>
  call<PerformanceResponse>(`/api/autopilot/performance${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`, { signal });

export const fetchAutopilotHealth = (signal?: AbortSignal) => call<HealthResponse>("/api/autopilot/health", { signal });
