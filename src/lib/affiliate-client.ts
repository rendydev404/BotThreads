/**
 * Klien fetch bertipe untuk API Shopee Affiliate. Aman dipakai di komponen "use client".
 * Galat dilempar sebagai `ContentApiError` dengan pesan Indonesia.
 */
import type { AffiliateOverviewResponse, AffiliateProductDTO, AffiliateSettings } from "./affiliate-types";
import { call } from "./content-client";

export const fetchAffiliate = (signal?: AbortSignal) => call<AffiliateOverviewResponse>("/api/affiliate", { signal });

/** Atur affiliate banyak akun sekaligus; field yang tidak dikirim tidak berubah. */
export const saveAffiliateAccounts = (accountIds: string[], settings: Partial<AffiliateSettings>) =>
  call<{ success: true; saved: number }>("/api/affiliate/accounts", {
    method: "POST",
    body: JSON.stringify({ accountIds, settings }),
  });

export interface ProductInput {
  id?: string;
  nama: string;
  link: string;
  niche: string[];
  catatan: string;
  aktif: boolean;
}

export const saveAffiliateProduct = (item: ProductInput) =>
  call<{ success: true; item: AffiliateProductDTO }>("/api/affiliate/products", { method: "POST", body: JSON.stringify(item) });

export const deleteAffiliateProduct = (id: string) =>
  call<{ success: true }>(`/api/affiliate/products/${encodeURIComponent(id)}`, { method: "DELETE" });

/** Saklar "jeda semua affiliate" (false = jeda, true = lanjutkan). */
export const setAffiliatePaused = (active: boolean) =>
  call<{ success: true; active: boolean }>("/api/affiliate/pause", { method: "POST", body: JSON.stringify({ active }) });

/** Kirim ulang balasan link yang gagal. */
export const retryAffiliateReply = (id: string) =>
  call<{ success: true }>(`/api/affiliate/replies/${encodeURIComponent(id)}/retry`, { method: "POST" });
