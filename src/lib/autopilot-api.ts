/**
 * Pembantu route API autopilot: ubah galat menjadi respons yang aman dan bisa dipahami admin.
 */
import type { NextResponse } from "next/server";
import { internalError, jsonError } from "./api-auth";
import { isMissingAutopilotSchema, missingSchemaFile } from "./autopilot-store";
import type { ApiError } from "./content-types";

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function autopilotError(scope: string, err: unknown): NextResponse<ApiError> {
  if (isMissingAutopilotSchema(err)) {
    const file = missingSchemaFile(err);
    console.error(`[${scope}] Skema belum dibuat (${file}).`);
    return jsonError(503, `Fitur ini belum siap: tabel belum dibuat di database (${file}). Hubungi pemilik dashboard.`);
  }
  return internalError(scope, err);
}

export const TOO_MANY = (retryAfter: number) =>
  jsonError(429, "Terlalu banyak permintaan. Tunggu sebentar.", undefined, { "Retry-After": String(retryAfter) });
