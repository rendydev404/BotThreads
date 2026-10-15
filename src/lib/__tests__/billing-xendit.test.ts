/**
 * Tagihan via Xendit (sql/012): route asli + SQL asli di Postgres in-memory, API Xendit ditiru.
 * Yang dijaga: paket hanya aktif bila API Xendit menyatakan lunas (callback palsu atau "bayar" dari
 * pengguna tidak bisa), callback ganda tidak memperpanjang dua kali, dan kunci rahasia tidak bocor ke audit.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./helpers/pg";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@supabase/supabase-js", async () => (await import("./helpers/pg")).supabaseMock(() => h.db as TestDb));
vi.mock("@/lib/users", async (original) => ({
  ...(await original<typeof import("@/lib/users")>()),
  getSessionUserId: async (cookie: string | undefined) => cookie || null,
}));

import { NextRequest } from "next/server";
import { bootDb, useTestSupabaseEnv } from "./helpers/pg";
import { forgetIntegrations } from "../integrations";
import { forgetPlans } from "../plan";
import { POST as plansPOST } from "@/app/api/admin/plans/route";
import { GET as integrationsGET, PUT as integrationsPUT } from "@/app/api/admin/integrations/route";
import { GET as billingGET, POST as billingPOST } from "@/app/api/billing/route";
import { POST as webhookPOST } from "@/app/api/billing/webhook/route";

let db: TestDb;
const REPO = path.resolve(__dirname, "../../..");
const T0 = new Date("2026-10-14T03:00:00Z").getTime();
const KEY = "xnd_development_abc123SECRET";
const CB_TOKEN = "token-verifikasi-callback";

const req = (user: string, url: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", cookie: `session=${user}`, ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const json = async <T = Record<string, unknown>>(res: Response): Promise<T> => (await res.json()) as T;
const rows = async <T>(sql: string): Promise<T[]> => (await db.query<T>(sql)).rows;

/* ------------------------------------------------------------------ Xendit tiruan */

interface FakeInvoice {
  id: string;
  external_id: string;
  amount: number;
  status: string;
  invoice_url: string;
  expiry_date: string;
}
const xendit = { invoices: new Map<string, FakeInvoice>(), created: 0, expired: 0, auth: [] as string[] };

function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const reply = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  if (url.host !== "api.xendit.co") return reply(500, { message: "host tak terduga" });
  xendit.auth.push(String((init?.headers as Record<string, string>)?.Authorization ?? ""));

  if (url.pathname === "/v2/invoices" && init?.method === "POST") {
    const b = JSON.parse(String(init.body)) as { external_id: string; amount: number; invoice_duration: number };
    xendit.created += 1;
    const inv: FakeInvoice = {
      id: `xinv_${xendit.created}`,
      external_id: b.external_id,
      amount: b.amount,
      status: "PENDING",
      invoice_url: `https://checkout-staging.xendit.co/web/xinv_${xendit.created}`,
      expiry_date: new Date(Date.now() + b.invoice_duration * 1000).toISOString(),
    };
    xendit.invoices.set(inv.id, inv);
    return reply(200, inv);
  }
  const get = /^\/v2\/invoices\/([^/]+)$/.exec(url.pathname);
  if (get) {
    const inv = xendit.invoices.get(decodeURIComponent(get[1]));
    return inv ? reply(200, inv) : reply(404, { message: "not found" });
  }
  const exp = /^\/invoices\/([^/]+)\/expire!$/.exec(url.pathname);
  if (exp) {
    const inv = xendit.invoices.get(decodeURIComponent(exp[1]));
    if (!inv) return reply(404, { message: "not found" });
    if (inv.status !== "PENDING") return reply(400, { message: "INVOICE_NOT_PENDING" });
    xendit.expired += 1;
    inv.status = "EXPIRED";
    return reply(200, inv);
  }
  return reply(404, { message: `rute tak dikenal ${url.pathname}` });
}

/* ------------------------------------------------------------------ pembantu */

const checkout = (planId: string, months = 1) => billingPOST(req("u-admin", "/api/billing", "POST", { action: "checkout", planId, months }));
const callback = (externalId: string, token: string | null, extra: Record<string, unknown> = {}) =>
  webhookPOST(
    req("", "/api/billing/webhook", "POST", { external_id: externalId, status: "PAID", ...extra }, token ? { "x-callback-token": token } : {})
  );
const wsPlan = async () => (await rows<{ planId: string | null; planBerakhir: string | null }>(
  `SELECT "planId", "planBerakhir"::text AS "planBerakhir" FROM "WorkspaceSettings" WHERE "workspaceId" = 'wsA'`
))[0];
const markPaidAtXendit = (externalId: string, channel = "QRIS") => {
  for (const inv of xendit.invoices.values()) {
    if (inv.external_id === externalId) Object.assign(inv, { status: "PAID", payment_channel: channel, payment_method: "QR_CODE" });
  }
};

beforeAll(async () => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  useTestSupabaseEnv();
  process.env.AUTH_SECRET = "uji-rahasia-yang-panjangnya-lebih-dari-32-karakter";
  process.env.CONTENT_PUBLISH_ENABLED = "false";
  for (const k of ["XENDIT_SECRET_KEY", "XENDIT_CALLBACK_TOKEN", "XENDIT_WEBHOOK_TOKEN", "APP_URL"]) delete process.env[k];
  db = await bootDb([]);
  h.db = db;
  await db.exec(`
    INSERT INTO "Workspace" VALUES ('wsA', 'Brand Utama', 'utama');
    INSERT INTO "Outlet" VALUES ('o-a1', 'wsA', 'Cabang a1', true);
    INSERT INTO "ThreadsAccount" (id, "workspaceId", username, "displayName", "accessExpiresAt", scopes)
      VALUES ('a1', 'wsA', 'akun_a1', 'Akun a1', '2099-01-01', '{threads_content_publish}');
    INSERT INTO "SocialAccount" VALUES ('s-a1', 'o-a1', 'a1');
    INSERT INTO "DashboardUser" (id, username, email, "passwordHash", "createdAt") VALUES
      ('u-admin', 'admin', 'admin@contoh.id', 'x', '2026-01-01');
  `);
  for (const f of ["002_dashboard_post_log", "003_dashboard_rpc", "005_autopilot", "006_autopilot_radar", "007_autopilot_learning", "008_multiuser", "009_signup", "010_superadmin", "011_plans", "012_billing_and_integrations", "012_billing_and_integrations"]) {
    await db.exec(fs.readFileSync(path.join(REPO, `sql/${f}.sql`), "utf8"));
  }
  for (const p of [
    { id: "pro", nama: "Pro", hargaBulanan: 150000, publik: true },
    { id: "gratis", nama: "Gratis", hargaBulanan: 0, publik: true },
    { id: "internal", nama: "Internal", hargaBulanan: 0, publik: false },
  ]) {
    const res = await plansPOST(
      req("u-admin", "/api/admin/plans", "POST", {
        action: "save",
        plan: { maxAkun: 5, maxPostingPerHari: 3, maxAnggota: 3, modeOtomatis: true, aktif: true, urutan: 1, deskripsi: null, ...p },
      })
    );
    expect(res.status).toBe(200);
  }
});

afterEach(() => {
  forgetIntegrations();
  forgetPlans();
});

describe("sebelum kunci Xendit diisi", () => {
  it("pembayaran online tidak siap; paket berbayar ditolak, paket publik gratis tetap bisa, paket internal tidak", async () => {
    const b = await json<{ paymentReady: boolean; invoices: unknown[] }>(await billingGET(req("u-admin", "/api/billing")));
    expect(b).toMatchObject({ paymentReady: false, invoices: [] });
    expect((await checkout("pro")).status).toBe(503);
    expect((await checkout("internal")).status).toBe(404);

    const free = await json<{ invoice: { status: string; provider: string } }>(await checkout("gratis"));
    expect(free.invoice).toMatchObject({ status: "PAID", provider: "GRATIS" });
    expect((await wsPlan()).planId).toBe("gratis");
    expect(xendit.created).toBe(0);
  });
});

describe("kunci integrasi", () => {
  it("format kunci divalidasi, nilai rahasia disamarkan, dan tidak tersimpan di catatan audit", async () => {
    const bad = await integrationsPUT(req("u-admin", "/api/admin/integrations", "PUT", { xendit: { secretKey: "sk_salah" } }));
    expect(bad.status).toBe(400);

    const ok = await integrationsPUT(
      req("u-admin", "/api/admin/integrations", "PUT", { xendit: { secretKey: KEY, callbackToken: CB_TOKEN } })
    );
    expect(ok.status).toBe(200);
    const body = await json<{ integrations: { xendit: Record<string, unknown> } }>(ok);
    expect(body.integrations.xendit).toMatchObject({ ready: true, mode: "test", hasCallbackToken: true, source: "database" });
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(JSON.stringify(await json(await integrationsGET(req("u-admin", "/api/admin/integrations"))))).not.toContain(CB_TOKEN);

    const leaked = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM "PlatformAuditLog" WHERE detail::text LIKE '%${KEY}%' OR detail::text LIKE '%${CB_TOKEN}%'`
    );
    expect(leaked).toEqual([{ n: 0 }]);

    // Mengosongkan kolom rahasia = tidak mengubah.
    await integrationsPUT(req("u-admin", "/api/admin/integrations", "PUT", { xendit: { secretKey: "" } }));
    forgetIntegrations();
    expect((await json<{ paymentReady: boolean }>(await billingGET(req("u-admin", "/api/billing")))).paymentReady).toBe(true);
  });
});

describe("migrasi dari versi lama", () => {
  it("kunci yang dulu tersimpan di catatan audit dipindah ke tabel lalu dihapus dari audit", async () => {
    await db.exec(`
      UPDATE "PlatformIntegration" SET "threadsOauth" = '{}'::jsonb WHERE id = 1;
      INSERT INTO "PlatformAuditLog" (actor, action, "targetType", "targetId", detail, "createdAt") VALUES
        ('u-admin', 'INTEGRASI_SIMPAN', 'SISTEM', 'integrations',
         '{"threadsOauth": {"enabled": true, "appId": "123456789", "appSecret": "rahasia-threads-lama"}, "midtrans": {"serverKey": "SB-Mid-server-x"}}',
         '2026-10-01');
    `);
    await db.exec(fs.readFileSync(path.join(REPO, "sql/012_billing_and_integrations.sql"), "utf8"));
    const [cfg] = await rows<{ t: Record<string, unknown> }>(`SELECT "threadsOauth" AS t FROM "PlatformIntegration"`);
    expect(cfg.t).toEqual({ enabled: true, appId: "123456789", appSecret: "rahasia-threads-lama" });
    const leaked = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM "PlatformAuditLog" WHERE detail::text LIKE '%rahasia-threads-lama%' OR detail::text LIKE '%SB-Mid-server%'`
    );
    expect(leaked).toEqual([{ n: 0 }]);
  });
});

describe("checkout dan pelunasan", () => {
  let invoiceId = "";

  it("membuat invoice Xendit dengan nominal paket; checkout ulang memakai tagihan yang sama", async () => {
    const res = await json<{ invoice: { id: string; status: string; amount: number; paymentUrl: string; externalId: string } }>(
      await checkout("pro")
    );
    invoiceId = res.invoice.id;
    expect(res.invoice).toMatchObject({ status: "PENDING", amount: 150000, externalId: "xinv_1" });
    expect(res.invoice.paymentUrl).toContain("xendit.co");
    expect(xendit.auth.at(-1)).toBe(`Basic ${Buffer.from(`${KEY}:`).toString("base64")}`);

    const again = await json<{ invoice: { id: string } }>(await checkout("pro"));
    expect(again.invoice.id).toBe(invoiceId);
    expect(xendit.created).toBe(1);
  });

  it("pengguna tidak bisa melunasi sendiri; callback palsu atau belum dibayar tidak mengaktifkan paket", async () => {
    expect((await billingPOST(req("u-admin", "/api/billing", "POST", { action: "pay", invoiceId }))).status).toBe(400);
    expect((await callback(invoiceId, "token-salah")).status).toBe(401);
    expect((await callback(invoiceId, null)).status).toBe(401);

    // Token benar tapi Xendit masih PENDING: isi callback "PAID" tidak dipercaya.
    expect((await callback(invoiceId, CB_TOKEN)).status).toBe(200);
    expect((await wsPlan()).planId).toBe("gratis");
    const [inv] = await rows<{ status: string }>(`SELECT status FROM "SubscriptionInvoice" WHERE id = '${invoiceId}'`);
    expect(inv.status).toBe("PENDING");
  });

  it("lunas di Xendit ➜ paket aktif 30 hari; callback ganda tidak memperpanjang dua kali", async () => {
    markPaidAtXendit(invoiceId);
    expect((await callback(invoiceId, CB_TOKEN)).status).toBe(200);
    const first = await wsPlan();
    expect(first.planId).toBe("pro");
    expect(new Date(`${first.planBerakhir}Z`).getTime()).toBe(T0 + 30 * 86_400_000);

    expect((await callback(invoiceId, CB_TOKEN)).status).toBe(200);
    expect(await wsPlan()).toEqual(first);
    const [inv] = await rows<{ status: string; paymentMethod: string }>(
      `SELECT status, "paymentMethod" FROM "SubscriptionInvoice" WHERE id = '${invoiceId}'`
    );
    expect(inv).toEqual({ status: "PAID", paymentMethod: "XENDIT_QRIS" });
  });

  it("perpanjangan saat paket masih aktif dihitung dari tanggal berakhir; tombol Cek status melunasi", async () => {
    const res = await json<{ invoice: { id: string } }>(await checkout("pro", 3));
    markPaidAtXendit(res.invoice.id, "BCA");
    const synced = await json<{ invoice: { status: string; paymentMethod: string } }>(
      await billingPOST(req("u-admin", "/api/billing", "POST", { action: "sync", invoiceId: res.invoice.id }))
    );
    expect(synced.invoice).toMatchObject({ status: "PAID", paymentMethod: "XENDIT_BCA" });
    const p = await wsPlan();
    expect(new Date(`${p.planBerakhir}Z`).getTime()).toBe(T0 + (30 + 90) * 86_400_000);
  });

  it("nominal di Xendit berbeda dari tagihan ➜ tidak dilunasi", async () => {
    const res = await json<{ invoice: { id: string; externalId: string } }>(await checkout("pro", 12));
    const x = xendit.invoices.get(res.invoice.externalId)!;
    Object.assign(x, { status: "PAID", amount: 1000 });
    await callback(res.invoice.id, CB_TOKEN);
    const [inv] = await rows<{ status: string }>(`SELECT status FROM "SubscriptionInvoice" WHERE id = '${res.invoice.id}'`);
    expect(inv.status).toBe("PENDING");
    x.status = "PENDING";
    x.amount = 1440000;
  });

  it("membatalkan tagihan juga menutup invoice di Xendit", async () => {
    const list = await json<{ invoices: { id: string; status: string; months: number }[] }>(await billingGET(req("u-admin", "/api/billing")));
    const pending = list.invoices.find((i) => i.status === "PENDING" && i.months === 12)!;
    const res = await billingPOST(req("u-admin", "/api/billing", "POST", { action: "cancel", invoiceId: pending.id }));
    expect(res.status).toBe(200);
    expect((await json<{ invoice: { status: string } }>(res)).invoice.status).toBe("CANCELLED");
    expect(xendit.expired).toBe(1);
  });

  it("callback untuk external_id asing diakui tanpa efek", async () => {
    expect((await callback("order-lain-123", CB_TOKEN)).status).toBe(200);
  });
});
