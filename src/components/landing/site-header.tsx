import Image from "next/image";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LangToggle } from "@/components/i18n/lang-toggle";
import { T } from "@/components/i18n/t";
import { PUBLIC_NAV } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * Header mengambang halaman publik. Menu menaut ke halaman Fitur, Cara kerja, Harga, dan Tanya jawab yang berdiri
 * sendiri: tautan menu yang sama di setiap halaman adalah sinyal utama Google untuk memilih sitelink.
 * `clock`: jam simulasi yang bergerak mengikuti gulir (hanya di halaman perkenalan).
 */
export function SiteHeader({ current, clock = false }: { current?: string; clock?: boolean }) {
  return (
    <header className="sticky top-3 z-30 px-3 md:px-6">
      <div className="lp-nav relative max-w-[1180px] mx-auto h-14 pl-3 pr-2 rounded-2xl border backdrop-blur-md flex items-center justify-between gap-3 overflow-hidden">
        <Link href="/selamat-datang" className="flex items-center gap-2.5 min-w-0">
          <Image src="/logo.webp" alt="" width={34} height={34} priority className="w-[34px] h-[34px] rounded-xl shrink-0" />
          <span className="text-[15px] font-bold truncate hidden sm:block">BotThreads</span>
        </Link>

        {clock && (
          <p
            className="lp-mono hidden xl:flex items-center gap-2 h-8 px-3 rounded-lg bg-subtle text-xs font-bold text-fg"
            title="Gulir halaman untuk menjalani satu hari autopilot"
            aria-hidden="true"
          >
            <span className="lp-live w-1.5 h-1.5 rounded-full bg-success" />
            <span data-clock className="tabular-nums">
              06.00
            </span>
            <span className="text-faint font-medium">WIB</span>
          </p>
        )}

        <nav aria-label="Menu utama" className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          {PUBLIC_NAV.map((n) => (
            <Link
              key={n.path}
              href={n.path}
              aria-current={current === n.path ? "page" : undefined}
              className={cn(
                n.headerClass,
                "h-10 px-3 rounded-lg text-sm font-semibold items-center transition-colors",
                current === n.path ? "text-fg bg-subtle" : "text-muted hover:text-fg"
              )}
            >
              <T>{n.label}</T>
            </Link>
          ))}
          <LangToggle className="mr-0.5" />
          <ThemeToggle />
          <Link href="/login" className="max-[340px]:hidden h-10 px-2.5 sm:px-4 rounded-lg text-sm font-semibold hover:bg-subtle inline-flex items-center transition-colors">
            <T>Masuk</T>
          </Link>
          <Link href="/daftar" className="h-10 px-3 sm:px-4 rounded-xl text-sm font-semibold bg-accent hover:bg-accent-hover text-on-accent inline-flex items-center transition-colors">
            <T>Daftar</T>
          </Link>
        </nav>
        {clock && <span aria-hidden="true" className="lp-progress absolute left-0 bottom-0 h-[2px] w-full bg-accent" />}
      </div>
    </header>
  );
}
