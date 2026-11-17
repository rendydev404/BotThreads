import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Eye, Zap } from "lucide-react";
import { PublicPage } from "@/components/landing/public-page";
import { DAY_TIMELINE, SETUP_STEPS } from "@/components/landing/public-data";
import { BTN, WRAP } from "@/components/landing/fonts";
import { SystemFlow } from "@/components/flow/system-flow";
import { T } from "@/components/i18n/t";
import { FEATURES_PATH, HOW_PATH, OG_IMAGE, SITE_NAME } from "@/lib/site";

const TITLE = "Cara Kerja BotThreads: Dari Tren sampai Terbit di Threads";
const DESCRIPTION =
  "Cara kerja BotThreads: AI mencari ide dari tren, menulis dengan gaya brand, memeriksa draf, menerbitkan di jam ramai lewat API resmi Threads, lalu belajar dari views. Plus cara mulai dalam empat langkah.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: HOW_PATH },
  openGraph: { type: "website", siteName: SITE_NAME, locale: "id_ID", url: HOW_PATH, title: TITLE, description: DESCRIPTION, images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [OG_IMAGE] },
};

export default function HowItWorksPage() {
  return (
    <PublicPage
      path={HOW_PATH}
      crumb="Cara kerja"
      docTitle={TITLE}
      description={DESCRIPTION}
      eyebrow="CARA KERJA"
      title="Anda kerjakan 2 langkah, sisanya jalan sendiri"
      lead="Hubungkan akun Threads dan kenalkan brand Anda ke AI, cukup sekali. Setelah itu BotThreads mencari ide, menulis, memeriksa, memposting, dan belajar dari hasilnya setiap hari."
    >
      {/* Peta alur: sama dengan di dalam aplikasi (lib/system-flow) */}
      <section className={WRAP} aria-labelledby="alur-judul">
        <h2 id="alur-judul" className="sr-only">
          <T>Alur kerja BotThreads</T>
        </h2>
        <p className="text-sm text-muted" data-reveal>
          <T>Klik tiap langkah untuk melihat apa yang terjadi dan menu mana yang dipakai di aplikasi.</T>
        </p>
        <div className="mt-6" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
          <SystemFlow variant="landing" />
        </div>
      </section>

      {/* Satu hari autopilot */}
      <section className={`${WRAP} pt-16 md:pt-24`} aria-labelledby="sehari-judul">
        <div className="max-w-2xl" data-reveal>
          <p className="lp-mono text-xs font-bold tracking-widest text-accent">
            <T>SATU HARI AUTOPILOT</T>
          </p>
          <h2 id="sehari-judul" className="lp-display mt-4 text-[2rem] leading-[1.05] md:text-[2.75rem] font-extrabold">
            <T>Yang terjadi pada akun Anda setiap hari</T>
          </h2>
          <p className="mt-4 text-[15px] text-muted leading-relaxed">
            <T>Jam di bawah adalah contoh untuk satu akun dengan pengaturan bawaan.</T>
          </p>
        </div>
        <ol className="mt-10 relative border-l-2 border-line ml-3 md:ml-4 space-y-8">
          {DAY_TIMELINE.map((s, i) => (
            <li key={s.time} className="relative pl-8 md:pl-10" data-reveal style={{ "--i": i + 1 } as React.CSSProperties}>
              <span className="lp-mono absolute -left-[1.05rem] top-0 inline-flex items-center h-7 px-2 rounded-md bg-accent text-on-accent text-xs font-bold tabular-nums">
                {s.time}
              </span>
              <h3 className="pt-9 text-lg font-bold">
                <T>{s.title}</T>
              </h3>
              <p className="mt-1.5 max-w-2xl text-sm text-muted leading-relaxed">
                <T>{s.body}</T>
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* Dua mode */}
      <section className={`${WRAP} pt-16 md:pt-24`} aria-labelledby="mode-judul">
        <div className="max-w-2xl" data-reveal>
          <p className="lp-mono text-xs font-bold tracking-widest text-accent">
            <T>DUA MODE</T>
          </p>
          <h2 id="mode-judul" className="lp-display mt-4 text-[2rem] leading-[1.05] md:text-[2.75rem] font-extrabold">
            <T>Anda yang menentukan seberapa lepas tangan</T>
          </h2>
        </div>
        <div className="mt-10 grid md:grid-cols-2 gap-4">
          <article className="lp-lift rounded-3xl border border-line bg-surface p-6 md:p-7" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
            <div className="w-11 h-11 rounded-2xl bg-warning-soft text-warning flex items-center justify-center">
              <Eye className="w-5 h-5" />
            </div>
            <h3 className="lp-display mt-5 text-2xl font-bold">
              <T>Tinjau dulu</T>
            </h3>
            <p className="mt-2 text-sm text-muted leading-relaxed">
              <T>
                {"AI menulis beberapa jam sebelum tayang dan menunggu. Anda menyetujui, mengedit, meminta tulis ulang, atau menolak. Yang tidak disetujui sampai 15 menit sebelum jamnya dilewati, bukan diterbitkan."}
              </T>
            </p>
          </article>
          <article className="lp-lift rounded-3xl border border-accent bg-accent-soft p-6 md:p-7" data-reveal style={{ "--i": 2 } as React.CSSProperties}>
            <div className="w-11 h-11 rounded-2xl bg-accent text-on-accent flex items-center justify-center">
              <Zap className="w-5 h-5" />
            </div>
            <h3 className="lp-display mt-5 text-2xl font-bold">
              <T>Otomatis</T>
            </h3>
            <p className="mt-2 text-sm text-muted leading-relaxed">
              <T>
                {"Draf yang lolos pemeriksaan langsung masuk antrean dan terbit di jamnya. Anda menerima notifikasi bila ada posting yang viral, akun yang dijeda, atau kinerja yang turun."}
              </T>
            </p>
          </article>
        </div>
      </section>

      {/* Cara mulai */}
      <section className={`${WRAP} pt-16 md:pt-24`} aria-labelledby="mulai-judul">
        <div className="max-w-2xl" data-reveal>
          <p className="lp-mono text-xs font-bold tracking-widest text-accent">
            <T>CARA MULAI</T>
          </p>
          <h2 id="mulai-judul" className="lp-display mt-4 text-[2rem] leading-[1.05] md:text-[2.75rem] font-extrabold">
            <T>Dari daftar sampai autopilot, empat langkah</T>
          </h2>
        </div>
        <ol className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {SETUP_STEPS.map((s, i) => (
            <li key={s.title} className="rounded-2xl border border-line bg-surface p-5" data-reveal style={{ "--i": i + 1 } as React.CSSProperties}>
              <span className="lp-mono text-xs font-bold text-accent tabular-nums">0{i + 1}</span>
              <h3 className="mt-2 text-base font-bold">
                <T>{s.title}</T>
              </h3>
              <p className="mt-1.5 text-[13px] text-muted leading-relaxed">
                <T>{s.body}</T>
              </p>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 sm:items-center">
          <Link href="/daftar" className={`${BTN} bg-accent hover:bg-accent-hover text-on-accent`}>
            <T>Mulai langkah pertama</T>
            <ArrowRight className="lp-arrow w-[18px] h-[18px]" />
          </Link>
          <Link href={FEATURES_PATH} className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
            <T>Lihat semua fitur</T>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
    </PublicPage>
  );
}
