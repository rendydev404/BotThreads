import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-next";
import { getSessionUserId } from "@/lib/users";
import { isSameOrigin } from "@/lib/same-origin";
import { CRON_PATHS, cronSecretConfigured, isCronAuthorized } from "@/lib/cron-auth";

// Endpoint tanpa sesi: login/logout, masuk dengan Google, terima undangan, dan reset password.
// Tiga yang terakhir dibuktikan dengan token/`state` sendiri dan dibatasi lajunya di handler.
const PUBLIC_API = [
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/google",
  "/api/auth/google/callback",
  "/api/auth/invite",
  "/api/auth/reset",
  "/api/auth/register",
  // Daftar paket untuk halaman perkenalan (hanya paket aktif yang publik).
  "/api/plans",
  // Notifikasi pembayaran Midtrans: signature dicek, lalu status diverifikasi ulang ke API Midtrans.
  "/api/billing/webhook",
  // Callback OAuth Threads: di HP bisa selesai di browser/aplikasi lain tanpa sesi; diamankan state bertanda tangan.
  "/api/threads/oauth/callback",
];

// Halaman yang dibuka dari tautan undangan/reset oleh orang yang belum punya sesi.
const PUBLIC_PAGE_PREFIXES = ["/undangan/", "/reset-password/"];
// Halaman pemasaran, pendaftaran, dan dokumen kebijakan legal (wajib publik untuk verifikasi Payment Gateway & OAuth).
const LANDING_PATH = "/selamat-datang";
const PUBLIC_PAGES = [
  LANDING_PATH,
  "/daftar",
  "/kebijakan-privasi",
  "/syarat-ketentuan",
  "/kebijakan-pengembalian",
  "/pengiriman-layanan",
  "/penghapusan-data",
  "/kontak",
  // Hasil hubungkan akun Threads bila login selesai di browser tanpa sesi dashboard.
  "/threads-terhubung",
];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (PUBLIC_API.includes(pathname)) return NextResponse.next();
  if (PUBLIC_PAGE_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (PUBLIC_PAGES.includes(pathname)) return NextResponse.next();

  // Endpoint terjadwal: dipanggil penjadwal (bukan browser) dengan rahasia, tanpa sesi.
  if (CRON_PATHS.includes(pathname)) {
    if (!cronSecretConfigured()) {
      return NextResponse.json(
        { success: false, error: "Penjadwal belum dikonfigurasi." },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (request.method !== "POST" || !isCronAuthorized(request)) {
      return NextResponse.json(
        { success: false, error: "Tidak diizinkan." },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.next();
  }

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
    // Pengunjung tanpa sesi yang membuka beranda melihat halaman perkenalan, bukan form masuk.
    if (pathname === "/") return NextResponse.redirect(new URL(LANDING_PATH, request.url));
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  // Perlindungan CSRF untuk aksi yang mengubah data
  if (isApi && request.method !== "GET" && request.method !== "HEAD") {
    if (!isSameOrigin(request)) {
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
