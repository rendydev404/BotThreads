/**
 * Layanan Pengerahan Buzzer Lintas-Niche untuk Konsol Super Admin (/admin/buzzer)
 * serta pengeksekusi antrean tugas buzzer pada penerbit Threads.
 */
import { randomUUID } from "node:crypto";
import { ADMIN_PAGE_SIZE } from "./admin-types";
import { VOICE_STYLES, type VoiceStyle } from "./autopilot-types";
import {
  cleanBuzzerText,
  generateBuzzerDrafts,
  generateBuzzerProfilesAI,
  inferProfileHeuristic,
} from "./buzzer-ai";
import {
  BUZZER_ACTIONS,
  type BuzzerAccountDTO,
  type BuzzerAction,
  type BuzzerCampaignDTO,
  type BuzzerCampaignListResponse,
  type BuzzerCampaignStatus,
  type BuzzerDraftItem,
  type BuzzerDraftResponse,
  type BuzzerInferredFrom,
  type BuzzerNicheRelation,
  type BuzzerOverviewResponse,
  type BuzzerPostsResponse,
  type BuzzerProfilePatch,
  type BuzzerStatsDTO,
  type BuzzerTargetAccountDTO,
  type BuzzerTargetPostDTO,
  type BuzzerTaskDTO,
  type BuzzerWorkspaceDTO,
} from "./buzzer-types";
import { db, rpc, sqlTs, toDate, utc } from "./supabase";
import { decodeCursor, encodeCursor, type Failure } from "./threads-publish";
import {
  ThreadsApiError,
  accessTokenFor,
  markReconnect,
  threads,
  type AccountRow,
} from "./threads-publisher";
import { decryptThreadsToken } from "./threads-token";

const GRAPH = "https://graph.threads.net/v1.0";
const LIVE_TIMEOUT_MS = 8_000;
const STALE_LOCK_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const CONCURRENCY = 4;
const CLAIM_BATCH = 12;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;

const failure = (status: number, error: string): Failure => ({ ok: false, status, error });
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const iso = (v: string | Date | null | undefined): string | null =>
  v ? (v instanceof Date ? v.toISOString() : utc(String(v)).toISOString()) : null;
const clean = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

const isMissingBuzzerRpc = (err: unknown): boolean =>
  err instanceof Error &&
  /PGRST202|42883|42P01/.test(err.message) &&
  /dash_(?:sa_)?buzzer_|BuzzerProfile|BuzzerCampaign|BuzzerTask/.test(err.message);

const isAccountReady = (
  acc: { aktif: boolean; needsReconnect: boolean; accessExpiresAt: string; scopes?: string[] | null },
  now: Date
): boolean =>
  acc.aktif &&
  !acc.needsReconnect &&
  toDate(acc.accessExpiresAt).getTime() > now.getTime() &&
  (acc.scopes ?? []).includes("threads_content_publish");

/* ------------------------------------------------------------------ Cadangan (bila sql/029 belum dijalankan di SQL Editor) */

interface FallbackMeta {
  aktif?: boolean;
  niche?: string;
  persona?: string;
  voiceStyle?: VoiceStyle;
  catatan?: string | null;
  inferredFrom?: BuzzerInferredFrom;
}

const fallbackCampaigns = new Map<string, BuzzerCampaignDTO>();

function parseFallbackNote(note: string | null | undefined): FallbackMeta | null {
  if (!note || !note.startsWith("{")) return null;
  try {
    const j = JSON.parse(note) as FallbackMeta;
    return isRecord(j) ? j : null;
  } catch {
    return null;
  }
}

async function loadOverviewFallback(now: Date): Promise<BuzzerOverviewResponse> {
  const [wsRes, pubRes, apRes, acsRes] = await Promise.all([
    db().from("Workspace").select("id, nama, slug"),
    rpc<
      {
        id: string;
        username: string | null;
        displayName: string;
        avatarUrl: string | null;
        needsReconnect: boolean;
        accessExpiresAt: string;
        scopes: string[];
        outletNama: string | null;
        workspaceId: string | null;
      }[]
    >("dash_publish_accounts").catch(() => []),
    rpc<{
      configs?: {
        accountId: string;
        workspaceId: string;
        brief: string | null;
        pillars: { key: string; bobot?: number }[];
        voiceStyle: string | null;
      }[];
    }>("dash_ap_state", { p_workspace: null, p_from: "2026-01-01", p_to: "2026-01-02" }).catch(() => ({ configs: [] })),
    db()
      .from("AutoCommentSetting")
      .select("threadsAccountId, workspaceId, personaName, personaStyle, lastRunNote, updatedAt"),
  ]);

  const workspacesAll = (wsRes.data ?? []) as BuzzerWorkspaceDTO[];
  const wsMap = new Map(workspacesAll.map((w) => [w.id, w]));
  const buzzerWorkspaces = workspacesAll.filter((w) => /buzzer/i.test(w.slug) || /buzzer/i.test(w.nama));
  const buzzerWsIds = new Set(buzzerWorkspaces.map((w) => w.id));

  // Ambil langsung dari ThreadsAccount supaya workspaceId selalu akurat walau akun belum dipetakan ke Outlet.
  const taRes = await db()
    .from("ThreadsAccount")
    .select("id, workspaceId, username, displayName, avatarUrl, needsReconnect, accessExpiresAt, scopes")
    .order("displayName", { ascending: true });
  const taRows = (taRes.data ?? []) as {
    id: string;
    workspaceId: string;
    username: string | null;
    displayName: string;
    avatarUrl: string | null;
    needsReconnect: boolean;
    accessExpiresAt: string;
    scopes: string[] | null;
  }[];

  const outletByAcc = new Map(pubRes.map((p) => [p.id, p.outletNama]));
  const apByAcc = new Map((apRes.configs ?? []).map((c) => [c.accountId, c]));
  const acsByAcc = new Map(
    ((acsRes.data ?? []) as {
      threadsAccountId: string;
      personaName: string;
      personaStyle: string;
      lastRunNote: string | null;
      updatedAt: string | null;
    }[]).map((a) => [a.threadsAccountId, a])
  );

  const buzzerRaw = taRows.filter((a) => buzzerWsIds.has(a.workspaceId));
  const targetRaw = taRows.filter((a) => !buzzerWsIds.has(a.workspaceId));

  // Sample postingan untuk akun buzzer (1 query).
  const buzzerIds = buzzerRaw.map((b) => b.id);
  const sampleMap = new Map<string, string[]>();
  if (buzzerIds.length > 0) {
    const psRes = await db()
      .from("ThreadsPostStat")
      .select("threadsAccountId, text, postedAt")
      .in("threadsAccountId", buzzerIds)
      .order("postedAt", { ascending: false })
      .limit(120);
    for (const r of (psRes.data ?? []) as { threadsAccountId: string; text: string }[]) {
      const text = clean(r.text, 240);
      if (text.length < 15) continue;
      const list = sampleMap.get(r.threadsAccountId) ?? [];
      if (list.length < 3) {
        list.push(text);
        sampleMap.set(r.threadsAccountId, list);
      }
    }
  }

  const buzzers: BuzzerAccountDTO[] = buzzerRaw.map((a, idx) => {
    const acs = acsByAcc.get(a.id);
    const ap = apByAcc.get(a.id);
    const meta = parseFallbackNote(acs?.lastRunNote);
    const samples = sampleMap.get(a.id) ?? [];
    const rawVoice = meta?.voiceStyle ?? (ap?.voiceStyle as VoiceStyle | undefined) ?? "aku_kamu";
    const voiceStyle: VoiceStyle = rawVoice in VOICE_STYLES ? rawVoice : "aku_kamu";
    const base: BuzzerAccountDTO = {
      accountId: a.id,
      workspaceId: a.workspaceId,
      workspaceNama: wsMap.get(a.workspaceId)?.nama ?? "Workspace Buzzer",
      username: a.username,
      displayName: a.displayName,
      avatarUrl: a.avatarUrl,
      needsReconnect: a.needsReconnect,
      accessExpiresAt: iso(a.accessExpiresAt) ?? now.toISOString(),
      scopes: a.scopes ?? [],
      outletNama: outletByAcc.get(a.id) ?? null,
      aktif: meta?.aktif ?? true,
      ready: false,
      niche: clean(meta?.niche ?? ap?.brief ?? "", 160),
      persona: clean(meta?.persona ?? acs?.personaStyle ?? "", 300),
      voiceStyle,
      catatan: meta?.catatan ?? null,
      inferredFrom: meta?.inferredFrom ?? (acs?.personaStyle ? "AUTO_COMMENT" : "HISTORI"),
      updatedAt: iso(acs?.updatedAt),
      samplePosts: samples,
      tasksToday: 0,
      tasksTotal: 0,
    };
    if (!base.niche || !base.persona) {
      const heur = inferProfileHeuristic(base, idx);
      base.niche = base.niche || heur.niche;
      base.persona = base.persona || heur.persona;
      base.voiceStyle = heur.voiceStyle;
      base.inferredFrom = heur.inferredFrom ?? "HISTORI";
    }
    base.ready = isAccountReady(base, now);
    return base;
  });

  const targets: BuzzerTargetAccountDTO[] = targetRaw.map((t) => {
    const ap = apByAcc.get(t.id);
    const wsNama = wsMap.get(t.workspaceId)?.nama ?? "Workspace";
    return {
      accountId: t.id,
      workspaceId: t.workspaceId,
      workspaceNama: wsNama,
      tenantId: ap?.workspaceId ?? t.workspaceId,
      tenantNama: wsMap.get(ap?.workspaceId ?? t.workspaceId)?.nama ?? wsNama,
      username: t.username,
      displayName: t.displayName,
      avatarUrl: t.avatarUrl,
      needsReconnect: t.needsReconnect,
      accessExpiresAt: iso(t.accessExpiresAt) ?? now.toISOString(),
      outletNama: outletByAcc.get(t.id) ?? null,
      brief: ap?.brief ?? null,
      pillars: Array.isArray(ap?.pillars) ? ap.pillars : [],
      postCount: 0,
    };
  });

  const campaigns = [...fallbackCampaigns.values()];
  const allTasks = campaigns.flatMap((c) => c.tasks);
  const stats: BuzzerStatsDTO = {
    totalBuzzers: buzzers.length,
    readyBuzzers: buzzers.filter((b) => b.ready).length,
    profiledBuzzers: buzzers.filter((b) => b.niche.trim() !== "" || b.persona.trim() !== "").length,
    totalCampaigns: campaigns.length,
    activeCampaigns: campaigns.filter((c) => c.status === "BERJALAN").length,
    queuedTasks: allTasks.filter((t) => t.status === "TERJADWAL" || t.status === "DIPROSES").length,
    doneToday: allTasks.filter((t) => t.status === "BERHASIL").length,
    doneTotal: allTasks.filter((t) => t.status === "BERHASIL").length,
  };

  return {
    success: true,
    installed: true,
    workspaces: buzzerWorkspaces,
    buzzers,
    targets,
    stats,
  };
}

/* ------------------------------------------------------------------ 1. Ringkasan & Daftar Akun Buzzer */

export async function getBuzzerOverview(adminId: string, now = new Date()): Promise<BuzzerOverviewResponse> {
  try {
    const raw = await rpc<{
      workspaces: BuzzerWorkspaceDTO[];
      buzzers: Omit<BuzzerAccountDTO, "ready">[];
      targets: BuzzerTargetAccountDTO[];
      stats: BuzzerStatsDTO;
    }>("dash_sa_buzzer_overview", { p_user: adminId, p_now: sqlTs(now) });

    const buzzers: BuzzerAccountDTO[] = (raw.buzzers ?? []).map((b, idx) => {
      const item: BuzzerAccountDTO = {
        ...b,
        accessExpiresAt: iso(b.accessExpiresAt) ?? now.toISOString(),
        updatedAt: iso(b.updatedAt),
        voiceStyle: b.voiceStyle && b.voiceStyle in VOICE_STYLES ? b.voiceStyle : "aku_kamu",
        samplePosts: Array.isArray(b.samplePosts) ? b.samplePosts : [],
        ready: false,
      };
      if (!item.niche.trim() || !item.persona.trim()) {
        const heur = inferProfileHeuristic(item, idx);
        item.niche = item.niche.trim() || heur.niche;
        item.persona = item.persona.trim() || heur.persona;
        item.voiceStyle = heur.voiceStyle;
      }
      item.ready = isAccountReady(item, now);
      return item;
    });

    const profiledBuzzers = buzzers.filter((b) => b.niche.trim() !== "" || b.persona.trim() !== "").length;
    const readyBuzzers = buzzers.filter((b) => b.ready).length;

    return {
      success: true,
      installed: true,
      workspaces: raw.workspaces ?? [],
      buzzers,
      targets: (raw.targets ?? []).map((t) => ({
        ...t,
        accessExpiresAt: iso(t.accessExpiresAt) ?? now.toISOString(),
        pillars: Array.isArray(t.pillars) ? t.pillars : [],
      })),
      stats: {
        ...raw.stats,
        totalBuzzers: buzzers.length,
        readyBuzzers,
        profiledBuzzers,
      },
    };
  } catch (err) {
    if (isMissingBuzzerRpc(err)) {
      return loadOverviewFallback(now);
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ 2. Daftar Postingan Akun Target (DB + Live Threads API) */

interface LiveThreadsPost {
  id?: string;
  media_type?: string;
  text?: string;
  permalink?: string;
  timestamp?: string;
}

async function fetchTargetLivePosts(adminId: string, accountId: string): Promise<BuzzerTargetPostDTO[]> {
  try {
    let row: {
      id: string;
      threadsUserId: string;
      accessToken: string | null;
      needsReconnect: boolean;
      accessExpiresAt: string;
    } | null = null;
    try {
      row = await rpc("dash_sa_buzzer_target_token", { p_user: adminId, p_account_id: accountId });
    } catch {
      const { data } = await db()
        .from("ThreadsAccount")
        .select("id, threadsUserId, accessToken, needsReconnect, accessExpiresAt")
        .eq("id", accountId)
        .maybeSingle();
      row = data as typeof row;
    }
    if (!row || row.needsReconnect || !row.accessToken || toDate(row.accessExpiresAt).getTime() <= Date.now()) {
      return [];
    }
    const token = decryptThreadsToken(row.accessToken);
    const params = new URLSearchParams({
      fields: "id,media_type,text,permalink,timestamp",
      limit: "20",
      access_token: token,
    });
    const res = await fetch(`${GRAPH}/${row.threadsUserId}/threads?${params}`, {
      signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json().catch(() => null)) as { data?: LiveThreadsPost[] } | null;
    return (body?.data ?? [])
      .filter((p) => p.id && p.timestamp && p.media_type !== "REPOST_FACADE" && (p.text ?? "").trim().length > 0)
      .map((p) => ({
        mediaId: String(p.id),
        mediaType: p.media_type || "TEXT_POST",
        text: clean(p.text ?? "", 600),
        permalink: p.permalink ?? null,
        postedAt: new Date(p.timestamp!).toISOString(),
        views: 0,
        likes: 0,
        replies: 0,
        reposts: 0,
        quotes: 0,
        buzzerKomen: 0,
        buzzerRepost: 0,
        buzzerQuote: 0,
        buzzerPending: 0,
      }));
  } catch {
    return [];
  }
}

export async function listBuzzerTargetPosts(
  adminId: string,
  accountId: string,
  opts: { includeLive?: boolean } = {}
): Promise<BuzzerPostsResponse | Failure> {
  if (!ID.test(accountId)) return failure(400, "Id akun target tidak valid.");

  let dbPosts: BuzzerTargetPostDTO[] = [];
  try {
    const rows = await rpc<BuzzerTargetPostDTO[]>("dash_sa_buzzer_posts", {
      p_user: adminId,
      p_account_id: accountId,
      p_limit: 25,
    });
    dbPosts = (rows ?? []).map((r) => ({
      ...r,
      postedAt: iso(r.postedAt) ?? new Date().toISOString(),
    }));
  } catch (err) {
    if (!isMissingBuzzerRpc(err)) throw err;
    const { data } = await db()
      .from("ThreadsPostStat")
      .select("mediaId, mediaType, text, permalink, postedAt, views, likes, replies, reposts, quotes")
      .eq("threadsAccountId", accountId)
      .eq("isQuote", false)
      .order("postedAt", { ascending: false })
      .limit(25);
    dbPosts = ((data ?? []) as Omit<BuzzerTargetPostDTO, "buzzerKomen" | "buzzerRepost" | "buzzerQuote" | "buzzerPending">[]).map(
      (r) => ({
        ...r,
        postedAt: iso(r.postedAt) ?? new Date().toISOString(),
        buzzerKomen: 0,
        buzzerRepost: 0,
        buzzerQuote: 0,
        buzzerPending: 0,
      })
    );
  }

  const livePosts = opts.includeLive !== false ? await fetchTargetLivePosts(adminId, accountId) : [];
  const merged = new Map<string, BuzzerTargetPostDTO>();
  for (const p of dbPosts) {
    merged.set(p.mediaId, p);
  }
  for (const lp of livePosts) {
    if (!merged.has(lp.mediaId)) {
      merged.set(lp.mediaId, lp);
    }
  }

  const items = [...merged.values()]
    .sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime())
    .slice(0, 30);

  return { success: true, items };
}

/* ------------------------------------------------------------------ 3. Simpan & Generate AI Profil Niche Buzzer */

export async function saveBuzzerProfiles(
  adminId: string,
  body: unknown,
  now = new Date()
): Promise<{ ok: true; updated: number; items: BuzzerProfilePatch[] } | Failure> {
  if (!isRecord(body)) return failure(400, "Data tidak valid.");

  let patches: BuzzerProfilePatch[] = [];

  if (body.mode === "ai_generate") {
    const overview = await getBuzzerOverview(adminId, now);
    const targetIds = Array.isArray(body.accountIds)
      ? new Set(body.accountIds.filter((x): x is string => typeof x === "string" && ID.test(x)))
      : null;
    const candidates = overview.buzzers.filter((b) => (targetIds ? targetIds.has(b.accountId) : true));
    if (candidates.length === 0) return failure(400, "Tidak ada akun buzzer yang dipilih.");
    patches = await generateBuzzerProfilesAI(candidates);
  } else {
    const rawItems = Array.isArray(body.items) ? body.items : [body];
    if (rawItems.length === 0 || rawItems.length > 100) {
      return failure(400, "Jumlah akun buzzer yang disimpan harus 1-100.");
    }
    for (const raw of rawItems) {
      if (!isRecord(raw) || typeof raw.accountId !== "string" || !ID.test(raw.accountId)) {
        return failure(400, "Id akun buzzer tidak valid.");
      }
      const niche = clean(raw.niche, 160);
      const persona = clean(raw.persona, 300);
      if (niche.length < 3) return failure(400, "Niche buzzer minimal 3 karakter.");
      if (persona.length < 5) return failure(400, "Persona buzzer minimal 5 karakter.");
      const vs = typeof raw.voiceStyle === "string" && raw.voiceStyle in VOICE_STYLES ? (raw.voiceStyle as VoiceStyle) : "aku_kamu";
      const inf: BuzzerInferredFrom =
        raw.inferredFrom === "AI" || raw.inferredFrom === "AUTO_COMMENT" || raw.inferredFrom === "HISTORI"
          ? raw.inferredFrom
          : "MANUAL";
      patches.push({
        accountId: raw.accountId,
        aktif: typeof raw.aktif === "boolean" ? raw.aktif : true,
        niche,
        persona,
        voiceStyle: vs,
        catatan: clean(raw.catatan, 300) || null,
        inferredFrom: inf,
      });
    }
  }

  try {
    const updated = await rpc<number>("dash_sa_buzzer_profile_upsert", {
      p_user: adminId,
      p_items: patches,
      p_now: sqlTs(now),
    });
    return { ok: true, updated, items: patches };
  } catch (err) {
    if (!isMissingBuzzerRpc(err)) throw err;
    // Fallback simpan ke AutoCommentSetting supaya perubahan langsung tersimpan di DB.
    const { data: taRows } = await db()
      .from("ThreadsAccount")
      .select("id, workspaceId")
      .in(
        "id",
        patches.map((p) => p.accountId)
      );
    const wsByAcc = new Map(((taRows ?? []) as { id: string; workspaceId: string }[]).map((r) => [r.id, r.workspaceId]));
    for (const p of patches) {
      const wsId = wsByAcc.get(p.accountId);
      if (!wsId) continue;
      const note = JSON.stringify({
        aktif: p.aktif,
        niche: p.niche,
        persona: p.persona,
        voiceStyle: p.voiceStyle,
        catatan: p.catatan ?? null,
        inferredFrom: p.inferredFrom ?? "MANUAL",
      });
      await db()
        .from("AutoCommentSetting")
        .upsert(
          {
            id: `bprof_${p.accountId}`.slice(0, 36),
            workspaceId: wsId,
            threadsAccountId: p.accountId,
            personaName: p.niche.slice(0, 80),
            personaStyle: p.persona.slice(0, 260),
            lastRunNote: note,
            updatedAt: now.toISOString(),
          },
          { onConflict: "threadsAccountId" }
        );
    }
    return { ok: true, updated: patches.length, items: patches };
  }
}

/* ------------------------------------------------------------------ 4. Pratinjau Draf Komentar & Quote Lintas-Niche */

export async function previewBuzzerDrafts(
  adminId: string,
  body: unknown,
  now = new Date()
): Promise<BuzzerDraftResponse | Failure> {
  if (!isRecord(body)) return failure(400, "Data permintaan tidak valid.");
  const targetUsername = clean(body.targetUsername, 80) || "threads";
  const targetDisplayName = clean(body.targetDisplayName, 120) || null;
  const targetNiche = clean(body.targetNiche, 160) || null;
  const targetText = clean(body.targetText, 1000);
  if (targetText.length < 5) return failure(400, "Isi teks postingan target minimal 5 karakter.");

  const rawActions = Array.isArray(body.actions) ? body.actions : ["KOMEN"];
  const textActions = rawActions.filter((a): a is "KOMEN" | "QUOTE" => a === "KOMEN" || a === "QUOTE");
  if (textActions.length === 0) {
    return { success: true, targetNiche: targetNiche ?? "Umum", items: [] };
  }

  const rawIds = Array.isArray(body.buzzerAccountIds) ? body.buzzerAccountIds : [];
  const accountIds = [...new Set(rawIds.filter((x): x is string => typeof x === "string" && ID.test(x)))];
  if (accountIds.length === 0 || accountIds.length > 50) {
    return failure(400, "Pilih 1-50 akun buzzer untuk membuat pratinjau.");
  }

  const overview = await getBuzzerOverview(adminId, now);
  const byId = new Map(overview.buzzers.map((b) => [b.accountId, b]));
  const selectedBuzzers = accountIds.map((id) => byId.get(id)).filter((b): b is BuzzerAccountDTO => !!b);
  if (selectedBuzzers.length === 0) return failure(404, "Akun buzzer yang dipilih tidak ditemukan.");

  const catatanAdmin = clean(body.catatanAdmin, 350) || null;
  const allItems: BuzzerDraftItem[] = [];
  let resolvedTargetNiche = targetNiche ?? "Umum";

  for (const act of textActions) {
    const res = await generateBuzzerDrafts({
      targetUsername,
      targetDisplayName,
      targetNiche: resolvedTargetNiche,
      targetText,
      catatanAdmin,
      action: act,
      buzzers: selectedBuzzers,
      existingTexts: allItems.map((i) => i.text),
    });
    resolvedTargetNiche = res.targetNiche;
    allItems.push(...res.items);
  }

  return {
    success: true,
    targetNiche: resolvedTargetNiche,
    items: allItems,
  };
}

/* ------------------------------------------------------------------ 5. Kerahkan Buzzer (Buat Kampanye + Antrean + Eksekusi Awal) */

function parseActions(raw: unknown): BuzzerAction[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((a): a is BuzzerAction => typeof a === "string" && (BUZZER_ACTIONS as string[]).includes(a)))];
}

export async function deployBuzzerCampaign(
  adminId: string,
  body: unknown,
  now = new Date()
): Promise<{ ok: true; campaignId: string; inserted: number; skipped: number; executedNow: number } | Failure> {
  if (!isRecord(body)) return failure(400, "Data pengerahan tidak valid.");

  const targetMediaId = clean(body.targetMediaId, 120);
  if (!targetMediaId || !ID.test(targetMediaId)) {
    return failure(400, "Pilih postingan target yang valid terlebih dahulu.");
  }

  const targetAccountId = typeof body.targetAccountId === "string" && ID.test(body.targetAccountId) ? body.targetAccountId : null;
  const targetUsername = clean(body.targetUsername, 80) || "threads";
  const targetDisplayName = clean(body.targetDisplayName, 120) || null;
  const targetNiche = clean(body.targetNiche, 160) || null;
  const targetText = clean(body.targetText, 1000);
  const targetPermalink = clean(body.targetPermalink, 500) || null;
  const targetPostedAt = typeof body.targetPostedAt === "string" ? iso(body.targetPostedAt) : null;
  const actions = parseActions(body.actions);
  if (actions.length === 0) return failure(400, "Pilih minimal satu aksi interaksi (Komentar, Repost, atau Quote Share).");
  if ((actions.includes("KOMEN") || actions.includes("QUOTE")) && targetText.length < 3) {
    return failure(400, "Teks postingan target diperlukan untuk menyusun komentar atau quote lintas-niche.");
  }

  const rawIds = Array.isArray(body.buzzerAccountIds) ? body.buzzerAccountIds : [];
  const accountIds = [...new Set(rawIds.filter((x): x is string => typeof x === "string" && ID.test(x)))];
  if (accountIds.length === 0 || accountIds.length > 50) {
    return failure(400, "Pilih antara 1 hingga 50 akun buzzer.");
  }

  const jedaMinDetik = Math.max(0, Math.min(3600, Math.round(Number(body.jedaMinDetik ?? 15) || 0)));
  const jedaMaxDetik = Math.max(jedaMinDetik, Math.min(7200, Math.round(Number(body.jedaMaxDetik ?? 60) || 0)));
  const catatanAdmin = clean(body.catatanAdmin, 350) || null;

  const overview = await getBuzzerOverview(adminId, now);
  const byId = new Map(overview.buzzers.map((b) => [b.accountId, b]));
  const selectedBuzzers = accountIds.map((id) => byId.get(id)).filter((b): b is BuzzerAccountDTO => !!b);
  if (selectedBuzzers.length === 0) return failure(404, "Akun buzzer yang dipilih tidak ditemukan.");

  // Kumpulkan draf kustom yang mungkin sudah disunting Super Admin di pratinjau.
  const customMap = new Map<string, { text: string; nicheRelation: BuzzerNicheRelation }>();
  if (Array.isArray(body.customDrafts)) {
    for (const d of body.customDrafts) {
      if (!isRecord(d) || typeof d.buzzerAccountId !== "string" || typeof d.action !== "string" || typeof d.text !== "string") continue;
      const cleaned = cleanBuzzerText(d.text);
      if (!cleaned) continue;
      const rel: BuzzerNicheRelation =
        d.nicheRelation === "SEJALUR" || d.nicheRelation === "JEMBATAN" || d.nicheRelation === "JAUH"
          ? d.nicheRelation
          : "JEMBATAN";
      customMap.set(`${d.buzzerAccountId}:${d.action}`, { text: cleaned, nicheRelation: rel });
    }
  }

  // Untuk KOMEN dan QUOTE yang belum punya draf kustom, buatkan otomatis lewat AI lintas-niche.
  let resolvedTargetNiche = targetNiche ?? "Umum";
  for (const act of actions) {
    if (act !== "KOMEN" && act !== "QUOTE") continue;
    const missing = selectedBuzzers.filter((b) => !customMap.has(`${b.accountId}:${act}`));
    if (missing.length > 0) {
      const gen = await generateBuzzerDrafts({
        targetUsername,
        targetDisplayName,
        targetNiche: resolvedTargetNiche,
        targetText,
        catatanAdmin,
        action: act,
        buzzers: missing,
        existingTexts: [...customMap.values()].map((v) => v.text),
      });
      resolvedTargetNiche = gen.targetNiche;
      for (const it of gen.items) {
        customMap.set(`${it.buzzerAccountId}:${act}`, { text: it.text, nicheRelation: it.nicheRelation });
      }
    }
  }

  // Susun tugas dengan jadwal bertahap (staggered) agar terlihat natural seperti netizen organik.
  interface TaskInput {
    buzzerAccountId: string;
    action: BuzzerAction;
    nicheRelation: BuzzerNicheRelation | null;
    text: string | null;
    scheduledAt: string;
  }
  const tasks: TaskInput[] = [];
  let cursorMs = now.getTime();

  selectedBuzzers.forEach((b, bIdx) => {
    actions.forEach((act, aIdx) => {
      if (bIdx > 0 || aIdx > 0) {
        const span = Math.max(0, jedaMaxDetik - jedaMinDetik);
        const stepSec = jedaMinDetik + (span > 0 ? ((bIdx * 7 + aIdx * 3) % (span + 1)) : 0);
        cursorMs += stepSec * 1000;
      }
      const draft = act === "REPOST" ? null : customMap.get(`${b.accountId}:${act}`) ?? null;
      tasks.push({
        buzzerAccountId: b.accountId,
        action: act,
        nicheRelation: draft?.nicheRelation ?? null,
        text: draft?.text ?? null,
        scheduledAt: sqlTs(new Date(cursorMs)),
      });
    });
  });

  const campaignPayload = {
    targetAccountId,
    targetUsername,
    targetDisplayName,
    targetNiche: resolvedTargetNiche,
    targetMediaId,
    targetText,
    targetPermalink,
    targetPostedAt: targetPostedAt ? sqlTs(new Date(targetPostedAt)) : null,
    actions,
    catatanAdmin,
    jedaMinDetik,
    jedaMaxDetik,
  };

  let campaignId: string;
  let inserted = tasks.length;
  let skipped = 0;

  try {
    const res = await rpc<{ campaignId: string; inserted: number; skipped: number }>("dash_sa_buzzer_campaign_create", {
      p_user: adminId,
      p_campaign: campaignPayload,
      p_tasks: tasks,
      p_now: sqlTs(now),
    });
    campaignId = res.campaignId;
    inserted = res.inserted;
    skipped = res.skipped;
  } catch (err) {
    if (err instanceof Error && /TIDAK_ADA_TUGAS_BARU/.test(err.message)) {
      return failure(409, "Semua akun buzzer yang dipilih sudah pernah melakukan aksi tersebut di postingan ini.");
    }
    if (!isMissingBuzzerRpc(err)) throw err;
    campaignId = `bc_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const taskDtos: BuzzerTaskDTO[] = tasks.map((t, i) => {
      const bz = byId.get(t.buzzerAccountId);
      return {
        id: `${campaignId}_${i + 1}`,
        buzzerAccountId: t.buzzerAccountId,
        buzzerUsername: bz?.username ?? null,
        buzzerDisplayName: bz?.displayName ?? t.buzzerAccountId,
        buzzerAvatarUrl: bz?.avatarUrl ?? null,
        buzzerNiche: bz?.niche ?? "",
        action: t.action,
        nicheRelation: t.nicheRelation,
        text: t.text,
        status: "TERJADWAL",
        attempts: 0,
        scheduledAt: utc(t.scheduledAt).toISOString(),
        executedAt: null,
        resultMediaId: null,
        resultPermalink: null,
        lastError: null,
      };
    });
    fallbackCampaigns.set(campaignId, {
      id: campaignId,
      targetAccountId,
      targetUsername,
      targetDisplayName,
      targetNiche: resolvedTargetNiche,
      targetMediaId,
      targetText,
      targetPermalink,
      targetPostedAt,
      actions,
      catatanAdmin,
      jedaMinDetik,
      jedaMaxDetik,
      totalTasks: taskDtos.length,
      doneTasks: 0,
      failedTasks: 0,
      status: "BERJALAN",
      createdBy: adminId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      tasks: taskDtos,
    });
  }

  // Eksekusi langsung tugas yang jatuh tempo sekarang (atau jeda <= 15 detik) agar tidak perlu menunggu cron menit depan.
  const execRes = await runBuzzerQueue({
    now: new Date(now.getTime() + 15_000),
    campaignId,
    deadlineMs: Date.now() + 25_000,
  });

  return {
    ok: true,
    campaignId,
    inserted,
    skipped,
    executedNow: execRes.succeeded,
  };
}

/* ------------------------------------------------------------------ 6. Riwayat Kampanye & Aksi (Batal / Coba Ulang / Proses Sekarang) */

const VALID_CAMPAIGN_STATUSES: BuzzerCampaignStatus[] = ["BERJALAN", "SELESAI", "SEBAGIAN_GAGAL", "DIBATALKAN"];

export async function listBuzzerCampaigns(
  adminId: string,
  opts: { status: string | null; cursor: string | null }
): Promise<BuzzerCampaignListResponse | Failure> {
  if (opts.status !== null && !VALID_CAMPAIGN_STATUSES.includes(opts.status as BuzzerCampaignStatus)) {
    return failure(400, "Status kampanye tidak valid.");
  }
  const cursor = decodeCursor(opts.cursor);

  try {
    const rows = await rpc<BuzzerCampaignDTO[]>("dash_sa_buzzer_campaigns", {
      p_user: adminId,
      p_status: opts.status,
      p_cursor_at: cursor ? sqlTs(cursor.at) : null,
      p_cursor_id: cursor?.id ?? null,
      p_limit: ADMIN_PAGE_SIZE,
    });
    const page = (rows ?? []).slice(0, ADMIN_PAGE_SIZE).map((c) => ({
      ...c,
      targetPostedAt: iso(c.targetPostedAt),
      createdAt: iso(c.createdAt) ?? new Date().toISOString(),
      updatedAt: iso(c.updatedAt) ?? new Date().toISOString(),
      tasks: (c.tasks ?? []).map((t) => ({
        ...t,
        scheduledAt: iso(t.scheduledAt) ?? new Date().toISOString(),
        executedAt: iso(t.executedAt),
      })),
    }));
    const last = page.at(-1);
    return {
      success: true,
      items: page,
      nextCursor: (rows ?? []).length > ADMIN_PAGE_SIZE && last ? encodeCursor(new Date(last.createdAt), last.id) : null,
    };
  } catch (err) {
    if (!isMissingBuzzerRpc(err)) throw err;
    const all = [...fallbackCampaigns.values()]
      .filter((c) => !opts.status || c.status === opts.status)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { success: true, items: all.slice(0, ADMIN_PAGE_SIZE), nextCursor: null };
  }
}

export async function actOnBuzzerCampaign(
  adminId: string,
  campaignId: string,
  body: unknown,
  now = new Date()
): Promise<{ ok: true; affected: number; executed?: number } | Failure> {
  if (!ID.test(campaignId)) return failure(400, "Id kampanye tidak valid.");
  if (!isRecord(body) || typeof body.action !== "string") return failure(400, "Tindakan tidak valid.");

  if (body.action === "RUN_NOW") {
    // Majukan jadwal tugas yang masih TERJADWAL di kampanye ini lalu jalankan antrean sekarang.
    const futureHorizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const res = await runBuzzerQueue({
      now: futureHorizon,
      campaignId,
      deadlineMs: Date.now() + 30_000,
    });
    return { ok: true, affected: res.processed, executed: res.succeeded };
  }

  if (body.action !== "CANCEL" && body.action !== "RETRY_FAILED") {
    return failure(400, "Tindakan kampanye tidak dikenal.");
  }

  try {
    const res = await rpc<{ affected: number }>("dash_sa_buzzer_campaign_action", {
      p_user: adminId,
      p_campaign_id: campaignId,
      p_action: body.action,
      p_now: sqlTs(now),
    });
    let executed = 0;
    if (body.action === "RETRY_FAILED" && res.affected > 0) {
      const q = await runBuzzerQueue({
        now: new Date(now.getTime() + 20_000),
        campaignId,
        deadlineMs: Date.now() + 20_000,
      });
      executed = q.succeeded;
    }
    return { ok: true, affected: res.affected, executed };
  } catch (err) {
    if (!isMissingBuzzerRpc(err)) throw err;
    const c = fallbackCampaigns.get(campaignId);
    if (!c) return failure(404, "Kampanye tidak ditemukan.");
    let affected = 0;
    for (const t of c.tasks) {
      if (body.action === "CANCEL" && t.status === "TERJADWAL") {
        t.status = "DIBATALKAN";
        affected++;
      } else if (body.action === "RETRY_FAILED" && t.status === "GAGAL") {
        t.status = "TERJADWAL";
        t.attempts = 0;
        t.lastError = null;
        t.scheduledAt = now.toISOString();
        affected++;
      }
    }
    return { ok: true, affected };
  }
}

/* ------------------------------------------------------------------ 7. Eksekutor Antrean Buzzer ke API Resmi Meta Threads */

interface ClaimedBuzzerTask {
  id: string;
  campaignId: string;
  buzzerAccountId: string;
  targetMediaId: string;
  action: BuzzerAction;
  nicheRelation: BuzzerNicheRelation | null;
  text: string | null;
  containerId: string | null;
  attempts: number;
  account: AccountRow | null;
}

type TaskOutcome =
  | { kind: "CONTAINER"; containerId: string }
  | { kind: "BERHASIL"; mediaId: string | null; url: string | null; containerId?: string }
  | { kind: "GAGAL"; error: string; containerId?: string }
  | { kind: "ULANG"; error?: string; containerId?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function executeSingleTask(task: ClaimedBuzzerTask, now: Date): Promise<TaskOutcome> {
  if (!task.account) {
    return { kind: "GAGAL", error: "Akun Threads buzzer tidak ditemukan." };
  }
  let token: string | null;
  try {
    token = await accessTokenFor(task.account, now);
  } catch {
    return { kind: "GAGAL", error: "Token Threads tidak bisa dibaca. Hubungkan ulang akun buzzer ini." };
  }
  if (!token) {
    return { kind: "GAGAL", error: "Sesi Threads kedaluwarsa. Hubungkan ulang akun buzzer ini." };
  }

  const userId = task.account.threadsUserId;

  try {
    // 1. Aksi REPOST langsung ke endpoint /{mediaId}/repost
    if (task.action === "REPOST") {
      const repostId = await threads.repost(task.targetMediaId, token);
      const url = await threads.permalink(repostId, token);
      return { kind: "BERHASIL", mediaId: repostId, url };
    }

    // 2. Aksi KOMEN (reply_to_id) atau QUOTE (quote_post_id)
    const text = cleanBuzzerText(task.text ?? "");
    if (!text) {
      return { kind: "GAGAL", error: "Teks komentar/quote kosong atau tidak lolos saringan." };
    }

    let containerId = task.containerId;
    if (!containerId) {
      const extra: Record<string, string> =
        task.action === "QUOTE"
          ? { quote_post_id: task.targetMediaId }
          : { reply_to_id: task.targetMediaId };
      containerId = await threads.createText(userId, token, text, extra);
    }

    for (let i = 0; i < 4; i++) {
      const st = await threads.status(containerId, token);
      if (st.status === "FINISHED") {
        const mediaId = await threads.publish(userId, token, containerId);
        const url = await threads.permalink(mediaId, token);
        return { kind: "BERHASIL", mediaId, url, containerId };
      }
      if (st.status === "PUBLISHED") {
        return { kind: "BERHASIL", mediaId: null, url: null, containerId };
      }
      if (st.status === "ERROR" || st.status === "EXPIRED") {
        return {
          kind: "GAGAL",
          error: st.error_message || `Threads menolak ${task.action.toLowerCase()} (status ${st.status}).`,
          containerId,
        };
      }
      await sleep(1500);
    }

    return task.attempts + 1 >= MAX_ATTEMPTS
      ? { kind: "GAGAL", error: "Threads terlalu lama memproses container.", containerId }
      : { kind: "CONTAINER", containerId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Gagal mengeksekusi tugas buzzer ke Threads.";
    if (err instanceof ThreadsApiError && err.isAuthError) {
      await markReconnect(task.account.id, now);
      return { kind: "GAGAL", error: "Sesi Threads dicabut atau kedaluwarsa. Hubungkan ulang akun buzzer." };
    }
    return task.attempts + 1 >= MAX_ATTEMPTS ? { kind: "GAGAL", error: msg } : { kind: "ULANG", error: msg };
  }
}

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const run = async () => {
    while (next < items.length) await worker(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

export async function runBuzzerQueue(
  opts: {
    now?: Date;
    deadlineMs?: number;
    campaignId?: string;
    counts?: Record<string, number>;
  } = {}
): Promise<{ processed: number; succeeded: number; failed: number }> {
  const now = opts.now ?? new Date();
  const deadline = opts.deadlineMs ?? Date.now() + 25_000;
  const counts = opts.counts ?? {};

  let claimed: ClaimedBuzzerTask[] = [];
  let usingFallback = false;
  try {
    claimed = await rpc<ClaimedBuzzerTask[]>("dash_buzzer_claim", {
      p_now: sqlTs(now),
      p_stale_before: sqlTs(new Date(Date.now() - STALE_LOCK_MS)),
      p_limit: CLAIM_BATCH,
      p_campaign_id: opts.campaignId ?? null,
    });
  } catch (err) {
    if (!isMissingBuzzerRpc(err)) {
      console.error("[buzzer] gagal mengklaim antrean:", err instanceof Error ? err.message : err);
      return { processed: 0, succeeded: 0, failed: 0 };
    }
    usingFallback = true;
    const due: { campaign: BuzzerCampaignDTO; task: BuzzerTaskDTO }[] = [];
    for (const c of fallbackCampaigns.values()) {
      if (opts.campaignId && c.id !== opts.campaignId) continue;
      for (const t of c.tasks) {
        if (t.status === "TERJADWAL" && new Date(t.scheduledAt).getTime() <= now.getTime()) {
          due.push({ campaign: c, task: t });
          if (due.length >= CLAIM_BATCH) break;
        }
      }
      if (due.length >= CLAIM_BATCH) break;
    }
    if (due.length > 0) {
      const accIds = [...new Set(due.map((d) => d.task.buzzerAccountId))];
      const { data: accRows } = await db()
        .from("ThreadsAccount")
        .select("id, threadsUserId, accessToken, accessExpiresAt, needsReconnect, updatedAt")
        .in("id", accIds);
      const accMap = new Map(((accRows ?? []) as AccountRow[]).map((a) => [a.id, a]));
      claimed = due.map(({ campaign, task }) => {
        task.status = "DIPROSES";
        return {
          id: task.id,
          campaignId: campaign.id,
          buzzerAccountId: task.buzzerAccountId,
          targetMediaId: campaign.targetMediaId,
          action: task.action,
          nicheRelation: task.nicheRelation,
          text: task.text,
          containerId: null,
          attempts: task.attempts,
          account: accMap.get(task.buzzerAccountId) ?? null,
        };
      });
    }
  }

  if (!claimed || claimed.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  const byAccount = new Map<string, ClaimedBuzzerTask[]>();
  for (const t of claimed) {
    const key = t.buzzerAccountId || t.id;
    byAccount.set(key, [...(byAccount.get(key) ?? []), t]);
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  await pool([...byAccount.values()], CONCURRENCY, async (accountTasks) => {
    for (const task of accountTasks) {
      if (Date.now() > deadline) {
        await rpc("dash_buzzer_result", {
          p_id: task.id,
          p_outcome: "ULANG",
          p_patch: {},
          p_now: sqlTs(new Date()),
        }).catch(() => undefined);
        continue;
      }
      const outcome = await executeSingleTask(task, new Date());
      processed++;
      if (outcome.kind === "BERHASIL") {
        succeeded++;
        counts.buzzerBerhasil = (counts.buzzerBerhasil ?? 0) + 1;
      } else if (outcome.kind === "GAGAL") {
        failed++;
        counts.buzzerGagal = (counts.buzzerGagal ?? 0) + 1;
      }
      const { kind, ...patch } = outcome;
      if (usingFallback) {
        const c = fallbackCampaigns.get(task.campaignId);
        const ft = c?.tasks.find((x) => x.id === task.id);
        if (c && ft) {
          ft.status = kind === "BERHASIL" ? "BERHASIL" : kind === "GAGAL" ? "GAGAL" : "TERJADWAL";
          if (kind === "BERHASIL") {
            ft.executedAt = new Date().toISOString();
            ft.resultMediaId = (patch as { mediaId?: string | null }).mediaId ?? null;
            ft.resultPermalink = (patch as { url?: string | null }).url ?? null;
            ft.lastError = null;
          } else if (kind === "GAGAL" || kind === "ULANG") {
            ft.attempts += 1;
            ft.lastError = (patch as { error?: string }).error ?? null;
          }
          c.doneTasks = c.tasks.filter((x) => x.status === "BERHASIL").length;
          c.failedTasks = c.tasks.filter((x) => x.status === "GAGAL").length;
          const pending = c.tasks.some((x) => x.status === "TERJADWAL" || x.status === "DIPROSES");
          c.status = pending ? "BERJALAN" : c.failedTasks === 0 ? "SELESAI" : "SEBAGIAN_GAGAL";
          c.updatedAt = new Date().toISOString();
        }
      } else {
        await rpc("dash_buzzer_result", {
          p_id: task.id,
          p_outcome: kind,
          p_patch: patch,
          p_now: sqlTs(new Date()),
        }).catch(() => undefined);
      }
    }
  });

  return { processed, succeeded, failed };
}
