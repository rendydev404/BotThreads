import { NextResponse } from "next/server";
import { getInsight } from "@/lib/insight";
import { withCtx } from "@/lib/request-ctx";

/** Analitik + saran AI untuk periode & akun yang sedang dilihat di dasbor. */
export const POST = withCtx("VIEWER", async (request) => {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Permintaan tidak valid." }, { status: 400 });
  }

  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.length <= max ? v : null;

  try {
    const insight = await getInsight(
      {
        account: str(body.account, 100) || "all",
        period: str(body.period, 20),
        from: str(body.from, 10),
        to: str(body.to, 10),
      },
      body.force === true
    );
    return NextResponse.json(
      { success: true, insight },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error in /api/analytics/insight:", error);
    return NextResponse.json(
      { success: false, error: "Analisis belum bisa dibuat. Coba lagi sebentar." },
      { status: 500 }
    );
  }
});
