/**
 * Kunci async per kunci (in-memory, per proses): pekerjaan dengan kunci yang sama dijalankan
 * berurutan, kunci berbeda tetap paralel. Dipakai untuk urutan "periksa lalu tulis" yang tidak atomik
 * di database (kuota posting per akun, transaksi tagihan). Cukup karena dashboard berjalan sebagai
 * satu instance; bila di-scale horizontal, ganti dengan pg_advisory_xact_lock di fungsi SQL-nya.
 */
const tails = new Map<string, Promise<void>>();

async function lockOne(key: string): Promise<() => void> {
  const prev = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const tail = prev.then(() => mine);
  tails.set(key, tail);
  await prev;
  return () => {
    release();
    // Antrean kosong: hapus supaya Map tidak tumbuh tanpa batas.
    if (tails.get(key) === tail) tails.delete(key);
  };
}

/** Jalankan `fn` sambil memegang semua kunci. Kunci diambil urut abjad supaya tidak saling mengunci. */
export async function withKeys<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
  const releases: (() => void)[] = [];
  try {
    for (const key of [...new Set(keys)].sort()) releases.push(await lockOne(key));
    return await fn();
  } finally {
    for (const release of releases.reverse()) release();
  }
}

/** Jumlah kunci yang sedang dipegang/diantre (untuk uji). */
export const heldKeys = (): number => tails.size;
