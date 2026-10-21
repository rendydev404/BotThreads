/**
 * Layanan Shopee Affiliate untuk route API: tab Affiliate di halaman autopilot (pengaturan per akun,
 * katalog produk per niche, saklar jeda, laporan). Semua akses dibatasi lingkup pengguna (`RequestCtx`).
 */
import { affiliateReadiness } from "./affiliate-pick";
import {
  affiliateOverview,
  deleteProduct,
  emptyAffiliateState,
  loadAffiliateState,
  retryAffiliateReply,
  setAffiliateWorkspace,
  upsertAffiliateConfigs,
  upsertProduct,
  type AffConfigRow,
} from "./affiliate-store";
import {
  AFF_GAP_HOURS_MAX,
  AFF_LINK_MAX,
  AFF_NAME_MAX,
  AFF_NICHE_MAX,
  AFF_NOTE_MAX,
  AFF_PER_DAY_MAX,
  AFF_REPEAT_DAYS_MAX,
  AFF_TEMPLATE_MAX,
  DEFAULT_AFFILIATE,
  EMPTY_SUMMARY,
  LINK_TOKEN,
  isShopeeLink,
  normalizeNiche,
  type AffiliateOverviewResponse,
  type AffiliateProductDTO,
  type AffiliateSettings,
} from "./affiliate-types";
import { visibleAccounts } from "./autopilot-service";
import { DEFAULT_SETTINGS } from "./autopilot-types";
import { MissingAutopilotSchemaError, loadState } from "./autopilot-store";
import { resolveWorkspace } from "./radar-service";
import type { RequestCtx } from "./request-ctx";
import { wibDayKey } from "./scheduling";
import type { Failure } from "./threads-publish";

const failure = (status: number, error: string): Failure => ({ ok: false, status, error });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clean = (s: string): string => s.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
const ID = /^[A-Za-z0-9_-]{1,64}$/;

const NO_WORKSPACE = "Workspace belum bisa ditentukan. Pastikan ada akun yang sudah dipetakan ke cabang.";
const SCOPED = "Katalog dan saklar affiliate berlaku untuk seluruh workspace. Minta admin workspace untuk mengubahnya.";

const EMPTY: AffiliateOverviewResponse = {
  success: true,
  installed: false,
  aktif: true,
  accounts: [],
  products: [],
  recent: [],
  summary: EMPTY_SUMMARY,
  nicheSuggestions: [],
};

/** Daftar tag niche dari input bebas (array atau teks berpisah koma). */
function parseNiche(raw: unknown): string[] | null {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : null;
  if (!list || list.some((n) => typeof n !== "string")) return null;
  return [...new Set((list as string[]).map(normalizeNiche).filter((n) => n.length >= 2))];
}

/* ------------------------------------------------------------------ baca */

export async function affiliatePage(ctx: RequestCtx, now = new Date()): Promise<AffiliateOverviewResponse> {
  const workspaceId = await resolveWorkspace(ctx);
  if (!workspaceId) return { ...EMPTY, installed: true };
  try {
    const today = wibDayKey(now);
    const [accounts, state, raw] = await Promise.all([
      visibleAccounts(ctx),
      loadState(workspaceId, today, today),
      affiliateOverview(workspaceId, ctx.accountIds, now),
    ]);
    const configs = new Map(raw.configs.map((c) => [c.accountId, c]));
    const mine = accounts.filter((a) => a.tenantId === workspaceId);
    // Pemakaian terakhir per akun-produk (aturan jeda yang sama dengan undian slot) untuk status per akun.
    const usage = await loadAffiliateState(
      mine.filter((a) => configs.get(a.id)?.aktif).map((a) => a.id),
      today
    ).catch(() => emptyAffiliateState());
    const activeProducts = raw.products.filter((p) => p.aktif);
    const suggestions = new Set<string>();
    const list = mine.map((a) => {
        const ap = state.configs.get(a.id);
        for (const p of ap?.pillars ?? []) {
          const n = normalizeNiche(p.key);
          if (n.length >= 2) suggestions.add(n);
        }
        const c = configs.get(a.id);
        const { accountId, ...settings } = c ?? { accountId: a.id, ...DEFAULT_AFFILIATE, updatedAt: null };
        void accountId;
        const mode = ap?.mode ?? DEFAULT_SETTINGS.mode;
        const postsPerDay = ap?.postsPerDay ?? DEFAULT_SETTINGS.postsPerDay;
        const lastUse = new Map<string, Date>();
        for (const [key, at] of usage.lastUse) if (key.startsWith(`${a.id}|`)) lastUse.set(key.slice(a.id.length + 1), at);
        return {
          id: a.id,
          username: a.username,
          displayName: a.displayName,
          avatarUrl: a.avatarUrl,
          mode,
          postsPerDay,
          config: settings,
          status: affiliateReadiness({ settings, mode, postsPerDay, paused: !raw.aktif, products: activeProducts, lastUse, now }),
        };
      });
    for (const p of raw.products) for (const n of p.niche) suggestions.add(n);
    for (const c of raw.configs) for (const n of c.niche) suggestions.add(n);
    return {
      success: true,
      installed: true,
      aktif: raw.aktif,
      accounts: list,
      products: raw.products,
      recent: raw.recent,
      summary: raw.summary ?? EMPTY_SUMMARY,
      nicheSuggestions: [...suggestions].sort((a, b) => a.localeCompare(b, "id")),
    };
  } catch (err) {
    if (err instanceof MissingAutopilotSchemaError) return EMPTY;
    throw err;
  }
}

/* ------------------------------------------------------------------ katalog */

export async function saveProduct(ctx: RequestCtx, body: unknown, now = new Date()): Promise<{ ok: true; item: AffiliateProductDTO } | Failure> {
  if (ctx.accountIds !== null) return failure(403, SCOPED);
  if (!isRecord(body)) return failure(400, "Body permintaan tidak valid.");
  const nama = typeof body.nama === "string" ? clean(body.nama) : "";
  if (nama.length < 2 || nama.length > AFF_NAME_MAX) return failure(400, `Nama produk harus 2-${AFF_NAME_MAX} karakter.`);
  const link = typeof body.link === "string" ? body.link.trim() : "";
  if (link.length > AFF_LINK_MAX || !isShopeeLink(link)) {
    return failure(400, "Link harus link Shopee Indonesia yang diawali https:// (mis. https://s.shopee.co.id/xxxx).");
  }
  const niche = parseNiche(body.niche);
  if (!niche || niche.length === 0) return failure(400, "Isi minimal satu niche (mis. dapur, skincare, otomotif).");
  if (niche.length > AFF_NICHE_MAX) return failure(400, `Maksimal ${AFF_NICHE_MAX} niche per produk.`);
  const catatan = typeof body.catatan === "string" ? clean(body.catatan) : "";
  if (catatan.length > AFF_NOTE_MAX) return failure(400, `Catatan produk maksimal ${AFF_NOTE_MAX} karakter.`);
  if (body.aktif !== undefined && typeof body.aktif !== "boolean") return failure(400, "Status aktif tidak valid.");
  const aktif = body.aktif !== false;
  const id = typeof body.id === "string" && ID.test(body.id) ? body.id : undefined;

  const workspaceId = await resolveWorkspace(ctx);
  if (!workspaceId) return failure(409, NO_WORKSPACE);
  const saved = await upsertProduct({ id, workspaceId, nama, link, niche, catatan, aktif }, ctx.userId, now);
  if (!saved) return failure(404, "Produk tidak ditemukan.");
  return {
    ok: true,
    item: { id: saved, nama, link, niche, catatan, aktif, updatedAt: now.toISOString(), dipakai30: 0, terakhir: null },
  };
}

export async function removeProduct(ctx: RequestCtx, id: string, now = new Date()): Promise<{ ok: true } | Failure> {
  if (ctx.accountIds !== null) return failure(403, SCOPED);
  const workspaceId = await resolveWorkspace(ctx);
  if (!workspaceId) return failure(409, NO_WORKSPACE);
  return (await deleteProduct(id, workspaceId, ctx.userId, now)) ? { ok: true } : failure(404, "Produk tidak ditemukan.");
}

/* ------------------------------------------------------------------ pengaturan akun */

const intIn = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Terapkan perubahan sebagian ke pengaturan lama. Semua angka bebas diatur dalam batas tabel. */
export function parseAffiliatePatch(patch: unknown, base: AffiliateSettings): { ok: true; value: AffiliateSettings } | { ok: false; error: string } {
  if (!isRecord(patch)) return { ok: false, error: "Pengaturan tidak valid." };
  const next = { ...base, niche: [...base.niche] };
  if (patch.aktif !== undefined) {
    if (typeof patch.aktif !== "boolean") return { ok: false, error: "Saklar affiliate tidak valid." };
    next.aktif = patch.aktif;
  }
  if (patch.perHari !== undefined) {
    if (!intIn(patch.perHari, 0, AFF_PER_DAY_MAX)) return { ok: false, error: `Maksimal per hari harus 0-${AFF_PER_DAY_MAX}.` };
    next.perHari = patch.perHari;
  }
  if (patch.porsi !== undefined) {
    if (typeof patch.porsi !== "number" || !Number.isFinite(patch.porsi) || patch.porsi < 0 || patch.porsi > 1) {
      return { ok: false, error: "Porsi harus 0-100%." };
    }
    next.porsi = Math.round(patch.porsi * 100) / 100;
  }
  if (patch.jarakJam !== undefined) {
    if (!intIn(patch.jarakJam, 0, AFF_GAP_HOURS_MAX)) return { ok: false, error: `Jarak antar postingan affiliate harus 0-${AFF_GAP_HOURS_MAX} jam.` };
    next.jarakJam = patch.jarakJam;
  }
  if (patch.jedaHari !== undefined) {
    if (!intIn(patch.jedaHari, 0, AFF_REPEAT_DAYS_MAX)) return { ok: false, error: `Jeda produk yang sama harus 0-${AFF_REPEAT_DAYS_MAX} hari.` };
    next.jedaHari = patch.jedaHari;
  }
  if (patch.niche !== undefined) {
    const niche = parseNiche(patch.niche);
    if (!niche) return { ok: false, error: "Niche tidak valid." };
    if (niche.length > AFF_NICHE_MAX) return { ok: false, error: `Maksimal ${AFF_NICHE_MAX} niche per akun.` };
    next.niche = niche;
  }
  if (patch.templateBalasan !== undefined) {
    if (typeof patch.templateBalasan !== "string") return { ok: false, error: "Teks balasan tidak valid." };
    const t = patch.templateBalasan
      .replace(/\r\n/g, "\n")
      .replace(/[<>]/g, " ")
      .split("\n")
      .map((l) => l.replace(/[ \t]+/g, " ").trim())
      .join("\n")
      .trim();
    if (!t.includes(LINK_TOKEN)) return { ok: false, error: `Teks balasan wajib memuat ${LINK_TOKEN} sebagai tempat link.` };
    if (t.length > AFF_TEMPLATE_MAX) return { ok: false, error: `Teks balasan maksimal ${AFF_TEMPLATE_MAX} karakter.` };
    next.templateBalasan = t;
  }
  if (next.aktif && next.niche.length === 0) return { ok: false, error: "Pilih minimal satu niche sebelum menyalakan affiliate." };
  return { ok: true, value: next };
}

export async function saveAffiliateSettings(
  ctx: RequestCtx,
  accountIds: unknown,
  patch: unknown,
  now = new Date()
): Promise<{ ok: true; saved: number } | Failure> {
  if (!Array.isArray(accountIds) || accountIds.length === 0 || accountIds.length > 200 || accountIds.some((id) => typeof id !== "string" || !ID.test(id))) {
    return failure(400, "Pilih akun yang akan diatur.");
  }
  const workspaceId = await resolveWorkspace(ctx);
  if (!workspaceId) return failure(409, NO_WORKSPACE);
  const [accounts, raw] = await Promise.all([visibleAccounts(ctx), affiliateOverview(workspaceId, ctx.accountIds, now)]);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const current = new Map(raw.configs.map((c) => [c.accountId, c]));
  const items: AffConfigRow[] = [];
  for (const id of new Set(accountIds as string[])) {
    const account = byId.get(id);
    if (!account || account.tenantId !== workspaceId) return failure(404, "Akun Threads tidak ditemukan.");
    const c = current.get(id);
    const parsed = parseAffiliatePatch(patch, c ? { ...c } : DEFAULT_AFFILIATE);
    if (!parsed.ok) return failure(400, parsed.error);
    const { aktif, perHari, porsi, jarakJam, jedaHari, niche, templateBalasan } = parsed.value;
    items.push({ accountId: id, workspaceId, aktif, perHari, porsi, jarakJam, jedaHari, niche, templateBalasan });
  }
  return { ok: true, saved: await upsertAffiliateConfigs(items, ctx.userId, now) };
}

export async function setAffiliateActive(ctx: RequestCtx, aktif: boolean, now = new Date()): Promise<{ ok: true } | Failure> {
  if (ctx.accountIds !== null) return failure(403, SCOPED);
  const workspaceId = await resolveWorkspace(ctx);
  if (!workspaceId) return failure(409, NO_WORKSPACE);
  await setAffiliateWorkspace(workspaceId, aktif, ctx.userId, now);
  return { ok: true };
}

/** Kirim ulang balasan link yang gagal (maks 2 hari setelah slot, batas yang sama dengan antrean publisher). */
export async function retryReply(ctx: RequestCtx, id: string, now = new Date()): Promise<{ ok: true } | Failure> {
  const workspaceId = await resolveWorkspace(ctx);
  if (!workspaceId) return failure(409, NO_WORKSPACE);
  return (await retryAffiliateReply(id, workspaceId, ctx.accountIds, now))
    ? { ok: true }
    : failure(409, "Link ini tidak bisa dikirim ulang: sudah lewat 2 hari atau statusnya sudah berubah. Muat ulang halaman.");
}
