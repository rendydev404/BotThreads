/**
 * Penilaian kesiapan akun Threads untuk diposting (murni, tanpa I/O). Diuji unit.
 */
import type { PublishReason } from "./content-types";

const PUBLISH_SCOPE = "threads_content_publish";

export interface ReadinessInput {
  id: string;
  username: string | null;
  needsReconnect: boolean;
  accessExpiresAt: Date;
  scopes: string[];
  socialAccountId: string | null;
  outletId: string | null;
  outletActive: boolean | null;
}

/**
 * Alasan akun belum siap, atau undefined bila siap. Urutan pemeriksaan menentukan alasan yang
 * ditampilkan: pemetaan cabang dulu, lalu cabang aktif, sesi, token, izin, lalu pembatas masa uji.
 */
export function evaluateReadiness(
  row: ReadinessInput,
  now: Date,
  testAllow: string[] | null
): PublishReason | undefined {
  if (!row.socialAccountId || !row.outletId) return "NOT_MAPPED";
  if (row.outletActive === false) return "OUTLET_INACTIVE";
  if (row.needsReconnect) return "NEEDS_RECONNECT";
  if (row.accessExpiresAt.getTime() <= now.getTime()) return "TOKEN_EXPIRED";
  if (!row.scopes.includes(PUBLISH_SCOPE)) return "NO_PUBLISH_SCOPE";
  if (
    testAllow &&
    !testAllow.includes(row.id.toLowerCase()) &&
    !testAllow.includes((row.username ?? "").toLowerCase())
  ) {
    return "TEST_RESTRICTED";
  }
  return undefined;
}
