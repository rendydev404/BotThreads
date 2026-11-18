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
    <div role="note" className="mb-5 relative rounded-2xl border border-line bg-surface pl-4 pr-11 py-2.5 md:py-3 text-sm">
      {/* HP: satu baris saja (titik kemajuan, judul langkah, panah berikutnya) supaya isi halaman cepat terlihat. */}
      <div className="flex items-center gap-3 md:gap-4">
        {/* Posisi di alur sebagai titik kemajuan: lebih cepat dibaca daripada label teks. */}
        <div className="flex items-center gap-2.5 shrink-0" aria-label={t("Langkah {no} dari {total}", { no: step.no, total: FLOW_STEPS.length })}>
          <span className="flex items-center gap-1" aria-hidden>
            {FLOW_STEPS.map((s) => (
              <span
                key={s.id}
                className={cn("h-1.5 rounded-full transition-all", s.no === step.no ? "w-5 bg-accent" : s.no < step.no ? "w-1.5 bg-accent/50" : "w-1.5 bg-line-strong")}
              />
            ))}
          </span>
          <span className="text-[11px] font-semibold text-muted tabular-nums max-md:sr-only">
            {step.no}/{FLOW_STEPS.length}
          </span>
          {auto ? <Bot className="w-4 h-4 text-accent max-md:hidden" aria-label={t("Otomatis")} /> : <Hand className="w-4 h-4 text-warning max-md:hidden" aria-label={t("Tugas Anda")} />}
        </div>
        <p className="min-w-0 flex-1 text-fg leading-relaxed max-md:truncate">
          <span className="font-semibold">{t(step.title)}</span>
          <span className="text-muted max-md:hidden">. {t(step.you ?? step.short)}</span>
        </p>
        <div className="flex items-center gap-3 shrink-0 text-[13px] font-semibold">
          <Link href="/cara-kerja" className="inline-flex items-center gap-1 text-muted hover:text-fg transition-colors max-md:hidden">
            <Route className="w-4 h-4" />
            {t("Lihat alur")}
          </Link>
          {next && (
            <Link
              href={nextHref ?? next.href}
              aria-label={t("Berikutnya: {title}", { title: t(next.title) })}
              className="inline-flex items-center justify-center gap-1 text-accent hover:text-accent-hover transition-colors max-md:w-9 max-md:h-9 max-md:rounded-full max-md:bg-accent-soft"
            >
              <span className="max-md:hidden">{t("Berikutnya")}</span>
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
        className="absolute top-1/2 -translate-y-1/2 right-1.5 w-9 h-9 rounded-lg flex items-center justify-center text-muted hover:text-fg hover:bg-subtle transition-colors cursor-pointer"
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
