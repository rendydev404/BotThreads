/**
 * Klien fetch bertipe untuk API konten/posting Threads. Aman dipakai di komponen "use client"
 * (hanya mengimpor tipe). Semua galat dilempar sebagai `ContentApiError` dengan pesan Indonesia.
 */
import type {
  AccountsResponse,
  CreatePostsResponse,
  OrchestrateEvent,
  PostItemDTO,
  PostsResponse,
  PostStatusKey,
  RecommendResponse,
} from "./content-types";

export class ContentApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: string[]
  ) {
    super(message);
    this.name = "ContentApiError";
  }
}

export async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ContentApiError("Koneksi bermasalah. Periksa jaringan lalu coba lagi.", 0);
  }
  let data: { success?: boolean; error?: string; details?: string[] } | null = null;
  try {
    data = await res.json();
  } catch {
    /* body kosong / bukan JSON */
  }
  if (!res.ok || !data || data.success === false) {
    throw new ContentApiError(
      data?.error ?? (res.status === 401 ? "Sesi berakhir. Silakan masuk kembali." : "Terjadi kesalahan. Coba lagi."),
      res.status,
      data?.details
    );
  }
  return data as T;
}

export const fetchPublishAccounts = () => call<AccountsResponse>("/api/threads/accounts");

export interface RecommendRequest {
  accountIds: string[];
  brief?: string;
  count?: number;
  date?: string | null;
  avoid?: string | null;
}

export const recommend = (body: RecommendRequest) =>
  call<RecommendResponse>("/api/content/recommend", { method: "POST", body: JSON.stringify(body) });

export interface CreateItemRequest {
  threadsAccountId: string;
  text: string;
  topicTag: string | null;
  /** "now" atau ISO 8601 */
  publishAt: string;
  aiModel?: string | null;
  aiEdited?: boolean;
}

/** `partial`: item bermasalah dilewati dan dilaporkan di `skipped`, sisanya tetap dijadwalkan. */
export const createPosts = (
  idempotencyKey: string,
  items: CreateItemRequest[],
  opts: { partial?: boolean; autoReschedule?: boolean } = {}
) =>
  call<CreatePostsResponse>("/api/content/posts", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey,
      items,
      ...(opts.partial ? { partial: true } : {}),
      ...(opts.autoReschedule ? { autoReschedule: true } : {}),
    }),
  });

export interface OrchestrateRequest {
  /** null = semua akun. */
  accountIds: string[] | null;
  topic?: string;
  /** "HH:MM" WIB untuk semua akun; null = jam terbaik tiap akun. */
  time?: string | null;
  /** Teks draf yang sedang diganti (buat ulang satu akun). */
  avoid?: string | null;
  /** Posting otomatis dari prompt; null/kosong = draf saja. */
  publish?: { mode: "now" | "schedule"; dayOffset: number | null; hourWib: number | null } | null;
}

/**
 * Jalankan Multi-Agent Orchestrator dan teruskan tiap peristiwa SSE ke `onEvent`. Selesai saat aliran
 * ditutup; melempar `ContentApiError` bila permintaan ditolak atau koneksi putus di tengah jalan.
 */
export async function orchestrate(
  body: OrchestrateRequest,
  onEvent: (event: OrchestrateEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/content/orchestrate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ContentApiError("Koneksi bermasalah. Periksa jaringan lalu coba lagi.", 0);
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ContentApiError(
      data?.error ?? (res.status === 401 ? "Sesi berakhir. Silakan masuk kembali." : "Orkestrasi gagal dimulai. Coba lagi."),
      res.status
    );
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue; // komentar ": ping" dilewati
        try {
          onEvent(JSON.parse(line.slice(5)) as OrchestrateEvent);
        } catch {
          /* baris rusak dilewati */
        }
      }
    }
  }
}

export interface ListParams {
  scope: "upcoming" | "history";
  account?: string | null;
  status?: PostStatusKey | null;
  cursor?: string | null;
  all?: boolean;
}

export function listPosts(p: ListParams, signal?: AbortSignal) {
  const q = new URLSearchParams({ scope: p.scope });
  if (p.account && p.account !== "all") q.set("account", p.account);
  if (p.status) q.set("status", p.status);
  if (p.cursor) q.set("cursor", p.cursor);
  if (p.all) q.set("all", "1");
  return call<PostsResponse>(`/api/content/posts?${q}`, { signal });
}

export const fetchPostsByIds = (ids: string[], all = false) =>
  call<PostsResponse>(`/api/content/posts?ids=${encodeURIComponent(ids.join(","))}${all ? "&all=1" : ""}`);

/** `aiBase`: versi AI yang dipilih sebelum diubah lagi pengguna (bahan AI belajar gaya akun). */
export const patchPost = (id: string, body: { text?: string; topicTag?: string | null; publishAt?: string; aiBase?: string }) =>
  call<{ success: true; post: PostItemDTO | null }>(`/api/content/posts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const cancelPost = (id: string) =>
  call<{ success: true }>(`/api/content/posts/${encodeURIComponent(id)}`, { method: "DELETE" });

export const cancelPosts = (ids: string[]) =>
  call<{ success: true }>(`/api/content/posts`, { method: "DELETE", body: JSON.stringify({ ids }) });

export const publishPostNow = (id: string) =>
  call<{ success: true; post: PostItemDTO | null }>(`/api/content/posts/${encodeURIComponent(id)}/publish-now`, {
    method: "POST",
  });

export const retryPost = (id: string) =>
  call<{ success: true; post: PostItemDTO | null }>(`/api/content/posts/${encodeURIComponent(id)}/retry`, {
    method: "POST",
  });

/** Kunci idempotensi acak per niat kirim (dibuat di klien, dipakai ulang saat coba lagi). */
export const newIdempotencyKey = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
