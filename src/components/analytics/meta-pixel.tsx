"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Meta Pixel untuk iklan situs (lihat src/lib/meta-pixel.ts). Pixel ID diambil dari /api/pixel (di-cache);
 * bila Pixel mati, tidak ada skrip pihak ketiga yang dimuat sama sekali.
 *
 * - Skrip fbevents.js dimuat saat peramban senggang setelah halaman tampil, jadi tidak memperlambat LCP.
 * - PageView di setiap pindah halaman; ViewContent di halaman Harga dan Fitur.
 * - Event dari server (mis. CompleteRegistration setelah daftar) dititipkan lewat cookie `bt_px_ev` berisi
 *   "<Event>:<eventId>" lalu ditembakkan di sini dengan eventID yang sama dengan Conversions API (dihitung sekali).
 * - Konsol admin tidak dilacak.
 */

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue: unknown[]; loaded?: boolean; version?: string; push?: unknown };

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

const STORE_KEY = "bt:pixel";
const STORE_TTL_MS = 10 * 60_000;
const EVENT_COOKIE = "bt_px_ev";
const VIEW_CONTENT: Record<string, string> = { "/harga": "Harga", "/fitur": "Fitur" };
const SERVER_EVENTS = new Set(["CompleteRegistration"]);

let idPromise: Promise<string | null> | null = null;

function readCached(): string | null | undefined {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return undefined;
    const v = JSON.parse(raw) as { id: string | null; at: number };
    return Date.now() - v.at < STORE_TTL_MS ? v.id : undefined;
  } catch {
    return undefined;
  }
}

function pixelId(): Promise<string | null> {
  const cached = readCached();
  if (cached !== undefined) return Promise.resolve(cached);
  idPromise ??= fetch("/api/pixel")
    .then((r) => (r.ok ? (r.json() as Promise<{ pixelId: string | null }>) : { pixelId: null }))
    .then(({ pixelId: id }) => {
      try {
        sessionStorage.setItem(STORE_KEY, JSON.stringify({ id, at: Date.now() }));
      } catch {
        /* mode privat */
      }
      return id;
    })
    .catch(() => null);
  return idPromise;
}

/** Stub resmi fbq (antrean) lalu muat fbevents.js; dipanggil sekali. */
function install(id: string): void {
  if (window.fbq) return;
  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue.push(args);
  } as Fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  window.fbq = fbq;
  window._fbq = fbq;
  const load = () => {
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(s);
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(load, { timeout: 3000 });
  else setTimeout(load, 1500);
  fbq("init", id);
}

/** Event titipan server dari cookie, lalu cookie dihapus supaya tidak terkirim dua kali. */
function takeServerEvent(): { name: string; eventId: string } | null {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${EVENT_COOKIE}=([^;]+)`));
  if (!m) return null;
  document.cookie = `${EVENT_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`;
  const [name, eventId] = decodeURIComponent(m[1]).split(":");
  return name && eventId && SERVER_EVENTS.has(name) ? { name, eventId } : null;
}

/** Lacak event standar dari kode lain (aman dipanggil walau Pixel mati). */
export function trackPixel(event: string, params?: Record<string, unknown>, eventId?: string): void {
  window.fbq?.("track", event, params ?? {}, eventId ? { eventID: eventId } : undefined);
}

export function MetaPixel() {
  const pathname = usePathname();
  const ready = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || pathname === "/admin" || pathname.startsWith("/admin/")) return;
    let cancelled = false;
    void pixelId().then((id) => {
      if (cancelled || !id) return;
      if (ready.current !== id) {
        install(id);
        ready.current = id;
      }
      trackPixel("PageView");
      const content = VIEW_CONTENT[pathname];
      if (content) trackPixel("ViewContent", { content_name: content, content_category: "BotThreads" });
      const ev = takeServerEvent();
      if (ev) trackPixel(ev.name, { content_name: "BotThreads" }, ev.eventId);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return null;
}
