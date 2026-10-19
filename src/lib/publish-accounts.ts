/**
 * Akun Threads yang bisa diposting dari dashboard (FR-1).
 *
 * Satu RPC dengan join (ThreadsAccount -> SocialAccount -> Outlet) tanpa N+1, di-cache 60 detik.
 * Dashboard TIDAK memegang token Threads: kolom accessToken tidak pernah dibaca. Penerbitan
 * dikerjakan worker auto-suka; di sini hanya menilai kesiapan akun.
 *
 * Kuota akun paket ikut dinilai di sini (kolom overQuota dari sql/026): akun di atas kuota paket yang berlaku
 * sekarang dianggap belum siap, sehingga posting manual ditolak dan Autopilot dijeda lalu lanjut sendiri saat
 * kuota cukup lagi. Perubahan paket berlaku paling lambat satu masa cache (60 detik).
 */
import { accountScope, rpc, tenantIdOf, utc } from "@/lib/supabase";
import { currentScope } from "@/lib/tenant-scope";
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
  /** Di atas kuota akun paket tenantnya (sql/026; sebelum dipasang kolom ini tidak ada). */
  overQuota?: boolean;
}

/** Akun beserta kunci relasi yang dibutuhkan saat membuat antrean. */
export interface PublishAccount extends PublishAccountDTO {
  socialAccountId: string | null;
  outletId: string | null;
  /** Workspace auto-suka pemilik cabang akun ini (dipakai saat menulis ke antrean posting). */
  workspaceId: string | null;
  /** Tenant dashboard (kelompok workspace); kunci pengaturan, peran, dan lingkup di dashboard. */
  tenantId: string | null;
}

export const reasonText = (reason: PublishReason | undefined): string =>
  reason ? REASON_LABEL[reason] : "";

let cache: { at: number; value: PublishAccount[] } | null = null;
let pending: Promise<PublishAccount[]> | null = null;

async function load(): Promise<PublishAccount[]> {
  const rows = await rpc<AccountRow[]>("dash_publish_accounts");

  const now = new Date();
  const allow = publishTestAccounts();
  const tenants = new Map<string, string | null>();
  for (const w of new Set(rows.map((r) => r.workspaceId))) if (w) tenants.set(w, await tenantIdOf(w));
  return withoutExcluded(rows).map((r) => {
    const reason = evaluateReadiness({ ...r, accessExpiresAt: utc(r.accessExpiresAt) }, now, allow) ?? (r.overQuota ? "DI_LUAR_KUOTA" : undefined);
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
      tenantId: r.workspaceId ? tenants.get(r.workspaceId) ?? r.workspaceId : null,
    };
  });
}

/** Buang cache daftar akun (setelah tautan sumber akun berubah). */
export function forgetPublishAccounts(): void {
  cache = null;
}

async function loadAll(): Promise<PublishAccount[]> {
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

/**
 * Akun Threads beserta status kesiapan (cache 60 detik, permintaan serentak digabung). Bila permintaan
 * dibatasi lingkup tenant, hanya akun dalam lingkup itu yang dikembalikan; daftar lengkapnya tetap
 * di-cache sekali untuk semua.
 */
export async function listPublishAccounts(): Promise<PublishAccount[]> {
  const all = await loadAll();
  if (!currentScope()) return all;
  const visible = new Set((await accountScope()).visibleIds);
  return all.filter((a) => visible.has(a.id));
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
