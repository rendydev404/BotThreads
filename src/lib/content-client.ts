/**
 * Klien fetch bertipe untuk API konten/posting Threads. Aman dipakai di komponen "use client"
 * (hanya mengimpor tipe). Semua galat dilempar sebagai `ContentApiError` dengan pesan Indonesia.
 */
import type {
  AccountsResponse,
  CreatePostsResponse,
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

async function call<T>(url: string, init?: RequestInit): Promise<T> {
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

export const createPosts = (idempotencyKey: string, items: CreateItemRequest[]) =>
  call<CreatePostsResponse>("/api/content/posts", {
    method: "POST",
    body: JSON.stringify({ idempotencyKey, items }),
  });

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

export const patchPost = (id: string, body: { text?: string; topicTag?: string | null; publishAt?: string }) =>
  call<{ success: true; post: PostItemDTO | null }>(`/api/content/posts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const cancelPost = (id: string) =>
  call<{ success: true }>(`/api/content/posts/${encodeURIComponent(id)}`, { method: "DELETE" });

export const retryPost = (id: string) =>
  call<{ success: true; post: PostItemDTO | null }>(`/api/content/posts/${encodeURIComponent(id)}/retry`, {
    method: "POST",
  });

/** Kunci idempotensi acak per niat kirim (dibuat di klien, dipakai ulang saat coba lagi). */
export const newIdempotencyKey = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
