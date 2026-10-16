import React from "react";
import Image from "next/image";
import Link from "next/link";
import { PAYMENT_METHODS } from "@/lib/billing-types";
import { LEGAL_DOC_LIST, MERCHANT_INFO } from "@/lib/legal-content";
import { PaymentLogo } from "@/components/settings/payment-logos";

/**
 * Footer minimalis bergaya editorial: tanpa kotak berlebih, mengandalkan tipografi yang rapi,
 * garis pemisah tipis, dan tautan langsung ke masing-masing halaman dokumen legal mandiri.
 */
export function LandingFooter({ wrap }: { wrap: string }) {
  return (
    <footer className="border-t border-line bg-canvas text-fg">
      <div className={`${wrap} py-12 md:py-16`}>
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,0.75fr)_minmax(0,0.95fr)_minmax(0,0.95fr)]">
          {/* Identitas Brand */}
          <div className="space-y-3.5 max-w-sm">
            <Link href="/selamat-datang" className="inline-flex items-center gap-2.5">
              <Image src="/logo.webp" alt="BotThreads" width={30} height={30} className="w-[30px] h-[30px] rounded-lg" />
              <span className="text-[15px] font-bold tracking-tight text-fg">{MERCHANT_INFO.brandName}</span>
            </Link>
            <p className="text-[13px] text-muted leading-relaxed">{MERCHANT_INFO.tagline}</p>
            <p className="text-xs text-faint leading-relaxed">
              {MERCHANT_INFO.legalName}
              <span className="block">{MERCHANT_INFO.address}</span>
            </p>
          </div>

          {/* Kolom 1: Navigasi */}
          <div>
            <p className="lp-mono text-[11px] font-bold tracking-widest text-faint uppercase">Platform</p>
            <ul className="mt-4 space-y-2.5 text-[13px] text-muted">
              <li>
                <a href="/selamat-datang#cara-kerja" className="hover:text-fg transition-colors">
                  Cara kerja
                </a>
              </li>
              <li>
                <a href="/selamat-datang#paket" className="hover:text-fg transition-colors">
                  Harga & Paket
                </a>
              </li>
              <li>
                <a href="/selamat-datang#tanya" className="hover:text-fg transition-colors">
                  Tanya jawab
                </a>
              </li>
              <li>
                <Link href="/login" className="hover:text-fg transition-colors">
                  Masuk
                </Link>
              </li>
              <li>
                <Link href="/daftar" className="hover:text-fg transition-colors">
                  Daftar akun
                </Link>
              </li>
            </ul>
          </div>

          {/* Kolom 2: Halaman Dokumen Legal (Masing-masing punya halaman sendiri) */}
          <div>
            <p className="lp-mono text-[11px] font-bold tracking-widest text-faint uppercase">Legal & Kebijakan</p>
            <ul className="mt-4 space-y-2.5 text-[13px] text-muted">
              {LEGAL_DOC_LIST.filter((d) => d.id !== "kontak").map((doc) => (
                <li key={doc.id}>
                  <Link href={doc.href} className="hover:text-fg transition-colors">
                    {doc.shortTitle}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Kolom 3: Kontak & Layanan Pelanggan */}
          <div>
            <p className="lp-mono text-[11px] font-bold tracking-widest text-faint uppercase">Kontak & Bantuan</p>
            <ul className="mt-4 space-y-2.5 text-[13px] text-muted">
              <li>
                <Link href="/kontak" className="font-medium text-fg hover:text-accent transition-colors">
                  Identitas & Kontak Resmi
                </Link>
              </li>
              <li>
                <a href={`mailto:${MERCHANT_INFO.supportEmail}`} className="hover:text-fg transition-colors">
                  {MERCHANT_INFO.supportEmail}
                </a>
              </li>
              <li>
                <a
                  href={MERCHANT_INFO.whatsappHref}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-fg transition-colors tabular-nums"
                >
                  {MERCHANT_INFO.whatsappDisplay}
                </a>
              </li>
              <li className="text-xs text-faint pt-0.5">{MERCHANT_INFO.operatingHours}</li>
            </ul>
          </div>
        </div>

        {/* Baris Bawah: Metode Pembayaran & Hak Cipta */}
        <div className="mt-12 pt-6 border-t border-line flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1 text-xs text-faint">
            <p>
              © {new Date().getFullYear()} {MERCHANT_INFO.brandName} · {MERCHANT_INFO.legalName}. Transaksi resmi dalam
              Rupiah (IDR) melalui Midtrans.
            </p>
            <p>
              Jam dan contoh di halaman ini adalah ilustrasi. Threads adalah merek dagang Meta; layanan ini tidak
              berafiliasi dengan Meta.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5" aria-label="Metode pembayaran resmi">
            {PAYMENT_METHODS.map((m) => (
              <span key={m.id} title={m.label}>
                <PaymentLogo id={m.id} className="w-10 h-6 px-1 py-0.5 rounded-md" />
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
