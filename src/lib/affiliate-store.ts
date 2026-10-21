/**
 * Akses data Shopee Affiliate: pembungkus bertipe untuk fungsi RPC `dash_aff_*` (sql/019_affiliate.sql).
 * Agregasi (batas harian, jeda produk, laporan) dikerjakan di database; modul ini hanya memetakan bentuk baris.
 */
import { rpc, utc } from "@/lib/supabase";
import { MissingAutopilotSchemaError, isMissingAutopilotSchema, missingSchemaFile } from "./autopilot-store";
import type { AffiliateProductDTO, AffiliateRecentDTO, AffiliateSettings, AffiliateSummaryDTO } from "./affiliate-types";

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await rpc<T>(fn, args);
  } catch (err) {
    if (isMissingAutopilotSchema(err)) throw new MissingAutopilotSchemaError(missingSchemaFile(err));
    throw err;
  }
}

const iso = (v: string | null | undefined): string | null => (v ? utc(v).toISOString() : null);

/* ------------------------------------------------------------------ tick autopilot */

export interface AffConfigRow extends AffiliateSettings {
  accountId: string;
  workspaceId: string;
}

export interface AffProduct {
  id: string;
  workspaceId: string;
  nama: string;
  link: string;
  niche: string[];
  catatan: string;
}

export interface AffUse {
  slotId: string;
  accountId: string;
  workspaceId: string;
  productId: string;
  dayKey: string;
  slotAt: Date;
}

/** Keadaan affiliate untuk undian slot dalam satu tick (diubah di tempat saat slot memakai produk). */
export interface AffiliateState {
  configs: Map<string, AffConfigRow>;
  /** Workspace yang affiliate-nya dijeda. */
  paused: Set<string>;
  products: AffProduct[];
  /** Pemakaian di sekitar hari yang ditulis. */
  recent: AffUse[];
  /** `${accountId}|${productId}` -> waktu slot terakhir (60 hari). */
  lastUse: Map<string, Date>;
}

/** Keadaan kosong baru (tiap tick punya salinan sendiri karena keadaan diubah di tempat). */
export const emptyAffiliateState = (): AffiliateState => ({ configs: new Map(), paused: new Set(), products: [], recent: [], lastUse: new Map() });

export async function loadAffiliateState(accountIds: string[], fromDay: string): Promise<AffiliateState> {
  if (accountIds.length === 0) return emptyAffiliateState();
  const raw = await call<{
    configs: AffConfigRow[];
    paused: string[];
    products: AffProduct[];
    recent: (Omit<AffUse, "slotAt"> & { slotAt: string })[];
    lastUse: { accountId: string; productId: string; lastAt: string }[];
  }>("dash_aff_state", { p_account_ids: accountIds, p_from: fromDay });
  return {
    configs: new Map(raw.configs.map((c) => [c.accountId, { ...c, niche: c.niche ?? [] }])),
    paused: new Set(raw.paused),
    products: raw.products.map((p) => ({ ...p, niche: p.niche ?? [] })),
    recent: raw.recent.map((u) => ({ ...u, slotAt: utc(u.slotAt) })),
    lastUse: new Map(raw.lastUse.map((l) => [`${l.accountId}|${l.productId}`, utc(l.lastAt)])),
  };
}

export interface AffUseWrite {
  slotId: string;
  workspaceId: string;
  accountId: string;
  productId: string;
  dayKey: string;
  /** ISO UTC */
  slotAt: string;
  replyText: string;
  delayDetik: number;
}

/** Catat slot affiliate (sekaligus antrean balasan pertama). Upsert per slot. */
export const saveAffiliateUse = (item: AffUseWrite, now: Date) => call<string | null>("dash_aff_use_save", { p_item: item, p_now: now });

/* ------------------------------------------------------------------ dashboard */

export interface AffOverviewRaw {
  aktif: boolean;
  configs: (AffiliateSettings & { accountId: string; updatedAt: string | null })[];
  products: AffiliateProductDTO[];
  recent: AffiliateRecentDTO[];
  summary: AffiliateSummaryDTO | null;
}

export async function affiliateOverview(workspaceId: string, accountIds: string[] | null, now: Date): Promise<AffOverviewRaw> {
  const raw = await call<AffOverviewRaw>("dash_aff_overview", { p_workspace: workspaceId, p_account_ids: accountIds, p_now: now });
  return {
    ...raw,
    configs: raw.configs.map((c) => ({ ...c, niche: c.niche ?? [], updatedAt: iso(c.updatedAt) })),
    products: raw.products.map((p) => ({ ...p, niche: p.niche ?? [], updatedAt: iso(p.updatedAt), terakhir: iso(p.terakhir) })),
    recent: raw.recent.map((r) => ({ ...r, slotAt: utc(r.slotAt).toISOString() })),
  };
}

export interface ProductWrite {
  id?: string;
  workspaceId: string;
  nama: string;
  link: string;
  niche: string[];
  catatan: string;
  aktif: boolean;
}

export const upsertProduct = (item: ProductWrite, userId: string, now: Date) =>
  call<string | null>("dash_aff_product_upsert", { p_item: item, p_user: userId, p_now: now });

export const deleteProduct = (id: string, workspaceId: string, userId: string, now: Date) =>
  call<boolean>("dash_aff_product_delete", { p_id: id, p_workspace: workspaceId, p_user: userId, p_now: now });

export const upsertAffiliateConfigs = (items: AffConfigRow[], userId: string, now: Date) =>
  call<number>("dash_aff_config_upsert", { p_items: items, p_user: userId, p_now: now });

export const setAffiliateWorkspace = (workspaceId: string, aktif: boolean, userId: string, now: Date) =>
  call<boolean>("dash_aff_workspace_set", { p_workspace: workspaceId, p_aktif: aktif, p_user: userId, p_now: now });

/** Balasan link GAGAL -> MENUNGGU lagi (percobaan diulang dari nol). false bila tidak memenuhi syarat. */
export const retryAffiliateReply = (id: string, workspaceId: string, accountIds: string[] | null, now: Date) =>
  call<boolean>("dash_aff_reply_retry", { p_id: id, p_workspace: workspaceId, p_account_ids: accountIds, p_now: now });
