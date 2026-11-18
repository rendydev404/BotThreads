/**
 * Meta Pixel untuk iklan situs BotThreads (diatur super admin di /admin/pixel, sql/048_meta_pixel.sql).
 *
 * - Peramban: skrip Pixel dimuat oleh `components/analytics/meta-pixel.tsx` setelah halaman siap, memakai
 *   Pixel ID dari `GET /api/pixel` (publik, di-cache). PageView tiap pindah halaman, ViewContent di halaman
 *   harga/fitur, dan CompleteRegistration setelah daftar.
 * - Server (Conversions API, opsional): bila Access Token diisi, CompleteRegistration juga dikirim dari server
 *   dengan `event_id` yang sama sehingga Meta menghitungnya sekali (tidak hilang walau ada pemblokir iklan).
 *   Email di-hash SHA-256 sesuai aturan Meta; tidak ada data mentah yang dikirim.
 * Sumber nilai: database lalu variabel lingkungan META_PIXEL_ID / META_CAPI_TOKEN sebagai cadangan.
 */
import { createHash } from "node:crypto";
import { rpc, sqlTs } from "./supabase";
import type { Failure } from "./threads-publish";

const CACHE_TTL_MS = 60_000;
const GRAPH = "https://graph.facebook.com/v21.0";
const FETCH_TIMEOUT_MS = 5_000;

/** Cookie berumur pendek berisi event yang harus ditembakkan peramban di halaman berikutnya. */
export const PIXEL_EVENT_COOKIE = "bt_px_ev";
export const PIXEL_EVENTS = ["CompleteRegistration"] as const;
export type PixelServerEvent = (typeof PIXEL_EVENTS)[number];

type Source = "database" | "env" | "none";

export interface PixelConfig {
  /** Tabel/kolom tersedia (sql/048 terpasang). */
  stored: boolean;
  enabled: boolean;
  pixelId: string;
  accessToken: string;
  testEventCode: string;
  source: Source;
}

/** Untuk konsol admin: token tidak pernah dikirim utuh. */
export interface PixelAdminDTO {
  stored: boolean;
  enabled: boolean;
  pixelId: string;
  hasAccessToken: boolean;
  accessTokenMasked: string;
  testEventCode: string;
  source: Source;
  /** Pixel benar-benar terpasang di situs (menyala + ID terisi). */
  live: boolean;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const env = (name: string): string => (process.env[name] ?? "").trim();
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const isPixelId = (v: string): boolean => /^\d{10,20}$/.test(v);
export const isTestEventCode = (v: string): boolean => /^TEST[A-Z0-9]{2,20}$/i.test(v);

let cache: { at: number; value: PixelConfig } | null = null;

export function forgetPixelConfig(): void {
  cache = null;
}

export async function getPixelConfig(): Promise<PixelConfig> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  let row: Record<string, unknown> | null = null;
  let stored = false;
  try {
    const r = await rpc<unknown>("dash_pixel_config");
    row = isRecord(r) ? r : {};
    stored = true;
  } catch {
    // sql/048 belum dipasang: hanya variabel lingkungan.
  }
  const dbId = str(row?.pixelId);
  const pixelId = dbId || env("META_PIXEL_ID");
  const value: PixelConfig = {
    stored,
    enabled: typeof row?.enabled === "boolean" ? row.enabled : !!pixelId,
    pixelId,
    accessToken: str(row?.accessToken) || env("META_CAPI_TOKEN"),
    testEventCode: str(row?.testEventCode),
    source: dbId ? "database" : pixelId ? "env" : "none",
  };
  cache = { at: Date.now(), value };
  return value;
}

/** Pixel ID untuk peramban, atau null bila Pixel mati/belum diisi. */
export async function publicPixelId(): Promise<string | null> {
  const c = await getPixelConfig();
  return c.enabled && isPixelId(c.pixelId) ? c.pixelId : null;
}

function maskSecret(secret: string): string {
  if (!secret) return "";
  if (secret.length <= 10) return "••••••••";
  return `${secret.slice(0, 4)}••••••••${secret.slice(-4)}`;
}

export function toAdminDTO(c: PixelConfig): PixelAdminDTO {
  return {
    stored: c.stored,
    enabled: c.enabled,
    pixelId: c.pixelId,
    hasAccessToken: !!c.accessToken,
    accessTokenMasked: maskSecret(c.accessToken),
    testEventCode: c.testEventCode,
    source: c.source,
    live: c.enabled && isPixelId(c.pixelId),
  };
}

/**
 * Validasi + bentuk patch dari formulir admin. Token kosong = tidak diubah (formulir tidak pernah menampilkan
 * nilai lamanya); hapus lewat `clearAccessToken: true`. Teks kosong pada kolom lain = hapus.
 */
export function pixelPatch(body: unknown): { ok: true; patch: Record<string, unknown> } | Failure {
  if (!isRecord(body)) return { ok: false, status: 400, error: "Data Meta Pixel tidak valid." };
  const patch: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.pixelId === "string") {
    const id = body.pixelId.replace(/\s+/g, "");
    if (id && !isPixelId(id)) return { ok: false, status: 400, error: "Pixel ID harus berupa 10-20 angka (lihat Events Manager > Data sources)." };
    patch.pixelId = id;
  }
  if (body.clearAccessToken === true) patch.accessToken = "";
  else if (typeof body.accessToken === "string" && body.accessToken.trim()) {
    const token = body.accessToken.trim();
    if (!/^[A-Za-z0-9_-]{30,400}$/.test(token)) return { ok: false, status: 400, error: "Access Token Conversions API tidak valid." };
    patch.accessToken = token;
  }
  if (typeof body.testEventCode === "string") {
    const code = body.testEventCode.trim().toUpperCase();
    if (code && !isTestEventCode(code)) return { ok: false, status: 400, error: "Test Event Code diawali TEST, contoh TEST12345." };
    patch.testEventCode = code;
  }
  return { ok: true, patch };
}

export async function savePixelConfig(adminId: string, body: unknown, now = new Date()): Promise<{ ok: true; pixel: PixelAdminDTO } | Failure> {
  const parsed = pixelPatch(body);
  if (!parsed.ok) return parsed;
  const current = await getPixelConfig();
  if (!current.stored) {
    return { ok: false, status: 503, error: "Kolom Meta Pixel belum dipasang. Jalankan sql/048_meta_pixel.sql, atau isi META_PIXEL_ID di variabel lingkungan." };
  }
  const patch = parsed.patch;
  const nextId = typeof patch.pixelId === "string" ? patch.pixelId : current.pixelId;
  if (patch.enabled === true && !isPixelId(nextId)) return { ok: false, status: 400, error: "Isi Pixel ID dulu sebelum menyalakan Meta Pixel." };
  const saved = await rpc<unknown>("dash_pixel_config_set", { p_actor: adminId, p_patch: patch, p_now: sqlTs(now) });
  if (!saved) return { ok: false, status: 403, error: "Hanya super admin yang boleh mengubah Meta Pixel." };
  forgetPixelConfig();
  return { ok: true, pixel: toAdminDTO(await getPixelConfig()) };
}

/* ------------------------------------------------------------------ Conversions API */

const sha256 = (v: string): string => createHash("sha256").update(v.trim().toLowerCase()).digest("hex");

export interface ServerEventInput {
  eventName: PixelServerEvent | "PageView";
  eventId: string;
  sourceUrl: string;
  email?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** Nilai cookie _fbp / _fbc dari peramban (membantu Meta mencocokkan pengunjung iklan). */
  fbp?: string | null;
  fbc?: string | null;
  customData?: Record<string, unknown>;
  now?: Date;
}

/** Badan permintaan Conversions API untuk satu event (diekspor untuk uji). */
export function capiPayload(input: ServerEventInput, testEventCode: string): Record<string, unknown> {
  const userData: Record<string, unknown> = {};
  if (input.email && input.email.includes("@")) userData.em = [sha256(input.email)];
  if (input.ip) userData.client_ip_address = input.ip;
  if (input.userAgent) userData.client_user_agent = input.userAgent;
  if (input.fbp) userData.fbp = input.fbp;
  if (input.fbc) userData.fbc = input.fbc;
  return {
    data: [
      {
        event_name: input.eventName,
        event_time: Math.floor((input.now ?? new Date()).getTime() / 1000),
        event_id: input.eventId,
        action_source: "website",
        event_source_url: input.sourceUrl,
        user_data: userData,
        ...(input.customData ? { custom_data: input.customData } : {}),
      },
    ],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };
}

/**
 * Kirim event dari server. Tidak pernah melempar: Pixel mati, token kosong, atau Meta menolak hanya dicatat,
 * supaya pendaftaran/pembayaran tidak ikut gagal. Mengembalikan hasil untuk tombol "Kirim event uji".
 */
export async function sendServerEvent(input: ServerEventInput): Promise<{ ok: boolean; error?: string; received?: number }> {
  try {
    const c = await getPixelConfig();
    if (!c.enabled || !isPixelId(c.pixelId)) return { ok: false, error: "Meta Pixel belum menyala." };
    if (!c.accessToken) return { ok: false, error: "Access Token Conversions API belum diisi." };
    const res = await fetch(`${GRAPH}/${c.pixelId}/events?access_token=${encodeURIComponent(c.accessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(capiPayload(input, c.testEventCode)),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as { events_received?: number; error?: { message?: string } };
    if (!res.ok || body.error) {
      const error = body.error?.message || `Meta menolak event (${res.status}).`;
      console.warn("[meta-pixel] CAPI:", error);
      return { ok: false, error };
    }
    return { ok: true, received: body.events_received ?? 0 };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Gagal menghubungi Meta.";
    console.warn("[meta-pixel] CAPI:", error);
    return { ok: false, error };
  }
}

/** Nilai cookie event untuk peramban: "<Event>:<eventId>". */
export const pixelEventCookie = (event: PixelServerEvent, eventId: string): string => `${event}:${eventId}`;
