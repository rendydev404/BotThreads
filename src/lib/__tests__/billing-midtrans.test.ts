/**
 * Tagihan via Midtrans Core API (sql/012 + sql/017): route asli + SQL asli di Postgres in-memory, API Midtrans ditiru.
 * Yang dijaga: paket hanya aktif bila API Midtrans menyatakan lunas (notifikasi palsu / signature salah tidak bisa),
 * notifikasi ganda tidak memperpanjang dua kali, ganti metode mematikan transaksi lama, dan kunci rahasia tidak bocor.
 */
import { createHash } from "node:crypto";
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
import { syncPendingInvoices } from "../billing";
import { forgetIntegrations } from "../integrations";
import { forgetPlans } from "../plan";
import { POST as plansPOST } from "@/app/api/admin/plans/route";
import { GET as integrationsGET, PUT as integrationsPUT } from "@/app/api/admin/integrations/route";
import { GET as billingGET, POST as billingPOST } from "@/app/api/billing/route";
import { POST as webhookPOST } from "@/app/api/billing/webhook/route";

let db: TestDb;
const REPO = path.resolve(__dirname, "../../..");
const T0 = new Date("2026-10-14T03:00:00Z").getTime();
const SERVER_KEY = "Mid-server-UjiCobaRahasia123";
const CLIENT_KEY = "Mid-client-UjiCobaPublik123";

const req = (user: string, url: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`https://bottrit.test${url}`, {
    method,
    headers: { "content-type": "application/json", cookie: `session=${user}`, ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const json = async <T = Record<string, unknown>>(res: Response): Promise<T> => (await res.json()) as T;
const rows = async <T>(sql: string): Promise<T[]> => (await db.query<T>(sql)).rows;

/* ------------------------------------------------------------------ Midtrans tiruan */

interface FakeTx {
  order_id: string;
  gross_amount: string;
  payment_type: string;
  transaction_status: string;
  bank?: string;
  method: string;
}
const mt = {
  txs: new Map<string, FakeTx>(),
  charges: [] as Record<string, unknown>[],
  expired: [] as string[],
  auth: [] as string[],
  hosts: new Set<string>(),
  notifyHeaders: [] as (string | undefined)[],
};

function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const reply = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  mt.hosts.add(url.host);
  if (url.host !== "api.sandbox.midtrans.com" && url.host !== "api.midtrans.com") return reply(500, { status_message: "host tak terduga" });
  const headers = (init?.headers ?? {}) as Record<string, string>;
  mt.auth.push(String(headers.Authorization ?? ""));

  if (url.pathname === "/v2/charge" && init?.method === "POST") {
    const b = JSON.parse(String(init.body)) as Record<string, unknown> & {
      payment_type: string;
      transaction_details: { order_id: string; gross_amount: number };
      bank_transfer?: { bank: string };
    };
    mt.charges.push(b);
    mt.notifyHeaders.push(headers["X-Append-Notification"]);
    const id = b.transaction_details.order_id;
    if (mt.txs.has(id)) return reply(200, { status_code: "406", status_message: "Duplicate order ID" });
    const tx: FakeTx = {
      order_id: id,
      gross_amount: `${b.transaction_details.gross_amount}.00`,
      payment_type: b.payment_type,
      transaction_status: "pending",
      bank: b.bank_transfer?.bank,
      method: b.payment_type,
    };
    mt.txs.set(id, tx);
    const base = { status_code: "201", transaction_id: `trx-${mt.txs.size}`, order_id: id, gross_amount: tx.gross_amount, payment_type: tx.payment_type, transaction_status: "pending", expiry_time: "2026-10-15 10:00:00" };
    if (b.payment_type === "bank_transfer") return reply(200, { ...base, va_numbers: [{ bank: tx.bank, va_number: "8277001234567890" }] });
    if (b.payment_type === "qris" || b.payment_type === "gopay") {
      return reply(200, {
        ...base,
        expiry_time: "2026-10-14 10:30:00",
        qr_string: "00020101021226...",
        actions: [
          { name: "generate-qr-code", method: "GET", url: `https://api.sandbox.midtrans.com/v2/qris/${id}/qr-code` },
          { name: "deeplink-redirect", method: "GET", url: `https://simulator.sandbox.midtrans.com/gopay/${id}` },
        ],
      });
    }
    if (b.payment_type === "echannel") return reply(200, { ...base, bill_key: "123456789012", biller_code: "70012" });
    return reply(200, base);
  }
  const st = /^\/v2\/([^/]+)\/(status|expire)$/.exec(url.pathname);
  if (st) {
    const tx = mt.txs.get(decodeURIComponent(st[1]));
    if (!tx) return reply(200, { status_code: "404", status_message: "Transaction doesn't exist." });
    if (st[2] === "expire") {
      if (tx.transaction_status !== "pending") return reply(200, { status_code: "412", status_message: "Merchant cannot modify the status of the transaction" });
      tx.transaction_status = "expire";
      mt.expired.push(tx.order_id);
      return reply(200, { status_code: "407", ...tx });
    }
    const code = tx.transaction_status === "settlement" ? "200" : tx.transaction_status === "expire" ? "407" : "201";
    return reply(200, { status_code: code, ...tx, ...(tx.bank ? { va_numbers: [{ bank: tx.bank, va_number: "8277001234567890" }] } : {}) });
  }
  return reply(404, { status_message: `rute tak dikenal ${url.pathname}` });
}

/* ------------------------------------------------------------------ pembantu */

const checkout = (planId: string, months = 1, method = "bca_va") =>
  billingPOST(req("u-admin", "/api/billing", "POST", { action: "checkout", planId, months, method }));
const sign = (orderId: string, statusCode: string, gross: string, key = SERVER_KEY) =>
  createHash("sha512").update(`${orderId}${statusCode}${gross}${key}`).digest("hex");
const notify = (orderId: string, opts: { gross?: string; status?: string; key?: string } = {}) => {
  const gross = opts.gross ?? "150000.00";
  return webhookPOST(
    req("", "/api/billing/webhook", "POST", {
      order_id: orderId,
      status_code: "200",
      gross_amount: gross,
      transaction_status: opts.status ?? "settlement",
      signature_key: sign(orderId, "200", gross, opts.key),
    })
  );
};
const wsPlan = async () => (await rows<{ planId: string | null; planBerakhir: string | null }>(
  `SELECT "planId", "planBerakhir"::text AS "planBerakhir" FROM "WorkspaceSettings" WHERE "workspaceId" = 'wsA'`
))[0];
const payAtMidtrans = (orderId: string) => {
  const tx = mt.txs.get(orderId);
  if (!tx) throw new Error(`tx ${orderId} tidak ada`);
  tx.transaction_status = "settlement";
};

type Inv = {
  id: string;
  status: string;
  amount: number;
  provider: string;
  externalId: string;
  paymentMethod: string | null;
  payment: { method: string; kind: string; vaNumber?: string; qrUrl?: string; billKey?: string; billerCode?: string; status: string; expiresAt: string; orderId: string } | null;
};

beforeAll(async () => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  useTestSupabaseEnv();
  process.env.AUTH_SECRET = "uji-rahasia-yang-panjangnya-lebih-dari-32-karakter";
  process.env.CONTENT_PUBLISH_ENABLED = "false";
  for (const k of ["MIDTRANS_SERVER_KEY", "MIDTRANS_CLIENT_KEY", "MIDTRANS_MERCHANT_ID", "MIDTRANS_IS_PRODUCTION", "APP_URL"]) delete process.env[k];
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
  for (const f of ["002_dashboard_post_log", "003_dashboard_rpc", "005_autopilot", "006_autopilot_radar", "007_autopilot_learning", "008_multiuser", "009_signup", "010_superadmin", "011_plans", "012_billing_and_integrations"]) {
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

describe("sebelum sql/017 dan kunci Midtrans", () => {
  it("paket berbayar ditolak, paket publik gratis tetap bisa, paket internal tidak", async () => {
    const b = await json<{ paymentReady: boolean; invoices: unknown[] }>(await billingGET(req("u-admin", "/api/billing")));
    expect(b).toMatchObject({ paymentReady: false, invoices: [] });
    expect((await checkout("pro")).status).toBe(503);
    expect((await checkout("internal")).status).toBe(404);

    const free = await json<{ invoice: { status: string; provider: string } }>(await checkout("gratis"));
    expect(free.invoice).toMatchObject({ status: "PAID", provider: "GRATIS" });
    expect((await wsPlan()).planId).toBe("gratis");
    expect(mt.charges).toHaveLength(0);
  });

  it("menyimpan kunci Midtrans sebelum sql/017 dipasang ditolak dengan petunjuk", async () => {
    const res = await integrationsPUT(req("u-admin", "/api/admin/integrations", "PUT", { midtrans: { serverKey: SERVER_KEY } }));
    expect(res.status).toBe(503);
    expect((await json<{ error: string }>(res)).error).toContain("sql/017");
  });
});

describe("kunci integrasi", () => {
  beforeAll(async () => {
    // Dipasang dua kali: harus idempoten.
    for (let i = 0; i < 2; i++) await db.exec(fs.readFileSync(path.join(REPO, "sql/017_midtrans.sql"), "utf8"));
  });

  it("format kunci divalidasi, nilai rahasia disamarkan, dan tidak tersimpan di catatan audit", async () => {
    const bad = await integrationsPUT(req("u-admin", "/api/admin/integrations", "PUT", { midtrans: { serverKey: "sk_salah" } }));
    expect(bad.status).toBe(400);
    const noMethod = await integrationsPUT(req("u-admin", "/api/admin/integrations", "PUT", { midtrans: { methods: [] } }));
    expect(noMethod.status).toBe(400);

    const ok = await integrationsPUT(
      req("u-admin", "/api/admin/integrations", "PUT", {
        midtrans: { serverKey: SERVER_KEY, clientKey: CLIENT_KEY, merchantId: "M790000001", isProduction: false, methods: ["qris", "bca_va", "mandiri_bill", "tidak_ada"] },
      })
    );
    expect(ok.status).toBe(200);
    const body = await json<{ integrations: { midtrans: Record<string, unknown> } }>(ok);
    expect(body.integrations.midtrans).toMatchObject({
      ready: true,
      mode: "sandbox",
      merchantId: "M790000001",
      clientKey: CLIENT_KEY,
      methods: ["qris", "bca_va", "mandiri_bill"],
      source: "database",
    });
    expect(JSON.stringify(body)).not.toContain(SERVER_KEY);
    expect(JSON.stringify(await json(await integrationsGET(req("u-admin", "/api/admin/integrations"))))).not.toContain(SERVER_KEY);

    const leaked = await rows<{ n: number }>(`SELECT count(*)::int AS n FROM "PlatformAuditLog" WHERE detail::text LIKE '%${SERVER_KEY}%'`);
    expect(leaked).toEqual([{ n: 0 }]);

    // Mengosongkan kolom rahasia = tidak mengubah.
    await integrationsPUT(req("u-admin", "/api/admin/integrations", "PUT", { midtrans: { serverKey: "" } }));
    forgetIntegrations();
    const b = await json<{ paymentReady: boolean; testMode: boolean; methods: string[] }>(await billingGET(req("u-admin", "/api/billing")));
    expect(b).toMatchObject({ paymentReady: true, testMode: true, methods: ["qris", "bca_va", "mandiri_bill"] });
  });
});

describe("checkout dan pelunasan", () => {
  let inv: Inv;

  it("membuat charge VA dengan nominal paket; nomor VA tersimpan; checkout ulang memakai transaksi yang sama", async () => {
    expect((await checkout("pro", 1, "gopay")).status).toBe(400); // metode tidak diaktifkan admin

    const res = await json<{ invoice: Inv }>(await checkout("pro"));
    inv = res.invoice;
    expect(inv).toMatchObject({ status: "PENDING", amount: 150000, provider: "MIDTRANS", externalId: inv.id });
    expect(inv.payment).toMatchObject({ method: "bca_va", kind: "va", vaNumber: "8277001234567890", status: "pending", orderId: inv.id });
    expect(inv.payment!.expiresAt).toBe("2026-10-15T03:00:00.000Z"); // 10:00 WIB
    expect(mt.auth.at(-1)).toBe(`Basic ${Buffer.from(`${SERVER_KEY}:`).toString("base64")}`);
    expect([...mt.hosts]).toEqual(["api.sandbox.midtrans.com"]);
    const charge = mt.charges.at(-1) as { transaction_details: unknown; bank_transfer: unknown; custom_expiry: { expiry_duration: number } };
    expect(charge).toMatchObject({ transaction_details: { order_id: inv.id, gross_amount: 150000 }, bank_transfer: { bank: "bca" } });
    expect(charge.custom_expiry.expiry_duration).toBe(24 * 60);
    expect(mt.notifyHeaders.at(-1)).toBe("https://bottrit.test/api/billing/webhook");

    const again = await json<{ invoice: Inv }>(await checkout("pro"));
    expect(again.invoice.id).toBe(inv.id);
    expect(mt.charges).toHaveLength(1);
  });

  it("ganti metode ke QRIS mematikan VA lama dan membuat order baru <id>-2", async () => {
    const res = await json<{ invoice: Inv }>(await billingPOST(req("u-admin", "/api/billing", "POST", { action: "pay", invoiceId: inv.id, method: "qris" })));
    expect(mt.expired).toEqual([inv.id]);
    expect(res.invoice.externalId).toBe(`${inv.id}-2`);
    expect(res.invoice.payment).toMatchObject({ method: "qris", kind: "qr", orderId: `${inv.id}-2` });
    expect(res.invoice.payment!.qrUrl).toContain("/qr-code");
    expect((mt.charges.at(-1) as { custom_expiry: { expiry_duration: number } }).custom_expiry.expiry_duration).toBe(30);
    inv = res.invoice;
  });

  it("pengguna tidak bisa melunasi sendiri; notifikasi bersignature salah atau belum dibayar tidak mengaktifkan paket", async () => {
    expect((await notify(inv.externalId, { key: "Mid-server-palsu" })).status).toBe(401);
    // Signature benar tapi Midtrans masih pending: isi notifikasi "settlement" tidak dipercaya.
    expect((await notify(inv.externalId)).status).toBe(200);
    expect((await wsPlan()).planId).toBe("gratis");
    const [row] = await rows<{ status: string }>(`SELECT status FROM "SubscriptionInvoice" WHERE id = '${inv.id}'`);
    expect(row.status).toBe("PENDING");
  });

  it("lunas di Midtrans ➜ paket aktif 30 hari; notifikasi ganda tidak memperpanjang dua kali", async () => {
    payAtMidtrans(inv.externalId);
    expect((await notify(inv.externalId)).status).toBe(200);
    const first = await wsPlan();
    expect(first.planId).toBe("pro");
    expect(new Date(`${first.planBerakhir}Z`).getTime()).toBe(T0 + 30 * 86_400_000);

    expect((await notify(inv.externalId)).status).toBe(200);
    expect(await wsPlan()).toEqual(first);
    const [row] = await rows<{ status: string; paymentMethod: string }>(`SELECT status, "paymentMethod" FROM "SubscriptionInvoice" WHERE id = '${inv.id}'`);
    expect(row).toEqual({ status: "PAID", paymentMethod: "MIDTRANS_QRIS" });
  });

  it("perpanjangan dihitung dari tanggal berakhir; polling status (sync) melunasi; Mandiri bill tampil kode bayar", async () => {
    const res = await json<{ invoice: Inv }>(await checkout("pro", 3, "mandiri_bill"));
    expect(res.invoice.payment).toMatchObject({ kind: "bill", billKey: "123456789012", billerCode: "70012" });
    payAtMidtrans(res.invoice.id);
    const synced = await json<{ invoice: Inv }>(
      await billingPOST(req("u-admin", "/api/billing", "POST", { action: "sync", invoiceId: res.invoice.id }))
    );
    expect(synced.invoice).toMatchObject({ status: "PAID", paymentMethod: "MIDTRANS_MANDIRI_BILL" });
    const p = await wsPlan();
    expect(new Date(`${p.planBerakhir}Z`).getTime()).toBe(T0 + (30 + 90) * 86_400_000);
  });

  it("nominal di Midtrans berbeda dari tagihan ➜ tidak dilunasi", async () => {
    const res = await json<{ invoice: Inv }>(await checkout("pro", 12));
    const tx = mt.txs.get(res.invoice.externalId)!;
    Object.assign(tx, { transaction_status: "settlement", gross_amount: "1000.00" });
    await notify(res.invoice.externalId, { gross: "1000.00" });
    const [row] = await rows<{ status: string }>(`SELECT status FROM "SubscriptionInvoice" WHERE id = '${res.invoice.id}'`);
    expect(row.status).toBe("PENDING");
    Object.assign(tx, { transaction_status: "pending", gross_amount: "1440000.00" });
  });

  it("membatalkan tagihan juga mematikan transaksi di Midtrans", async () => {
    const list = await json<{ invoices: Inv[] }>(await billingGET(req("u-admin", "/api/billing")));
    const pending = list.invoices.find((i) => i.status === "PENDING")!;
    const res = await billingPOST(req("u-admin", "/api/billing", "POST", { action: "cancel", invoiceId: pending.id }));
    expect(res.status).toBe(200);
    expect((await json<{ invoice: { status: string } }>(res)).invoice.status).toBe("CANCELLED");
    expect(mt.expired).toContain(pending.externalId);
  });

  it("scheduler mencocokkan tagihan menunggu bila notifikasi terlewat", async () => {
    const res = await json<{ invoice: Inv }>(await checkout("pro", 1, "bca_va"));
    payAtMidtrans(res.invoice.externalId);
    expect(await syncPendingInvoices(20, new Date())).toEqual({ checked: 1, paid: 1 });
    expect(await syncPendingInvoices(20, new Date())).toEqual({ checked: 0, paid: 0 });
  });

  it("notifikasi untuk order_id asing diakui tanpa efek", async () => {
    expect((await notify("order-lain-123")).status).toBe(200);
  });
});
