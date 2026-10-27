"use client";

import { useState } from "react";
import Link from "next/link";
import { Compass, Sparkles, Route } from "lucide-react";
import { SystemFlow } from "@/components/flow/system-flow";
import { useMe } from "@/components/layout/use-me";
import { resetPageGuides } from "@/components/layout/page-guide";
import { startTour } from "@/components/tour/tour-events";
import type { FlowStepId } from "@/lib/system-flow";
import { useT } from "@/components/i18n/lang-provider";

export default function CaraKerjaPage() {
  const { me } = useMe();
  const t = useT();
  const done: FlowStepId[] = me?.accountCount ? ["hubungkan"] : [];
  const [guidesBack, setGuidesBack] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
            <Route className="w-5 h-5" />
          </div>
          <div className="min-w-0 max-w-2xl">
            <h2 className="text-xl font-bold text-fg leading-tight">{t("Begini BotThreads bekerja")}</h2>
            <p className="mt-1 text-sm text-muted leading-relaxed">
              {t("Ada enam langkah. Anda cukup mengerjakan langkah 1 dan 2 sekali di awal. Langkah 3 sampai 6 berjalan sendiri setiap hari, dan Anda bisa ikut campur kapan saja. Klik satu langkah untuk melihat rinciannya.")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => {
            resetPageGuides();
            setGuidesBack(true);
          }}
          disabled={guidesBack}
          className="inline-flex items-center justify-center h-10 px-3 rounded-lg text-sm font-semibold text-muted hover:text-fg hover:bg-subtle transition-colors cursor-pointer"
        >
          {guidesBack ? t("Panduan halaman tampil lagi") : t("Tampilkan lagi panduan halaman")}
        </button>
        <button
          type="button"
          onClick={startTour}
          className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-line bg-surface text-sm font-semibold text-fg hover:bg-subtle transition-colors cursor-pointer shrink-0"
        >
          <Compass className="w-4 h-4 text-accent" />
          {t("Putar tur 2 menit")}
        </button>
        </div>
      </div>

      {/* key: saat profil termuat, langkah yang terbuka pindah ke langkah pertama yang belum selesai. */}
      <SystemFlow key={done.join()} variant="app" doneIds={done} />

      <div className="card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-accent mt-0.5 shrink-0" />
          <p className="text-sm text-fg leading-relaxed">
            <span className="font-semibold">{t("Masih bingung?")}</span>{" "}
            {t("Tanyakan saja ke Studio AI dengan bahasa sehari-hari, misalnya")} &ldquo;{t("kenapa akun saya belum posting hari ini?")}&rdquo;
          </p>
        </div>
        <Link
          href="/prompt-studio"
          className="inline-flex items-center justify-center h-10 px-4 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-semibold transition-colors shrink-0"
        >
          {t("Buka Studio AI")}
        </Link>
      </div>
    </div>
  );
}
