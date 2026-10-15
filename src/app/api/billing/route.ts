import { NextResponse } from "next/server";
import { internalError, jsonError, readJson } from "@/lib/api-auth";
import { cancelInvoice, createCheckoutInvoice, getWorkspaceBilling, listWorkspaceInvoices, payInvoice, syncInvoice } from "@/lib/billing";
import type { BillingCycleMonths } from "@/lib/billing-types";
import { appOrigin } from "@/lib/google-oauth";
import { getRawIntegrations } from "@/lib/integrations";
import { withCtx } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

const NO_STORE = { "Cache-Control": "no-store" };

/** Status pembayaran online & daftar tagihan workspace saat ini. */
export const GET = withCtx("VIEWER", async (_request, ctx) => {
  try {
    if (!ctx.workspaceId) return jsonError(403, "Workspace tidak ditemukan.");
    return NextResponse.json(await getWorkspaceBilling(ctx.workspaceId), { headers: NO_STORE });
  } catch (err) {
    return internalError("billing:GET", err);
  }
});

/**
 * `action: "checkout"` buat tagihan + transaksi Midtrans dengan metode pilihan; `action: "pay"` ganti
 * metode / buat kode bayar baru untuk tagihan menunggu; `action: "sync"` cek status ke Midtrans;
 * `action: "cancel"` batalkan tagihan yang belum dibayar. Pelunasan hanya terjadi bila Midtrans
 * menyatakan lunas, tidak pernah atas permintaan pengguna.
 */
export const POST = withCtx("ADMIN", async (request, ctx) => {
  // Longgar untuk polling status dari layar bayar (sekitar 8 kali per menit).
  const limit = throttle(`billing:${ctx.userId}`, 40, 60_000);
  if (!limit.ok) return jsonError(429, "Terlalu banyak permintaan. Coba lagi sebentar.");
  if (!ctx.workspaceId) return jsonError(403, "Workspace tidak ditemukan.");
  const workspaceId = ctx.workspaceId;

  try {
    const body = (await readJson(request)) as Record<string, unknown> | null;
    if (!body || typeof body.action !== "string") return jsonError(400, "Permintaan tidak valid.");

    if (body.action === "checkout") {
      const cfg = await getRawIntegrations();
      const res = await createCheckoutInvoice({
        workspaceId,
        userId: ctx.userId,
        planId: typeof body.planId === "string" ? body.planId.trim().toLowerCase() : "",
        months: Number(body.months) as BillingCycleMonths,
        method: typeof body.method === "string" ? body.method : "",
        origin: appOrigin(request, cfg.googleOauth.appUrl),
      });
      if (!res.ok) return jsonError(res.status, res.error);
      return NextResponse.json({ success: true, invoice: res.invoice }, { headers: NO_STORE });
    }

    if (body.action === "sync" || body.action === "cancel" || body.action === "pay") {
      const invoiceId = typeof body.invoiceId === "string" ? body.invoiceId.trim() : "";
      const owned = (await listWorkspaceInvoices(workspaceId)).some((i) => i.id === invoiceId);
      if (!owned) return jsonError(404, "Tagihan tidak ditemukan di workspace ini.");
      let res;
      if (body.action === "pay") {
        const cfg = await getRawIntegrations();
        const method = typeof body.method === "string" ? body.method : "";
        res = await payInvoice(invoiceId, method, { actorId: ctx.userId, origin: appOrigin(request, cfg.googleOauth.appUrl) });
      } else {
        res =
          body.action === "sync"
            ? await syncInvoice(invoiceId, ctx.userId)
            : await cancelInvoice(invoiceId, ctx.userId, "Dibatalkan oleh pengguna");
      }
      if (!res.ok) return jsonError(res.status, res.error);
      return NextResponse.json({ success: true, invoice: res.invoice }, { headers: NO_STORE });
    }

    return jsonError(400, "Tindakan tidak dikenal.");
  } catch (err) {
    return internalError("billing:POST", err);
  }
});
