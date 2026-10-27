import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { currentLocale, tr } from "@/lib/i18n/core";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(num: number): string {
  if (num === null || num === undefined) return "0";
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  }
  return num.toLocaleString(currentLocale());
}

export function formatPercent(rate: number): string {
  if (rate === null || rate === undefined) return "0.0%";
  return `${rate.toFixed(1)}%`;
}

export function formatDateWIB(date: Date | string): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(currentLocale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(d) + " WIB";
}

export function formatRelativeTime(date: Date | string): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return tr("Baru saja");
  if (diffMinutes < 60) return tr("{n}m lalu", { n: diffMinutes });
  if (diffHours < 24) return tr("{n}j lalu", { n: diffHours });
  if (diffDays === 1) return tr("Kemarin");
  if (diffDays < 7) return tr("{n} hari lalu", { n: diffDays });

  return new Intl.DateTimeFormat(currentLocale(), {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Jakarta",
  }).format(d);
}

export function cleanPostText(text: string): string {
  if (!text) return tr("(Tidak ada caption teks)");
  return text
    // Remove mojibake characters like d??... or unprintable unicode control bytes
    .replace(/d\?[\?\s\u0080-\u009F]*/gi, " ")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
