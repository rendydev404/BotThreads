/**
 * Autentikasi pemanggil terjadwal (Coolify Scheduled Task) untuk endpoint internal. Pemanggil bukan
 * browser dan tidak punya sesi, jadi dikenali lewat rahasia bersama di header `x-cron-secret`.
 * Tanpa rahasia yang terpasang, endpoint internal tertutup sama sekali.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const CRON_HEADER = "x-cron-secret";
const MIN_SECRET_LENGTH = 32;

/** Endpoint yang boleh dipanggil tanpa sesi asalkan membawa rahasia cron. */
export const CRON_PATHS = ["/api/internal/autopilot/tick"];

export const cronSecretConfigured = (): boolean =>
  (process.env.AUTOPILOT_CRON_SECRET?.length ?? 0) >= MIN_SECRET_LENGTH;

const digest = (s: string): Buffer => createHash("sha256").update(s).digest();

/** Bandingkan rahasia dalam waktu konstan (hash dulu supaya panjangnya selalu sama). */
export function isCronAuthorized(req: { headers: Headers }): boolean {
  if (!cronSecretConfigured()) return false;
  const given = req.headers.get(CRON_HEADER);
  if (!given) return false;
  return timingSafeEqual(digest(given), digest(process.env.AUTOPILOT_CRON_SECRET!));
}
