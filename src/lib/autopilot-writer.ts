/**
 * Penulis slot autopilot: satu slot -> ide -> draf AI (suara akun) -> gerbang kualitas -> antrean
 * posting (mode otomatis) atau kotak tinjau (mode tinjau), plus tindakan manusia atas slot (setujui,
 * tolak, tulis ulang, lewati).
 *
 * Penulisan memakai agen per akun yang sudah ada (`runAccountAgent`) dan penerbitan tetap lewat
 * `createPosts`, jadi semua pagar lama berlaku: saklar CONTENT_PUBLISH_ENABLED, kesiapan akun,
 * validasi teks Threads, kuota harian, teks duplikat 7 hari, dan idempotensi. Kunci idempotensi
 * `autopilot:<slotId>` membuat satu slot tidak mungkin menghasilkan dua posting.
 */
import { EMPTY_BRAIN, brainBlocks } from "./account-brain";
import { learnFromEdit } from "./account-memory";
import { afterResponse } from "./after-safe";
import { anchorHint, mentionsTrend, trendAnchors } from "./trend-anchor";
import { pickAffiliate, rememberAffiliate, type AffPick } from "./affiliate-pick";
import { saveAffiliateUse, type AffiliateState } from "./affiliate-store";
import { MAX_TOTAL_ATTEMPTS, MAX_WRITE_ATTEMPTS, REVIEW_CUTOFF_MS, SLOT_LEASE_MS, SLOT_WRITE_TIMEOUT_MS } from "./autopilot-config";
import { CRITIC_UNAVAILABLE, criticize } from "./autopilot-critic";
import { runGate } from "./autopilot-gate";
import { pickIdea, type TopicUse } from "./autopilot-ideas";
import { hash32 } from "./autopilot-plan";
import { EMPTY_KNOWLEDGE, type AccountKnowledge } from "./autopilot-research";
import {
  SYSTEM_ACTOR,
  getSlot,
  updateSlot,
  type ClaimedSlot,
  type ConfigRow,
} from "./autopilot-store";
import { VOICE_STYLES, type AutopilotPillar, type SlotDraftDTO } from "./autopilot-types";
import { pickAngles, runAccountAgent, type PromptBlock, type SharedContext } from "./content-ai";
import { DASHBOARD_SOURCE, SCHEDULE_MIN_LEAD_MS } from "./content-config";
import type { PublishAccount } from "./publish-accounts";
import { updateIdea, type IdeaCandidate, type SignalBrief } from "./radar-store";
import { HOOK_FORMULAS, SIGNAL_SOURCE_LABEL } from "./radar-types";
import { formatWibLabel, wibParts } from "./scheduling";
import { charLength, normalizeForCompare } from "./threads-text";
import { createPosts, type Failure } from "./threads-publish";

/** Putaran tulis per percobaan: draf yang ditolak gerbang ditulis ulang sekali dengan catatan pemeriksa. */
const GATE_ROUNDS = 2;
/** Jeda aman di atas batas minimal jadwal; lebih dekat dari ini diterbitkan "sekarang". */
const NOW_LEAD_MS = SCHEDULE_MIN_LEAD_MS + 30_000;

export interface PeerDraft {
  aid: string;
  text: string;
}

export interface WriteContext {
  shared: SharedContext;
  accounts: Map<string, PublishAccount>;
  configs: Map<string, ConfigRow>;
  /** workspaceId -> draf autopilot hari ini (bertambah selama tick berjalan). */
  peers: Map<string, PeerDraft[]>;
  /** Kata terlarang dari env (berlaku untuk semua akun). */
  bannedTerms: string[];
  /** Topik terlarang per workspace (pengaturan workspace). */
  workspaceBanned: Map<string, string[]>;
  /** Knowledge base per akun: sumber klaim yang sah, promo berjalan, kata terlarang. */
  knowledge: Map<string, AccountKnowledge>;
  /** Ide BARU terbaik per akun (berkurang saat dipakai). */
  ideas: Map<string, IdeaCandidate[]>;
  /** Sinyal tren yang dirujuk ide-ide itu (id sinyal -> ringkasan), untuk konteks tulisan. */
  signals?: Map<string, SignalBrief>;
  /** Topik yang sudah dipakai hari ini lintas akun (pembatas topik kembar). */
  topicsToday: TopicUse[];
  /** Jalankan kritikus AI setelah gerbang deterministik. */
  critic: boolean;
  /** Pola yang terbukti berhasil per akun (dari hasil posting sebelumnya), untuk prompt. */
  proven: Map<string, string[]>;
  /** Pelajaran gaya per akun dari koreksi pemilik akun (memori gaya, account-memory.ts). */
  lessons?: Map<string, string[]>;
  /** Pengaturan, katalog, dan pemakaian Shopee Affiliate (diubah di tempat saat slot memakai produk). */
  affiliate?: AffiliateState;
  /** epoch ms: batas anggaran tick. */
  deadline: number;
  /** Benih sudut kreatif tick ini dan urutan akun, supaya akun bersebelahan mendapat sudut berbeda. */
  seed: number;
  order: Map<string, number>;
  /** Dipanggil tiap panggilan AI selesai (pemutus arus dan hitungan panggilan). */
  onAi: (ok: boolean) => void;
}

export type WriteOutcome =
  | { kind: "diantre" | "tinjau" }
  | { kind: "gagalTulis" | "dilewati" | "ditunda"; error: string };

/** Pilar konten untuk slot: undian berbobot yang deterministik per slot. */
export function pickPillar(pillars: AutopilotPillar[], slotId: string): string | null {
  const total = pillars.reduce((s, p) => s + p.bobot, 0);
  if (total <= 0) return null;
  let roll = hash32(`${slotId}|pilar`) % total;
  for (const p of pillars) {
    if (roll < p.bobot) return p.key;
    roll -= p.bobot;
  }
  return pillars[0]?.key ?? null;
}

/** Slot ini slot promo? Hanya bila porsi promo diatur DAN ada promo berjalan di knowledge base. */
export function pickPromo(
  promoRatio: number,
  promos: AccountKnowledge["promos"],
  slotId: string
): AccountKnowledge["promos"][number] | null {
  if (promoRatio <= 0 || promos.length === 0) return null;
  if (hash32(`${slotId}|promo`) / 0x1_0000_0000 >= promoRatio) return null;
  return promos[hash32(`${slotId}|promo-pilih`) % promos.length];
}

interface SlotBrief {
  /** Topik utama untuk agen (kosong = agen memilih dari gaya akun). */
  brief: string;
  idea: IdeaCandidate | null;
  promo: boolean;
  pillar: string | null;
  /** Slot affiliate: produk dan balasan berisi link. */
  affiliate?: AffPick | null;
}

/**
 * Mode aman: dipakai setelah percobaan dengan ide/tren biasa habis (paling sering ditolak karena klaim fakta
 * yang tidak didukung sumber). Tanpa ide, tren, promo, atau produk; isinya opini/pengalaman/pertanyaan yang
 * hampir pasti lolos pemeriksaan, supaya jam tayang tidak kosong.
 */
export const SAFE_BRIEF =
  "Tulis postingan ringan sesuai niche, tema, dan gaya akun ini: opini pribadi, pengalaman sehari-hari, atau pertanyaan yang mengajak ngobrol. " +
  "JANGAN menyebut angka, persentase, tanggal, harga, nama perusahaan, merek, produk, orang, atau klaim fakta apa pun di luar FAKTA BRAND.";

export const isSafeAttempt = (attempt: number): boolean => attempt > MAX_WRITE_ATTEMPTS;

/** Tentukan isi slot: promo (bila gilirannya), affiliate (bila gilirannya), ide dari bank ide, atau bebas dari gaya akun. */
export function planSlotBrief(
  slot: ClaimedSlot,
  config: ConfigRow,
  kb: AccountKnowledge,
  ctx: Pick<WriteContext, "ideas" | "topicsToday" | "affiliate">
): SlotBrief {
  const pillar = pickPillar(config.pillars, slot.id);
  if (isSafeAttempt(slot.attempt)) return { brief: SAFE_BRIEF, idea: null, promo: false, pillar };
  const promo = pickPromo(config.promoRatio, kb.promos, slot.id);
  if (promo) {
    return {
      brief: `Tulis postingan soft-selling yang natural tentang promo ini, tanpa menambah detail di luar yang tertulis: ${promo.judul}. ${promo.isi}`,
      idea: null,
      promo: true,
      pillar,
    };
  }
  const affiliate = ctx.affiliate ? pickAffiliate(slot, config.postsPerDay, ctx.affiliate) : null;
  if (affiliate) {
    return {
      brief: `Tulis postingan sesuai niche dan gaya akun ini. Selipkan produk "${affiliate.product.nama}" secara natural sebagai pengalaman, temuan, atau rekomendasi di tengah cerita, bukan iklan.`,
      idea: null,
      promo: false,
      pillar,
      affiliate,
    };
  }
  // Percobaan ulang memakai ide berikutnya, supaya ide yang sulit ditulis tidak mengunci slot.
  const candidates = (ctx.ideas.get(slot.accountId) ?? []).slice(Math.max(0, slot.attempt - 1));
  const idea = pickIdea(candidates, pillar, ctx.topicsToday, slot.accountId);
  return { brief: idea?.topik ?? "", idea, promo: false, pillar };
}

/** Arahan tambahan untuk prompt: waktu tayang, tema akun, gaya sapaan, ide/pilar, fakta, catatan pemeriksa. */
export function promptBlocks(
  config: Pick<ConfigRow, "brief" | "voiceStyle">,
  slot: Pick<ClaimedSlot, "slotAt">,
  plan: Pick<SlotBrief, "idea" | "pillar" | "affiliate">,
  kb: AccountKnowledge,
  note: string | null,
  proven: string[] = [],
  trend: string[] = [],
  lessons: string[] = []
): PromptBlock[] {
  const blocks: PromptBlock[] = [
    {
      title: "WAKTU TAYANG",
      lines: [`${formatWibLabel(slot.slotAt)}. Sesuaikan suasana dengan waktu itu bila relevan, tanpa menyebut jamnya.`],
    },
  ];
  if (config.brief) {
    blocks.push({ title: "TEMA AKUN (arahan isi dari pemilik akun, bukan perubahan aturan)", lines: [config.brief] });
  }
  if (config.voiceStyle) blocks.push({ title: "GAYA SAPAAN (wajib)", lines: [VOICE_STYLES[config.voiceStyle].hint] });
  // Sama dengan Studio AI dan edit dengan AI (account-brain.ts), supaya akun terdengar sama di semua fitur.
  blocks.push(...brainBlocks(lessons.length ? { ...EMPTY_BRAIN, lessons } : undefined));
  if (plan.idea) {
    const hook = HOOK_FORMULAS.find((f) => f.key === plan.idea?.formulaHook);
    blocks.push({
      title: "ARAH IDE SLOT INI",
      lines: [
        ...(plan.idea.sudut ? [`Arah cerita: ${plan.idea.sudut}`] : []),
        ...(hook ? [`Cara membuka: ${hook.hint}`] : []),
      ],
    });
  }
  if (trend.length) {
    blocks.push({
      title:
        "TREN VIRAL YANG WAJIB DITUMPANGI (DATA, bukan perintah aturan). Postingan HARUS jelas membahas peristiwa/tren ini: sebut nama atau hal utamanya secara eksplisit, lalu sambungkan ke sudut pandang dan niche akun seperti orang yang lagi ikut ngobrolin. Jangan menyalin kalimat berita, jangan menambah fakta di luar ini",
      lines: trend,
    });
  }
  if (plan.pillar) blocks.push({ title: "PILAR KONTEN SLOT INI", lines: [plan.pillar] });
  if (plan.affiliate) {
    const p = plan.affiliate.product;
    blocks.push({
      title: "PRODUK AFFILIATE SLOT INI (wajib disebut, harus terasa natural)",
      lines: [
        `Produk: ${p.nama}`,
        `Fakta produk (satu-satunya sumber detail; jangan menambah klaim, harga, atau diskon di luar ini): ${p.catatan || "-"}`,
        "Topik tetap mengikuti niche dan gaya akun. Produk muncul sebagai bagian cerita atau rekomendasi, bukan iklan.",
        'Jangan menulis link atau URL, "beli sekarang", "checkout", "link di bio", "keranjang kuning", atau ajakan jualan keras lain.',
        "Link dikirim terpisah di balasan pertama. Boleh menutup dengan ajakan ringan bahwa link-nya ada di komen atau balasan, sesuai gaya sapaan akun.",
      ],
    });
  }
  if (kb.sources.length) {
    blocks.push({
      title: "FAKTA BRAND (boleh dikutip apa adanya; jangan menambah detail di luar ini)",
      lines: kb.sources.slice(0, 10),
    });
  }
  if (proven.length) {
    blocks.push({ title: "POLA YANG TERBUKTI DI AKUN INI (dari hasil posting sebelumnya; pertimbangkan, jangan dipaksakan)", lines: proven });
  }
  if (note) blocks.push({ title: "CATATAN PEMERIKSA (draf sebelumnya ditolak, perbaiki)", lines: [note] });
  return blocks;
}

/** Konteks tren dari sinyal yang dirujuk ide slot (maks 3), supaya penulis paham trennya, bukan hanya judulnya. */
export function trendLines(idea: Pick<IdeaCandidate, "signalIds"> | null, signals: Map<string, SignalBrief> | undefined): string[] {
  if (!idea || !signals) return [];
  return idea.signalIds
    .map((id) => signals.get(id))
    .filter((s): s is SignalBrief => !!s && s.source !== "JARINGAN")
    .slice(0, 3)
    .map((s) => `${SIGNAL_SOURCE_LABEL[s.source]}: ${s.title}${s.summary ? ` - ${s.summary.slice(0, 260)}` : ""}`);
}

type EnqueueResult = { ok: true; postId: string; at: string } | { ok: false; error: string; fatal: boolean };

/** Masukkan draf slot ke antrean posting pada jam slot. Aman diulang (kunci idempotensi per slot). */
export async function enqueueSlot(
  slot: { id: string; accountId: string; slotAt: Date },
  draft: Pick<SlotDraftDTO, "text" | "topicTag" | "model" | "edited">,
  userId: string
): Promise<EnqueueResult> {
  const now = new Date();
  const lead = slot.slotAt.getTime() - now.getTime();
  const res = await createPosts(
    {
      userId,
      idempotencyKey: `autopilot:${slot.id}`,
      partial: true,
      // Slot sudah dipilih perencana; bentrok kuota tidak digeser ke hari lain, slotnya dilewati.
      autoReschedule: false,
      items: [
        {
          threadsAccountId: slot.accountId,
          text: draft.text,
          topicTag: draft.topicTag,
          publishAt: lead < NOW_LEAD_MS ? "now" : slot.slotAt.toISOString(),
          aiModel: draft.model.slice(0, 80),
          aiEdited: draft.edited === true,
        },
      ],
    },
    now
  );
  if (!res.ok) return { ok: false, error: res.error, fatal: res.status === 409 };
  const post = res.posts[0];
  // Ditolak aturan (kuota harian, teks duplikat, akun tidak siap): mengulang tidak akan mengubah hasil.
  if (!post) return { ok: false, error: res.skipped?.[0]?.error ?? "Tidak masuk antrean.", fatal: true };
  return { ok: true, postId: post.postId, at: post.tayangPada };
}

/** Tulis satu slot yang sudah diklaim (status MENULIS). Selalu mengakhiri slot di status yang jelas. */
export async function writeSlot(slot: ClaimedSlot, ctx: WriteContext): Promise<WriteOutcome> {
  const account = ctx.accounts.get(slot.accountId);
  const config = ctx.configs.get(slot.accountId);
  if (!account?.ready || !config) {
    const error = "Akun belum siap diposting.";
    await updateSlot(
      slot.id,
      { from: ["MENULIS"], to: "DIRENCANAKAN", patch: { lastError: error, attemptDelta: -1 } },
      new Date()
    );
    return { kind: "ditunda", error };
  }

  // Mode tinjau tanpa sisa waktu untuk ditinjau: menulis sekarang hanya membuang panggilan AI.
  if (slot.mode === "TINJAU" && slot.slotAt.getTime() - Date.now() < REVIEW_CUTOFF_MS) {
    return finish(slot, "Tidak sempat ditinjau sebelum jam tayang.", true, null);
  }

  const kb = ctx.knowledge.get(account.id) ?? EMPTY_KNOWLEDGE;
  const peers = ctx.peers.get(slot.workspaceId) ?? [];
  const others = peers.filter((p) => p.aid !== slot.accountId).map((p) => p.text);
  const bannedTerms = [...ctx.bannedTerms, ...(ctx.workspaceBanned.get(slot.workspaceId) ?? []), ...kb.banned];
  const plan = planSlotBrief(slot, config, kb, ctx);
  const aff = plan.affiliate ?? null;
  // Fakta produk affiliate ikut menjadi sumber klaim yang sah.
  const sources = [...(ctx.shared.facts.get(account.id) ?? []), ...kb.sources, ...(aff?.product.catatan ? [`${aff.product.nama}: ${aff.product.catatan}`] : [])];
  const affWorkspace = ctx.affiliate?.configs.get(slot.accountId)?.workspaceId ?? slot.workspaceId;
  // Pesan produk untuk slot ini supaya slot lain dalam tick yang sama tidak memakai produk/jatah yang sama.
  if (aff && ctx.affiliate) rememberAffiliate(ctx.affiliate, slot, affWorkspace, aff.product.id);
  const p = wibParts(slot.slotAt);
  const signal = AbortSignal.timeout(Math.max(5_000, Math.min(SLOT_WRITE_TIMEOUT_MS, ctx.deadline - Date.now())));

  let lastError = "AI tidak membalas. Dicoba lagi pada putaran berikutnya.";
  let note: string | null = null;
  let draft: SlotDraftDTO | null = null;
  let criticScore: number | null = null;
  // Draf ditolak pemeriksa (bukan AI yang diam): bila slot akhirnya dilewati, idenya ikut ditolak.
  let rejected = false;

  // Slot yang menumpang tren: draf wajib menyebut trennya (jangkar dari topik ide + judul tren).
  const trends = trendLines(plan.idea, ctx.signals);
  const trendTitles = (plan.idea?.signalIds ?? [])
    .map((id) => ctx.signals?.get(id))
    .filter((s): s is SignalBrief => !!s && s.source !== "JARINGAN")
    .map((s) => s.title);
  const anchors = plan.idea && trendTitles.length ? trendAnchors([plan.idea.topik, ...trendTitles]) : null;

  try {
    for (let round = 1; round <= GATE_ROUNDS && !signal.aborted; round++) {
      const out = await runAccountAgent(ctx.shared, {
        account,
        brief: plan.brief,
        // Slot bertren tidak diberi sudut kreatif acak (sudut itu yang membuat draf melenceng dari tren).
        // Slot lain: slot, putaran, dan percobaan berbeda memakai sudut lain supaya tidak mengulang kandidat.
        angles: anchors
          ? []
          : pickAngles(ctx.order.get(account.id) ?? 0, ctx.seed + slot.slotIndex * 3 + (round - 1) * 5 + (slot.attempt - 1) * 7),
        anchors,
        peers: others.slice(-10),
        avoid: slot.prevText,
        fixedTime: { hour: p.h, minute: p.min },
        extra: promptBlocks(
          config,
          slot,
          plan,
          kb,
          note,
          ctx.proven.get(account.id),
          trends,
          ctx.lessons?.get(account.id)
        ),
        signal,
      });
      ctx.onAi(out.ok);
      if (!out.ok) {
        lastError = out.error;
        continue;
      }
      const gate = runGate({
        text: out.draft.text,
        sources,
        peers: others,
        bannedTerms,
        ...(aff ? { affiliate: { nama: aff.product.nama } } : {}),
      });
      if (!gate.ok) {
        rejected = true;
        note = gate.reason;
        lastError = `Tidak lolos pemeriksaan: ${gate.reason}`;
        continue;
      }
      const onTrend = mentionsTrend(out.draft.text, anchors);
      if (anchors && !onTrend && round < GATE_ROUNDS) {
        note = `Draf belum menyebut tren yang ditumpangi (${anchorHint(anchors)}). Bahas peristiwanya secara eksplisit lalu kaitkan ke niche akun.`;
        lastError = "Draf belum menyambung ke tren.";
        continue;
      }
      const checks = [...gate.checks];
      if (anchors) {
        checks.push({
          key: "tren",
          label: "Menyambung tren",
          ok: onTrend,
          detail: onTrend ? `Menyebut ${anchorHint(anchors)}` : `Tidak menyebut ${anchorHint(anchors)}`,
        });
      }
      if (ctx.critic) {
        const verdict = await criticize({
          text: out.draft.text,
          handle: account.username ?? account.displayName,
          brief: config.brief,
          sources,
          signal,
        });
        ctx.onAi(verdict !== null);
        if (verdict && !verdict.ok) {
          rejected = true;
          note = [verdict.check.detail, verdict.note].filter(Boolean).join(" ");
          lastError = `Tidak lolos penilaian editor: ${verdict.check.detail}`;
          continue;
        }
        checks.push(verdict?.check ?? CRITIC_UNAVAILABLE);
        criticScore = verdict?.score ?? null;
      }
      draft = {
        text: out.draft.text,
        topicTag: out.draft.topicTag,
        angle: out.draft.angle,
        rationale: out.draft.rationale,
        model: out.draft.model,
        chars: charLength(out.draft.text),
        checks,
        ...(plan.idea ? { idea: { id: plan.idea.id, topik: plan.idea.topik }, topicKey: plan.idea.topicKey } : {}),
        ...(plan.promo ? { promo: true } : {}),
        ...(plan.pillar ? { pillar: plan.pillar } : {}),
        ...(aff ? { affiliate: { productId: aff.product.id, nama: aff.product.nama, link: aff.product.link, replyText: aff.replyText } } : {}),
      };
      break;
    }

    if (draft && aff) {
      // Antrean balasan pertama berisi link. Gagal mencatat tidak menggagalkan slot: postingan tetap
      // terbit tanpa balasan link (tidak merugikan), dan kesalahannya tercatat di log.
      await saveAffiliateUse(
        {
          slotId: slot.id,
          workspaceId: affWorkspace,
          accountId: slot.accountId,
          productId: aff.product.id,
          dayKey: slot.dayKey,
          slotAt: slot.slotAt.toISOString(),
          replyText: aff.replyText,
          delayDetik: aff.delayDetik,
        },
        new Date()
      ).catch((err) => console.error(`[autopilot] affiliate slot ${slot.id}:`, err instanceof Error ? err.message : err));
    }

    if (draft) {
      const patch = { draft, criticScore, lastError: null, ...(plan.idea ? { ideaId: plan.idea.id } : {}) };
      if (slot.mode === "TINJAU") {
        await updateSlot(slot.id, { from: ["MENULIS"], to: "MENUNGGU_TINJAU", patch }, new Date());
        await remember(ctx, slot, account.id, draft.text, plan.idea);
        return { kind: "tinjau" };
      }
      const queued = await enqueueSlot(slot, draft, SYSTEM_ACTOR);
      if (queued.ok) {
        await updateSlot(
          slot.id,
          { from: ["MENULIS"], to: "TERANTRE", patch: { ...patch, postId: queued.postId, slotAt: queued.at } },
          new Date()
        );
        await remember(ctx, slot, account.id, draft.text, plan.idea);
        return { kind: "diantre" };
      }
      lastError = queued.error;
      if (queued.fatal) return finish(slot, lastError, true, null);
    }
  } catch (err) {
    console.error(`[autopilot] slot ${slot.id}:`, err instanceof Error ? err.message : err);
    lastError = "Terjadi kesalahan saat menulis draf.";
  }
  // Slot tidak dilewati karena drafnya ditolak: kembali ke rencana dan ditulis ulang di tick berikutnya
  // (mode aman setelah MAX_WRITE_ATTEMPTS). Rekonsiliasi baru melewatinya bila jam tayangnya sudah lewat
  // lebih dari LATE_GRACE_MS. Ide yang terus ditolak pemeriksa disingkirkan supaya tidak dipilih lagi.
  return finish(slot, lastError, slot.attempt >= MAX_TOTAL_ATTEMPTS, rejected && slot.attempt >= MAX_WRITE_ATTEMPTS ? plan.idea : null);
}

/**
 * Draf yang baru jadi ikut menjadi pembanding untuk slot berikutnya (akun ini maupun akun lain), dan
 * idenya ditandai terpakai supaya tidak dipilih lagi.
 */
async function remember(
  ctx: WriteContext,
  slot: ClaimedSlot,
  accountId: string,
  text: string,
  idea: IdeaCandidate | null
): Promise<void> {
  const list = ctx.peers.get(slot.workspaceId) ?? [];
  list.push({ aid: accountId, text });
  ctx.peers.set(slot.workspaceId, list);
  ctx.shared.queues.get(accountId)?.push({ aid: accountId, at: slot.slotAt, caption: text, source: DASHBOARD_SOURCE });
  if (!idea) return;
  ctx.topicsToday.push({ aid: accountId, topicKey: idea.topicKey });
  ctx.ideas.set(accountId, (ctx.ideas.get(accountId) ?? []).filter((c) => c.id !== idea.id));
  // Kegagalan menandai ide tidak boleh menggagalkan slot yang sudah berhasil.
  await updateIdea(idea.id, { from: ["BARU"], patch: { status: "DIPAKAI", usedBySlot: slot.id } }, new Date()).catch((err) =>
    console.error("[autopilot] gagal menandai ide terpakai:", err instanceof Error ? err.message : err)
  );
}

async function finish(slot: ClaimedSlot, error: string, final: boolean, rejectedIdea: IdeaCandidate | null): Promise<WriteOutcome> {
  await updateSlot(
    slot.id,
    {
      from: ["MENULIS"],
      to: final ? "DILEWATI" : "DIRENCANAKAN",
      patch: final ? { skipReason: error, lastError: error } : { lastError: error },
    },
    new Date()
  );
  if (rejectedIdea) {
    await updateIdea(rejectedIdea.id, { from: ["BARU"], patch: { status: "DITOLAK" } }, new Date()).catch(() => undefined);
  }
  return { kind: final ? "dilewati" : "gagalTulis", error };
}

/** Lepas slot yang diklaim tetapi tidak sempat dikerjakan (anggaran tick habis); percobaan tidak dihitung. */
export const releaseSlot = (slot: ClaimedSlot, reason: string) =>
  updateSlot(
    slot.id,
    { from: ["MENULIS"], to: "DIRENCANAKAN", patch: { lastError: reason, attemptDelta: -1 } },
    new Date()
  );

/* ------------------------------------------------------------------ tindakan manusia */

export type ActionResult = { ok: true; postId?: string } | Failure;

const failure = (status: number, error: string): Failure => ({ ok: false, status, error });

const GONE = "Draf ini sudah tidak menunggu tinjauan. Muat ulang daftar.";

export interface SlotActionInput {
  slotId: string;
  /** Batasi ke workspace pengguna; null = tanpa batas (hanya untuk pemakaian internal). */
  workspaceId: string | null;
  userId: string;
}

/**
 * Setujui draf mode tinjau: masuk antrean pada jam slotnya. Teks boleh diubah dulu; teks dari manusia
 * tidak diperiksa gerbang AI (manusia yang bertanggung jawab), tetapi tetap divalidasi `createPosts`.
 */
export async function approveSlot(
  input: SlotActionInput & { text?: string; topicTag?: string | null; immediate?: boolean }
): Promise<ActionResult> {
  const slot = await getSlot(input.slotId, input.workspaceId);
  if (!slot) return failure(404, "Slot tidak ditemukan.");
  if (slot.status !== "MENUNGGU_TINJAU" || !slot.draft) return failure(409, GONE);

  const text = (input.text ?? slot.draft.text).replace(/\r\n/g, "\n").trim();
  const edited = normalizeForCompare(text) !== normalizeForCompare(slot.draft.text) || slot.draft.edited === true;
  const draft: SlotDraftDTO = {
    ...slot.draft,
    text,
    topicTag: input.topicTag !== undefined ? input.topicTag : slot.draft.topicTag,
    chars: charLength(text),
    ...(edited ? { edited: true } : {}),
  };

  // Kunci dulu supaya klik ganda atau dua peninjau tidak menghasilkan dua posting.
  const now = new Date();
  const locked = await updateSlot(
    slot.id,
    {
      workspaceId: input.workspaceId,
      from: ["MENUNGGU_TINJAU"],
      to: "MENULIS",
      patch: { leaseUntil: new Date(now.getTime() + SLOT_LEASE_MS).toISOString() },
    },
    now
  );
  if (!locked) return failure(409, GONE);

  const target = { id: slot.id, accountId: slot.accountId, slotAt: input.immediate ? now : new Date(slot.slotAt) };
  let queued: EnqueueResult;
  try {
    queued = await enqueueSlot(target, draft, input.userId);
  } catch (err) {
    await updateSlot(slot.id, { from: ["MENULIS"], to: "MENUNGGU_TINJAU" }, new Date());
    throw err;
  }
  if (!queued.ok) {
    await updateSlot(slot.id, { from: ["MENULIS"], to: "MENUNGGU_TINJAU", patch: { lastError: queued.error } }, new Date());
    return failure(queued.fatal ? 409 : 400, queued.error);
  }
  await updateSlot(
    slot.id,
    {
      from: ["MENULIS"],
      to: "TERANTRE",
      patch: {
        draft,
        postId: queued.postId,
        slotAt: queued.at,
        lastError: null,
        actor: input.userId,
        auditAction: "AUTOPILOT_SETUJUI",
      },
    },
    new Date()
  );
  // Pemilik akun mengubah draf AI sebelum menyetujui: AI belajar dari ubahannya (di latar).
  if (normalizeForCompare(text) !== normalizeForCompare(slot.draft.text)) {
    const before = slot.draft.text;
    afterResponse("memori gaya", () =>
      learnFromEdit({ accountId: slot.accountId, workspaceId: input.workspaceId, before, after: text, source: "REVIEW" })
    );
  }
  return { ok: true, postId: queued.postId };
}

/**
 * Tolak draf: jam tayangnya tetap dipakai, AI menulis draf baru dengan ide lain (percobaan bertambah, jadi
 * ide berikutnya yang dipakai; teks lama dihindari). Untuk mengosongkan jam itu, pakai "Lewati".
 */
export async function rejectSlot(input: SlotActionInput): Promise<ActionResult> {
  const done = await updateSlot(
    input.slotId,
    {
      workspaceId: input.workspaceId,
      from: ["MENUNGGU_TINJAU"],
      to: "DIRENCANAKAN",
      patch: { lastError: "Ditolak peninjau. AI menulis draf baru dengan ide lain.", actor: input.userId, auditAction: "AUTOPILOT_TOLAK" },
    },
    new Date()
  );
  return done ? { ok: true } : failure(409, GONE);
}

/** Minta AI menulis ulang: slot kembali ke rencana dan teks lama dijadikan contoh yang dihindari. */
export async function rewriteSlot(input: SlotActionInput): Promise<ActionResult> {
  const done = await updateSlot(
    input.slotId,
    {
      workspaceId: input.workspaceId,
      from: ["MENUNGGU_TINJAU"],
      to: "DIRENCANAKAN",
      patch: { attemptDelta: -1, lastError: null, actor: input.userId, auditAction: "AUTOPILOT_TULIS_ULANG" },
    },
    new Date()
  );
  return done ? { ok: true } : failure(409, GONE);
}

/** Lewati slot yang belum masuk antrean (rencana atau draf menunggu tinjauan). */
export async function skipSlot(input: SlotActionInput): Promise<ActionResult> {
  const done = await updateSlot(
    input.slotId,
    {
      workspaceId: input.workspaceId,
      from: ["DIRENCANAKAN", "MENUNGGU_TINJAU"],
      to: "DILEWATI",
      patch: { skipReason: "Dilewati pengguna.", actor: input.userId, auditAction: "AUTOPILOT_LEWATI" },
    },
    new Date()
  );
  return done ? { ok: true } : failure(409, "Slot ini sudah dikerjakan atau sudah lewat.");
}
