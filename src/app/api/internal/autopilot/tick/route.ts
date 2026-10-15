import { NextResponse, type NextRequest } from "next/server";
import { jsonError } from "@/lib/api-auth";
import { runTick } from "@/lib/autopilot-tick";
import { cronSecretConfigured, isCronAuthorized } from "@/lib/cron-auth";

/** Satu putaran menulis beberapa draf AI; anggaran kerja 200 detik (lihat TICK_BUDGET_MS). */
export const maxDuration = 300;

/**
 * Satu putaran autopilot. Dipanggil penjadwal (Coolify Scheduled Task) tiap 5 menit dengan header
 * `x-cron-secret`; bukan untuk browser. Aman dipanggil ganda: tick kedua langsung selesai karena
 * kunci tick masih dipegang yang pertama.
 */
export async function POST(request: NextRequest) {
  // Sudah diperiksa proxy; diulang di sini supaya route tetap tertutup bila matcher proxy berubah.
  if (!cronSecretConfigured()) return jsonError(503, "Penjadwal belum dikonfigurasi.");
  if (!isCronAuthorized(request)) return jsonError(401, "Tidak diizinkan.");

  try {
    const result = await runTick();
    return NextResponse.json(
      { success: result.ok, ...result },
      { status: result.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[autopilot/tick]", err instanceof Error ? err.message : "galat tak dikenal");
    return jsonError(500, "Tick gagal.");
  }
}
