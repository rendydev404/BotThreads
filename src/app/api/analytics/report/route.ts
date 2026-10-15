import { NextResponse } from "next/server";
import { DEFAULT_SCOPE, buildReport } from "@/lib/report";
import { withCtx } from "@/lib/request-ctx";

/** Laporan periodik ringan (tanpa AI), dipakai kartu laporan di chat. */
export const GET = withCtx("VIEWER", async (request) => {
  const sp = request.nextUrl.searchParams;
  const days = Number(sp.get("days") ?? 7);
  const scope = (sp.get("scope") ?? DEFAULT_SCOPE).slice(0, 80);

  try {
    const report = await buildReport(Number.isFinite(days) ? days : 7, scope);
    if (!report) {
      return NextResponse.json(
        { success: false, error: "Belum ada data." },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { success: true, report },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error in /api/analytics/report:", error);
    return NextResponse.json(
      { success: false, error: "Gagal memuat laporan." },
      { status: 500 }
    );
  }
});
