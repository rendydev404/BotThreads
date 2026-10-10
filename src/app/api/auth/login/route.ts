import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  authConfigured,
  createSessionToken,
} from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { clearFailures, lockedSeconds, recordFailure } from "@/lib/rate-limit";
import { findUserByIdentifier, normalizeIdentifier } from "@/lib/users";

const MAX_PER_IP = 5;
const MAX_PER_IDENTIFIER = 10;

// Hash tiruan: verifikasi tetap dijalankan walau pengguna tidak ada,
// supaya waktu respons tidak membocorkan keberadaan akun.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("dummy-password"));

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function json(body: object, status: number, headers?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export async function POST(req: NextRequest) {
  if (!authConfigured()) {
    return json(
      { error: "Login belum dikonfigurasi di server. Hubungi administrator." },
      503
    );
  }

  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) {
    return json({ error: "Permintaan tidak valid." }, 403);
  }

  let identifier = "";
  let password = "";
  try {
    const body = await req.json();
    identifier =
      typeof body.username === "string" ? normalizeIdentifier(body.username) : "";
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return json({ error: "Permintaan tidak valid." }, 400);
  }

  if (!identifier || !password || identifier.length > 200 || password.length > 200) {
    return json({ error: "Email/username dan password wajib diisi." }, 400);
  }

  const ipKey = `ip:${clientIp(req)}`;
  const idKey = `id:${identifier}`;
  const wait = Math.max(lockedSeconds(ipKey), lockedSeconds(idKey));
  if (wait > 0) {
    return json(
      {
        error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(wait / 60)} menit.`,
      },
      429,
      { "Retry-After": String(wait) }
    );
  }

  let user;
  try {
    user = await findUserByIdentifier(identifier);
  } catch (err) {
    console.error("Login lookup failed:", err);
    return json({ error: "Server sedang bermasalah. Coba lagi sebentar." }, 503);
  }

  const passwordOk = await verifyPassword(
    password,
    user?.passwordHash ?? (await getDummyHash())
  );

  if (!user || !user.isActive || !passwordOk) {
    recordFailure(ipKey, MAX_PER_IP);
    recordFailure(idKey, MAX_PER_IDENTIFIER);
    return json({ error: "Email/username atau password salah." }, 401);
  }

  clearFailures(ipKey);
  clearFailures(idKey);

  // Catat waktu login terakhir, tidak perlu ditunggu
  void prisma.dashboardUser
    .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    .catch(() => {});

  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol;
  const res = json({ success: true }, 200);
  res.cookies.set(
    SESSION_COOKIE,
    await createSessionToken(user.id, user.passwordHash),
    {
      httpOnly: true,
      secure: proto.startsWith("https"),
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    }
  );
  return res;
}
