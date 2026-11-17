import Link from "next/link";
import { ArrowRight, ArrowUpRight, ChevronRight } from "lucide-react";
import { LandingFooter } from "@/components/landing/legal-section";
import { LandingMotion } from "@/components/landing/motion";
import { SiteHeader } from "@/components/landing/site-header";
import { BTN, LANDING_FONTS, WRAP } from "@/components/landing/fonts";
import { JsonLd } from "@/components/seo/json-ld";
import { DocTitle, T } from "@/components/i18n/t";
import { PUBLIC_NAV, SITE_NAME, breadcrumbJsonLd, webPageJsonLd } from "@/lib/site";
import "@/app/selamat-datang/landing.css";

/** Ringkasan tiap halaman informasi untuk kartu "Jelajahi" di bawah halaman lain. */
const NAV_SUMMARY: Record<string, string> = {
  "/fitur": "Sepuluh hal yang dikerjakan BotThreads untuk akun Threads Anda.",
  "/cara-kerja-botthreads": "Satu hari autopilot dari tren pagi sampai belajar dari views malam.",
  "/harga": "Paket bulanan dalam Rupiah, dibayar lewat Midtrans.",
  "/faq": "Jawaban apa adanya, termasuk batasannya.",
};

/**
 * Kerangka halaman informasi publik (/fitur, /cara-kerja-botthreads, /harga, /faq): header dengan menu yang sama,
 * remah roti, judul H1, isi, tautan ke halaman informasi lain, ajakan mendaftar, dan footer.
 */
export function PublicPage({
  path,
  crumb,
  docTitle,
  description,
  eyebrow,
  title,
  lead,
  children,
}: {
  path: string;
  /** Nama pendek di remah roti dan BreadcrumbList. */
  crumb: string;
  /** Judul tab (sama dengan metadata.title), diterjemahkan di klien untuk pengguna EN. */
  docTitle: string;
  description: string;
  eyebrow: string;
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  const others = PUBLIC_NAV.filter((n) => n.path !== path);
  return (
    <LandingMotion className={`${LANDING_FONTS} flex-1 w-full min-h-screen bg-canvas text-fg overflow-x-clip`}>
      <DocTitle title={docTitle} />
      <JsonLd data={webPageJsonLd(docTitle, description, path)} />
      <JsonLd data={breadcrumbJsonLd(crumb, path)} />
      <SiteHeader current={path} />

      <main>
        <section className="relative -mt-[4.25rem] pt-[4.25rem]">
          <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
            <div className="lp-dots" />
            <div className="lp-halo" />
          </div>
          <div className={`${WRAP} relative pt-10 pb-12 md:pt-16 md:pb-16`}>
            <nav aria-label="Remah roti" className="text-[13px] text-muted">
              <ol className="flex items-center gap-1.5">
                <li>
                  <Link href="/selamat-datang" className="hover:text-fg transition-colors">
                    {SITE_NAME}
                  </Link>
                </li>
                <li aria-hidden="true">
                  <ChevronRight className="w-3.5 h-3.5" />
                </li>
                <li aria-current="page" className="font-semibold text-fg">
                  <T>{crumb}</T>
                </li>
              </ol>
            </nav>
            <p className="lp-rise lp-mono mt-8 text-xs font-bold tracking-widest text-accent" style={{ "--i": 0 } as React.CSSProperties}>
              <T>{eyebrow}</T>
            </p>
            <h1 className="lp-rise lp-display mt-4 max-w-3xl text-[2.25rem] leading-[1.03] md:text-[3.5rem] font-extrabold" style={{ "--i": 1 } as React.CSSProperties}>
              <T>{title}</T>
            </h1>
            <p className="lp-rise mt-5 max-w-2xl text-base md:text-lg text-muted leading-relaxed" style={{ "--i": 2 } as React.CSSProperties}>
              <T>{lead}</T>
            </p>
          </div>
        </section>

        {children}

        {/* Tautan antarhalaman informasi: membantu pengunjung dan memberi Google struktur situs yang jelas. */}
        <section className={`${WRAP} pt-16 md:pt-24`} aria-labelledby="jelajahi-judul">
          <h2 id="jelajahi-judul" className="lp-mono text-xs font-bold tracking-widest text-accent">
            <T>JELAJAHI BOTTHREADS</T>
          </h2>
          <ul className="mt-5 grid sm:grid-cols-3 gap-3">
            {others.map((n) => (
              <li key={n.path}>
                <Link href={n.path} className="lp-lift group flex h-full flex-col rounded-2xl border border-line bg-surface p-5 hover:border-accent transition-colors">
                  <span className="flex items-center justify-between gap-2 text-base font-bold">
                    <T>{n.label}</T>
                    <ArrowRight className="lp-arrow w-4 h-4 text-accent" />
                  </span>
                  <span className="mt-1.5 text-[13px] text-muted leading-snug">
                    <T>{NAV_SUMMARY[n.path] ?? ""}</T>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className={`${WRAP} py-16 md:py-24`}>
          <div className="relative rounded-[2rem] bg-fg text-canvas px-6 py-12 md:px-14 md:py-16 overflow-hidden" data-reveal>
            <div className="relative flex flex-col md:flex-row md:items-end justify-between gap-8">
              <div className="max-w-xl">
                <h2 className="lp-display text-[2rem] leading-[1.05] md:text-[3rem] font-extrabold">
                  <T>Mulai dari satu akun, mode Tinjau dulu.</T>
                </h2>
                <p className="mt-3 text-sm md:text-base opacity-75 leading-relaxed">
                  <T>Lihat gaya tulisnya selama dua hari. Kalau cocok, biarkan berjalan sendiri.</T>
                </p>
              </div>
              <Link href="/daftar" className={`${BTN} bg-accent hover:bg-accent-hover text-on-accent shrink-0`}>
                <T>Buat workspace</T>
                <ArrowUpRight className="lp-arrow w-[18px] h-[18px]" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter wrap={WRAP} />
    </LandingMotion>
  );
}
