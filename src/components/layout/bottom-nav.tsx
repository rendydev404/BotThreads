"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis } from "lucide-react";
import { adminNavItem, isActivePath, navigationItems } from "./sidebar";
import { useMe } from "./use-me";
import { usePopover } from "./use-popover";
import { cn } from "@/lib/utils";

const primary = navigationItems.filter((i) => i.mobile);
const moreBase = navigationItems.filter((i) => !i.mobile);

const ITEM_CLS =
  "flex-1 basis-0 min-w-0 flex flex-col items-center gap-0.5 py-1.5 rounded-lg text-[11px] leading-4 transition-colors";

export function BottomNav() {
  const pathname = usePathname();
  const { open, setOpen, rootRef, triggerRef } = usePopover<HTMLDivElement>();
  const { me } = useMe();
  const more = me?.superadmin ? [...moreBase, adminNavItem] : moreBase;
  const moreActive = more.some((i) => isActivePath(pathname, i.href));

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface/95 backdrop-blur border-t border-line px-1 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {/* Lima tombol harus muat di layar 360px: lebar dibagi rata, label 11px tanpa terpotong. */}
      <div className="flex items-stretch max-w-md mx-auto">
        {primary.map((item) => {
          const isActive = isActivePath(pathname, item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(ITEM_CLS, isActive ? "text-accent font-semibold" : "text-muted")}
            >
              <Icon className="w-5 h-5 shrink-0" strokeWidth={isActive ? 2.4 : 2} />
              <span className="max-w-full truncate whitespace-nowrap">{item.name}</span>
            </Link>
          );
        })}

        <div ref={rootRef} className="relative flex-1 basis-0 min-w-0 flex">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            className={cn(ITEM_CLS, "cursor-pointer", moreActive || open ? "text-accent font-semibold" : "text-muted")}
          >
            <Ellipsis className="w-5 h-5 shrink-0" strokeWidth={moreActive ? 2.4 : 2} />
            <span className="max-w-full truncate whitespace-nowrap">Lainnya</span>
          </button>

          {open && (
            <div
              role="menu"
              aria-label="Menu lainnya"
              className="absolute bottom-full right-0 mb-3 w-52 bg-surface rounded-xl p-1.5 shadow-pop border border-line animate-[pop-in_140ms_ease-out]"
            >
              {more.map((item) => {
                const isActive = isActivePath(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    role="menuitem"
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3 h-11 rounded-lg text-sm font-medium transition-colors",
                      isActive ? "bg-accent-soft text-accent font-semibold" : "text-fg hover:bg-subtle"
                    )}
                  >
                    <Icon className="w-[18px] h-[18px] shrink-0" />
                    {item.name}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
