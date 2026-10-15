import { NextResponse } from "next/server";
import { buildOverview } from "@/lib/overview";
import { withCtx } from "@/lib/request-ctx";

export const GET = withCtx("VIEWER", async (request) => {
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
});
