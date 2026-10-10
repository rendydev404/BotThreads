"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { BottomNav } from "./bottom-nav";
import { FloatingAiBubble } from "@/components/chat/floating-ai-bubble";

/** Halaman login tampil polos, tanpa sidebar/header/bubble. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/login") return <>{children}</>;

  return (
    <>
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <Header />
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8 max-w-[1280px] w-full mx-auto pb-28 md:pb-12">
          {children}
        </main>
      </div>
      <BottomNav />
      <FloatingAiBubble />
    </>
  );
}
