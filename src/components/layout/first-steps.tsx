"use client";

import Link from "next/link";
import { ArrowRight, Check, CreditCard, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThreadsConnectButton } from "@/components/settings/threads-connect-button";
import { ThreadsMark } from "@/components/landing/threads-mark";
import { useT } from "@/components/i18n/lang-provider";

/**
 * Workspace tanpa akun Threads. Satu ajakan yang jelas (hubungkan akun) di semua halaman, bukan banner bertumpuk.
 * `canConnect` = Pemilik/Admin (sama dengan /api/threads/oauth); peran lain diberi arahan.
 */
export function ConnectFirstBanner({ canConnect }: { canConnect: boolean }) {
  const t = useT();
  return (
    <div role="status" className="mb-5 card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex items-start gap-3.5 min-w-0 flex-1">
        <span className="w-11 h-11 shrink-0 rounded-2xl bg-accent-soft text-accent inline-flex items-center justify-center">
          <ThreadsMark className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-fg">{t("Satu langkah lagi: hubungkan akun Threads Anda")}</p>
          <p className="mt-0.5 text-sm text-muted leading-relaxed">
            {t("Cukup sekali, sekitar 1 menit. Setelah itu AI mulai menulis, menjadwalkan, dan melaporkan hasilnya.")}
          </p>
        </div>
      </div>
      {canConnect ? (
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <ThreadsConnectButton size="sm" />
          <Link href="/billing" className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold text-muted hover:text-fg transition-colors">
            <CreditCard className="w-3.5 h-3.5" />
            {t("Lihat paket")}
          </Link>
        </div>
      ) : (
        <p className="text-xs text-muted shrink-0">{t("Minta Pemilik atau Admin workspace menghubungkannya.")}</p>
      )}
    </div>
  );
}

interface Step {
  title: string;
  text: string;
  done?: boolean;
  action?: React.ReactNode;
}

/**
 * Ringkasan untuk workspace yang belum punya akun: daripada dasbor penuh angka 0, tampilkan jalan pendek ke
 * hasil pertama. Langkah pertama sudah dicentang (akun BotThreads sudah jadi) supaya terasa sudah berjalan.
 */
export function FirstSteps({ canConnect }: { canConnect: boolean }) {
  const t = useT();
  const steps: Step[] = [
    { title: "Buat akun BotThreads", text: "Selesai. Selamat datang!", done: true },
    {
      title: "Hubungkan akun Threads",
      text: "Login resmi lewat Threads, sekitar 1 menit. Kata sandi Anda tidak pernah kami lihat.",
      action: canConnect ? <ThreadsConnectButton size="sm" /> : <p className="text-xs text-muted">{t("Minta Pemilik atau Admin workspace menghubungkannya.")}</p>,
    },
    {
      title: "Kenalkan bisnis Anda ke AI",
      text: "Isi siapa akunnya dan gaya bahasanya, supaya tulisan AI terdengar seperti Anda.",
    },
    {
      title: "Nyalakan Autopilot",
      text: "AI mencari ide, menulis, lalu memposting di jam ramai. Anda tinggal memantau.",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const current = steps.findIndex((s) => !s.done);

  return (
    <section aria-label={t("Mulai pakai BotThreads")} className="card overflow-hidden">
      <div className="p-5 sm:p-7 bg-gradient-to-br from-accent-soft to-transparent">
        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-surface text-xs font-semibold text-accent">
          <Sparkles className="w-3.5 h-3.5" />
          {t("{done} dari {total} langkah selesai", { done: doneCount, total: steps.length })}
        </span>
        <h2 className="mt-3 text-xl sm:text-2xl font-bold text-fg">{t("Tinggal 3 langkah sampai posting pertama Anda")}</h2>
        <p className="mt-1 text-sm text-muted max-w-xl leading-relaxed">
          {t("Angka performa akan muncul di halaman ini begitu akun Threads terhubung dan posting pertama terbit.")}
        </p>
        <div className="mt-4 h-2 rounded-full bg-surface overflow-hidden" aria-hidden>
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
        </div>
      </div>
      <ol className="divide-y divide-line">
        {steps.map((s, i) => {
          const active = i === current;
          return (
            <li key={s.title} className={cn("p-4 sm:px-7 flex flex-col sm:flex-row sm:items-center gap-3", !active && !s.done && "opacity-60")}>
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <span
                  className={cn(
                    "w-8 h-8 shrink-0 rounded-full inline-flex items-center justify-center text-sm font-bold tabular-nums",
                    s.done ? "bg-success-soft text-success" : active ? "bg-accent text-on-accent" : "bg-subtle text-muted"
                  )}
                >
                  {s.done ? <Check className="w-4 h-4" /> : i}
                </span>
                <div className="min-w-0">
                  <p className={cn("text-sm font-semibold", s.done ? "text-muted line-through" : "text-fg")}>{t(s.title)}</p>
                  <p className="mt-0.5 text-[13px] text-muted leading-relaxed">{t(s.text)}</p>
                </div>
              </div>
              {active && s.action && <div className="shrink-0 pl-11 sm:pl-0 sm:ml-4">{s.action}</div>}
              {!active && !s.done && (
                <span className="shrink-0 pl-11 sm:pl-0 sm:ml-4 text-xs text-muted inline-flex items-center gap-1">
                  {t("Terbuka setelah langkah {n}", { n: i - 1 })}
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
