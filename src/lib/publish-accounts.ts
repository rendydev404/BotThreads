/**
 * Akun Threads yang bisa diposting dari dashboard (FR-1).
 *
 * Satu RPC dengan join (ThreadsAccount -> SocialAccount -> Outlet) tanpa N+1, di-cache 60 detik.
 * Dashboard TIDAK memegang token Threads: kolom accessToken tidak pernah dibaca. Penerbitan
 * dikerjakan worker auto-suka; di sini hanya menilai kesiapan akun.
 */
import { rpc, utc } from "@/lib/supabase";
import { withoutExcluded } from "./account-visibility";
import { publishTestAccounts } from "./content-config";
import { REASON_LABEL, type PublishAccountDTO, type PublishReason } from "./content-types";
import { evaluateReadiness } from "./readiness";

const TTL_MS = 60_000;

interface AccountRow {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  needsReconnect: boolean;
  accessExpiresAt: string;
  scopes: string[];
  socialAccountId: string | null;
  outletId: string | null;
  outletNama: string | null;
  outletActive: boolean | null;
  workspaceId: string | null;
}

/** Akun beserta kunci relasi yang dibutuhkan saat membuat antrean. */
export interface PublishAccount extends PublishAccountDTO {
  socialAccountId: string | null;
  outletId: string | null;
  workspaceId: string | null;
}

export const reasonText = (reason: PublishReason | undefined): string =>
  reason ? REASON_LABEL[reason] : "";

let cache: { at: number; value: PublishAccount[] } | null = null;
let pending: Promise<PublishAccount[]> | null = null;

async function load(): Promise<PublishAccount[]> {
  const rows = await rpc<AccountRow[]>("dash_publish_accounts");

  const now = new Date();
  const allow = publishTestAccounts();
  return withoutExcluded(rows).map((r) => {
    const reason = evaluateReadiness({ ...r, accessExpiresAt: utc(r.accessExpiresAt) }, now, allow);
    return {
      id: r.id,
      username: r.username,
      displayName: r.displayName,
      avatarUrl: r.avatarUrl,
      outletNama: r.outletNama,
      ready: !reason,
      ...(reason ? { reason } : {}),
      socialAccountId: r.socialAccountId,
      outletId: r.outletId,
      workspaceId: r.workspaceId,
    };
  });
}

/** Semua akun Threads beserta status kesiapan (cache 60 detik, permintaan serentak digabung). */
export async function listPublishAccounts(): Promise<PublishAccount[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  pending ??= load()
    .then((value) => {
      cache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Peta id -> akun untuk id yang diminta (yang tidak ada dilewati). */
export async function getPublishAccountMap(ids: string[]): Promise<Map<string, PublishAccount>> {
  const all = await listPublishAccounts();
  const wanted = new Set(ids);
  return new Map(all.filter((a) => wanted.has(a.id)).map((a) => [a.id, a]));
}

/** Bentuk untuk respons API: tanpa kunci relasi internal. */
export const toAccountDTO = (a: PublishAccount): PublishAccountDTO => ({
  id: a.id,
  username: a.username,
  displayName: a.displayName,
  avatarUrl: a.avatarUrl,
  outletNama: a.outletNama,
  ready: a.ready,
  ...(a.reason ? { reason: a.reason } : {}),
});
