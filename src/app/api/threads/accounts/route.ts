import { NextResponse } from "next/server";
import { internalError } from "@/lib/api-auth";
import {
  MAX_BATCH_ITEMS,
  isPublishEnabled,
  maxPostsPerDay,
  minGapMinutes,
} from "@/lib/content-config";
import type { AccountsResponse } from "@/lib/content-types";
import { listPublishAccounts, toAccountDTO } from "@/lib/publish-accounts";
import { withCtx } from "@/lib/request-ctx";

/** Akun Threads beserta kesiapan posting + status saklar fitur (bootstrap klien). */
export const GET = withCtx("VIEWER", async () => {
  try {
    const accounts = await listPublishAccounts();
    const body: AccountsResponse = {
      success: true,
      accounts: accounts.map(toAccountDTO),
      publishEnabled: isPublishEnabled(),
      limits: {
        maxPostsPerDay: maxPostsPerDay(),
        minGapMinutes: minGapMinutes(),
        maxBatchItems: MAX_BATCH_ITEMS,
      },
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (err) {
    return internalError("threads/accounts", err);
  }
});
