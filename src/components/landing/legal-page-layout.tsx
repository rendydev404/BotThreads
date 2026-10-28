"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Copy } from "lucide-react";
import {
  LEGAL_DOCUMENTS,
  LEGAL_DOC_LIST,
  MERCHANT_INFO,
  type LegalDocId,
} from "@/lib/legal-content";
import { LandingFooter } from "@/components/landing/legal-section";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LangToggle } from "@/components/i18n/lang-toggle";
import { useLang, useT } from "@/components/i18n/lang-provider";
import { LANG_COOKIE } from "@/lib/i18n/core";
import { cn } from "@/lib/utils";
import "@/app/selamat-datang/landing.css";

/**
 * Dokumen legal versi EN (./legal-content-en) dimuat lewat import dinamis hanya bila bahasa = EN, jadi
 * pengguna ID tidak mengunduhnya. Unduhan dimulai sedini mungkin (saat modul ini dievaluasi) bila cookie
 * `lang` = en, sejajar dengan kamus EN di LangProvider.
 */
type LegalEn = typeof import("@/lib/legal-content-en");
let legalEn: LegalEn | null = null;
let legalEnPromise: Promise<LegalEn> | null = null;
function loadLegalEn(): Promise<LegalEn> {
  if (!legalEnPromise) {
    legalEnPromise = import("@/lib/legal-content-en").then(
      (m) => (legalEn = m),
      (err) => {
        legalEnPromise = null;
        throw err;
      }
    );
  }
  return legalEnPromise;
}
if (typeof document !== "undefined" && new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=en(?:;|$)`).test(document.cookie)) {
  void loadLegalEn().catch(() => {});
}

/** Dokumen & identitas merchant sesuai bahasa aktif; selama versi EN belum termuat, tetap bahasa Indonesia. */
function useLegalContent() {
  const { lang } = useLang();
  const [en, setEn] = useState<LegalEn | null>(legalEn);
  useEffect(() => {
    if (lang !== "en" || en) return;
    let alive = true;
    loadLegalEn()
      .then((m) => {
        if (alive) setEn(m);
      })
      .catch(() => {
        // Gagal dimuat (jaringan): dokumen tetap tampil dalam bahasa Indonesia.
      });
    return () => {
      alive = false;
    };
  }, [lang, en]);
  return lang === "en" && en
    ? { docs: en.LEGAL_DOCUMENTS_EN, info: en.MERCHANT_INFO_EN, isEn: true }
    : { docs: LEGAL_DOCUMENTS, info: MERCHANT_INFO, isEn: false };
}

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  weight: ["500", "700"],
  display: "swap",
});

const WRAP = "max-w-[1180px] mx-auto px-4 md:px-8";

function CopyInline({ value }: { value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      className="h-7 px-2.5 rounded-md border border-line hover:border-line-strong bg-surface text-[11px] font-medium text-muted hover:text-fg inline-flex items-center gap-1.5 transition-colors cursor-pointer"
    >
      {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
      <span>{copied ? t("Tersalin") : t("Salin")}</span>
    </button>
  );
}

/**
 * Tata letak dokumen legal bergaya Swiss Editorial Ledger:
 * tipografi bersih, ruang kosong lega, garis pemisah 1px (hairline), tanpa tumpukan kartu/badge berlebih,
 * dilengkapi penanda pasal aktif otomatis (scroll-spy) di sisi kiri.
 */
export function LegalPageLayout({ docId }: { docId: LegalDocId }) {
  const t = useT();
  const { docs, info: MERCHANT, isEn } = useLegalContent();
  const doc = docs[docId];
  const docList = LEGAL_DOC_LIST.map((d) => docs[d.id]);
  const [activeSection, setActiveSection] = useState<string>(doc.articles[0]?.id ?? "");

  const currentIdx = docList.findIndex((d) => d.id === docId);
  const prevDoc = currentIdx > 0 ? docList[currentIdx - 1] : null;
  const nextDoc = currentIdx < docList.length - 1 ? docList[currentIdx + 1] : null;

  // Judul tab ikut bahasa. Metadata server tetap bahasa Indonesia supaya halaman ini tetap statis.
  useEffect(() => {
    const title = `${(isEn ? doc : LEGAL_DOCUMENTS[docId]).title} | BotThreads`;
    if (document.title !== title) document.title = title;
  }, [isEn, doc, docId]);

  useEffect(() => {
    const elements = doc.articles
      .map((a) => document.getElementById(a.id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) {
          setActiveSection(visible[0].target.id);
        }
      },
      { rootMargin: "-18% 0px -65% 0px", threshold: 0 }
    );

    elements.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [doc]);

  return (
    <div
      className={`${display.variable} ${mono.variable} lp flex-1 w-full min-h-screen bg-canvas text-fg flex flex-col`}
    >
      {/* Header Mengambang Minimalis */}
      <header className="sticky top-3 z-30 px-3 md:px-6">
        <div className="max-w-[1180px] mx-auto h-14 pl-3 pr-2 rounded-2xl border border-line bg-surface/85 backdrop-blur-md flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 shrink-0">
            <Link
              href="/selamat-datang"
              aria-label={t("Beranda")}
              className="group h-9 px-2.5 rounded-lg text-xs font-semibold text-muted hover:text-fg hover:bg-subtle inline-flex items-center gap-1.5 transition-colors shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
              <span className="hidden min-[400px]:inline">{t("Beranda")}</span>
            </Link>
            <span className="h-4 w-px bg-line hidden sm:block" aria-hidden="true" />
            <Link href="/selamat-datang" className="hidden sm:flex items-center gap-2 shrink-0">
              <Image src="/logo.webp" alt="" width={24} height={24} className="w-6 h-6 rounded-md shrink-0" />
              <span className="text-sm font-bold tracking-tight whitespace-nowrap">{MERCHANT.brandName}</span>
            </Link>
          </div>

          {/* Navigasi Antar-Halaman Legal */}
          <nav className="hidden lg:flex items-center gap-0.5 overflow-x-auto" aria-label={t("Dokumen Legal")}>
            {docList.map((item) => {
              const active = item.id === docId;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={cn(
                    "h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center whitespace-nowrap shrink-0 transition-colors",
                    active ? "bg-subtle text-fg font-semibold" : "text-muted hover:text-fg"
                  )}
                >
                  {item.shortTitle}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-1 shrink-0">
            <LangToggle />
            <ThemeToggle />
            <Link
              href="/login"
              className="max-[340px]:hidden h-9 px-2.5 sm:px-3 rounded-lg text-xs font-semibold text-muted hover:text-fg hover:bg-subtle inline-flex items-center transition-colors"
            >
              {t("Masuk")}
            </Link>
            <Link
              href="/daftar"
              className="h-9 px-3 sm:px-3.5 rounded-xl text-xs font-semibold bg-accent hover:bg-accent-hover text-on-accent inline-flex items-center transition-colors"
            >
              {t("Daftar")}
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Masthead Editorial Asimetris */}
        <section className={`${WRAP} pt-12 pb-10 md:pt-20 md:pb-14`}>
          <div className="grid lg:grid-cols-[minmax(0,1fr)_280px] gap-8 lg:gap-12 items-end">
            <div>
              <p className="lp-mono text-xs font-bold tracking-widest text-accent uppercase">
                {doc.order} / 06 — {doc.category}
              </p>
              <h1 className="lp-display mt-4 text-[2.25rem] leading-[1.04] md:text-[3.35rem] font-extrabold tracking-tight text-fg">
                {doc.title}
              </h1>
              <p className="mt-4 text-[15px] md:text-[17px] text-muted leading-relaxed max-w-2xl">
                {doc.subtitle}
              </p>
            </div>

            {/* Spesifikasi Dokumen di Kanan */}
            <dl className="border-t lg:border-t-0 lg:border-l border-line pt-5 lg:pt-0 lg:pl-6 space-y-3 text-xs">
              <div>
                <dt className="lp-mono text-[10px] font-bold tracking-wider text-faint uppercase">{t("Kode Dokumen")}</dt>
                <dd className="lp-mono mt-0.5 font-semibold text-fg">{doc.docCode}</dd>
              </div>
              <div>
                <dt className="lp-mono text-[10px] font-bold tracking-wider text-faint uppercase">{t("Berlaku Efektif")}</dt>
                <dd className="mt-0.5 font-medium text-fg">{doc.effectiveDate}</dd>
              </div>
              <div>
                <dt className="lp-mono text-[10px] font-bold tracking-wider text-faint uppercase">{t("Lingkup Kepatuhan")}</dt>
                <dd className="mt-0.5 font-medium text-muted">{doc.jurisdiction}</dd>
              </div>
            </dl>
          </div>

          {/* Pemilih Halaman untuk Layar Kecil/Tablet */}
          <div className="mt-8 flex lg:hidden items-center gap-1.5 overflow-x-auto pb-1">
            {docList.map((item) => {
              const active = item.id === docId;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={cn(
                    "h-8 px-3 rounded-lg text-xs font-medium inline-flex items-center shrink-0 border transition-colors",
                    active
                      ? "bg-fg text-canvas border-fg font-semibold"
                      : "bg-surface text-muted border-line hover:text-fg"
                  )}
                >
                  {item.shortTitle}
                </Link>
              );
            })}
          </div>
        </section>

        {/* Pita Ringkasan Pokok (Ledger Strip) */}
        <section className="border-y border-line bg-surface/60">
          <div className={WRAP}>
            <dl
              className={cn(
                "grid divide-y sm:divide-y-0 sm:divide-x divide-line",
                doc.summarySpecs.length <= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3"
              )}
            >
              {doc.summarySpecs.slice(0, 4).map((spec) => (
                <div key={spec.term} className="py-5 sm:px-5 first:sm:pl-0 last:sm:pr-0">
                  <dt className="lp-mono text-[10px] font-bold tracking-widest text-faint uppercase">{spec.term}</dt>
                  <dd className="mt-1.5 text-[13px] font-medium text-fg leading-relaxed">{spec.detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Badan Bacaan Dua Kolom: Indeks Kiri + Teks Editorial Kanan */}
        <section className={`${WRAP} py-12 md:py-20`}>
          <div className="grid lg:grid-cols-[230px_minmax(0,1fr)] gap-12 lg:gap-16 items-start">
            {/* Kolom Kiri Sticky: Daftar Isi & Dokumen Lain */}
            <aside className="hidden lg:block sticky top-24 space-y-8">
              <div>
                <p className="lp-mono text-[10px] font-bold tracking-widest text-faint uppercase">{t("Pada Halaman Ini")}</p>
                <ul className="mt-3 border-l border-line space-y-0.5 text-[13px]">
                  {doc.articles.map((art) => {
                    const isCurrent = activeSection === art.id;
                    return (
                      <li key={art.id}>
                        <a
                          href={`#${art.id}`}
                          onClick={() => setActiveSection(art.id)}
                          className={cn(
                            "block py-1.5 pl-3.5 -ml-px border-l-2 transition-colors leading-snug",
                            isCurrent
                              ? "border-accent text-fg font-semibold"
                              : "border-transparent text-muted hover:text-fg"
                          )}
                        >
                          <span className="lp-mono text-[11px] text-faint mr-2 tabular-nums">{art.index}</span>
                          <span>{art.title}</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="pt-6 border-t border-line">
                <p className="lp-mono text-[10px] font-bold tracking-widest text-faint uppercase">{t("Dokumen Resmi")}</p>
                <ul className="mt-3 space-y-1.5 text-[13px]">
                  {docList.map((item) => {
                    const active = item.id === docId;
                    return (
                      <li key={item.id}>
                        <Link
                          href={item.href}
                          className={cn(
                            "flex items-center justify-between py-1 transition-colors",
                            active ? "text-accent font-semibold" : "text-muted hover:text-fg"
                          )}
                        >
                          <span>{item.shortTitle}</span>
                          <span className="lp-mono text-[10px] text-faint tabular-nums">{item.order}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </aside>

            {/* Kolom Kanan: Konten Bacaan */}
            <div className="max-w-[70ch] min-w-0">
              {/* Jika halaman Kontak, tampilkan Tabel Identitas & Saluran Langsung di atas pasal */}
              {docId === "kontak" && (
                <div className="mb-12 pb-12 border-b border-line">
                  <div className="flex items-baseline justify-between gap-4 mb-4">
                    <h2 className="lp-display text-xl md:text-2xl font-bold tracking-tight text-fg">
                      {t("Identitas Penyelenggara & Saluran Langsung")}
                    </h2>
                    <span className="lp-mono text-[11px] font-bold text-accent">VERIFIED MERCHANT</span>
                  </div>
                  <p className="text-[15px] text-muted leading-[1.8] mb-6">
                    {t(
                      "Informasi di bawah ini merupakan identitas operasional resmi penyelenggara layanan {brand} di Indonesia untuk keperluan layanan pelanggan, administrasi penagihan, dan korespondensi resmi.",
                      { brand: MERCHANT.brandName }
                    )}
                  </p>

                  <dl className="border-t border-line divide-y divide-line">
                    <div className="py-4 grid sm:grid-cols-[200px_minmax(0,1fr)] gap-1 sm:gap-6 items-baseline">
                      <dt className="text-[13px] font-semibold text-fg">{t("Nama Platform")}</dt>
                      <dd className="text-[14px] text-muted">{MERCHANT.brandName}</dd>
                    </div>
                    <div className="py-4 grid sm:grid-cols-[200px_minmax(0,1fr)] gap-1 sm:gap-6 items-baseline">
                      <dt className="text-[13px] font-semibold text-fg">{t("Entitas Penyelenggara")}</dt>
                      <dd className="text-[14px] text-muted">
                        {MERCHANT.legalName} ({MERCHANT.unitName})
                      </dd>
                    </div>
                    <div className="py-4 grid sm:grid-cols-[200px_minmax(0,1fr)] gap-1 sm:gap-6 items-center">
                      <dt className="text-[13px] font-semibold text-fg">{t("Email Resmi")}</dt>
                      <dd className="text-[14px] text-fg font-medium flex flex-wrap items-center justify-between gap-2">
                        <a href={`mailto:${MERCHANT_INFO.supportEmail}`} className="hover:text-accent underline">
                          {MERCHANT_INFO.supportEmail}
                        </a>
                        <CopyInline value={MERCHANT_INFO.supportEmail} />
                      </dd>
                    </div>
                    <div className="py-4 grid sm:grid-cols-[200px_minmax(0,1fr)] gap-1 sm:gap-6 items-center">
                      <dt className="text-[13px] font-semibold text-fg">{t("WhatsApp Pelanggan")}</dt>
                      <dd className="text-[14px] text-fg font-medium flex flex-wrap items-center justify-between gap-2">
                        <a
                          href={MERCHANT_INFO.whatsappHref}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-accent underline tabular-nums inline-flex items-center gap-1"
                        >
                          <span>{MERCHANT_INFO.whatsappDisplay}</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </a>
                        <CopyInline value={MERCHANT_INFO.whatsappDisplay} />
                      </dd>
                    </div>
                    <div className="py-4 grid sm:grid-cols-[200px_minmax(0,1fr)] gap-1 sm:gap-6 items-baseline">
                      <dt className="text-[13px] font-semibold text-fg">{t("Jam Operasional")}</dt>
                      <dd className="text-[14px] text-muted">{MERCHANT.operatingHours}</dd>
                    </div>
                    <div className="py-4 grid sm:grid-cols-[200px_minmax(0,1fr)] gap-1 sm:gap-6 items-baseline">
                      <dt className="text-[13px] font-semibold text-fg">{t("Mata Uang & Pembayaran")}</dt>
                      <dd className="text-[14px] text-muted">
                        {MERCHANT.currency} · {MERCHANT.paymentGateway}
                      </dd>
                    </div>
                    <div className="py-4 grid sm:grid-cols-[200px_minmax(0,1fr)] gap-1 sm:gap-6 items-baseline">
                      <dt className="text-[13px] font-semibold text-fg">{t("Alamat Operasional")}</dt>
                      <dd className="text-[14px] text-muted leading-relaxed">{MERCHANT.address}</dd>
                    </div>
                  </dl>
                </div>
              )}

              {/* Daftar Pasal Editorial */}
              <div className="divide-y divide-line">
                {doc.articles.map((art) => (
                  <article
                    key={art.id}
                    id={art.id}
                    className="scroll-mt-28 first:pt-0 pt-10 pb-12 last:pb-6"
                  >
                    <div className="flex items-baseline gap-3.5">
                      <span className="lp-mono text-xs font-bold text-accent tabular-nums shrink-0">
                        {t("PASAL {n}", { n: art.index })}
                      </span>
                      <h2 className="lp-display text-xl md:text-2xl font-bold tracking-tight text-fg">
                        {art.title}
                      </h2>
                    </div>

                    <div className="mt-4 space-y-4 text-[15px] md:text-[15.5px] text-muted leading-[1.8]">
                      {art.paragraphs.map((p, idx) => (
                        <p key={idx}>{p}</p>
                      ))}
                    </div>

                    {art.rows && art.rows.length > 0 && (
                      <dl className="mt-6 border-t border-line divide-y divide-line">
                        {art.rows.map((row) => (
                          <div
                            key={row.term}
                            className="py-4 grid sm:grid-cols-[185px_minmax(0,1fr)] gap-1.5 sm:gap-6 items-baseline"
                          >
                            <dt className="text-[13.5px] font-semibold text-fg">{row.term}</dt>
                            <dd className="text-[14px] text-muted leading-[1.75]">{row.detail}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </article>
                ))}
              </div>

              {/* Navigasi Dokumen Sebelumnya / Selanjutnya */}
              <nav
                aria-label={t("Navigasi dokumen legal")}
                className="mt-10 pt-8 border-t border-line grid sm:grid-cols-2 gap-4"
              >
                {prevDoc ? (
                  <Link
                    href={prevDoc.href}
                    className="group py-3 pr-4 text-left flex flex-col justify-between transition-colors"
                  >
                    <span className="lp-mono text-[10px] font-bold tracking-widest text-faint uppercase inline-flex items-center gap-1.5">
                      <ArrowLeft className="w-3 h-3 transition-transform group-hover:-translate-x-0.5" />
                      {t("Sebelumnya ({n})", { n: prevDoc.order })}
                    </span>
                    <span className="mt-1 text-base font-bold text-fg group-hover:text-accent transition-colors">
                      {prevDoc.title}
                    </span>
                  </Link>
                ) : (
                  <div />
                )}

                {nextDoc ? (
                  <Link
                    href={nextDoc.href}
                    className="group py-3 sm:pl-4 sm:text-right flex flex-col sm:items-end justify-between transition-colors"
                  >
                    <span className="lp-mono text-[10px] font-bold tracking-widest text-faint uppercase inline-flex items-center gap-1.5">
                      {t("Selanjutnya ({n})", { n: nextDoc.order })}
                      <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
                    </span>
                    <span className="mt-1 text-base font-bold text-fg group-hover:text-accent transition-colors">
                      {nextDoc.title}
                    </span>
                  </Link>
                ) : (
                  <div />
                )}
              </nav>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter wrap={WRAP} />
    </div>
  );
}
