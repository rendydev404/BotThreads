import type { Metadata } from "next";
import { Suspense } from "react";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { LangProvider } from "@/components/i18n/lang-provider";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "BotThreads",
  description:
    "Autopilot konten dan analitik untuk akun Threads: ide, tulisan, dan jadwal dikerjakan AI.",
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



