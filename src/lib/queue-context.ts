import { listPosts } from "@/lib/threads-publish";
import { formatWibFull } from "@/lib/scheduling";
import type { PostItemDTO } from "@/lib/content-types";

/**
 * Antrean posting dashboard (dibuat lewat dashboard ini) sebagai konteks AI: jadwal terdekat dan hasil
 * terbaru. Dengan ini AI tahu keadaan sebenarnya sesudah eksekusi otomatis (mis. posting yang
 * dibatalkan, gagal, atau sudah terbit), bukan hanya apa yang tampil di riwayat chat.
 */

const TTL_MS = 20_000;
const MAX_UPCOMING = 15;
const MAX_HISTORY = 10;

let cache: { at: number; text: string } | null = null;

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

export function queueText(upcoming: PostItemDTO[], history: PostItemDTO[]): string {
  const line = (p: PostItemDTO) =>
    `- @${p.account.username ?? p.account.displayName} | ${formatWibFull(new Date(p.tayangPada))} | ${p.statusLabel}${p.pesanError ? ` (${clip(p.pesanError, 80)})` : ""} | "${clip(p.text, 100)}"`;

  const parts: string[] = [];
  parts.push(
    `ANTREAN POSTING DASHBOARD (dibuat lewat dashboard ini; keadaan terkini dari database)\nTerjadwal atau mengantre (${upcoming.length}):\n${upcoming.slice(0, MAX_UPCOMING).map(line).join("\n") || "- tidak ada"}`
  );
  parts.push(`Riwayat terbaru (terbit atau gagal):\n${history.slice(0, MAX_HISTORY).map(line).join("\n") || "- belum ada"}`);
  return parts.join("\n\n");
}

/** Teks antrean untuk konteks AI; cache 20 detik. Gagal membaca tidak boleh menggagalkan chat. */
export async function getQueueContext(): Promise<string> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.text;
  const base = { accountUsername: null, status: null, cursor: null, includeAll: false } as const;
  const [upcoming, history] = await Promise.all([
    listPosts({ ...base, scope: "upcoming" }),
    listPosts({ ...base, scope: "history" }),
  ]);
  const text = queueText(upcoming.items, history.items);
  cache = { at: Date.now(), text };
  return text;
}
