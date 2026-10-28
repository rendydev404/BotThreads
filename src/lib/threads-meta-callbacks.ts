/**
 * Callback dari Meta untuk app Threads (Threads use case > Settings):
 * - Deauthorize callback URL: pengguna mencabut akses app -> token dikosongkan, akun "Perlu Hubungkan Ulang".
 * - Data Deletion Requests URL: pengguna meminta datanya dihapus -> akun dihapus seperti tombol "Hapus akun"
 *   (dash_tc_remove: token, pemetaan, konfigurasi, antrean dibatalkan; metrik ikut terhapus lewat FK cascade).
 *
 * Keduanya dikirim sebagai POST form dengan `signed_request` = base64url(HMAC-SHA256(payload, App Secret)).payload,
 * payload JSON berisi `user_id` (ID pengguna Threads untuk app ini). Database dipakai bersama worker auto-suka,
 * jadi akun yang dihubungkan lewat SukaPost ikut tertangani di sini.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { forgetPublishAccounts } from "./publish-accounts";
import { forgetMembership } from "./request-ctx";
import { db, forgetAccountCaches, rpc, sqlTs } from "./supabase";

/** Sama dengan pembersihan cache setelah hapus akun di threads-connect.ts. */
const forgetAll = () => {
  forgetAccountCaches();
  forgetPublishAccounts();
  forgetMembership();
};

export interface SignedRequestPayload {
  user_id: string;
  algorithm?: string;
  issued_at?: number;
}

const b64url = (s: string): Buffer => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Verifikasi dan buka `signed_request`. Null bila format, algoritma, atau tanda tangannya salah. */
export function parseSignedRequest(raw: string | null | undefined, appSecret: string): SignedRequestPayload | null {
  if (!raw || !appSecret || raw.length > 4096) return null;
  const [sig, payload, extra] = raw.split(".");
  if (!sig || !payload || extra !== undefined) return null;
  const expected = createHmac("sha256", appSecret).update(payload).digest();
  const given = b64url(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(b64url(payload).toString("utf8")) as Record<string, unknown>;
    if (typeof data.algorithm === "string" && data.algorithm.toUpperCase() !== "HMAC-SHA256") return null;
    const userId = typeof data.user_id === "string" || typeof data.user_id === "number" ? String(data.user_id) : "";
    if (!/^\d{1,40}$/.test(userId)) return null;
    return { user_id: userId, algorithm: data.algorithm as string | undefined, issued_at: data.issued_at as number | undefined };
  } catch {
    return null;
  }
}

/** Ambil `signed_request` dari body POST (form-urlencoded atau JSON). */
export function signedRequestFromBody(raw: string, contentType: string | null): string | null {
  if (contentType?.includes("application/json")) {
    try {
      const v = (JSON.parse(raw) as { signed_request?: unknown }).signed_request;
      return typeof v === "string" ? v : null;
    } catch {
      return null;
    }
  }
  return new URLSearchParams(raw).get("signed_request");
}

async function accountsOf(threadsUserId: string): Promise<{ id: string; workspaceId: string; username: string | null }[]> {
  const { data, error } = await db().from("ThreadsAccount").select("id, workspaceId, username").eq("threadsUserId", threadsUserId);
  if (error) throw new Error(`Supabase: ${error.message}`);
  return (data ?? []) as { id: string; workspaceId: string; username: string | null }[];
}

/** Pengguna mencabut akses app: token dikosongkan dan akun ditandai perlu dihubungkan ulang. */
export async function deauthorizeThreadsUser(threadsUserId: string, now = new Date()): Promise<number> {
  const { data, error } = await db()
    .from("ThreadsAccount")
    .update({ accessToken: "", needsReconnect: true, updatedAt: sqlTs(now) })
    .eq("threadsUserId", threadsUserId)
    .select("id");
  if (error) throw new Error(`Supabase: ${error.message}`);
  forgetAll();
  return (data ?? []).length;
}

/** Pengaturan & riwayat Auto Komentar akun (sql/045). Skema belum dipasang = tidak ada yang dihapus. */
export async function forgetAutoComments(accountId: string): Promise<void> {
  try {
    await rpc<number>("dash_acmt_forget_account", { p_account: accountId });
  } catch (err) {
    if (!/dash_acmt_forget_account|PGRST202|42883/.test(err instanceof Error ? err.message : String(err))) throw err;
  }
}

/** Kode konfirmasi alfanumerik untuk halaman status penghapusan. */
export const newConfirmationCode = (): string => randomBytes(8).toString("hex").toUpperCase();

/** Pengguna meminta penghapusan data: semua akun Threads dengan ID itu dihapus dari dashboard. */
export async function deleteThreadsUserData(threadsUserId: string, now = new Date()): Promise<number> {
  let removed = 0;
  for (const a of await accountsOf(threadsUserId)) {
    const res = await rpc<{ status: string }>("dash_tc_remove", {
      p_workspace: a.workspaceId,
      p_account: a.id,
      p_user: "system:meta-data-deletion",
      p_now: sqlTs(now),
    });
    if (res.status === "OK") removed++;
    await forgetAutoComments(a.id);
  }
  forgetAll();
  return removed;
}
