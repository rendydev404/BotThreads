/**
 * Fakta per akun dari database untuk AI: nama cabang (dash_publish_accounts) dan kalimat faktual dari
 * postingan akun itu sendiri (lokasi, menu, harga, jam buka, layanan pesan antar). Dipakai supaya
 * draf siap posting tanpa placeholder seperti "[isi detail lokasi]"; bila fakta tidak ada, AI wajib
 * menulis kalimat yang tidak membutuhkannya.
 *
 * Satu query ThreadsPostStat (filter ILIKE di database, maks 600 baris) di-cache 10 menit.
 */
import { db, excludedIdList, must } from "@/lib/supabase";
import { SENTENCE_BREAK } from "./threads-text";
import { scopeKey } from "@/lib/tenant-scope";

const TTL_MS = 10 * 60_000;
const PER_ACCOUNT = 4;
const CLIP = 160;

/** Kalimat yang memuat fakta (bukan opini): alamat/arah, harga, menu, jam buka, promo, ojek daring. */
const FACT_WORD =
  /(\bjl\.?\s|\bjln\.?\s|\balamat\b|\blokasi\b|\bmaps\b|\bgmaps\b|\brp\.?\s?\d|\b\d+\s?(?:rb|ribu)\b|\bharga\b|\bjam\s+(?:buka|operasional)\b|\bbuka\s+(?:jam|setiap|tiap|mulai|dari)\b|\bpromo\b|\bdiskon\b|\bgofood\b|\bgrabfood\b|\bshopeefood\b)/i;
/** Penunjuk arah ke nama tempat (huruf kapital): "depan Pamulang Square", bukan "jalan ke toilet". */
const NEAR_PLACE = /\b(?:[Dd]epan|[Ss]ebelah|[Ss]eberang|[Ss]amping|[Dd]ekat)\s+[A-Z]/;

export const isFactSentence = (s: string): boolean => FACT_WORD.test(s) || NEAR_PLACE.test(s);

const ILIKE = ["jl.", "jln", "alamat", "lokasi", "maps", "depan", "sebelah", "seberang", "samping", "rp", "ribu", "harga", "buka", "promo", "diskon", "gofood", "grabfood", "shopeefood"]
  .map((w) => `text.ilike.*${w}*`)
  .join(",");

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Kalimat faktual dari satu postingan (murni, untuk diuji). */
export function factSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(SENTENCE_BREAK))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 12 && isFactSentence(s))
    .map((s) => (s.length > CLIP ? `${s.slice(0, CLIP - 1)}…` : s));
}

// Per lingkup tenant: isinya dimuat dengan daftar akun yang terlihat pengguna.
const cache = new Map<string, { at: number; value: Map<string, string[]> }>();
const pending = new Map<string, Promise<Map<string, string[]>>>();

async function load(): Promise<Map<string, string[]>> {
  const hidden = await excludedIdList();
  let q = db()
    .from("ThreadsPostStat")
    .select("threadsAccountId, text, postedAt")
    .or(ILIKE)
    .order("postedAt", { ascending: false })
    .order("id", { ascending: true })
    .limit(600);
  if (hidden) q = q.not("threadsAccountId", "in", hidden);
  const rows = await must<{ threadsAccountId: string; text: string; postedAt: string }[]>(q);

  const out = new Map<string, string[]>();
  const seen = new Map<string, Set<string>>();
  for (const r of rows) {
    const list = out.get(r.threadsAccountId) ?? [];
    if (list.length >= PER_ACCOUNT) continue;
    const keys = seen.get(r.threadsAccountId) ?? new Set<string>();
    for (const s of factSentences(r.text ?? "")) {
      const k = norm(s);
      if (list.length >= PER_ACCOUNT || keys.has(k)) continue;
      keys.add(k);
      list.push(`"${s}" (${r.postedAt.slice(0, 10)})`);
    }
    out.set(r.threadsAccountId, list);
    seen.set(r.threadsAccountId, keys);
  }
  return out;
}

/** Peta id akun -> kalimat fakta terbaru (cache 10 menit, permintaan serentak digabung). */
export async function getAccountFacts(): Promise<Map<string, string[]>> {
  const key = scopeKey();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let job = pending.get(key);
  if (!job) {
    job = load()
      .then((value) => {
        cache.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => {
        pending.delete(key);
      });
    pending.set(key, job);
  }
  return job;
}

interface FactAccount {
  id: string;
  username: string | null;
  displayName: string;
  outletNama: string | null;
}

/** Blok teks fakta untuk prompt asisten chat (semua akun yang tampil). */
export function factsText(accounts: FactAccount[], facts: Map<string, string[]>): string {
  const lines = accounts.map((a) => {
    const who = `@${a.username ?? a.displayName}`;
    const base = a.outletNama ? `cabang/akun "${a.outletNama}"` : "belum dipetakan ke cabang";
    const f = facts.get(a.id) ?? [];
    return `- ${who}: ${base}.${f.length ? ` Fakta dari postingannya: ${f.join("; ")}` : " Tidak ada fakta lokasi/menu/harga di postingannya."}`;
  });
  return `FAKTA AKUN DARI DATABASE (satu-satunya sumber detail lokasi, menu, harga, jam buka; harga/promo lebih dari 60 hari bisa sudah berubah, jangan dipakai):\n${lines.join("\n")}`;
}
