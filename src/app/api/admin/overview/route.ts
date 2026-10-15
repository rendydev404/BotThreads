import { NextResponse } from "next/server";
import { NO_STORE, adminError } from "@/lib/admin-api";
import { getOverview } from "@/lib/admin-service";
import { withAdmin } from "@/lib/request-ctx";

/** Ringkasan platform: pengguna, workspace, akun, autopilot, dan saklar sistem. Satu perjalanan ke database. */
export const GET = withAdmin("dashboard.lihat", async () => {
  try {
    return NextResponse.json(await getOverview(), { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/overview", err);
  }
});
