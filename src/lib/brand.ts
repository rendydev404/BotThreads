/**
 * Nama dan deskripsi brand untuk prompt AI, diambil dari pengaturan workspace pengguna (menu
 * Pengaturan > Brand). Sebelum pengaturan itu ada, dipakai nilai bawaan yang sama dengan teks prompt
 * semula, jadi perilaku lama tidak berubah.
 */
import { MissingAutopilotSchemaError } from "./autopilot-store";
import { getWorkspaceSettings } from "./team-store";
import { currentScope } from "./tenant-scope";

export interface Brand {
  nama: string;
  /** Penjelasan singkat bidang usaha (mis. "kuliner shawarma"); boleh kosong. */
  deskripsi: string;
}

/** Teks brand yang tertulis di prompt bawaan; `applyBrand` menggantinya dengan brand workspace. */
export const DEFAULT_BRAND: Brand = { nama: "Suka Shawarma", deskripsi: "kuliner shawarma" };

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Brand }>();

/** Brand workspace pada lingkup permintaan saat ini (cache 60 detik per workspace). */
export async function currentBrand(): Promise<Brand> {
  const workspaceId = currentScope()?.workspaceId;
  if (!workspaceId) return DEFAULT_BRAND;
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value = DEFAULT_BRAND;
  try {
    const s = await getWorkspaceSettings(workspaceId);
    if (s?.namaBrand) value = { nama: s.namaBrand, deskripsi: s.deskripsiBrand ?? "" };
  } catch (err) {
    // Prompt tetap harus jadi walau pengaturan gagal dibaca.
    if (!(err instanceof MissingAutopilotSchemaError)) console.error("[brand]", err instanceof Error ? err.message : err);
  }
  cache.set(workspaceId, { at: Date.now(), value });
  return value;
}

const plain = (s: string, max: number): string => s.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Ganti brand bawaan di teks prompt dengan brand workspace (nama dan deskripsinya dibersihkan). */
export function applyBrand(prompt: string, brand: Brand): string {
  if (brand === DEFAULT_BRAND) return prompt;
  const nama = plain(brand.nama, 80) || DEFAULT_BRAND.nama;
  const deskripsi = plain(brand.deskripsi, 200);
  return prompt
    .replaceAll(`${DEFAULT_BRAND.nama} (${DEFAULT_BRAND.deskripsi})`, deskripsi ? `${nama} (${deskripsi})` : nama)
    .replaceAll(DEFAULT_BRAND.nama, nama);
}
