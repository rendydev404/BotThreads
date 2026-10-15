/**
 * Navigasi saat sesi berganti (masuk, keluar, terima undangan). Sengaja memuat ulang penuh, bukan
 * navigasi klien: cache tingkat modul (profil, daftar akun) milik sesi sebelumnya harus ikut hilang.
 */
export function hardNavigate(path: string): void {
  window.location.assign(path);
}

/** Akhiri sesi lalu kembali ke halaman masuk, juga bila permintaan keluar gagal terkirim. */
export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    hardNavigate("/login");
  }
}
