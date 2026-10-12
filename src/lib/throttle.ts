/**
 * Pembatas laju sederhana di memori per kunci (mis. id pengguna + aksi). Cukup untuk satu instance
 * dashboard internal; bila dashboard di-scale horizontal, pindahkan ke penyimpanan bersama.
 */
interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 2000;

export interface ThrottleResult {
  ok: boolean;
  /** Detik sampai boleh mencoba lagi (hanya bila ditolak). */
  retryAfter: number;
}

export function throttle(key: string, limit: number, windowMs: number, now = Date.now()): ThrottleResult {
  let b = buckets.get(key);
  if (!b) {
    if (buckets.size >= MAX_KEYS) buckets.clear();
    b = { hits: [] };
    buckets.set(key, b);
  }
  const cutoff = now - windowMs;
  b.hits = b.hits.filter((t) => t > cutoff);
  if (b.hits.length >= limit) {
    const oldest = b.hits[0];
    return { ok: false, retryAfter: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
  }
  b.hits.push(now);
  return { ok: true, retryAfter: 0 };
}
