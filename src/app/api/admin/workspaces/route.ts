import { NextResponse } from "next/server";
import { NO_STORE, adminError } from "@/lib/admin-api";
import { listWorkspaces } from "@/lib/admin-service";
import { withSuperAdmin } from "@/lib/request-ctx";

/** Semua workspace dashboard beserta anggota dan jumlah akunnya. Query: `q`, `cursor`. */
export const GET = withSuperAdmin(async (request) => {
  const sp = request.nextUrl.searchParams;
  try {
    return NextResponse.json(await listWorkspaces({ q: sp.get("q"), cursor: sp.get("cursor") }), { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/workspaces", err);
  }
});
