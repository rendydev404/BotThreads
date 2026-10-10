import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-next";
import { getSessionUserId } from "@/lib/users";

const PUBLIC_API = ["/api/auth/login", "/api/auth/logout"];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (PUBLIC_API.includes(pathname)) return NextResponse.next();

  const user = await getSessionUserId(
    request.cookies.get(SESSION_COOKIE)?.value
  );

  if (pathname === "/login") {
    if (user) {
      const dest = safeNextPath(request.nextUrl.searchParams.get("next"));
      return NextResponse.redirect(new URL(dest, request.url));
    }
    return NextResponse.next();
  }

  if (!user) {
    if (isApi) {
      return NextResponse.json(
        { success: false, error: "Sesi berakhir. Silakan login kembali." },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  // Perlindungan CSRF untuk aksi yang mengubah data
  if (isApi && request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) {
      return NextResponse.json(
        { success: false, error: "Permintaan tidak valid." },
        { status: 403 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  // Lewati aset statis Next dan file gambar publik
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)",
  ],
};
