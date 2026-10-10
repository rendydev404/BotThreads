import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { BottomNav } from "@/components/layout/bottom-nav";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "BotDash - Threads Bot Analytics & Prompt Studio",
  description:
    "Enterprise Telegram Bot Management & Threads Performance Analytics Dashboard",
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
    >
      <body className="min-h-full flex bg-[#F4F7FE] text-[#343C6A] font-sans">
        {/* Desktop Sidebar */}
        <Sidebar />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-screen">
          <Header />
          <main className="flex-1 p-4 md:p-8 max-w-7xl w-full mx-auto pb-28 md:pb-12">
            {children}
          </main>
        </div>

        {/* Mobile-First Bottom Navigation Bar */}
        <BottomNav />
      </body>
    </html>
  );
}
