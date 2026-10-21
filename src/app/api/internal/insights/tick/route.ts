import { NextResponse, type NextRequest } from "next/server";
import { jsonError } from "@/lib/api-auth";
import { cronSecretConfigured, isCronAuthorized } from "@/lib/cron-auth";
import { runInsightsTick } from "@/lib/threads-insights";

export const maxDuration = 300;

/**
 * Satu putaran pengumpul metrik Threads (postingan + metrik harian akun). Dipanggil penjadwal (Coolify
 * Scheduled Task) tiap 5 menit dengan header `x-cron-secret`; bukan untuk browser. Aman dipanggil ganda:
 * putaran kedua langsung selesai karena lease.
 */
export async function POST(request: NextRequest) {
  // Sudah diperiksa proxy; diulang di sini supaya route tetap tertutup bila matcher proxy berubah.
  if (!cronSecretConfigured()) return jsonError(503, "Penjadwal belum dikonfigurasi.");
  if (!isCronAuthorized(request)) return jsonError(401, "Tidak diizinkan.");

  try {
    const result = await runInsightsTick();
    if (result.diproses) console.log("[insights/tick]", JSON.stringify(result));
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[insights/tick]", err instanceof Error ? err.message : "galat tak dikenal");
    return jsonError(500, "Putaran pengumpul metrik gagal.");
  }
}
