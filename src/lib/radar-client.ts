/**
 * Klien fetch bertipe untuk API radar tren, bank ide, momen, dan knowledge base. Aman dipakai di
 * komponen "use client". Galat dilempar sebagai `ContentApiError` dengan pesan Indonesia.
 */
import { call } from "./content-client";
import type { PostMedia } from "./post-media";
import type {
  IdeaAction,
  IdeaListResponse,
  KnowledgeDTO,
  KnowledgeKind,
  KnowledgeListResponse,
  MomentDTO,
  MomentListResponse,
  SignalListResponse,
  SignalSource,
} from "./radar-types";

export function listRadarSignals(p: { source?: SignalSource | null; cursor?: string | null } = {}, signal?: AbortSignal) {
  const q = new URLSearchParams();
  if (p.source) q.set("source", p.source);
  if (p.cursor) q.set("cursor", p.cursor);
  return call<SignalListResponse>(`/api/radar/signals?${q}`, { signal });
}

/** Tambah inspirasi manual (teks posting/gagasan, tautan opsional). */
export const addRadarSignal = (text: string, url?: string | null) =>
  call<{ success: true }>("/api/radar/signals", { method: "POST", body: JSON.stringify({ text, url: url || null }) });

export const deleteRadarSignal = (id: string) =>
  call<{ success: true }>(`/api/radar/signals/${encodeURIComponent(id)}`, { method: "DELETE" });

export const listMoments = (signal?: AbortSignal) => call<MomentListResponse>("/api/radar/moments", { signal });

export const saveMoment = (m: { id?: string; nama: string; mulai: string; selesai: string; catatan?: string | null }) =>
  call<{ success: true; id: string; moment: MomentDTO }>("/api/radar/moments", { method: "POST", body: JSON.stringify(m) });

export const deleteMoment = (id: string) =>
  call<{ success: true }>(`/api/radar/moments/${encodeURIComponent(id)}`, { method: "DELETE" });

/** Baris bank ide beserta gambar preview/posting (sql/038). */
export type IdeaListItem = IdeaListResponse["items"][number] & { previewMedia?: PostMedia | null };
export type IdeaListWithMedia = Omit<IdeaListResponse, "items"> & { items: IdeaListItem[] };

export function listIdeas(
  p: { view?: "ready" | "used" | "dropped"; accountId?: string | null; cursor?: string | null } = {},
  signal?: AbortSignal
) {
  const q = new URLSearchParams({ view: p.view ?? "ready" });
  if (p.accountId) q.set("accountId", p.accountId);
  if (p.cursor) q.set("cursor", p.cursor);
  return call<IdeaListWithMedia>(`/api/ideas?${q}`, { signal });
}

/** pin = pakai di slot berikutnya, unpin = lepas, reject = jangan dipakai. */
export const actOnIdea = (id: string, action: IdeaAction) =>
  call<{ success: true }>(`/api/ideas/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ action }) });

export const listKnowledge = (signal?: AbortSignal) => call<KnowledgeListResponse>("/api/knowledge", { signal });

export const saveKnowledge = (k: {
  id?: string;
  /** null = berlaku untuk semua akun. */
  accountId: string | null;
  jenis: KnowledgeKind;
  judul: string;
  isi: string;
  /** "YYYY-MM-DD"; wajib untuk PROMO. */
  berlakuSampai: string | null;
}) => call<{ success: true; id: string; item: KnowledgeDTO }>("/api/knowledge", { method: "POST", body: JSON.stringify(k) });

export const deleteKnowledge = (id: string) =>
  call<{ success: true }>(`/api/knowledge/${encodeURIComponent(id)}`, { method: "DELETE" });

/** Preview postingan dari ide: tersimpan dikembalikan langsung, `regenerate` meminta AI menulis ulang. */
export const fetchIdeaPreview = (id: string, regenerate = false, signal?: AbortSignal) =>
  call<{
    success: true;
    preview: { text: string; topicTag: string | null; model: string; at: string; media?: PostMedia | null };
  }>(`/api/ideas/${encodeURIComponent(id)}/preview`, { method: "POST", body: JSON.stringify({ regenerate }), signal });

/** "ganti" = cari gambar lain (atau tambah bila belum ada), "hapus" = posting dari ide ini tanpa gambar. */
export type IdeaMediaAction = "ganti" | "hapus";

export const changeIdeaMedia = (id: string, action: IdeaMediaAction, signal?: AbortSignal) =>
  call<{ success: true; media: PostMedia | null }>(`/api/ideas/${encodeURIComponent(id)}/media`, {
    method: "POST",
    body: JSON.stringify({ action }),
    signal,
  });
