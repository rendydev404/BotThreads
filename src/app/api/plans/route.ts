import { NextResponse } from "next/server";
import { internalError } from "@/lib/api-auth";
import { publicPlans } from "@/lib/plan";

/** Paket yang ditawarkan (aktif dan publik) untuk halaman perkenalan. Publik, tanpa sesi. */
export async function GET() {
  try {
    return NextResponse.json(await publicPlans(), { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (err) {
    return internalError("plans", err);
  }
}
