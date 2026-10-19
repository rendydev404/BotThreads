import { after, NextResponse, type NextRequest } from "next/server";
import { getRawIntegrations } from "@/lib/integrations";
import { ingestWebhook, parseWebhook, runReplies, validSignature } from "@/lib/threads-replies";

/** Balasan dikirim setelah webhook dijawab; batas route juga membatasi pekerjaan `after`. */
export const maxDuration = 60;
const REPLY_BUDGET_MS = 45_000;

const verifyToken = (): string => (process.env.THREADS_WEBHOOK_VERIFY_TOKEN ?? "").trim();

/**
 * Verifikasi langganan webhook dari Meta (App Dashboard > Threads Webhooks): balas `hub.challenge` bila
 * `hub.verify_token` sama dengan THREADS_WEBHOOK_VERIFY_TOKEN.
 */
export function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const token = verifyToken();
  if (sp.get("hub.mode") === "subscribe" && token && sp.get("hub.verify_token") === token) {
    return new NextResponse(sp.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * Notifikasi webhook Threads (topik "replies"). Ditandatangani Meta dengan App Secret Threads
 * (`X-Hub-Signature-256`). Komentar disimpan dulu, Meta langsung dijawab 200, lalu balasan dikirim di `after`.
 * Gagal menyimpan = 500, supaya Meta mengirim ulang.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  const { threadsOauth } = await getRawIntegrations();
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"), threadsOauth.appSecret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }

  const now = new Date();
  try {
    const items = parseWebhook(body);
    const accounts = items.length ? await ingestWebhook(items, now) : [];
    if (accounts.length) {
      after(() => runReplies(new Date(), Date.now() + REPLY_BUDGET_MS, {}));
    }
  } catch (err) {
    console.error("[webhooks/threads]", err instanceof Error ? err.message : err);
    return new NextResponse("Error", { status: 500 });
  }
  return new NextResponse("OK", { status: 200 });
}
