import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-auth";
import { TOO_MANY } from "@/lib/autopilot-api";
import { withCtx } from "@/lib/request-ctx";
import { accountScope, db, must, toDate } from "@/lib/supabase";
import { throttle } from "@/lib/throttle";
import { decryptThreadsToken } from "@/lib/threads-token";

/**
 * Gambar postingan riwayat, diambil dari Threads API (bukan dari penyimpanan kita: berkas gambar tidak
 * disimpan). GET `?ids=<mediaId>,<mediaId>` (maks. 25) ->
 * `{ success: true, media: { [mediaId]: { type, images: [{ url, isVideo }] } } }`.
 *
 * - Hanya mediaId milik akun yang boleh dilihat pengguna (lingkup sama dengan /api/posts); id lain diabaikan.
 * - Postingan teks tidak memanggil Threads. Galat per id = id itu tidak ada di jawaban (bukan 500).
 * - Hasil di-cache di memori server 30 menit per mediaId: URL CDN Threads kedaluwarsa setelah beberapa
 *   waktu, jadi tidak disimpan lebih lama dan tidak pernah ditulis ke database.
 */

const API = "https://graph.threads.net/v1.0";
const FIELDS = "media_type,media_url,thumbnail_url,children{media_type,media_url,thumbnail_url}";
const MAX_IDS = 25;
const CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 30 * 60_000;
const CACHE_MAX = 2_000;
const MEDIA_ID = /^[A-Za-z0-9_-]{1,64}$/;

interface ThreadsMediaImage {
  url: string;
  isVideo: boolean;
}
interface ThreadsMediaInfo {
  type: string;
  images: ThreadsMediaImage[];
}

const cache = new Map<string, { at: number; value: ThreadsMediaInfo }>();
/** Permintaan ke Threads yang sedang berjalan per mediaId (dua tab yang memuat halaman sama = satu panggilan). */
const inflight = new Map<string, Promise<ThreadsMediaInfo | null>>();

function cached(id: string, now: number): ThreadsMediaInfo | null {
  const hit = cache.get(id);
  if (!hit) return null;
  if (now - hit.at >= CACHE_TTL_MS) {
    cache.delete(id);
    return null;
  }
  return hit.value;
}

function remember(id: string, value: ThreadsMediaInfo, now: number): void {
  cache.delete(id);
  // Penuh: buang entri tertua (Map menjaga urutan sisip).
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(id, { at: now, value });
}

/** Jenis media Threads yang bergambar (VIDEO memakai thumbnail-nya). */
const isVisual = (mediaType: string | null): boolean => /IMAGE|CAROUSEL|ALBUM|VIDEO|PHOTO/i.test(mediaType ?? "");

type GraphNode = { media_type?: string; media_url?: string; thumbnail_url?: string };
type GraphMedia = GraphNode & { children?: { data?: GraphNode[] } };

const isHttps = (u: unknown): u is string => typeof u === "string" && /^https:\/\//.test(u);

function toImage(n: GraphNode): ThreadsMediaImage | null {
  const isVideo = n.media_type === "VIDEO";
  const url = isVideo ? n.thumbnail_url : n.media_url ?? n.thumbnail_url;
  return isHttps(url) ? { url, isVideo } : null;
}

/** Bentuk jawaban Graph API -> info tampilan; null bila tidak ada gambar yang bisa ditampilkan. */
function parseMedia(body: GraphMedia): ThreadsMediaInfo | null {
  const children = body.children?.data ?? [];
  const nodes = children.length ? children : [body];
  const images = nodes.map(toImage).filter((i): i is ThreadsMediaImage => i !== null);
  return images.length ? { type: body.media_type ?? (children.length ? "CAROUSEL_ALBUM" : "IMAGE"), images } : null;
}

async function fetchMedia(id: string, token: string): Promise<ThreadsMediaInfo | null> {
  const url = `${API}/${encodeURIComponent(id)}?fields=${encodeURIComponent(FIELDS)}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
  const body = (await res.json().catch(() => null)) as (GraphMedia & { error?: unknown }) | null;
  if (!res.ok || !body || body.error) return null;
  return parseMedia(body);
}

function loadOne(id: string, token: string): Promise<ThreadsMediaInfo | null> {
  const running = inflight.get(id);
  if (running) return running;
  const p = fetchMedia(id, token)
    .then((info) => {
      if (info) remember(id, info, Date.now());
      return info;
    })
    .catch(() => null)
    .finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    })
  );
}

type StatRow = { mediaId: string; mediaType: string | null; threadsAccountId: string };
type TokenRow = { id: string; accessToken: string | null; accessExpiresAt: string | null; needsReconnect: boolean | null };

/** Token akun yang masih berlaku (hanya dibaca: rute tampilan tidak memperpanjang/menandai akun). */
function usableToken(a: TokenRow, now: number): string | null {
  if (!a.accessToken || a.needsReconnect) return null;
  if (a.accessExpiresAt && toDate(a.accessExpiresAt).getTime() <= now) return null;
  try {
    return decryptThreadsToken(a.accessToken);
  } catch {
    return null;
  }
}

export const GET = withCtx("VIEWER", async (request, ctx) => {
  // Dibaca di luar try/catch: sinyal "route dinamis" dari Next tidak boleh tertelan.
  const raw = request.nextUrl.searchParams.get("ids") ?? "";
  const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length > MAX_IDS) return jsonError(400, `Maksimal ${MAX_IDS} postingan per permintaan.`);
  if (ids.some((id) => !MEDIA_ID.test(id))) return jsonError(400, "Id media tidak valid.");
  const headers = { "Cache-Control": "private, max-age=600" };
  if (ids.length === 0) return NextResponse.json({ success: true, media: {} }, { headers });

  const limit = throttle(`posts-media:${ctx.userId}`, 60, 60_000);
  if (!limit.ok) return TOO_MANY(limit.retryAfter);

  try {
    const [rows, scope] = await Promise.all([
      must<StatRow[]>(db().from("ThreadsPostStat").select("mediaId, mediaType, threadsAccountId").in("mediaId", ids)),
      accountScope(),
    ]);
    // Lingkup akun dicek SEBELUM cache: entri cache milik akun lain tidak pernah keluar.
    const visible = new Set(scope.visibleIds);
    const wanted = new Set(ids);
    const allowed = rows.filter((r) => wanted.has(r.mediaId) && visible.has(r.threadsAccountId) && isVisual(r.mediaType));

    const now = Date.now();
    const media: Record<string, ThreadsMediaInfo> = {};
    const misses: StatRow[] = [];
    for (const r of allowed) {
      const hit = cached(r.mediaId, now);
      if (hit) media[r.mediaId] = hit;
      else misses.push(r);
    }

    if (misses.length) {
      const accountIds = [...new Set(misses.map((r) => r.threadsAccountId))];
      const accounts = await must<TokenRow[]>(
        db().from("ThreadsAccount").select("id, accessToken, accessExpiresAt, needsReconnect").in("id", accountIds)
      );
      const tokens = new Map<string, string>();
      for (const a of accounts) {
        if (!accountIds.includes(a.id)) continue;
        const t = usableToken(a, now);
        if (t) tokens.set(a.id, t);
      }
      await eachLimit(misses, CONCURRENCY, async (r) => {
        const token = tokens.get(r.threadsAccountId);
        if (!token) return;
        const info = await loadOne(r.mediaId, token);
        if (info) media[r.mediaId] = info;
      });
    }

    return NextResponse.json({ success: true, media }, { headers });
  } catch (error) {
    console.error("Error in /api/posts/media:", error instanceof Error ? error.message : error);
    return jsonError(500, "Terjadi kesalahan pada server. Coba lagi sebentar lagi.");
  }
});
