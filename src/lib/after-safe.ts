import { after } from "next/server";

/**
 * Jadwalkan pekerjaan latar setelah respons terkirim (`after` Next). Pekerjaan latar tidak boleh
 * menggagalkan respons utama: bila `after` tidak tersedia (di luar lingkup request, mis. tes), pekerjaan
 * dilewati dan dicatat, sementara respons tetap berhasil.
 */
export function afterResponse(label: string, task: () => Promise<unknown>): void {
  try {
    after(task);
  } catch (err) {
    console.warn(`[after] ${label} dilewati:`, err instanceof Error ? err.message : err);
  }
}
