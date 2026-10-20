import { call } from "./content-client";
import type { PairingStatus } from "./threads-pairing";

export type PairPollStatus = PairingStatus | "kedaluwarsa";

/** Komputer: buat QR baru. */
export const createThreadsPair = () =>
  call<{ success: true; pollToken: string; expiresAt: string; approveUrl: string; qrSvg: string }>("/api/threads/pair", { method: "POST" });

/** Komputer: status pairing (nama workspace & penyetuju terisi setelah disetujui). */
export const pollThreadsPair = (token: string) =>
  call<{ success: true; status: PairPollStatus; expiresAt?: string; workspaceName?: string; approverName?: string }>(
    "/api/threads/pair/status",
    { method: "POST", body: JSON.stringify({ token }) }
  );

/** Komputer: pakai persetujuan dan ambil alamat halaman izin Threads. */
export const continueThreadsPair = (token: string) =>
  call<{ success: true; url: string }>("/api/threads/pair/status", { method: "POST", body: JSON.stringify({ token, action: "lanjut" }) });

/** HP: lihat pairing dari QR. */
export const peekThreadsPair = (id: string) =>
  call<{ success: true; status: PairingStatus; expiresAt: string; workspaceName: string }>(
    `/api/threads/pair/confirm?id=${encodeURIComponent(id)}`
  );

/** HP: setujui atau tolak. */
export const decideThreadsPair = (id: string, action: "setujui" | "tolak") =>
  call<{ success: true }>("/api/threads/pair/confirm", { method: "POST", body: JSON.stringify({ id, action }) });
