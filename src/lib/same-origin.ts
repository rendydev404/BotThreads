/**
 * Perlindungan CSRF: permintaan yang mengubah data dari browser harus berasal
 * dari host yang sama dengan aplikasi.
 *
 * Dibandingkan ke header Host / X-Forwarded-Host (yang diteruskan proxy),
 * BUKAN ke request.nextUrl.origin, karena di belakang proxy server Next
 * melihat dirinya sebagai 0.0.0.0:3000 sehingga semua login akan ditolak.
 */
export function isSameOrigin(req: { headers: Headers }): boolean {
  const origin = req.headers.get("origin");
  // Klien non-browser (curl, server-ke-server) tidak mengirim Origin dan tidak
  // membawa cookie sesi secara otomatis, jadi aman diteruskan.
  if (!origin) return true;

  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false; // mis. Origin: null
  }

  const host = (
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    ""
  )
    .split(",")[0]
    .trim()
    .toLowerCase();

  return originHost === host;
}
