/**
 * Polling cadangan untuk balas komentar otomatis.
 *
 * Jalur utama tetap webhook Threads (/api/webhooks/threads). Untuk tech provider, Meta baru mengirim webhook
 * setelah izin lolos App Review, jadi sampai saat itu komentar diambil sendiri dengan hemat:
 * - hanya postingan BotThreads 3 hari terakhir di akun yang balas komentar otomatisnya aktif (sql/044);
 * - makin tua postingannya makin jarang dicek: 5 menit (< 6 jam), 15 menit (< 24 jam), 1 jam (< 3 hari);
 * - akun yang dalam 24 jam terakhir sudah menerima komentar lewat webhook dilewati, jadi polling berhenti
 *   sendiri begitu webhook berjalan;
 * - komentar yang sudah tersimpan disaring dengan satu query, lalu sisanya disimpan lewat jalur webhook yang
 *   sama (dash_reply_webhook_ingest) sehingga aturannya identik.
 * Jadwal & tanda webhook disimpan di memori proses: setelah restart, postingan cukup dicek sekali lagi.
 */
import { db, rpc, sqlTs, toDate } from "./supabase";
import { accessTokenFor, type AccountRow } from "./threads-publisher";
import { ingestWebhook, type WebhookReply } from "./threads-replies";

const API = "https://graph.threads.net/v1.0";
const FETCH_TIMEOUT_MS = 10_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const POLL_WINDOW_MS = 72 * HOUR;
/** Akun yang menerima komentar lewat webhook dalam rentang ini tidak di-polling. */
export const WEBHOOK_QUIET_MS = 24 * HOUR;
const MAX_TARGETS = 300;
const MAX_POSTS_PER_RUN = 40;
const CONCURRENCY = 6;
const MAX_PAGES = 2;
const FIELDS = "id,text,username,timestamp,replied_to,root_post,is_reply_owned_by_me";

type Counts = Record<string, number>;
const bump = (c: Counts, k: string, n = 1) => {
  if (n) c[k] = (c[k] ?? 0) + n;
};

/** Jeda cek berikutnya untuk postingan berumur `ageMs`; null = di luar jendela polling. */
export function pollIntervalMs(ageMs: number): number | null {
  if (ageMs < 6 * HOUR) return 5 * MINUTE;
  if (ageMs < 24 * HOUR) return 15 * MINUTE;
  if (ageMs < POLL_WINDOW_MS) return HOUR;
  return null;
}

export interface PollTarget {
  mediaId: string;
  accountId: string;
  postedAt: Date;
}

/** Postingan yang waktunya dicek, paling lama terlambat dulu, dibatasi `limit`. */
export function duePolls(
  targets: PollTarget[],
  now: number,
  lastPolled: ReadonlyMap<string, number>,
  webhookSeen: ReadonlyMap<string, number>,
  limit = MAX_POSTS_PER_RUN
): PollTarget[] {
  return targets
    .map((t) => {
      const interval = pollIntervalMs(Math.max(0, now - t.postedAt.getTime()));
      if (interval === null) return null;
      const seen = webhookSeen.get(t.accountId);
      if (seen !== undefined && now - seen < WEBHOOK_QUIET_MS) return null;
      const dueAt = (lastPolled.get(t.mediaId) ?? 0) + interval;
      return dueAt <= now ? { t, late: now - dueAt } : null;
    })
    .filter((x): x is { t: PollTarget; late: number } => x !== null)
    .sort((a, b) => b.late - a.late)
    .slice(0, limit)
    .map((x) => x.t);
}

const lastPolled = new Map<string, number>();
const webhookSeen = new Map<string, number>();

/** Dipanggil route webhook: akun ini sudah menerima komentar lewat webhook, polling-nya berhenti. */
export function noteWebhookAccounts(accountIds: string[], now = Date.now()): void {
  for (const id of accountIds) webhookSeen.set(id, now);
}

interface RawReply {
  id?: string;
  text?: string;
  username?: string;
  timestamp?: string;
  replied_to?: { id?: string };
  root_post?: { id?: string };
  is_reply_owned_by_me?: boolean;
}

async function fetchConversation(mediaId: string, token: string): Promise<RawReply[]> {
  const out: RawReply[] = [];
  let url: string | null = `${API}/${mediaId}/conversation?${new URLSearchParams({ fields: FIELDS, access_token: token })}`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as { data?: RawReply[]; paging?: { next?: string }; error?: { message?: string } };
    if (!res.ok || body.error) throw new Error(body.error?.message || `Threads API error (${res.status})`);
    out.push(...(body.data ?? []));
    url = body.paging?.next ?? null;
  }
  return out;
}

/** Balasan Threads -> bentuk yang sama dengan item webhook. */
export function toWebhookReply(mediaId: string, r: RawReply): WebhookReply | null {
  if (!r.id || r.is_reply_owned_by_me) return null;
  const repliedTo = r.replied_to?.id ?? null;
  const at = r.timestamp ? new Date(r.timestamp) : null;
  return {
    mediaId: r.root_post?.id || mediaId,
    commentId: r.id,
    repliedTo: repliedTo && repliedTo !== mediaId ? repliedTo : null,
    username: (r.username ?? "").trim(),
    text: (r.text ?? "").trim(),
    commentedAt: at && !Number.isNaN(at.getTime()) ? sqlTs(at) : null,
  };
}

async function knownCommentIds(ids: string[]): Promise<Set<string>> {
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db().from("ThreadsComment").select("commentId").in("commentId", ids.slice(i, i + 100));
    if (error) throw new Error(`Supabase: ${error.message}`);
    for (const r of (data ?? []) as { commentId: string }[]) known.add(r.commentId);
  }
  return known;
}

const missingSchema = (err: unknown) => /dash_reply_poll_targets|PGRST202|42883/.test(err instanceof Error ? err.message : String(err));

/** Satu putaran polling; dipanggil penerbit sebelum runReplies. */
export async function runReplyPolling(now: Date, deadline: number, counts: Counts): Promise<void> {
  let rows: { mediaId: string; accountId: string; postedAt: string }[];
  try {
    rows = await rpc("dash_reply_poll_targets", { p_since: sqlTs(new Date(now.getTime() - POLL_WINDOW_MS)), p_limit: MAX_TARGETS });
  } catch (err) {
    if (missingSchema(err)) return bump(counts, "pollingBelumDipasang");
    throw err;
  }
  const due = duePolls(
    rows.map((r) => ({ mediaId: r.mediaId, accountId: r.accountId, postedAt: toDate(r.postedAt) })),
    now.getTime(),
    lastPolled,
    webhookSeen
  );
  // Buang jadwal postingan yang sudah keluar dari jendela supaya peta tidak tumbuh terus.
  const live = new Set(rows.map((r) => r.mediaId));
  for (const id of lastPolled.keys()) if (!live.has(id)) lastPolled.delete(id);
  if (!due.length) return;

  const accountIds = [...new Set(due.map((t) => t.accountId))];
  const { data, error } = await db()
    .from("ThreadsAccount")
    .select("id, threadsUserId, accessToken, accessExpiresAt, needsReconnect, updatedAt")
    .in("id", accountIds);
  if (error) throw new Error(`Supabase: ${error.message}`);
  const accounts = new Map(((data ?? []) as AccountRow[]).map((a) => [a.id, a]));
  const tokens = new Map<string, string | null>();

  let next = 0;
  const worker = async () => {
    while (next < due.length && Date.now() < deadline) {
      const t = due[next++];
      const account = accounts.get(t.accountId);
      if (!account) continue;
      if (!tokens.has(account.id)) tokens.set(account.id, await accessTokenFor(account, now).catch(() => null));
      const token = tokens.get(account.id);
      if (!token) continue;
      try {
        const raw = await fetchConversation(t.mediaId, token);
        lastPolled.set(t.mediaId, Date.now());
        bump(counts, "pollingPostingan");
        const items = raw.map((r) => toWebhookReply(t.mediaId, r)).filter((x): x is WebhookReply => x !== null);
        if (!items.length) continue;
        const known = await knownCommentIds(items.map((i) => i.commentId));
        const fresh = items.filter((i) => !known.has(i.commentId));
        if (fresh.length) await ingestWebhook(fresh, now, counts);
        bump(counts, "pollingKomentarBaru", fresh.length);
      } catch (err) {
        // Satu postingan gagal (dihapus, izin dicabut) tidak menghentikan yang lain; dicoba lagi sesuai jadwal.
        lastPolled.set(t.mediaId, Date.now());
        bump(counts, "pollingGagal");
        console.warn(`[reply-poll] ${t.mediaId}:`, err instanceof Error ? err.message : err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker));
}
