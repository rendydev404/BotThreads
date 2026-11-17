import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MessageCircle } from "lucide-react";
import { PublicPage } from "@/components/landing/public-page";
import { FAQ } from "@/components/landing/faq-data";
import { WRAP } from "@/components/landing/fonts";
import { JsonLd } from "@/components/seo/json-ld";
import { T } from "@/components/i18n/t";
import { MERCHANT_INFO } from "@/lib/legal-content";
import { FAQ_PATH, OG_IMAGE, SITE_NAME, faqPageJsonLd } from "@/lib/site";

const TITLE = "Tanya Jawab (FAQ) BotThreads";
const DESCRIPTION =
  "Tanya jawab seputar BotThreads: keamanan akun Threads, persetujuan posting, sumber ide, jadwal posting, cara menghentikan autopilot, pembayaran, dan pengembalian dana.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: FAQ_PATH },
  openGraph: { type: "website", siteName: SITE_NAME, locale: "id_ID", url: FAQ_PATH, title: TITLE, description: DESCRIPTION, images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [OG_IMAGE] },
};

/** Jangkar stabil per pertanyaan (#urutan), supaya tiap jawaban bisa ditautkan langsung. */
const anchor = (i: number) => `tanya-${i + 1}`;

export default function FaqPage() {
  return (
    <PublicPage
      path={FAQ_PATH}
      crumb="Tanya jawab"
      docTitle={TITLE}
      description={DESCRIPTION}
      eyebrow="TANYA JAWAB"
      title="Yang biasanya ditanyakan lebih dulu"
      lead="Jawaban apa adanya, termasuk batasannya. Setiap jawaban mengikuti aturan yang benar-benar dipakai sistem."
    >
      <JsonLd data={faqPageJsonLd(FAQ, FAQ_PATH)} />
      <div className={`${WRAP} grid lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] gap-10`}>
        {/* Daftar pertanyaan: tetap di samping saat digulir (desktop) */}
        <nav aria-label="Daftar pertanyaan" className="lg:sticky lg:top-24 self-start">
          <ol className="space-y-1 text-[13px]">
            {FAQ.map((f, i) => (
              <li key={f.q}>
                <a href={`#${anchor(i)}`} className="flex gap-2 rounded-lg px-2 py-1.5 text-muted hover:text-fg hover:bg-subtle transition-colors">
                  <span className="lp-mono font-bold text-faint tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                  <span className="leading-snug">
                    <T>{f.q}</T>
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {/* Semua jawaban terbuka (bukan akordeon): mudah dibaca, dan mudah dikutip mesin pencari maupun AI. */}
        <div className="divide-y divide-line border-y border-line">
          {FAQ.map((f, i) => (
            <section key={f.q} id={anchor(i)} aria-labelledby={`${anchor(i)}-judul`} className="scroll-mt-24 py-7">
              <h2 id={`${anchor(i)}-judul`} className="text-lg md:text-xl font-bold leading-snug">
                <T>{f.q}</T>
              </h2>
              <p className="mt-3 text-[15px] text-muted leading-relaxed">
                <T>{f.a}</T>
              </p>
            </section>
          ))}
        </div>
      </div>

      <section className={`${WRAP} pt-12`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-5 md:p-6">
          <div className="flex items-start gap-3">
            <MessageCircle className="w-5 h-5 mt-0.5 text-accent shrink-0" />
            <div>
              <h2 className="text-base font-bold">
                <T>Pertanyaan Anda belum terjawab?</T>
              </h2>
              <p className="mt-1 text-sm text-muted">
                <T>{MERCHANT_INFO.operatingHours}</T>
              </p>
            </div>
          </div>
          <Link href="/kontak" className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline shrink-0">
            <T>Hubungi kami</T>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
    </PublicPage>
  );
}
