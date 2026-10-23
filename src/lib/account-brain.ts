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

/** Batas karakter per baris blok tema di prompt. */
export const BRIEF_LINE_MAX = 1500;

/**
 * Baris tema akun untuk prompt, tanpa memotong isinya. Tema hasil onboarding/tempel sering satu baris
 * ribuan karakter; baris sepanjang itu dipecah di batas kalimat (bukan dipotong), supaya aturan di
 * akhir tema (mis. soal emoji) tetap sampai ke AI.
 */
export function briefLines(brief: string, max = BRIEF_LINE_MAX): string[] {
  const out: string[] = [];
  for (const raw of brief.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if ([...line].length <= max) {
      out.push(line);
      continue;
    }
    let cur = "";
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      // Kalimat yang sendirian sudah melebihi batas dipecah per kata.
      const parts = [...sentence].length > max ? sentence.split(/\s+/) : [sentence];
      for (const part of parts) {
        const next = cur ? `${cur} ${part}` : part;
        if ([...next].length > max && cur) {
          out.push(cur);
          cur = part;
        } else cur = next;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** Tema/pelajaran melarang emoji ("dilarang menggunakan emoji", "tanpa emoji", "jangan pakai emoji"). */
export const NO_EMOJI = /\b(?:dilarang|jangan|tanpa|tidak boleh|gak boleh|ga boleh|nggak boleh|no)\s+(?:\S+\s+){0,3}emoji/i;
/** Tema meminta emoji ("harus pake emoji", "wajib pakai emoji", "gunakan emoji kalau ..."). */
const WANT_EMOJI = /\b(?:harus|wajib|pakai|pake|gunakan|menggunakan|pakailah|kasih|tambahkan|selipkan|sertakan)\s+(?:\S+\s+){0,2}emoji/i;

/**
 * Aturan emoji yang ditulis pemilik akun di Tema: "ban" (melarang), "want" (meminta, mungkin bersyarat),
 * atau null bila tema tidak mengatur emoji. `rule` adalah kalimat aslinya, untuk dikutip ke prompt.
 */
export function themeEmojiRule(brief: string | null | undefined): { mode: "ban" | "want"; rule: string } | null {
  if (!brief || !/emoji/i.test(brief)) return null;
  const sentences = brief.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => /emoji/i.test(s));
  const ban = sentences.find((s) => NO_EMOJI.test(s));
  if (ban) return { mode: "ban", rule: ban.slice(0, 300) };
  const want = sentences.find((s) => WANT_EMOJI.test(s));
  return want ? { mode: "want", rule: want.slice(0, 300) } : null;
}

/** Blok arahan emoji saat Tema meminta emoji: menang atas PROFIL SUARA/kebiasaan lama akun yang jarang ber-emoji. */
export function wantEmojiBlock(rule: string): PromptBlock {
  return {
    title: "EMOJI (aturan dari TEMA AKUN; menang atas PROFIL SUARA, POLA LAYOUT, dan kebiasaan lama akun)",
    lines: [
      `Aturan pemilik akun: "${rule}"`,
      "Bila kondisi aturan itu terpenuhi (atau aturannya tanpa syarat), WAJIB pakai 1 emoji (paling banyak 2) yang pas dengan suasana isi, di posisi yang wajar. Jangan emoji dekorasi. Meski contoh gaya akun tanpa emoji, aturan ini tetap berlaku.",
    ],
  };
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
      lines: briefLines(brain.role),
      maxLine: BRIEF_LINE_MAX,
    });
    const emoji = themeEmojiRule(brain.role);
    if (emoji?.mode === "want") blocks.push(wantEmojiBlock(emoji.rule));
  }
  if (brain.voiceStyle && !skip.voice) blocks.push({ title: "GAYA SAPAAN (wajib)", lines: [VOICE_STYLES[brain.voiceStyle].hint] });
  if (brain.pillars.length && !skip.pillars) blocks.push({ title: "KATEGORI TOPIK AKUN", lines: [brain.pillars.join(", ")] });
  if (brain.lessons.length && !skip.lessons) {
    // Aturan emoji di Tema (ditulis sendiri pemilik akun) menang atas pelajaran emoji hasil koreksi otomatis.
    const lessons = themeEmojiRule(brain.role) ? brain.lessons.filter((l) => !/emoji/i.test(l)) : brain.lessons;
    if (lessons.length) {
      blocks.push({
        title: "PELAJARAN GAYA DARI PEMILIK AKUN (dipelajari dari koreksinya terhadap draf AI sebelumnya; WAJIB diikuti)",
        lines: lessons,
      });
    }
  }
  if (brain.facts.length && !skip.facts) {
    blocks.push({ title: "FAKTA BRAND (boleh dikutip apa adanya; jangan menambah detail di luar ini)", lines: brain.facts.slice(0, 10) });
  }
  if (brain.proven.length && !skip.proven) {
    blocks.push({ title: "POLA YANG TERBUKTI DI AKUN INI (dari hasil posting sebelumnya; pertimbangkan, jangan dipaksakan)", lines: brain.proven });
  }
  return blocks;
}
