/**
 * Paket langganan (sql/011_plans.sql): batas per workspace dan pengelolaannya oleh super admin.
 * Sebelum sql/011 dipasang tidak ada paket: semua workspace tanpa batas, seperti sebelumnya.
 */
import { MissingAutopilotSchemaError } from "./autopilot-store";
import {
  PLAN_DESC_MAX,
  PLAN_ID_PATTERN,
  PLAN_NAME_MAX,
  PLAN_POSTS_MAX,
  type AdminPlansResponse,
  type PlanDTO,
  type PlanLimits,
  type PublicPlansResponse,
} from "./plan-types";
import { rpc, utc } from "./supabase";
import type { Failure } from "./threads-publish";

const SQL_FILE = "sql/018_plan_labels.sql";
const TTL_MS = 30_000;
const MISSING_TTL_MS = 5 * 60_000;
const UNLIMITED: PlanLimits = { plan: null, bawaan: true, berakhir: null, kedaluwarsa: false, pakai: { akun: 0, anggota: 0 } };

const isMissing = (err: unknown): boolean =>
  err instanceof Error && /PGRST202|42883|42P01|42703/.test(err.message) && /dash_plan_|dash_sa_plan|dash_sa_workspace_plan|"Plan"|planId|planBawaan/.test(err.message);
const failure = (status: number, error: string): Failure => ({ ok: false, status, error });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

let missingUntil = 0;
const limitCache = new Map<string, { at: number; value: PlanLimits }>();
let expiredCache: { at: number; value: Set<string> } | null = null;

export function forgetPlans(): void {
  limitCache.clear();
  expiredCache = null;
  missingUntil = 0;
}

/** Jalankan RPC paket; `fallback` dipakai bila skemanya belum dipasang (diingat 5 menit). */
async function read<T>(fn: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  if (Date.now() < missingUntil) return fallback;
  try {
    return await rpc<T>(fn, args);
  } catch (err) {
    if (!isMissing(err)) throw err;
    missingUntil = Date.now() + MISSING_TTL_MS;
    return fallback;
  }
}

/** Paket yang berlaku untuk sebuah workspace dan pemakaiannya (cache 30 detik; `fresh` melewati cache). */
export async function planLimits(workspaceId: string | null, now = new Date(), fresh = false): Promise<PlanLimits> {
  if (!workspaceId) return UNLIMITED;
  const hit = limitCache.get(workspaceId);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const raw = await read<PlanLimits | null>("dash_plan_limits", { p_ws: workspaceId, p_now: now }, null);
  const value: PlanLimits = raw ? { ...raw, bawaan: raw.bawaan !== false, berakhir: raw.berakhir ? utc(raw.berakhir).toISOString() : null } : UNLIMITED;
  limitCache.set(workspaceId, { at: Date.now(), value });
  if (limitCache.size > 500) limitCache.clear();
  return value;
}

/** Workspace yang paketnya habis masa berlaku (cache 30 detik). Dipakai tick untuk menghentikan autopilotnya. */
export async function expiredTenants(now = new Date()): Promise<Set<string>> {
  if (expiredCache && Date.now() - expiredCache.at < TTL_MS) return expiredCache.value;
  const value = new Set(await read<string[]>("dash_plan_expired", { p_now: now }, []));
  expiredCache = { at: Date.now(), value };
  return value;
}

export async function publicPlans(): Promise<PublicPlansResponse> {
  const rows = await read<PlanDTO[]>("dash_plan_list", { p_public: true }, []);
  return {
    success: true,
    items: rows.map(({ id, nama, deskripsi, label, hargaBulanan, maxAkun, maxPostingPerHari, maxAnggota, modeOtomatis }) => ({
      id, nama, deskripsi, label, hargaBulanan, maxAkun, maxPostingPerHari, maxAnggota, modeOtomatis,
    })),
  };
}

/* ------------------------------------------------------------------ super admin */

async function write<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await rpc<T>(fn, args);
  } catch (err) {
    if (isMissing(err)) throw new MissingAutopilotSchemaError(SQL_FILE);
    throw err;
  }
}

export async function adminPlans(): Promise<AdminPlansResponse> {
  try {
    return { success: true, installed: true, items: await rpc<PlanDTO[]>("dash_plan_list", { p_public: false }) };
  } catch (err) {
    if (!isMissing(err)) throw err;
    return { success: true, installed: false, items: [] };
  }
}

const intIn = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Buat/ubah paket, hapus paket, atau tetapkan paket bawaan. Body: `{ action: "save", plan }` | `{ action: "delete" | "default", id }`. */
export async function actOnPlans(adminId: string, body: unknown, now = new Date()): Promise<{ ok: true } | Failure> {
  if (!isRecord(body) || typeof body.action !== "string") return failure(400, "Tindakan tidak valid.");
  let result: string;
  if (body.action === "save") {
    const p = body.plan;
    if (!isRecord(p)) return failure(400, "Data paket tidak valid.");
    const id = typeof p.id === "string" ? p.id.trim().toLowerCase() : "";
    if (!PLAN_ID_PATTERN.test(id)) return failure(400, "Kode paket 2-32 karakter: huruf kecil, angka, atau tanda hubung.");
    const nama = text(p.nama, PLAN_NAME_MAX);
    if (nama.length < 2) return failure(400, `Nama paket harus 2-${PLAN_NAME_MAX} karakter.`);
    if (p.label !== null && p.label !== undefined && p.label !== "REKOMENDASI" && p.label !== "TERLARIS") {
      return failure(400, "Label paket tidak valid.");
    }
    if (!intIn(p.hargaBulanan, 0, 1_000_000_000)) return failure(400, "Harga per bulan harus bilangan bulat rupiah, 0 atau lebih.");
    if (!intIn(p.maxAkun, 1, 1000)) return failure(400, "Jumlah akun harus 1-1000.");
    if (!intIn(p.maxPostingPerHari, 1, PLAN_POSTS_MAX)) return failure(400, `Posting per hari harus 1-${PLAN_POSTS_MAX}.`);
    if (!intIn(p.maxAnggota, 1, 1000)) return failure(400, "Jumlah anggota harus 1-1000.");
    for (const key of ["modeOtomatis", "publik", "aktif"] as const) {
      if (typeof p[key] !== "boolean") return failure(400, "Nilai saklar paket tidak valid.");
    }
    result = await write<string>("dash_sa_plan_upsert_v2", {
      p_actor: adminId,
      p_plan: {
        id, nama, deskripsi: text(p.deskripsi, PLAN_DESC_MAX) || null, label: p.label ?? null, hargaBulanan: p.hargaBulanan, maxAkun: p.maxAkun,
        maxPostingPerHari: p.maxPostingPerHari, maxAnggota: p.maxAnggota, modeOtomatis: p.modeOtomatis, publik: p.publik, aktif: p.aktif,
        urutan: intIn(p.urutan, 0, 999) ? p.urutan : 0,
      },
      p_now: now,
    });
  } else if (body.action === "delete") {
    if (typeof body.id !== "string" || !PLAN_ID_PATTERN.test(body.id)) return failure(400, "Kode paket tidak valid.");
    result = await write<string>("dash_sa_plan_delete", { p_actor: adminId, p_id: body.id, p_now: now });
    if (result === "IN_USE") return failure(409, "Paket ini masih dipakai workspace atau menjadi paket bawaan. Pindahkan dulu, atau nonaktifkan saja.");
    if (result === "NOT_FOUND") return failure(404, "Paket tidak ditemukan.");
  } else if (body.action === "default") {
    if (body.id !== null && (typeof body.id !== "string" || !PLAN_ID_PATTERN.test(body.id))) return failure(400, "Kode paket tidak valid.");
    result = await write<string>("dash_sa_plan_default", { p_actor: adminId, p_id: body.id, p_now: now });
    if (result === "NO_PLAN") return failure(404, "Paket tidak ditemukan atau tidak aktif.");
  } else {
    return failure(400, "Tindakan tidak valid.");
  }
  if (result !== "OK") return failure(403, "Hanya super admin yang boleh melakukan ini.");
  forgetPlans();
  return { ok: true };
}

/** Pasang paket ke workspace. `planId` null = kembali ke paket bawaan; `until` ISO atau null (tanpa batas waktu). */
export async function setWorkspacePlan(adminId: string, workspaceId: string, body: Record<string, unknown>, now = new Date()): Promise<{ ok: true } | Failure> {
  if (body.planId !== null && (typeof body.planId !== "string" || !PLAN_ID_PATTERN.test(body.planId))) return failure(400, "Kode paket tidak valid.");
  let until: Date | null = null;
  if (body.until !== null && body.until !== undefined) {
    const at = typeof body.until === "string" ? Date.parse(body.until) : NaN;
    if (!Number.isFinite(at)) return failure(400, "Tanggal berakhir tidak valid.");
    until = new Date(at);
  }
  const result = await write<string>("dash_sa_workspace_plan", { p_actor: adminId, p_ws: workspaceId, p_plan: body.planId, p_until: until, p_now: now });
  if (result === "NOT_FOUND") return failure(404, "Workspace tidak ditemukan.");
  if (result === "NO_PLAN") return failure(404, "Paket tidak ditemukan.");
  if (result !== "OK") return failure(403, "Hanya super admin yang boleh melakukan ini.");
  forgetPlans();
  return { ok: true };
}

/** Paket tiap workspace untuk daftar di panel admin: id workspace -> { planId, planBerakhir }. */
export async function workspacePlans(): Promise<Record<string, { planId: string; planBerakhir: string | null }>> {
  const raw = await read<Record<string, { planId: string; planBerakhir: string | null }>>("dash_sa_workspace_plans", {}, {});
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, { planId: v.planId, planBerakhir: v.planBerakhir ? utc(v.planBerakhir).toISOString() : null }]));
}

/* ------------------------------------------------------------------ penegakan batas */

/**
 * Periksa perubahan autopilot terhadap paket workspace. `after` = keadaan akun-akun workspace itu
 * setelah perubahan (id akun -> mode dan posting per hari). Null bila boleh, atau pesan penolakan.
 */
export function checkAutopilotAgainstPlan(
  limits: PlanLimits,
  changed: { mode: string; postsPerDay: number }[],
  activeAfter: number
): string | null {
  const turningOn = changed.some((c) => c.mode !== "MATI");
  if (limits.kedaluwarsa && turningOn) return "Masa berlaku paket workspace ini sudah habis. Perpanjang dulu untuk menyalakan autopilot.";
  const plan = limits.plan;
  if (!plan) return null;
  if (changed.some((c) => c.mode !== "MATI" && c.postsPerDay > plan.maxPostingPerHari)) {
    return `Paket ${plan.nama} mengizinkan paling banyak ${plan.maxPostingPerHari} posting per akun per hari.`;
  }
  if (!plan.modeOtomatis && changed.some((c) => c.mode === "OTOMATIS")) {
    return `Paket ${plan.nama} hanya mendukung mode Tinjau dulu. Naikkan paket untuk mode Otomatis.`;
  }
  if (turningOn && activeAfter > plan.maxAkun) {
    return `Paket ${plan.nama} mengizinkan autopilot di ${plan.maxAkun} akun. Matikan akun lain dulu atau naikkan paket.`;
  }
  return null;
}
