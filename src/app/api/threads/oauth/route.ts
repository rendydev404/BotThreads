import { NextResponse } from "next/server";
import { withCtx } from "@/lib/request-ctx";
import { startThreadsAuthorize } from "@/lib/threads-oauth-start";

/** Mulai OAuth resmi Meta Threads (tombol "Hubungkan Akun Threads"); aturannya di `startThreadsAuthorize`. */
export const GET = withCtx("ADMIN", async (request, ctx) => {
  const reconnect = request.nextUrl.searchParams.get("reconnect") === "1";
  const start = await startThreadsAuthorize(request, ctx, { reconnect });
  if (start.error !== null) {
    return NextResponse.redirect(new URL(`/akun?threads_error=${encodeURIComponent(start.error)}`, start.origin));
  }
  return new NextResponse(null, { status: 307, headers: { Location: start.url, "Cache-Control": "no-store" } });
});
