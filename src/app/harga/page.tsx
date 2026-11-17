import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, CalendarClock, Check, CreditCard, RefreshCcw, Wallet } from "lucide-react";
import { Pricing } from "@/components/landing/pricing";
import { PublicPage } from "@/components/landing/public-page";
import { FAQ } from "@/components/landing/faq-data";
import { WRAP } from "@/components/landing/fonts";
import { PaymentLogo } from "@/components/settings/payment-logos";
import { T } from "@/components/i18n/t";
import { PAYMENT_METHODS } from "@/lib/billing-types";
import { FAQ_PATH, OG_IMAGE, PRICING_PATH, SITE_NAME } from "@/lib/site";

const TITLE = "Harga BotThreads: Paket Langganan dalam Rupiah";
const DESCRIPTION =
  "Harga dan paket langganan BotThreads dalam Rupiah: jumlah akun Threads, posting per hari, dan mode autopilot tiap paket. Bayar bulanan, 3 bulan, atau tahunan lewat Midtrans.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: PRICING_PATH },
  openGraph: { type: "website", siteName: SITE_NAME, locale: "id_ID", url: PRICING_PATH, title: TITLE, description: DESCRIPTION, images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [OG_IMAGE] },
};

/** Aturan tagihan yang sama untuk semua paket (lihat faq-data.ts dan kebijakan pengembalian). */
const BILLING_FACTS: { Icon: React.ComponentType<{ className?: string }>; title: string; body: string }[] = [
  { Icon: CreditCard, title: "Aktif begitu lunas", body: "Paket aktif otomatis setelah pembayaran lunas, tanpa menunggu konfirmasi manual." },
  { Icon: RefreshCcw, title: "Tanpa potongan otomatis", body: "Tidak ada tagihan berulang. Anda memperpanjang sendiri bila ingin lanjut, dan sisa hari tidak hangus." },
  { Icon: CalendarClock, title: "Lebih hemat jangka panjang", body: "Hemat 10% untuk pembayaran 3 bulan dan 20% untuk pembayaran tahunan." },
  { Icon: Wallet, title: "Data tetap aman", body: "Kalau paket habis, autopilot berhenti, tetapi data dan statistik Anda tetap bisa dibuka." },
];

/** Pertanyaan seputar biaya, diambil dari daftar tanya jawab yang sama supaya jawabannya tidak bisa berbeda. */
const PRICING_FAQ = FAQ.filter((f) => /bayar|refund|setujui|Berapa kali/i.test(f.q));

export default function PricingPage() {
  return (
    <PublicPage
      path={PRICING_PATH}
      crumb="Harga"
      docTitle={TITLE}
      description={DESCRIPTION}
      eyebrow="HARGA"
      title="Harga BotThreads, dalam Rupiah"
      lead="Pilih paket sesuai jumlah akun Threads yang Anda kelola. Semua paket memakai mesin autopilot yang sama; bedanya ada di jumlah akun, posting per hari, anggota tim, dan mode yang tersedia."
    >
      {/* Daftar paket dari database (sama dengan di halaman perkenalan), termasuk Offer schema.org */}
      <div className="-mt-16 md:-mt-24">
        <Suspense fallback={<div className={`${WRAP} py-24`} />}>
          <Pricing wrap={WRAP} />
        </Suspense>
      </div>

      <section className={`${WRAP}`} aria-labelledby="tagihan-judul">
        <h2 id="tagihan-judul" className="lp-display text-2xl md:text-3xl font-extrabold">
          <T>Berlaku untuk semua paket</T>
        </h2>
        <ul className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {BILLING_FACTS.map(({ Icon, title, body }, i) => (
            <li key={title} className="rounded-2xl border border-line bg-surface p-5" data-reveal style={{ "--i": i + 1 } as React.CSSProperties}>
              <Icon className="w-5 h-5 text-accent" />
              <h3 className="mt-3 text-base font-bold">
                <T>{title}</T>
              </h3>
              <p className="mt-1.5 text-[13px] text-muted leading-relaxed">
                <T>{body}</T>
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${WRAP} pt-16`} aria-labelledby="metode-judul">
        <h2 id="metode-judul" className="lp-display text-2xl md:text-3xl font-extrabold">
          <T>Metode pembayaran</T>
        </h2>
        <p className="mt-2 text-sm text-muted">
          <T>Transaksi resmi dalam Rupiah (IDR) melalui Midtrans.</T>
        </p>
        <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {PAYMENT_METHODS.map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3">
              <PaymentLogo id={m.id} className="w-12 h-7 px-1 py-0.5 rounded-md shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{m.label}</span>
                <span className="block text-xs text-muted truncate">
                  <T>{m.hint}</T>
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${WRAP} pt-16`} aria-labelledby="biaya-tanya-judul">
        <h2 id="biaya-tanya-judul" className="lp-display text-2xl md:text-3xl font-extrabold">
          <T>Pertanyaan seputar biaya</T>
        </h2>
        <dl className="mt-6 divide-y divide-line border-y border-line">
          {PRICING_FAQ.map((f) => (
            <div key={f.q} className="py-5">
              <dt className="flex items-start gap-2.5 text-[15px] font-semibold">
                <Check className="w-4 h-4 mt-1 text-success shrink-0" />
                <T>{f.q}</T>
              </dt>
              <dd className="mt-2 pl-6.5 text-sm text-muted leading-relaxed">
                <T>{f.a}</T>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-6">
          <Link href={FAQ_PATH} className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
            <T>Lihat semua tanya jawab</T>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </p>
      </section>
    </PublicPage>
  );
}
