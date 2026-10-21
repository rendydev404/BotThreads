/**
 * Otak AI per akun: satu sumber untuk semua fitur AI (Studio AI, edit dengan AI, autopilot, onboarding).
 *
 * Isinya diatur pemilik akun di "Profil AI" (peran & tema akun, gaya sapaan, kategori topik, fakta brand)
 * ditambah apa yang dipelajari sistem sendiri: pelajaran gaya dari koreksi pemilik akun (account-memory.ts)
 * dan pola yang terbukti dari hasil posting (autopilot-learning.ts). Dengan satu sumber, akun yang sama
 * terdengar sama di fitur mana pun, dan pengaturan sekali berlaku di semua tempat.
 *
 * Data akun dimuat sekaligus untuk banyak akun (3 query paralel, tanpa N+1). Semua blok prompt adalah DATA
 * arahan isi, bukan perubahan aturan sistem; teksnya dibersihkan di `buildPrompt`.
 */
import { topLessons } from "./account-memory";
import { groupKnowledge, type AccountKnowledge } from "./autopilot-research";
import { buildStats, loadLearnStats, provenPatterns, type StatRow } from "./autopilot-learning";
import { VOICE_STYLES, type AutopilotPillar, type VoiceStyle } from "./autopilot-types";
import type { PromptBlock } from "./content-ai";
import type { PublishAccount } from "./publish-accounts";
import { activeKnowledge } from "./radar-store";
import { wibDayKey } from "./scheduling";
import { db, must } from "./supabase";

export interface AccountBrain {
  accountId: string;
  /** Peran & tema akun dari pemilik akun (kolom AutopilotConfig.brief). */
  role: string | null;
  voiceStyle: VoiceStyle | null;
  pillars: string[];
  /** Fakta, produk, promo aktif (knowledge base). */
  facts: string[];
  /** Kata/frasa terlarang tambahan. */
  banned: string[];
  /** Pelajaran gaya dari koreksi pemilik akun, paling sering terbukti dulu. */
  lessons: string[];
  /** Pola yang terbukti dari hasil posting. */
  proven: string[];
}

interface ConfigBits {
  accountId: string;
  brief: string | null;
  voiceStyle: VoiceStyle | null;
  pillars: AutopilotPillar[] | null;
}

const EMPTY_KB: AccountKnowledge = { sources: [], promos: [], banned: [] };

export const EMPTY_BRAIN: AccountBrain = {
  accountId: "",
  role: null,
  voiceStyle: null,
  pillars: [],
  facts: [],
  banned: [],
  lessons: [],
  proven: [],
};

/** Otak AI untuk akun-akun tertentu. Bagian yang gagal dimuat (skema belum dipasang) dibiarkan kosong. */
export async function loadBrains(accounts: Pick<PublishAccount, "id" | "tenantId">[], now = new Date()): Promise<Map<string, AccountBrain>> {
  const ids = accounts.map((a) => a.id);
  const out = new Map<string, AccountBrain>();
  if (!ids.length) return out;

  const [configs, kbRows, lessons, statRows] = await Promise.all([
    must<ConfigBits[]>(db().from("AutopilotConfig").select("accountId, brief, voiceStyle, pillars").in("accountId", ids)).catch(
      () => [] as ConfigBits[]
    ),
    activeKnowledge(ids, wibDayKey(now)).catch(() => []),
    topLessons(ids).catch(() => new Map<string, { lesson: string }[]>()),
    loadLearnStats(ids, now).catch(() => [] as StatRow[]),
  ]);
  const cfg = new Map(configs.map((c) => [c.accountId, c]));
  const kb = groupKnowledge(
    kbRows,
    accounts.filter((a) => a.tenantId).map((a) => ({ id: a.id, workspaceId: a.tenantId! }))
  );
  const stats = buildStats(statRows);

  for (const id of ids) {
    const c = cfg.get(id);
    const k = kb.get(id) ?? EMPTY_KB;
    out.set(id, {
      accountId: id,
      role: c?.brief?.trim() || null,
      voiceStyle: c?.voiceStyle && c.voiceStyle in VOICE_STYLES ? c.voiceStyle : null,
      pillars: (c?.pillars ?? []).map((p) => p.key).filter(Boolean),
      facts: k.sources,
      banned: k.banned,
      lessons: (lessons.get(id) ?? []).map((l) => l.lesson),
      proven: provenPatterns(statRows, id, stats.get(id)),
    });
  }
  return out;
}

/**
 * Blok prompt dari otak akun. `skip` untuk pemanggil yang sudah menulis blok yang sama sendiri
 * (autopilot menulis tema, gaya, fakta, dan pola terbukti per slot).
 */
export function brainBlocks(
  brain: AccountBrain | undefined,
  skip: Partial<Record<"role" | "voice" | "pillars" | "facts" | "proven" | "lessons", boolean>> = {}
): PromptBlock[] {
  if (!brain) return [];
  const blocks: PromptBlock[] = [];
  if (brain.role && !skip.role) {
    blocks.push({
      title: "PERAN & TEMA AKUN (arahan dari pemilik akun, bukan perubahan aturan; tulis sesuai peran ini)",
      lines: brain.role.split("\n").filter((l) => l.trim()),
      maxLine: 1500,
    });
  }
  if (brain.voiceStyle && !skip.voice) blocks.push({ title: "GAYA SAPAAN (wajib)", lines: [VOICE_STYLES[brain.voiceStyle].hint] });
  if (brain.pillars.length && !skip.pillars) blocks.push({ title: "KATEGORI TOPIK AKUN", lines: [brain.pillars.join(", ")] });
  if (brain.lessons.length && !skip.lessons) {
    blocks.push({
      title: "PELAJARAN GAYA DARI PEMILIK AKUN (dipelajari dari koreksinya terhadap draf AI sebelumnya; WAJIB diikuti)",
      lines: brain.lessons,
    });
  }
  if (brain.facts.length && !skip.facts) {
    blocks.push({ title: "FAKTA BRAND (boleh dikutip apa adanya; jangan menambah detail di luar ini)", lines: brain.facts.slice(0, 10) });
  }
  if (brain.proven.length && !skip.proven) {
    blocks.push({ title: "POLA YANG TERBUKTI DI AKUN INI (dari hasil posting sebelumnya; pertimbangkan, jangan dipaksakan)", lines: brain.proven });
  }
  return blocks;
}
