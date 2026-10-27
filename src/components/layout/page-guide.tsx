"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, Bot, Hand, Route, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FLOW_STEPS, flowStepForPath } from "@/lib/system-flow";
import { useT } from "@/components/i18n/lang-provider";

const STORE_KEY = "bt:page-guide-hidden";
const CHANGE_EVENT = "bt:page-guide";

function readRaw(): string {
  try {
    return localStorage.getItem(STORE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function writeRaw(value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, value);
  } catch {
    /* mode privat: pilihan tidak diingat */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function parseHidden(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Pita kecil di atas halaman: halaman ini langkah ke berapa dari alur BotThreads, apa yang perlu
 * dilakukan di sini, dan langkah berikutnya. Bisa ditutup per langkah (diingat di peramban ini).
 */
export function PageGuide({ pathname }: { pathname: string }) {
  const t = useT();
  const step = flowStepForPath(pathname);
  // null di server: pita baru tampil setelah pilihan "tutup" dari localStorage terbaca, supaya tidak berkedip.
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const hidden = raw === null ? null : parseHidden(raw);

  if (!step || hidden === null || hidden.includes(step.id)) return null;

  const next = FLOW_STEPS[step.no] ?? null;
  // Langkah 2 sebagian ada di halaman yang sama dengan langkah 1 (Profil AI), jadi arahkan ke Pengetahuan.
  const nextHref = next?.id === "kenalkan" ? "/pengaturan?tab=pengetahuan" : next?.href;
  const auto = step.by === "otomatis";

  const close = () => writeRaw(JSON.stringify([...hidden, step.id]));

  return (
    <div role="note" className="mb-5 relative rounded-xl border border-line bg-surface p-3.5 pr-11 text-sm">
      <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4">
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center h-6 px-2 rounded-md bg-subtle text-[11px] font-bold text-fg tabular-nums">
            {t("Langkah {no} dari {total}", { no: step.no, total: FLOW_STEPS.length })}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-bold",
              auto ? "bg-accent-soft text-accent" : "bg-warning-soft text-warning"
            )}
          >
            {auto ? <Bot className="w-3.5 h-3.5" /> : <Hand className="w-3.5 h-3.5" />}
            {auto ? t("Otomatis") : t("Tugas Anda")}
          </span>
        </div>
        <p className="min-w-0 flex-1 text-fg leading-relaxed">
          <span className="font-semibold">{t(step.title)}.</span> <span className="text-muted">{t(step.you ?? step.short)}</span>
        </p>
        <div className="flex items-center gap-3 shrink-0 text-[13px] font-semibold">
          <Link href="/cara-kerja" className="inline-flex items-center gap-1 text-muted hover:text-fg transition-colors">
            <Route className="w-4 h-4" />
            {t("Lihat alur")}
          </Link>
          {next && (
            <Link href={nextHref ?? next.href} className="inline-flex items-center gap-1 text-accent hover:text-accent-hover transition-colors">
              {t("Berikutnya: {title}", { title: t(next.title) })}
              <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={close}
        aria-label={t("Tutup panduan halaman ini")}
        title={t("Tutup panduan ini (bisa dibuka lagi di Panduan Cara Kerja)")}
        className="absolute top-2.5 right-2.5 w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-fg hover:bg-subtle transition-colors cursor-pointer"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

/** Tampilkan lagi semua panduan halaman yang pernah ditutup. */
export function resetPageGuides(): void {
  writeRaw(null);
}
