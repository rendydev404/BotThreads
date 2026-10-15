/**
 * Lingkup tenant per permintaan (workspace dan akun yang boleh diakses pengguna), dibawa dengan
 * AsyncLocalStorage supaya berlaku di SEMUA akses data dalam permintaan itu tanpa harus meneruskan
 * argumen ke setiap fungsi.
 *
 * Cara kerjanya: route membungkus handler dengan `withCtx` (request-ctx.ts) yang menjalankan handler
 * di dalam `runScoped`. Titik akses data pusat (`accountScope`/`scopedIds`/`excludedIdList` di
 * supabase.ts dan `listPublishAccounts`) membaca lingkup ini, jadi akun di luar lingkup diperlakukan
 * persis seperti akun yang dikecualikan: tidak ikut agregasi, daftar, konteks AI, maupun antrean.
 * Cache proses yang menyimpan hasil lintas akun wajib memakai `scopeKey()` sebagai bagian kuncinya.
 *
 * Tanpa lingkup aktif (mis. tick autopilot atau skrip), akses bersifat global.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantScope {
  /** Workspace aktif; null = tidak dibatasi workspace. */
  workspaceId: string | null;
  /** Akun yang boleh diakses; null = semua akun di workspace. */
  accountIds: string[] | null;
  /** Kunci cache untuk lingkup ini. */
  key: string;
}

const storage = new AsyncLocalStorage<TenantScope>();

/** Kunci untuk akses tanpa pembatasan. */
export const GLOBAL_SCOPE_KEY = "*";

export function makeScope(workspaceId: string | null, accountIds: string[] | null): TenantScope {
  const key =
    workspaceId === null && accountIds === null
      ? GLOBAL_SCOPE_KEY
      : `${workspaceId ?? "-"}|${accountIds === null ? "*" : [...accountIds].sort().join(",")}`;
  return { workspaceId, accountIds, key };
}

/** Jalankan `fn` dengan lingkup tertentu; berlaku untuk semua pekerjaan asinkron di dalamnya. */
export const runScoped = <T>(scope: TenantScope, fn: () => T): T => storage.run(scope, fn);

/** Lingkup permintaan saat ini; null bila tidak dibatasi. */
export function currentScope(): TenantScope | null {
  const s = storage.getStore();
  return s && s.key !== GLOBAL_SCOPE_KEY ? s : null;
}

/** Bagian kunci cache yang membedakan lingkup. Cache lintas akun WAJIB menyertakannya. */
export const scopeKey = (): string => storage.getStore()?.key ?? GLOBAL_SCOPE_KEY;

/** Akun ini (dengan workspace-nya) berada di dalam lingkup saat ini? */
export function inScope(accountId: string, workspaceId: string | null | undefined): boolean {
  const s = currentScope();
  if (!s) return true;
  if (s.workspaceId !== null && workspaceId !== s.workspaceId) return false;
  return s.accountIds === null || s.accountIds.includes(accountId);
}
