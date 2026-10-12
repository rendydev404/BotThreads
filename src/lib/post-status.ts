/**
 * Pemetaan status penerbitan -> status tampilan (PRD 6.4). Murni, dipakai server (kontrak API)
 * dan diuji unit.
 *
 * Aturan mengikuti perilaku worker threads-publisher:
 * - Tahap 1 mengunci (lockedAt) lalu membuat container (platformContainerId) dan menandai post DIPROSES.
 * - Tahap 2 menerbitkan container yang FINISHED lalu menandai dispatch TERBIT / GAGAL.
 */
import { EDIT_LOCK_MS } from "./content-config";
import { STATUS_LABEL, type PostStatusKey } from "./content-types";

export interface StatusInput {
  /** ScheduledPost.status */
  postStatus: string;
  /** PostDispatch.status */
  dispatchStatus: string;
  tayangPada: Date;
  platformContainerId: string | null;
  lockedAt: Date | null;
}

export interface StatusView {
  key: PostStatusKey;
  label: string;
  /** Teks/topik/jam boleh diubah. */
  editable: boolean;
  /** Boleh dibatalkan (dihapus dari antrean). */
  cancellable: boolean;
  /** Boleh dikirim ulang. */
  retryable: boolean;
}

export function postStatusView(input: StatusInput, now: Date): StatusView {
  const make = (key: PostStatusKey, editable = false, cancellable = false, retryable = false): StatusView => ({
    key,
    label: STATUS_LABEL[key],
    editable,
    cancellable,
    retryable,
  });

  if (input.dispatchStatus === "TERBIT" || input.postStatus === "SELESAI") return make("PUBLISHED");
  if (input.dispatchStatus === "GAGAL" || input.postStatus === "GAGAL") return make("FAILED", false, false, true);

  const inFlight =
    input.platformContainerId !== null || input.lockedAt !== null || input.postStatus === "DIPROSES";
  if (inFlight) return make("PROCESSING");

  if (input.tayangPada.getTime() > now.getTime()) {
    // Edit ditolak bila hampir tayang: worker bisa mengambilnya kapan saja.
    const editable = input.tayangPada.getTime() > now.getTime() + EDIT_LOCK_MS;
    return make("SCHEDULED", editable, true);
  }
  // Mengantre: belum diambil worker, masih boleh dibatalkan (mis. worker sedang mati).
  return make("QUEUED", false, true);
}

/** Pesan galat penerbit yang menandakan masalah akun (bukan konten): kirim ulang tidak berguna. */
export const ACCOUNT_ERROR_PATTERN = /sesi|hubungkan ulang|kedaluwarsa|belum terhubung|terputus/i;

export const isAccountError = (pesanError: string | null | undefined): boolean =>
  !!pesanError && ACCOUNT_ERROR_PATTERN.test(pesanError);
