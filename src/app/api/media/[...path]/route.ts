import fs from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import { MEDIA_BUCKET } from "@/lib/media-store";
import { resolveSafeMediaPath } from "@/lib/pg-direct";

const SAFE_REL_RE = /^[A-Za-z0-9_./-]{1,200}\.(?:jpg|jpeg|png|webp)$/i;

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path: segments } = await context.params;
  if (!Array.isArray(segments) || segments.length < 2) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const [bucket, ...rest] = segments;
  const relPath = rest.join("/");
  if (bucket !== MEDIA_BUCKET || !SAFE_REL_RE.test(relPath) || relPath.includes("..")) {
    return new NextResponse("Not Found", { status: 404 });
  }

  try {
    const fullPath = resolveSafeMediaPath(bucket, relPath);
    const buf = await fs.readFile(fullPath);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(buf.byteLength),
        "Cache-Control": "public, max-age=600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
}
