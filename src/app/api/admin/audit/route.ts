import { NextResponse } from "next/server";
import { NO_STORE, adminError } from "@/lib/admin-api";
import { getAudit } from "@/lib/admin-service";
import { withAdmin } from "@/lib/request-ctx";

/** Catatan semua tindakan super admin, terbaru dulu. Query: `cursor`. */
export const GET = withAdmin("audit.lihat", async (request) => {
  try {
    return NextResponse.json(await getAudit(request.nextUrl.searchParams.get("cursor")), { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/audit", err);
  }
});
