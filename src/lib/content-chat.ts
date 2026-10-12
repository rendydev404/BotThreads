/**
 * Jalur draf konten di chat AI (FR-3). Memakai logika FR-2 langsung (fungsi lib, bukan HTTP internal).
 * Pesan pendamping disusun deterministik di server (tanpa panggilan AI kedua) dan tidak ada eksekusi
 * otomatis: pengguna selalu menekan tombol di kartu draf.
 */
import { MAX_RECOMMEND_ACCOUNTS } from "./content-config";
import { findMentionedAccounts, type DraftIntent } from "./content-intent";
import { recommendDrafts, topAccountsByRecentViews } from "./content-ai";
import { MAX_BRIEF_CHARS } from "./content-validation";
import type { ContentDraft } from "./content-types";
import { listPublishAccounts, reasonText, type PublishAccount } from "./publish-accounts";
import { wibAt, wibDayKey } from "./scheduling";

export interface LastDraft {
  threadsAccountId: string;
  text: string;
}

/** Validasi `lastDrafts` dari klien: maksimal 5 butir, teks maksimal 600 karakter. */
export function parseLastDrafts(raw: unknown): LastDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: LastDraft[] = [];
  for (const item of raw.slice(0, 5)) {
    if (typeof item !== "object" || item === null) continue;
    const { threadsAccountId, text } = item as Record<string, unknown>;
    if (typeof threadsAccountId !== "string" || !threadsAccountId || threadsAccountId.length > 100) continue;
    if (typeof text !== "string" || !text.trim()) continue;
    out.push({ threadsAccountId, text: text.slice(0, 600) });
  }
  return out;
}

export interface DraftChatResult {
  message: string;
  drafts: ContentDraft[];
  degraded: boolean;
  model: string | null;
  latencyMs: number;
}

const handle = (a: { username: string | null; displayName: string }) => `@${a.username ?? a.displayName}`;

const empty = (message: string, started: number): DraftChatResult => ({
  message,
  drafts: [],
  degraded: false,
  model: null,
  latencyMs: Date.now() - started,
});

export async function handleDraftChat(opts: {
  text: string;
  /** "all" atau username dari filter chat */
  accountFilter: string | null;
  lastDrafts: LastDraft[];
  intent: DraftIntent;
  now?: Date;
}): Promise<DraftChatResult> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const { intent } = opts;

  const all = await listPublishAccounts();
  const byId = new Map(all.map((a) => [a.id, a]));
  const ready = all.filter((a) => a.ready);
  if (ready.length === 0) {
    return empty(
      "Belum ada akun yang siap diposting. Pastikan akun cabang sudah dipetakan dan terhubung di SukaPost.",
      started
    );
  }

  let targets: PublishAccount[] = [];
  let revise: Map<string, string> | undefined;
  let perAccount = 1;
  let totalWanted = intent.count;
  let autoPicked = false;

  if (intent.revise && opts.lastDrafts.length > 0) {
    let picked = opts.lastDrafts;
    if (intent.reviseIndex !== null) {
      const one = opts.lastDrafts[intent.reviseIndex - 1];
      if (!one) return empty(`Draf nomor ${intent.reviseIndex} tidak ada. Pilih nomor 1 sampai ${opts.lastDrafts.length}.`, started);
      picked = [one];
    }
    revise = new Map();
    for (const d of picked) {
      const acc = byId.get(d.threadsAccountId);
      if (acc?.ready && !revise.has(acc.id)) {
        revise.set(acc.id, d.text);
        targets.push(acc);
      }
    }
    if (targets.length === 0) {
      return empty("Akun untuk draf tersebut sudah tidak siap diposting, jadi belum bisa direvisi.", started);
    }
    totalWanted = targets.length;
  } else {
    const mentioned = findMentionedAccounts(opts.text, all);
    const notReady = mentioned.filter((a) => !a.ready);
    targets = mentioned.filter((a) => a.ready).slice(0, MAX_RECOMMEND_ACCOUNTS);

    if (targets.length === 0 && notReady.length > 0) {
      const a = notReady[0];
      return empty(`${handle(a)} belum siap diposting: ${reasonText(a.reason) || "belum dipetakan ke cabang"}.`, started);
    }
    if (targets.length === 0 && opts.accountFilter && opts.accountFilter !== "all") {
      const f = opts.accountFilter.toLowerCase();
      const acc = all.find((a) => a.username?.toLowerCase() === f);
      if (acc && !acc.ready) {
        return empty(`${handle(acc)} belum siap diposting: ${reasonText(acc.reason) || "belum dipetakan ke cabang"}.`, started);
      }
      if (acc) targets = [acc];
    }
    if (targets.length === 0) {
      // Tanpa akun disebut dan filter "semua akun": pilih 3 akun dengan views 14 hari terbaik.
      const topIds = await topAccountsByRecentViews(ready.map((a) => a.id), 3, now);
      targets = topIds.map((id) => byId.get(id)).filter((a): a is PublishAccount => !!a);
      autoPicked = true;
    }
    perAccount = Math.max(1, Math.ceil(intent.count / targets.length));
  }

  const dayKey = intent.dayOffset !== null ? wibDayKey(wibAt(now, intent.dayOffset, 12)) : null;
  const result = await recommendDrafts(
    {
      accounts: targets,
      brief: opts.text.slice(0, MAX_BRIEF_CHARS),
      count: perAccount,
      dayKey,
      avoid: null,
      ...(revise ? { revise } : {}),
      forceHour: intent.hourWib,
    },
    now
  );

  const drafts = result.drafts.slice(0, Math.max(totalWanted, revise ? targets.length : 1));
  if (drafts.length === 0) {
    return {
      message: result.degraded
        ? "AI sedang tidak tersedia, jadi draf belum bisa dibuat. Coba lagi sebentar lagi."
        : "AI belum menghasilkan draf yang layak (terlalu mirip postingan sebelumnya). Coba lagi atau beri arahan topik yang berbeda.",
      drafts: [],
      degraded: result.degraded,
      model: result.model,
      latencyMs: result.latencyMs,
    };
  }

  const names = [...new Set(drafts.map((d) => d.threadsAccountId))].map((id) => handle(byId.get(id) ?? { username: null, displayName: "akun" }));
  const lines: string[] = [];
  lines.push(
    revise
      ? `Ini draf yang sudah direvisi untuk ${names.join(", ")}.`
      : `Ini ${drafts.length} draf untuk ${names.join(", ")}${autoPicked ? ", saya pilih dari akun dengan views 14 hari terakhir tertinggi" : ""}.`
  );
  lines.push("Jam tayang disarankan dari data performa akun. Edit teksnya bila perlu, lalu pilih **Posting sekarang** atau **Jadwalkan**. Tidak ada yang terkirim sebelum Anda menekan tombolnya.");
  if (result.failedAccountIds.length > 0) {
    const failed = result.failedAccountIds.map((id) => handle(byId.get(id) ?? { username: null, displayName: "akun" }));
    lines.push(`Draf untuk ${failed.join(", ")} belum berhasil dibuat; coba lagi.`);
  }
  return {
    message: lines.join("\n\n"),
    drafts,
    degraded: false,
    model: result.model,
    latencyMs: result.latencyMs,
  };
}
