/**
 * Pembantu route panel super admin: ubah galat menjadi respons yang aman dan bisa dipahami.
 */
import type { NextResponse } from "next/server";
import { internalError, jsonError } from "./api-auth";
import { MissingAutopilotSchemaError } from "./autopilot-store";
import type { ApiError } from "./content-types";

export const NO_STORE = { "Cache-Control": "no-store" };

export function adminError(scope: string, err: unknown): NextResponse<ApiError> {
  if (err instanceof MissingAutopilotSchemaError) {
    console.error(`[${scope}] Skema belum dibuat (${err.file}).`);
    return jsonError(503, `Panel super admin belum siap: tabel belum dibuat di database (${err.file}). Jalankan berkas itu di SQL Editor.`);
  }
  return internalError(scope, err);
}

export const ADMIN_TOO_MANY = (retryAfter: number) =>
  jsonError(429, "Terlalu banyak tindakan. Tunggu sebentar.", undefined, { "Retry-After": String(retryAfter) });
