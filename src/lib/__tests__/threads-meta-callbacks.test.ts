import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("../supabase", () => ({ db: () => ({}), rpc: vi.fn(), sqlTs: (d: Date) => d.toISOString(), forgetAccountCaches: () => {} }));
vi.mock("../publish-accounts", () => ({ forgetPublishAccounts: () => {} }));
vi.mock("../request-ctx", () => ({ forgetMembership: () => {} }));

import { newConfirmationCode, parseSignedRequest, signedRequestFromBody } from "../threads-meta-callbacks";

const SECRET = "threads_app_secret";
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** signed_request seperti yang dikirim Meta: base64url(HMAC-SHA256(payload)).payload */
function sign(payload: object, secret = SECRET): string {
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  return `${b64url(createHmac("sha256", secret).update(p).digest())}.${p}`;
}

describe("parseSignedRequest", () => {
  it("tanda tangan benar: user_id (angka atau teks) dikembalikan", () => {
    expect(parseSignedRequest(sign({ algorithm: "HMAC-SHA256", issued_at: 1, user_id: "17841405793187218" }), SECRET)?.user_id).toBe("17841405793187218");
    expect(parseSignedRequest(sign({ algorithm: "HMAC-SHA256", user_id: 218471 }), SECRET)?.user_id).toBe("218471");
  });

  it("secret lain, payload diubah, algoritma lain, atau format rusak: ditolak", () => {
    const good = sign({ algorithm: "HMAC-SHA256", user_id: "1" });
    expect(parseSignedRequest(sign({ algorithm: "HMAC-SHA256", user_id: "1" }, "lain"), SECRET)).toBeNull();
    const [sig] = good.split(".");
    expect(parseSignedRequest(`${sig}.${b64url(Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "2" })))}`, SECRET)).toBeNull();
    expect(parseSignedRequest(sign({ algorithm: "HMAC-SHA1", user_id: "1" }), SECRET)).toBeNull();
    expect(parseSignedRequest(sign({ algorithm: "HMAC-SHA256", user_id: "abc" }), SECRET)).toBeNull();
    expect(parseSignedRequest("tanpa-titik", SECRET)).toBeNull();
    expect(parseSignedRequest(good, "")).toBeNull();
    expect(parseSignedRequest(null, SECRET)).toBeNull();
  });
});

describe("signedRequestFromBody", () => {
  it("membaca form-urlencoded (bawaan Meta) dan JSON", () => {
    expect(signedRequestFromBody("signed_request=abc.def&x=1", "application/x-www-form-urlencoded")).toBe("abc.def");
    expect(signedRequestFromBody(JSON.stringify({ signed_request: "abc.def" }), "application/json")).toBe("abc.def");
    expect(signedRequestFromBody("{rusak", "application/json")).toBeNull();
  });
});

describe("newConfirmationCode", () => {
  it("alfanumerik 16 karakter dan berbeda tiap panggilan", () => {
    const a = newConfirmationCode();
    expect(a).toMatch(/^[0-9A-F]{16}$/);
    expect(newConfirmationCode()).not.toBe(a);
  });
});
