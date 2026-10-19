/**
 * Hubungkan akun Threads dari HP: callback OAuth sah walau datang tanpa cookie sesi (halaman izin terbuka di
 * aplikasi Threads atau browser lain), karena identitas dibawa `state` bertanda tangan. State palsu, kedaluwarsa,
 * atau milik pengguna lain ditolak.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: null as null | { userId: string; workspaceId: string; role: string; accountIds: null },
  member: { workspaceId: "ws1", role: "ADMIN", accountIds: null } as { workspaceId: string; role: string; accountIds: null },
  active: true,
  connect: vi.fn(),
}));

vi.mock("@/lib/integrations", () => ({
  getRawIntegrations: async () => ({ googleOauth: { appUrl: "https://bottrit.com" }, threadsOauth: { enabled: true, appId: "a", appSecret: "s" } }),
}));
vi.mock("@/lib/users", () => ({ isUserActive: async () => h.active }));
vi.mock("@/lib/request-ctx", async (original) => ({
  ...(await original<typeof import("@/lib/request-ctx")>()),
  getCtx: async () => h.session,
  ctxForUser: async (userId: string) => ({ userId, ...h.member }),
}));
vi.mock("@/lib/threads-connect", async (original) => ({
  ...(await original<typeof import("@/lib/threads-connect")>()),
  exchangeThreadsOAuthCode: async () => ({ accessToken: "tok", expiresInSeconds: 100 }),
  connectThreadsAccount: (...args: unknown[]) => h.connect(...args),
}));

import { NextRequest } from "next/server";
import { signThreadsOAuthState, verifyThreadsOAuthState } from "../threads-connect";
import { GET as callback } from "@/app/api/threads/oauth/callback/route";

beforeAll(() => {
  process.env.AUTH_SECRET = "uji-rahasia-yang-panjangnya-lebih-dari-32-karakter";
});

beforeEach(() => {
  h.session = null;
  h.member = { workspaceId: "ws1", role: "ADMIN", accountIds: null };
  h.active = true;
  h.connect.mockReset();
  h.connect.mockResolvedValue({ ok: true, account: { username: "sinta" } });
});

const call = (state: string, extra = "") =>
  callback(new NextRequest(`https://bottrit.com/api/threads/oauth/callback?code=kode%23_&state=${encodeURIComponent(state)}${extra}`));
const location = (res: Response) => decodeURIComponent(res.headers.get("location") ?? "");

describe("state OAuth Threads", () => {
  it("bolak-balik dengan pengguna dan workspace; ditolak bila diubah, kedaluwarsa, atau rusak", () => {
    const s = signThreadsOAuthState({ userId: "u1", workspaceId: "ws1" }, 1_000);
    expect(verifyThreadsOAuthState(s, 2_000)).toEqual({ userId: "u1", workspaceId: "ws1" });
    expect(verifyThreadsOAuthState(s, 1_000 + 16 * 60_000)).toBeNull();

    const [payload, sig] = s.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "penyerang", w: "ws1", e: 9e15, n: "x" })).toString("base64url");
    expect(verifyThreadsOAuthState(`${forged}.${sig}`, 2_000)).toBeNull();
    expect(verifyThreadsOAuthState(`${payload}.${sig}x`, 2_000)).toBeNull();
    expect(verifyThreadsOAuthState("acak", 2_000)).toBeNull();
    expect(verifyThreadsOAuthState(null, 2_000)).toBeNull();
  });
});

describe("callback OAuth Threads", () => {
  it("tanpa sesi (browser lain di HP): akun tersimpan ke workspace dari state, lalu ke halaman hasil publik", async () => {
    const res = await call(signThreadsOAuthState({ userId: "u1", workspaceId: "ws1" }));
    expect(h.connect).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "ws1", userId: "u1", accessToken: "tok" }));
    expect(location(res)).toBe("https://bottrit.com/threads-terhubung?threads_connected=sinta");
  });

  it("dengan sesi pengguna yang sama: kembali ke Pengaturan", async () => {
    h.session = { userId: "u1", workspaceId: "ws1", role: "OWNER", accountIds: null };
    const res = await call(signThreadsOAuthState({ userId: "u1", workspaceId: "ws1" }));
    expect(location(res)).toBe("https://bottrit.com/pengaturan?tab=akun&threads_connected=sinta");
  });

  it("menolak state palsu, sesi pengguna lain, workspace berubah, peran kurang, dan akun nonaktif", async () => {
    expect(location(await call("palsu.ttd"))).toContain("threads_error=Sesi login Threads kedaluwarsa");

    h.session = { userId: "u2", workspaceId: "ws1", role: "OWNER", accountIds: null };
    expect(location(await call(signThreadsOAuthState({ userId: "u1", workspaceId: "ws1" })))).toContain("pengguna lain");
    h.session = null;

    h.member = { workspaceId: "ws-lain", role: "ADMIN", accountIds: null };
    expect(location(await call(signThreadsOAuthState({ userId: "u1", workspaceId: "ws1" })))).toContain("Workspace aktif berubah");

    h.member = { workspaceId: "ws1", role: "EDITOR", accountIds: null };
    expect(location(await call(signThreadsOAuthState({ userId: "u1", workspaceId: "ws1" })))).toContain("Pemilik atau Admin");

    h.member = { workspaceId: "ws1", role: "ADMIN", accountIds: null };
    h.active = false;
    expect(location(await call(signThreadsOAuthState({ userId: "u1", workspaceId: "ws1" })))).toContain("tidak aktif");
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("izin ditolak di Threads: jelaskan soal undangan Threads Tester", async () => {
    const res = await call(signThreadsOAuthState({ userId: "u1", workspaceId: "ws1" }), "&error=access_denied");
    expect(location(res)).toContain("Threads Tester");
  });
});
