/**
 * Pembatas percobaan login (in-memory, per proses).
 * Cukup untuk satu instance; untuk banyak instance pindahkan ke Redis.
 */
interface Entry {
  fails: number;
  windowStart: number;
  lockedUntil: number;
}

const WINDOW_MS = 15 * 60 * 1000;
const store = new Map<string, Entry>();

function prune(now: number) {
  if (store.size < 500) return;
  for (const [k, e] of store) {
    if (e.lockedUntil < now && now - e.windowStart > WINDOW_MS) store.delete(k);
  }
}

/** Detik tersisa jika terkunci, 0 jika boleh mencoba. */
export function lockedSeconds(key: string): number {
  const e = store.get(key);
  if (!e) return 0;
  const now = Date.now();
  return e.lockedUntil > now ? Math.ceil((e.lockedUntil - now) / 1000) : 0;
}

export function recordFailure(key: string, max: number) {
  const now = Date.now();
  prune(now);
  let e = store.get(key);
  if (!e || now - e.windowStart > WINDOW_MS) {
    e = { fails: 0, windowStart: now, lockedUntil: 0 };
  }
  e.fails += 1;
  if (e.fails >= max) e.lockedUntil = now + WINDOW_MS;
  store.set(key, e);
}

export function clearFailures(key: string) {
  store.delete(key);
}
