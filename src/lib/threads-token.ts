/**
 * Enkripsi token Threads untuk kolom "ThreadsAccount"."accessToken".
 *
 * Kolom itu dibaca worker auto-suka (penerbit posting), yang mendekripsi dengan AES-256-GCM
 * (auto-suka-shawarma/server/src/lib/crypto.ts): kunci = SHA-256(TOKEN_ENCRYPTION_KEY, atau
 * META_APP_SECRET bila kosong), format "iv.tag.data" base64. Dashboard HARUS memakai rahasia yang sama
 * dengan worker; token yang disimpan dengan kunci lain tidak bisa dipakai worker untuk memposting.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function secret(): string {
  return (process.env.TOKEN_ENCRYPTION_KEY || process.env.META_APP_SECRET || "").trim();
}

export const tokenKeyConfigured = (): boolean => secret().length > 0;

function key(): Buffer {
  const s = secret();
  if (!s) throw new Error("TOKEN_ENCRYPTION_KEY belum diisi.");
  return createHash("sha256").update(s).digest();
}

export function encryptThreadsToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, data].map((b) => b.toString("base64")).join(".");
}

/** Kebalikan `encryptThreadsToken`; melempar galat bila kunci tidak cocok. */
export function decryptThreadsToken(payload: string): string {
  const [iv, tag, data] = payload.split(".").map((part) => Buffer.from(part, "base64"));
  if (!iv || !tag || !data) throw new Error("Format token terenkripsi tidak dikenal.");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Kunci cocok dengan worker? Diuji dengan mendekripsi satu token tersimpan (hasilnya dibuang). */
export function tokenKeyMatches(sample: string): boolean {
  try {
    return decryptThreadsToken(sample).length > 0;
  } catch {
    return false;
  }
}
