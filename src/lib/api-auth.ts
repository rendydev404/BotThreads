/**
 * Pembantu route API fitur konten: identitas pengguna dari cookie sesi dan format galat seragam.
 * Autentikasi & cek same-origin sudah dipaksa `proxy.ts`; di sini kita hanya perlu id pengguna
 * untuk audit dan pembatasan laju.
 */
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, getSessionUserId } from "@/lib/users";
import type { ApiError } from "./content-types";
import { isMissingAuditTable } from "./threads-publish";

export const getRequestUserId = (request: NextRequest): Promise<string | null> =>
  getSessionUserId(request.cookies.get(SESSION_COOKIE)?.value);

export function jsonError(
  status: number,
  error: string,
  details?: string[],
  headers?: Record<string, string>
): NextResponse<ApiError> {
  return NextResponse.json(
    { success: false, error, ...(details?.length ? { details } : {}) },
    { status, headers }
  );
}

export const UNAUTHORIZED = () => jsonError(401, "Sesi berakhir. Silakan masuk kembali.");

export const PUBLISH_DISABLED = () =>
  jsonError(403, "Fitur posting belum diaktifkan. Hubungi pemilik dashboard.");

/** Ubah galat tak terduga menjadi respons aman (tanpa membocorkan detail internal ke klien). */
export function internalError(scope: string, err: unknown): NextResponse<ApiError> {
  if (isMissingAuditTable(err)) {
    console.error(`[${scope}] Tabel DashboardPostLog belum dibuat.`);
    return jsonError(
      503,
      "Fitur posting belum siap: tabel audit belum dibuat di database. Hubungi pemilik dashboard."
    );
  }
  console.error(`[${scope}]`, err instanceof Error ? err.message : "galat tak dikenal");
  return jsonError(500, "Terjadi kesalahan pada server. Coba lagi sebentar lagi.");
}

/** Baca body JSON; null bila bukan JSON valid. */
export async function readJson(request: NextRequest): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
