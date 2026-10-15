import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { ADMIN_TOO_MANY, NO_STORE, adminError } from "@/lib/admin-api";
import { approveInvoice, cancelInvoice, getAdminBilling, syncInvoice } from "@/lib/billing";
import { withAdmin } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

export const GET = withAdmin("tagihan.lihat", async () => {
  try {
    return NextResponse.json(await getAdminBilling(), { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/billing:GET", err);
  }
});

/** `approve` (tandai lunas manual), `sync` (cek status ke Midtrans), atau `cancel`. */
export const POST = withAdmin("tagihan.kelola", async (request, admin) => {
  const limit = throttle(`admin-billing:${admin.userId}`, 30, 60_000);
  if (!limit.ok) return ADMIN_TOO_MANY(limit.retryAfter);
  try {
    const body = (await readJson(request)) as { action?: string; invoiceId?: string; notes?: string } | null;
    const invoiceId = typeof body?.invoiceId === "string" ? body.invoiceId.trim() : "";
    if (!invoiceId) return jsonError(400, "ID tagihan wajib diisi.");
    const notes = typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 200) : null;

    const res =
      body?.action === "approve"
        ? await approveInvoice(invoiceId, admin.userId, notes ?? "Disetujui oleh Super Admin")
        : body?.action === "sync"
          ? await syncInvoice(invoiceId, admin.userId)
          : body?.action === "cancel"
            ? await cancelInvoice(invoiceId, admin.userId, notes ?? "Dibatalkan oleh Super Admin")
            : null;
    if (!res) return jsonError(400, "Tindakan tidak valid.");
    if (!res.ok) return jsonError(res.status, res.error);
    return NextResponse.json({ success: true, invoice: res.invoice }, { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/billing:POST", err);
  }
});
