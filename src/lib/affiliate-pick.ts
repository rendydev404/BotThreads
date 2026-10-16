/**
 * Undian slot affiliate (murni, tanpa I/O): apakah slot autopilot ini ditulis sebagai postingan
 * affiliate, dan produk mana yang dipakai. Semua angka diatur pengguna per akun; yang paling ketat
 * yang berlaku. Undian deterministik per slot (hash), jadi slot yang ditulis ulang tetap jadi slot affiliate.
 *
 * Aturan (berurutan):
 * 1. akun aktif, workspace tidak dijeda, dan jatah harian efektif (`effectivePerDay`) > 0;
 * 2. slot termasuk urutan yang ditunjuk untuk hari itu (tersebar acak-tetap di antara slot harian);
 * 3. jatah hari itu belum habis dan jarak dari postingan affiliate lain di akun ini >= `jarakJam`;
 * 4. produk: aktif, se-workspace, niche cocok, tidak dipakai akun lain di hari yang sama, tidak dipakai
 *    akun ini dalam `jedaHari` terakhir. Yang paling lama tidak dipakai didahulukan.
 */
import { effectivePerDay, replyFromTemplate } from "./affiliate-types";
import type { AffProduct, AffiliateState } from "./affiliate-store";
import { hash32 } from "./autopilot-plan";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface AffSlot {
  id: string;
  accountId: string;
  dayKey: string;
  slotIndex: number;
  slotAt: Date;
}

export interface AffPick {
  product: AffProduct;
  replyText: string;
  /** Jeda balasan setelah postingan utama terbit (detik, 60-180). */
  delayDetik: number;
}

/** Urutan slot (0..postsPerDay-1) yang ditunjuk sebagai affiliate untuk akun pada hari itu. */
export function designatedSlots(accountId: string, dayKey: string, postsPerDay: number, count: number): Set<number> {
  const order = Array.from({ length: postsPerDay }, (_, i) => i).sort(
    (a, b) => hash32(`${accountId}|${dayKey}|aff|${a}`) - hash32(`${accountId}|${dayKey}|aff|${b}`) || a - b
  );
  return new Set(order.slice(0, count));
}

export function pickAffiliate(slot: AffSlot, postsPerDay: number, st: AffiliateState): AffPick | null {
  const cfg = st.configs.get(slot.accountId);
  if (!cfg || st.paused.has(cfg.workspaceId)) return null;
  const quota = effectivePerDay(cfg, postsPerDay);
  if (quota <= 0 || cfg.niche.length === 0) return null;
  if (!designatedSlots(slot.accountId, slot.dayKey, postsPerDay, quota).has(slot.slotIndex)) return null;

  const mine = st.recent.filter((u) => u.accountId === slot.accountId && u.slotId !== slot.id);
  if (mine.filter((u) => u.dayKey === slot.dayKey).length >= quota) return null;
  const gapMs = cfg.jarakJam * HOUR_MS;
  if (gapMs > 0 && mine.some((u) => Math.abs(u.slotAt.getTime() - slot.slotAt.getTime()) < gapMs)) return null;

  const niche = new Set(cfg.niche);
  const takenToday = new Set(
    st.recent
      .filter((u) => u.workspaceId === cfg.workspaceId && u.dayKey === slot.dayKey && u.accountId !== slot.accountId)
      .map((u) => u.productId)
  );
  const repeatMs = cfg.jedaHari * DAY_MS;
  const lastAt = (p: AffProduct): number | null => {
    const at = st.lastUse.get(`${slot.accountId}|${p.id}`);
    // Pemakaian slot ini sendiri (tulis ulang) tidak dihitung.
    return at && at.getTime() !== slot.slotAt.getTime() ? at.getTime() : null;
  };
  const candidates = st.products.filter((p) => {
    if (p.workspaceId !== cfg.workspaceId || takenToday.has(p.id)) return false;
    if (!p.niche.some((n) => niche.has(n))) return false;
    const at = lastAt(p);
    return at === null || slot.slotAt.getTime() - at >= repeatMs;
  });
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const la = lastAt(a) ?? -Infinity;
    const lb = lastAt(b) ?? -Infinity;
    return la - lb || hash32(`${slot.id}|${a.id}`) - hash32(`${slot.id}|${b.id}`);
  });
  const product = candidates[0];
  return {
    product,
    replyText: replyFromTemplate(cfg.templateBalasan, product.link),
    delayDetik: 60 + (hash32(`${slot.id}|jeda`) % 121),
  };
}

/** Catat pemakaian ke keadaan tick supaya slot berikutnya (akun ini maupun akun lain) memperhitungkannya. */
export function rememberAffiliate(st: AffiliateState, slot: AffSlot, workspaceId: string, productId: string): void {
  st.recent = st.recent.filter((u) => u.slotId !== slot.id);
  st.recent.push({ slotId: slot.id, accountId: slot.accountId, workspaceId, productId, dayKey: slot.dayKey, slotAt: slot.slotAt });
  const key = `${slot.accountId}|${productId}`;
  const prev = st.lastUse.get(key);
  if (!prev || prev < slot.slotAt) st.lastUse.set(key, slot.slotAt);
}
