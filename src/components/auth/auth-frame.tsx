"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";

/** Tautan kembali ke halaman perkenalan, di pojok kiri atas halaman masuk dan daftar. */
export function BackToLanding() {
  return (
    <Link
      href="/selamat-datang"
      className="group absolute top-4 left-4 h-10 pl-2.5 pr-3.5 rounded-lg inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg hover:bg-subtle transition-colors"
    >
      <ArrowLeft className="w-[18px] h-[18px] transition-transform group-hover:-translate-x-0.5" />
      Beranda
    </Link>
  );
}

/**
 * Bingkai halaman tanpa sesi (daftar, terima undangan, reset password): logo, judul, satu kartu.
 * `back` menampilkan tautan kembali ke halaman perkenalan.
 */
export function AuthFrame({ title, subtitle, children, back }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode; back?: boolean }) {
  return (
    <main className="relative flex-1 w-full min-h-screen flex items-center justify-center px-5 py-16 bg-canvas">
      {back && <BackToLanding />}
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-[420px]">
        <div className="flex flex-col items-center text-center">
          <Image src="/logo.webp" alt="BotThreads" width={64} height={64} priority className="w-16 h-16 rounded-2xl shadow-pop" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted leading-relaxed">{subtitle}</p>}
        </div>
        <div className="card mt-7 p-6">{children}</div>
      </div>
    </main>
  );
}

export const AUTH_BUTTON_CLS =
  "w-full h-12 rounded-xl text-[15px] font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed";

/** Panel hasil (berhasil atau tautan tidak berlaku) dengan satu tautan lanjutan. */
export function AuthNotice({
  icon,
  tone,
  title,
  children,
  href = "/login",
  action = "Ke halaman masuk",
}: {
  icon: React.ReactNode;
  tone: "success" | "danger";
  title: string;
  children: React.ReactNode;
  href?: string;
  action?: string;
}) {
  return (
    <div className="text-center" role={tone === "danger" ? "alert" : "status"}>
      <div
        className={cn(
          "w-12 h-12 mx-auto rounded-2xl flex items-center justify-center",
          tone === "success" ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
        )}
      >
        {icon}
      </div>
      <h2 className="mt-4 text-base font-bold text-fg">{title}</h2>
      <p className="mt-1.5 text-sm text-muted leading-relaxed">{children}</p>
      <Link href={href} className={cn(AUTH_BUTTON_CLS, "mt-5 bg-accent hover:bg-accent-hover text-on-accent")}>
        {action}
        <ArrowRight className="w-[18px] h-[18px]" />
      </Link>
    </div>
  );
}

export function AuthSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-4 animate-pulse" aria-busy="true" aria-label={label}>
      <div className="h-4 w-2/3 rounded bg-subtle" />
      <div className="h-11 rounded-xl bg-subtle" />
      <div className="h-11 rounded-xl bg-subtle" />
      <div className="h-12 rounded-xl bg-subtle" />
    </div>
  );
}
