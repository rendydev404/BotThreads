import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";

// Dua huruf khusus halaman publik: judul yang berkarakter dan angka jam ala papan jadwal.
export const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });
export const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", weight: ["500", "700"], display: "swap" });

export const LANDING_FONTS = `${display.variable} ${mono.variable}`;

export const WRAP = "max-w-[1180px] mx-auto px-4 md:px-8";
export const BTN = "lp-cta inline-flex items-center justify-center gap-2 h-12 px-6 rounded-xl text-[15px] font-semibold transition-colors";
