import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BarChart3, Check, Clock, Eye, KeyRound, MessageSquareReply, PenLine, Radar, ShieldCheck, OctagonPause, Users } from "lucide-react";
import { GateDemo, HoursPlanner, IdeaSources } from "@/components/landing/demos";
import { PublicPage } from "@/components/landing/public-page";
import { COMPARISON, FEATURES, type FeatureIcon } from "@/components/landing/public-data";
import { WRAP } from "@/components/landing/fonts";
import { T } from "@/components/i18n/t";
import { FEATURES_PATH, HOW_PATH, OG_IMAGE, SITE_NAME } from "@/lib/site";

const TITLE = "Fitur BotThreads: Autopilot AI untuk Akun Threads";
const DESCRIPTION =
  "Fitur BotThreads: ide posting otomatis dari tren, penulisan dengan gaya brand, pemeriksaan sebelum terbit, jadwal di jam ramai, analitik, moderasi balasan, dan rem pengaman.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: FEATURES_PATH },
  openGraph: { type: "website", siteName: SITE_NAME, locale: "id_ID", url: FEATURES_PATH, title: TITLE, description: DESCRIPTION, images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [OG_IMAGE] },
};

const ICONS: Record<FeatureIcon, React.ComponentType<{ className?: string }>> = {
  radar: Radar,
  pen: PenLine,
  shield: ShieldCheck,
  clock: Clock,
  eye: Eye,
  chart: BarChart3,
  brake: OctagonPause,
  reply: MessageSquareReply,
  users: Users,
  lock: KeyRound,
};

export default function FeaturesPage() {
  return (
    <PublicPage
      path={FEATURES_PATH}
      crumb="Fitur"
      docTitle={TITLE}
      description={DESCRIPTION}
      eyebrow="FITUR"
      title="Semua yang dikerjakan BotThreads untuk akun Threads Anda"
      lead="Dari mencari ide sampai belajar dari views, setiap langkah berjalan sendiri dan tetap bisa Anda awasi. Berikut fitur utamanya, lengkap dengan aturan yang benar-benar dipakai sistem."
    >
      {/* Daftar isi: jangkar ke tiap fitur */}
      <nav aria-label="Daftar fitur" className={`${WRAP}`}>
        <ul className="flex flex-wrap gap-2">
          {FEATURES.map((f) => (
            <li key={f.id}>
              <a href={`#${f.id}`} className="inline-flex h-9 items-center rounded-full border border-line bg-surface px-3.5 text-[13px] font-semibold text-muted hover:text-fg hover:border-accent transition-colors">
                <T>{f.title}</T>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className={`${WRAP} mt-10 grid md:grid-cols-2 gap-4`}>
        {FEATURES.map((f, i) => {
          const Icon = ICONS[f.icon];
          return (
            <section
              key={f.id}
              id={f.id}
              aria-labelledby={`${f.id}-judul`}
              className="lp-lift scroll-mt-24 rounded-3xl border border-line bg-surface p-6 md:p-7"
              data-reveal
              style={{ "--i": (i % 2) + 1 } as React.CSSProperties}
            >
              <div className="flex items-center justify-between">
                <div className="w-11 h-11 rounded-2xl bg-accent-soft text-accent flex items-center justify-center">
                  <Icon className="w-5 h-5" />
                </div>
                <span className="lp-mono text-xs font-bold text-faint tabular-nums">{String(i + 1).padStart(2, "0")}</span>
              </div>
              <h2 id={`${f.id}-judul`} className="lp-display mt-5 text-2xl font-bold leading-tight">
                <T>{f.title}</T>
              </h2>
              <p className="mt-2 text-sm text-muted leading-relaxed">
                <T>{f.body}</T>
              </p>
              <ul className="mt-5 space-y-2 text-[13px] text-fg">
                {f.points.map((p) => (
                  <li key={p} className="flex items-start gap-2.5 leading-relaxed">
                    <Check className="w-4 h-4 mt-0.5 text-success shrink-0" />
                    <span>
                      <T>{p}</T>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {/* Coba langsung: demo interaktif yang sama dengan di halaman perkenalan */}
      <section className={`${WRAP} pt-16 md:pt-24`} aria-labelledby="coba-judul">
        <div className="max-w-2xl" data-reveal>
          <p className="lp-mono text-xs font-bold tracking-widest text-accent">
            <T>COBA LANGSUNG</T>
          </p>
          <h2 id="coba-judul" className="lp-display mt-4 text-[2rem] leading-[1.05] md:text-[2.75rem] font-extrabold">
            <T>Lihat fiturnya bekerja</T>
          </h2>
        </div>
        <div className="mt-10 space-y-14">
          <div data-reveal>
            <h3 className="text-lg font-bold">
              <T>Dari mana ide datang</T>
            </h3>
            <div className="mt-5">
              <IdeaSources />
            </div>
          </div>
          <div data-reveal>
            <h3 className="text-lg font-bold">
              <T>Jam tayang dihitung, bukan ditebak</T>
            </h3>
            <div className="mt-5">
              <HoursPlanner />
            </div>
          </div>
          <div data-reveal>
            <h3 className="text-lg font-bold">
              <T>Tidak semua draf boleh terbit</T>
            </h3>
            <div className="mt-5">
              <GateDemo />
            </div>
          </div>
        </div>
      </section>

      {/* Perbandingan */}
      <section className={`${WRAP} pt-16 md:pt-24`} aria-labelledby="banding-judul">
        <div className="max-w-2xl" data-reveal>
          <p className="lp-mono text-xs font-bold tracking-widest text-accent">
            <T>PERBANDINGAN</T>
          </p>
          <h2 id="banding-judul" className="lp-display mt-4 text-[2rem] leading-[1.05] md:text-[2.75rem] font-extrabold">
            <T>BotThreads dibandingkan cara lain mengelola Threads</T>
          </h2>
        </div>
        <ul className="mt-8 space-y-3 md:hidden">
          {COMPARISON.map((c) => (
            <li key={c.row} className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-sm font-bold">
                <T>{c.row}</T>
              </p>
              <p className="mt-2.5 rounded-xl bg-accent-soft px-3 py-2 text-[13px] font-medium text-fg leading-snug">
                <span className="block text-[11px] font-bold text-accent">BotThreads</span>
                <T>{c.bot}</T>
              </p>
              <dl className="mt-2.5 grid grid-cols-2 gap-3 text-[12px] leading-snug">
                <div>
                  <dt className="font-semibold text-faint">
                    <T>Posting manual</T>
                  </dt>
                  <dd className="mt-0.5 text-muted">
                    <T>{c.manual}</T>
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-faint">
                    <T>Penjadwal biasa</T>
                  </dt>
                  <dd className="mt-0.5 text-muted">
                    <T>{c.scheduler}</T>
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        <div className="mt-8 hidden md:block overflow-x-auto rounded-2xl border border-line bg-surface" data-reveal>
          <table className="w-full text-left text-sm leading-snug">
            <caption className="sr-only">
              <T>Perbandingan posting manual, aplikasi penjadwal biasa, dan BotThreads</T>
            </caption>
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th scope="col" className="p-4 font-semibold w-[22%]">
                  <span className="sr-only">
                    <T>Pekerjaan</T>
                  </span>
                </th>
                <th scope="col" className="p-4 font-semibold">
                  <T>Posting manual</T>
                </th>
                <th scope="col" className="p-4 font-semibold">
                  <T>Penjadwal biasa</T>
                </th>
                <th scope="col" className="p-4 font-bold text-accent bg-accent-soft">BotThreads</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((c) => (
                <tr key={c.row} className="border-b border-line last:border-0 align-top">
                  <th scope="row" className="p-4 font-semibold text-fg">
                    <T>{c.row}</T>
                  </th>
                  <td className="p-4 text-muted">
                    <T>{c.manual}</T>
                  </td>
                  <td className="p-4 text-muted">
                    <T>{c.scheduler}</T>
                  </td>
                  <td className="p-4 font-medium text-fg bg-accent-soft">
                    <T>{c.bot}</T>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-6">
          <Link href={HOW_PATH} className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
            <T>Lihat cara kerjanya dari tren sampai terbit</T>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </p>
      </section>
    </PublicPage>
  );
}
