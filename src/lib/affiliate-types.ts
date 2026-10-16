/**
 * Tipe dan aturan bersama server dan klien untuk Shopee Affiliate di autopilot
 * (docs/specs/2026-10-16-shopee-affiliate-design.md). Tanpa import server.
 */
import type { AutopilotMode } from "./autopilot-types";

/** Batas pengaturan (dicerminkan di CHECK tabel AffiliateConfig). */
export const AFF_PER_DAY_MAX = 6;
export const AFF_GAP_HOURS_MAX = 12;
export const AFF_REPEAT_DAYS_MAX = 60;
/** Di atas porsi ini UI memberi peringatan "berisiko terlihat spam" (tidak dilarang). */
export const AFF_RATIO_WARN = 0.3;
export const AFF_NICHE_MAX = 10;
export const AFF_NICHE_CHARS = 30;
export const AFF_NAME_MAX = 80;
export const AFF_NOTE_MAX = 600;
export const AFF_LINK_MAX = 300;
export const AFF_TEMPLATE_MAX = 300;
/** Penanda tempat link di teks balasan. */
export const LINK_TOKEN = "{link}";
export const DEFAULT_REPLY_TEMPLATE = `Yang nanya, ini link-nya: ${LINK_TOKEN}\n(link affiliate)`;

export interface AffiliateSettings {
  aktif: boolean;
  /** Maksimal postingan affiliate per akun per hari. */
  perHari: number;
  /** Porsi maksimal dari total postingan harian akun (0-1). */
  porsi: number;
  /** Jarak minimal antar postingan affiliate di akun yang sama (jam). */
  jarakJam: number;
  /** Produk yang sama tidak dipakai lagi di akun yang sama dalam sekian hari. */
  jedaHari: number;
  /** Tag niche akun: menentukan produk katalog mana yang cocok. */
  niche: string[];
  /** Teks balasan pertama; `{link}` diganti link produk. */
  templateBalasan: string;
}

export const DEFAULT_AFFILIATE: AffiliateSettings = {
  aktif: false,
  perHari: 1,
  porsi: AFF_RATIO_WARN,
  jarakJam: 4,
  jedaHari: 14,
  niche: [],
  templateBalasan: DEFAULT_REPLY_TEMPLATE,
};

/**
 * Jumlah postingan affiliate per hari yang benar-benar berlaku: yang paling ketat antara "maks per hari"
 * dan "porsi" dari jumlah postingan harian akun (dibulatkan). Contoh: 3 posting, porsi 30% -> 1.
 */
export function effectivePerDay(s: Pick<AffiliateSettings, "aktif" | "perHari" | "porsi">, postsPerDay: number): number {
  if (!s.aktif) return 0;
  return Math.max(0, Math.min(s.perHari, postsPerDay, Math.round(postsPerDay * s.porsi + 1e-9)));
}

const SHOPEE_HOSTS = /^(?:[a-z0-9-]+\.)*shopee\.co\.id$|^(?:www\.)?shope\.ee$/i;

/** Link https ke Shopee Indonesia (termasuk short link s.shopee.co.id dan shope.ee). */
export function isShopeeLink(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && SHOPEE_HOSTS.test(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Tag niche baku: huruf kecil, tanpa "#", spasi dirapatkan. String kosong bila tidak sah. */
export function normalizeNiche(raw: string): string {
  return raw
    .replace(/^[\s#]+/, "")
    .replace(/[<>,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, AFF_NICHE_CHARS);
}

/** Teks balasan dari templat. */
export const replyFromTemplate = (template: string, link: string): string => template.split(LINK_TOKEN).join(link).trim();

/* ------------------------------------------------------------------ DTO */

export interface AffiliateProductDTO {
  id: string;
  nama: string;
  link: string;
  niche: string[];
  catatan: string;
  aktif: boolean;
  updatedAt: string | null;
  /** Postingan affiliate produk ini yang sudah terbit dalam 30 hari. */
  dipakai30: number;
  terakhir: string | null;
}

export interface AffiliateAccountDTO {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  /** Pengaturan autopilot yang memengaruhi affiliate. */
  mode: AutopilotMode;
  postsPerDay: number;
  config: AffiliateSettings & { updatedAt: string | null };
}

export type AffiliateReplyStatus = "MENUNGGU" | "TERKIRIM" | "GAGAL" | "BATAL";

export interface AffiliateRecentDTO {
  id: string;
  accountId: string;
  productId: string;
  produk: string | null;
  slotAt: string;
  slotStatus: string;
  balasan: AffiliateReplyStatus;
  error: string | null;
  releaseUrl: string | null;
}

export interface AffiliateSummaryDTO {
  terbit: number;
  terjadwal: number;
  balasanTerkirim: number;
  balasanGagal: number;
}

export interface AffiliateOverviewResponse {
  success: true;
  /** Tabel affiliate sudah dibuat (sql/019_affiliate.sql). */
  installed: boolean;
  /** Saklar "jeda semua affiliate" workspace (true = berjalan). */
  aktif: boolean;
  accounts: AffiliateAccountDTO[];
  products: AffiliateProductDTO[];
  recent: AffiliateRecentDTO[];
  summary: AffiliateSummaryDTO;
  /** Usulan tag niche: pilar autopilot akun dan niche yang sudah dipakai katalog. */
  nicheSuggestions: string[];
}

export const EMPTY_SUMMARY: AffiliateSummaryDTO = { terbit: 0, terjadwal: 0, balasanTerkirim: 0, balasanGagal: 0 };
