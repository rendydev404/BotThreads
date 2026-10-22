/**
 * Klien fetch untuk "Contoh gaya" (korpus gaya Threads, /api/style-examples). Aman dipakai di komponen
 * "use client" (hanya mengimpor tipe dan fungsi `call`).
 */
import { call } from "./content-client";
import type { StyleExampleDTO } from "./style-corpus";
import type { LayoutProfile, PostFormat } from "./style-types";

export type { StyleExampleDTO } from "./style-corpus";

/** Batas panjang contoh gaya (karakter), dipakai UI dan route. */
export const STYLE_TEXT_MIN = 20;
export const STYLE_TEXT_MAX = 1000;
export const STYLE_NOTE_MAX = 200;

export interface StyleExamplesResponse {
  success: true;
  /** False bila SQL korpus gaya belum dipasang. */
  ready: boolean;
  examples: StyleExampleDTO[];
  /** Ringkasan "Gaya yang terbukti" (hanya bila diminta dengan akun); null bila postingan belum cukup. */
  profile: LayoutProfile | null;
}

export const fetchStyleExamples = (accountId: string | null, opts: { profile?: boolean; signal?: AbortSignal } = {}) => {
  const q = new URLSearchParams();
  if (accountId) q.set("accountId", accountId);
  if (opts.profile && accountId) q.set("profile", "1");
  const qs = q.toString();
  return call<StyleExamplesResponse>(`/api/style-examples${qs ? `?${qs}` : ""}`, { cache: "no-store", signal: opts.signal });
};

export const addStyleExample = (body: { accountId: string | null; text: string; format: PostFormat | "AUTO"; note?: string | null }) =>
  call<{ success: true; example: StyleExampleDTO }>("/api/style-examples", { method: "POST", body: JSON.stringify(body) });

export const removeStyleExample = (id: string) =>
  call<{ success: true }>(`/api/style-examples?id=${encodeURIComponent(id)}`, { method: "DELETE" });
