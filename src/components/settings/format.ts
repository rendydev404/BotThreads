/**
 * Pembantu format murni untuk halaman Radar dan Pengaturan. Tidak ada yang membaca jam sekarang,
 * jadi aman dipanggil saat render.
 */
import { ContentApiError } from "@/lib/content-client";
import { wibParts } from "@/lib/scheduling";

export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const MONTH_LONG = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

export const pad2 = (n: number): string => String(n).padStart(2, "0");

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Pecah "YYYY-MM-DD" menjadi angka (bulan 1-12); null bila bentuknya salah. */
export function parseDayKey(key: string | null | undefined): { y: number; m: number; d: number } | null {
  const hit = key ? DAY_KEY.exec(key) : null;
  if (!hit) return null;
  const y = Number(hit[1]);
  const m = Number(hit[2]);
  const d = Number(hit[3]);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? { y, m, d } : null;
}

export const toDayKey = (y: number, m: number, d: number): string => `${y}-${pad2(m)}-${pad2(d)}`;

/** Jumlah hari pada bulan `m` (1-12). */
export const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** "14 Okt 2026" dari kunci hari "YYYY-MM-DD". */
export function formatDayKey(key: string | null | undefined): string {
  const p = parseDayKey(key);
  return p ? `${p.d} ${MONTH_SHORT[p.m - 1]} ${p.y}` : (key ?? "-");
}

/** "14 Okt 2026" (WIB) dari ISO UTC. */
export function formatDateWib(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  const p = wibParts(date);
  return `${p.d} ${MONTH_SHORT[p.m]} ${p.y}`;
}

/** Rentang hari: "14 Okt 2026" atau "14 - 20 Okt 2026" atau lengkap bila beda bulan/tahun. */
export function formatDayRange(start: string, end: string): string {
  const a = parseDayKey(start);
  const b = parseDayKey(end);
  if (!a || !b) return `${start} - ${end}`;
  if (start === end) return formatDayKey(start);
  if (a.y === b.y && a.m === b.m) return `${a.d} - ${b.d} ${MONTH_SHORT[b.m - 1]} ${b.y}`;
  if (a.y === b.y) return `${a.d} ${MONTH_SHORT[a.m - 1]} - ${b.d} ${MONTH_SHORT[b.m - 1]} ${b.y}`;
  return `${formatDayKey(start)} - ${formatDayKey(end)}`;
}

/** Bilangan bulat dengan pemisah ribuan Indonesia ("12.345"). */
export const formatInt = (n: number): string => Math.round(Number.isFinite(n) ? n : 0).toLocaleString("id-ID");

/** Kelipatan views: "1,4x". */
export const formatMultiplier = (x: number): string => `${(Number.isFinite(x) ? x : 0).toFixed(1).replace(".", ",")}x`;

/** Nilai 0..1 menjadi 0..100 (dibulatkan, dijepit). */
export const toScore100 = (v: number | null | undefined): number =>
  Math.round(Math.min(1, Math.max(0, typeof v === "number" && Number.isFinite(v) ? v : 0)) * 100);

/** Durasi singkat: "850 ms" atau "2,4 dtk". */
export const formatMs = (ms: number): string => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1).replace(".", ",")} dtk`);

export const errorText = (e: unknown, fallback: string): string => (e instanceof Error && e.message ? e.message : fallback);

export const errorStatus = (e: unknown): number | null => (e instanceof ContentApiError ? e.status : null);

export const errorDetails = (e: unknown): string[] | undefined => (e instanceof ContentApiError ? e.details : undefined);
