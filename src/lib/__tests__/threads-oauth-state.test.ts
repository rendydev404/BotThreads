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
  // withCtx memanggil getCtx dari dalam modulnya sendiri (tidak kena mock di atas): pakai sesi tiruan langsung.
  withCtx:
    (_min: string, handler: (req: unknown, ctx: unknown) => unknown) =>
    (req: unknown) =>
      handler(req, h.session),
}));
vi.mock("@/lib/threads-connect", async (original) => ({
  ...(await original<typeof import("@/lib/threads-connect")>()),
  exchangeThreadsOAuthCode: async () => ({ accessToken: "tok", expiresInSeconds: 100 }),
  connectThreadsAccount: (...args: unknown[]) => h.connect(...args),
  listWorkspaceThreadsAccounts: async () => ({ accounts: [], quota: { used: 0, max: 5, planNama: "Pro", expired: false } }),
}));
vi.mock("@/lib/threads-token", async (original) => ({
  ...(await original<typeof import("@/lib/threads-token")>()),
  tokenKeyConfigured: () => true,
}));

import { NextRequest } from "next/server";
import { signThreadsOAuthState, verifyThreadsOAuthState } from "../threads-connect";
import { GET as callback } from "@/app/api/threads/oauth/callback/route";
import { GET as start } from "@/app/api/threads/oauth/route";

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

describe("mulai OAuth Threads", () => {
  it("halaman izin memakai www.threads.com/oauth/authorize/ (dikecualikan dari universal link, jadi di HP tetap di browser)", async () => {
    h.session = { userId: "u1", workspaceId: "ws1", role: "OWNER", accountIds: null };
    for (const url of ["https://bottrit.com/api/threads/oauth", "https://bottrit.com/api/threads/oauth?format=link"]) {
      const res = await start(new NextRequest(url));
      const target = new URL(res.headers.get("location") ?? ((await res.json()) as { url: string }).url);
      expect(`${target.origin}${target.pathname}`).toBe("https://www.threads.com/oauth/authorize/");
      expect(target.searchParams.get("redirect_uri")).toBe("https://bottrit.com/api/threads/oauth/callback");
    }
  });

  it("Android: dibuka lewat intent ke Chrome (bukan aplikasi Threads), dengan cadangan URL https; iPhone tetap https", async () => {
    h.session = { userId: "u1", workspaceId: "ws1", role: "OWNER", accountIds: null };
    const open = async (ua: string) =>
      (await start(new NextRequest("https://bottrit.com/api/threads/oauth", { headers: { "user-agent": ua } }))).headers.get("location") ?? "";

    const android = await open("Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36");
    const m = /^intent:\/\/(www\.threads\.com\/oauth\/authorize\/\?[^#]+)#Intent;scheme=https;package=com\.android\.chrome;S\.browser_fallback_url=([^;]+);end$/.exec(android);
    expect(m).not.toBeNull();
    const fallback = decodeURIComponent(m![2]);
    expect(fallback).toBe(`https://${m![1]}`);
    expect(new URL(fallback).searchParams.get("state")).toBeTruthy();

    const iphone = await open("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1");
    expect(iphone.startsWith("https://www.threads.com/oauth/authorize/?")).toBe(true);
  });
});

describe("callback OAuth Threads", () => {
  it("tanpa sesi (browser lain di HP): akun tersimpan ke workspace dari state, lalu ke halaman hasil publik", async () => {
    const res = await call(signThreadsOAuthState({ userId: "u1", workspaceId: "ws1" }));
    expect(h.connect).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "ws1", userId: "u1", accessToken: "tok" }));
    expect(location(res)).toBe("https://bottrit.com/threads-terhubung?threads_connected=sinta");
  });

  it("dengan sesi pengguna yang sama: kembali ke halaman Akun Threads", async () => {
    h.session = { userId: "u1", workspaceId: "ws1", role: "OWNER", accountIds: null };
    const res = await call(signThreadsOAuthState({ userId: "u1", workspaceId: "ws1" }));
    expect(location(res)).toBe("https://bottrit.com/akun?threads_connected=sinta");
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
