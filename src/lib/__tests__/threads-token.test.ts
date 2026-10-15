/**
 * Token Threads yang disimpan dashboard harus bisa dibaca worker auto-suka (dan sebaliknya):
 * AES-256-GCM, kunci SHA-256 dari TOKEN_ENCRYPTION_KEY (atau META_APP_SECRET), format "iv.tag.data".
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { decryptThreadsToken, encryptThreadsToken, tokenKeyConfigured, tokenKeyMatches } from "../threads-token";

// Salinan persis lib/crypto.ts milik worker auto-suka (kunci dari TOKEN_ENCRYPTION_KEY || META_APP_SECRET).
const workerKey = () => createHash("sha256").update(process.env.TOKEN_ENCRYPTION_KEY || process.env.META_APP_SECRET || "").digest();
function workerEncrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", workerKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}
function workerDecrypt(payload: string): string {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", workerKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

afterEach(() => {
  delete process.env.TOKEN_ENCRYPTION_KEY;
  delete process.env.META_APP_SECRET;
});

describe("enkripsi token Threads", () => {
  it("tanpa kunci: belum siap dan menolak mengenkripsi", () => {
    expect(tokenKeyConfigured()).toBe(false);
    expect(() => encryptThreadsToken("THAA")).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("dua arah kompatibel dengan worker, termasuk cadangan META_APP_SECRET", () => {
    for (const env of [{ TOKEN_ENCRYPTION_KEY: "kunci-bersama" }, { META_APP_SECRET: "rahasia-meta" }]) {
      Object.assign(process.env, env);
      const mine = encryptThreadsToken("THAAtoken-asli");
      expect(mine.split(".")).toHaveLength(3);
      expect(mine).not.toContain("THAAtoken-asli");
      expect(workerDecrypt(mine)).toBe("THAAtoken-asli");
      expect(decryptThreadsToken(workerEncrypt("THAAdari-worker"))).toBe("THAAdari-worker");
      delete process.env.TOKEN_ENCRYPTION_KEY;
      delete process.env.META_APP_SECRET;
    }
  });

  it("kunci yang berbeda dari worker terdeteksi", () => {
    process.env.TOKEN_ENCRYPTION_KEY = "kunci-worker";
    const stored = workerEncrypt("THAAtoken");
    expect(tokenKeyMatches(stored)).toBe(true);
    process.env.TOKEN_ENCRYPTION_KEY = "kunci-lain";
    expect(tokenKeyMatches(stored)).toBe(false);
    expect(tokenKeyMatches("bukan-format")).toBe(false);
  });
});
