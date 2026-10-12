/**
 * Akun Threads yang TIDAK dimasukkan ke dashboard ini (analitik, peringkat, laporan,
 * konteks AI, pemilih akun posting). Datanya tetap ada di database milik bot; dashboard
 * hanya menyaringnya. Pemfilteran data dikerjakan `accountScope()` di supabase.ts.
 *
 * Env opsional EXCLUDED_THREADS_ACCOUNTS: daftar username tambahan, dipisah koma.
 */

const DEFAULT_EXCLUDED = ["maulanayusuf7923"];

const norm = (s: string) => s.trim().replace(/^@/, "").toLowerCase();

/** Username yang dikecualikan (huruf kecil, tanpa @). Dibaca saat dipanggil agar env bisa diuji. */
export function excludedUsernames(): Set<string> {
  const extra = (process.env.EXCLUDED_THREADS_ACCOUNTS ?? "").split(",");
  return new Set([...DEFAULT_EXCLUDED, ...extra].map(norm).filter(Boolean));
}

export const isExcludedUsername = (username: string | null | undefined): boolean =>
  !!username && excludedUsernames().has(norm(username));

/** Buang baris milik akun yang dikecualikan. */
export function withoutExcluded<T extends { username: string | null }>(rows: T[]): T[] {
  const set = excludedUsernames();
  return rows.filter((r) => !r.username || !set.has(norm(r.username)));
}
