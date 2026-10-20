/**
 * Hubungkan Threads lewat QR dari komputer: komputer membuat QR, HP (Pemilik/Admin) menyetujui, komputer lalu
 * diantar ke halaman izin Threads dengan state milik penyetuju. Sekali pakai, umur pendek, dan aturan kuota sama
 * dengan tombol Hubungkan biasa.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Session = { userId: string; workspaceId: string; role: string; accountIds: null; workspaces: { workspaceId: string; nama: string; role: string }[] };

const h = vi.hoisted(() => ({
  session: null as null | Session,
  quota: { used: 1, max: 5, planNama: "Pro", expired: false },
}));

vi.mock("@/lib/integrations", () => ({
  getRawIntegrations: async () => ({ googleOauth: { appUrl: "https://bottrit.com" }, threadsOauth: { enabled: true, appId: "a", appSecret: "s" } }),
}));
vi.mock("@/lib/request-ctx", async (original) => {
  const rank: Record<string, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2, OWNER: 3 };
  return {
    ...(await original<typeof import("@/lib/request-ctx")>()),
    // withCtx memanggil getCtx dari dalam modulnya sendiri: pakai sesi tiruan + cek peran sederhana.
    withCtx:
      (min: string, handler: (req: unknown, ctx: unknown) => unknown) =>
      (req: unknown) => {
        if (!h.session) return Response.json({ success: false, error: "Sesi berakhir." }, { status: 401 });
        if (rank[h.session.role] < rank[min]) return Response.json({ success: false, error: "Tidak diizinkan." }, { status: 403 });
        return handler(req, h.session);
      },
  };
});
vi.mock("@/lib/threads-connect", async (original) => ({
  ...(await original<typeof import("@/lib/threads-connect")>()),
  listWorkspaceThreadsAccounts: async () => ({ accounts: [], quota: h.quota }),
}));
vi.mock("@/lib/threads-token", async (original) => ({
  ...(await original<typeof import("@/lib/threads-token")>()),
  tokenKeyConfigured: () => true,
}));
vi.mock("@/lib/supabase", async (original) => ({
  ...(await original<typeof import("@/lib/supabase")>()),
  db: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { username: "rendi", name: "Rendi" }, error: null }) }) }) }) }),
}));

import { NextRequest } from "next/server";
import { verifyThreadsOAuthState } from "../threads-connect";
import { PAIRING_TTL_MS } from "../threads-pairing";
import { POST as createPOST } from "@/app/api/threads/pair/route";
import { POST as statusPOST } from "@/app/api/threads/pair/status/route";
import { GET as confirmGET, POST as confirmPOST } from "@/app/api/threads/pair/confirm/route";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const OWNER: Session = { userId: "u1", workspaceId: "ws1", role: "OWNER", accountIds: null, workspaces: [{ workspaceId: "ws1", nama: "Brand Utama", role: "OWNER" }] };
let ip = 0;

const req = (path: string, init: { method?: string; body?: unknown; ua?: string } = {}) =>
  new NextRequest(`https://bottrit.com${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.7.0.${++ip % 250}`, ...(init.ua ? { "user-agent": init.ua } : {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;

const create = async () => {
  const r = await json<{ pollToken: string; approveUrl: string; qrSvg: string; expiresAt: string }>(await createPOST(req("/api/threads/pair", { method: "POST" })));
  return { ...r, id: r.approveUrl.split("/hubungkan/")[1] };
};
const poll = (token: string) => statusPOST(req("/api/threads/pair/status", { method: "POST", body: { token } }));
const proceed = (token: string, ua = IPHONE) => statusPOST(req("/api/threads/pair/status", { method: "POST", body: { token, action: "lanjut" }, ua }));
const decide = (id: string, action: string) => confirmPOST(req("/api/threads/pair/confirm", { method: "POST", body: { id, action } }));

beforeAll(() => {
  process.env.AUTH_SECRET = "uji-rahasia-yang-panjangnya-lebih-dari-32-karakter";
});
beforeEach(() => {
  h.session = null;
  h.quota = { used: 1, max: 5, planNama: "Pro", expired: false };
});
afterEach(() => vi.useRealTimers());

describe("pairing QR Threads", () => {
  it("komputer: QR berisi alamat persetujuan; status menunggu tanpa membocorkan workspace", async () => {
    const p = await create();
    expect(p.approveUrl).toMatch(/^https:\/\/bottrit\.com\/hubungkan\/[A-Za-z0-9_-]{24}$/);
    expect(p.pollToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.qrSvg.startsWith("<svg")).toBe(true);
    // SVG ringkas (satu path), bukan ribuan <rect>.
    expect(p.qrSvg.length).toBeLessThan(6_000);
    expect(await json(await poll(p.pollToken))).toEqual({ success: true, status: "menunggu", expiresAt: p.expiresAt });
  });

  it("alur penuh: HP Pemilik menyetujui, komputer melihat workspace + penyetuju, lalu dapat halaman izin Threads sekali saja", async () => {
    const p = await create();
    h.session = OWNER;
    expect(await json(await confirmGET(req(`/api/threads/pair/confirm?id=${p.id}`)))).toMatchObject({
      success: true,
      status: "menunggu",
      workspaceName: "Brand Utama",
    });
    expect((await decide(p.id, "setujui")).status).toBe(200);
    expect((await decide(p.id, "setujui")).status).toBe(409);

    h.session = null; // komputer tidak punya sesi dashboard
    expect(await json(await poll(p.pollToken))).toMatchObject({ status: "disetujui", workspaceName: "Brand Utama", approverName: "Rendi" });

    const first = await json<{ url: string }>(await proceed(p.pollToken));
    const u = new URL(first.url);
    expect(`${u.origin}${u.pathname}`).toBe("https://www.threads.com/oauth/authorize/");
    expect(u.hash).toBe("#weblink");
    expect(u.searchParams.get("redirect_uri")).toBe("https://bottrit.com/api/threads/oauth/callback");
    expect(verifyThreadsOAuthState(u.searchParams.get("state"))).toEqual({ userId: "u1", workspaceId: "ws1" });

    expect((await proceed(p.pollToken)).status).toBe(409);
    expect(await json(await poll(p.pollToken))).toMatchObject({ status: "dipakai" });
  });

  it("menolak: belum disetujui, peran kurang, ditolak dari HP, dan masukan tidak valid", async () => {
    const p = await create();
    expect((await proceed(p.pollToken)).status).toBe(409);

    h.session = { ...OWNER, role: "EDITOR" };
    expect((await decide(p.id, "setujui")).status).toBe(403);
    h.session = null;
    expect((await decide(p.id, "setujui")).status).toBe(401);

    h.session = OWNER;
    expect((await decide(p.id, "tolak")).status).toBe(200);
    expect(await json(await poll(p.pollToken))).toMatchObject({ status: "ditolak" });
    expect((await proceed(p.pollToken)).status).toBe(409);

    expect((await poll("bukan-token")).status).toBe(400);
    expect((await decide("bukan-id", "setujui")).status).toBe(400);
    expect((await decide(p.id, "hapus")).status).toBe(400);
  });

  it("kuota penuh atau paket habis ditolak saat menyetujui di HP, sebelum siapa pun login Threads", async () => {
    const p = await create();
    h.session = OWNER;
    h.quota = { used: 5, max: 5, planNama: "Pro", expired: false };
    const full = await decide(p.id, "setujui");
    expect(full.status).toBe(409);
    expect((await json<{ error: string }>(full)).error).toContain("Kuota akun paket Pro sudah penuh");

    h.quota = { used: 1, max: 5, planNama: "Pro", expired: true };
    expect((await json<{ error: string }>(await decide(p.id, "setujui"))).error).toContain("sudah habis");
    expect(await json(await poll(p.pollToken))).toMatchObject({ status: "menunggu" });
  });

  it("kedaluwarsa setelah 10 menit", async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    const p = await create();
    vi.setSystemTime(Date.now() + PAIRING_TTL_MS + 1_000);
    expect(await json(await poll(p.pollToken))).toEqual({ success: true, status: "kedaluwarsa" });
    h.session = OWNER;
    expect((await confirmGET(req(`/api/threads/pair/confirm?id=${p.id}`))).status).toBe(410);
    expect((await decide(p.id, "setujui")).status).toBe(410);
    expect((await proceed(p.pollToken)).status).toBe(410);
  });
});
