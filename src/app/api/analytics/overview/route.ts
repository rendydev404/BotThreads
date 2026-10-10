import { NextRequest, NextResponse } from "next/server";
import { buildOverview } from "@/lib/overview";

export async function GET(request: NextRequest) {
  // Dibaca di luar try/catch: sinyal "route dinamis" dari Next tidak boleh tertelan
  const sp = request.nextUrl.searchParams;
  try {
    const data = await buildOverview({
      account: sp.get("account") || "all",
      period: sp.get("period"),
      from: sp.get("from"),
      to: sp.get("to"),
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error in /api/analytics/overview:", error);
    return NextResponse.json(
      { success: false, error: "Gagal memuat data dasbor." },
      { status: 500 }
    );
  }
}
