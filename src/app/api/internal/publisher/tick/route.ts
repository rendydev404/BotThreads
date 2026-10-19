import { NextResponse, type NextRequest } from "next/server";
import { jsonError } from "@/lib/api-auth";
import { cronSecretConfigured, isCronAuthorized } from "@/lib/cron-auth";
import { runPublisher } from "@/lib/threads-publisher";

export const maxDuration = 60;

/**
 * Satu putaran penerbit Threads. Dipanggil penjadwal (Coolify Scheduled Task) tiap menit dengan header
 * `x-cron-secret`; bukan untuk browser. Aman dipanggil ganda: dispatch diklaim dengan SKIP LOCKED.
 */
export async function POST(request: NextRequest) {
  // Sudah diperiksa proxy; diulang di sini supaya route tetap tertutup bila matcher proxy berubah.
  if (!cronSecretConfigured()) return jsonError(503, "Penjadwal belum dikonfigurasi.");
  if (!isCronAuthorized(request)) return jsonError(401, "Tidak diizinkan.");

  try {
    const result = await runPublisher();
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[publisher/tick]", err instanceof Error ? err.message : "galat tak dikenal");
    return jsonError(500, "Putaran penerbit gagal.");
  }
}
