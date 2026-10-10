import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { isSameOrigin } from "@/lib/same-origin";

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 403 });
  }
  const res = NextResponse.json(
    { success: true },
    { headers: { "Cache-Control": "no-store" } }
  );
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
