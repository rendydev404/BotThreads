import type { Metadata } from "next";
import { Suspense } from "react";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { LangProvider } from "@/components/i18n/lang-provider";
import { MERCHANT_INFO } from "@/lib/legal-content";
import { SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

// Bawaan untuk semua halaman; halaman publik menimpa judul, deskripsi, dan URL kanonisnya sendiri.
// Gambar pratinjau datang dari app/opengraph-image.tsx (dipasang otomatis oleh Next).
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: SITE_KEYWORDS,
  authors: [{ name: MERCHANT_INFO.legalName, url: SITE_URL }],
  creator: MERCHANT_INFO.legalName,
  publisher: MERCHANT_INFO.legalName,
  category: "technology",
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "id_ID",
    alternateLocale: ["en_US"],
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="id"
      className={`${plusJakarta.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('botdash_theme');if(t!=='light'&&(t!=='system'||window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){document.documentElement.classList.add('dark');}try{var d=document.documentElement;if(/(?:^|;\\s*)lang=en(?:;|$)/.test(document.cookie)){d.lang='en';d.classList.add('i18n-wait');setTimeout(function(){d.classList.remove('i18n-wait')},1500);}}catch(e){}})();`,
          }}
        />
      </head>
      <body suppressHydrationWarning className="min-h-full flex bg-canvas text-fg font-sans">
        <ThemeProvider>
          {/* Bahasa (ID/EN) dibaca dari cookie `lang` di klien, sehingga shell tetap bisa di-prerender statis. */}
          <LangProvider>
          {/* AppShell membaca pathname; pada rute ber-parameter (tautan undangan/reset) nilainya baru
              diketahui saat permintaan datang, jadi butuh batas Suspense agar bisa di-prerender. */}
          <Suspense fallback={null}>
            <AppShell>{children}</AppShell>
          </Suspense>
          </LangProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}



