"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdminPage } from "./console-shell";
import { ADMIN_MODULES } from "./nav";
import { OverviewTab } from "./overview-tab";
import { useAdmin } from "./shared";

/** Kunci tab lama (/admin?tab=...) ke URL modul yang baru. */
const LEGACY: Record<string, string> = Object.fromEntries(ADMIN_MODULES.map((m) => [m.key, m.href]));

/**
 * Beranda konsol: ringkasan platform. Tautan lama `?tab=` diteruskan ke modulnya, dan staf yang tidak
 * punya izin ringkasan langsung dibawa ke modul pertama yang boleh ia buka.
 */
export function AdminHome() {
  const router = useRouter();
  const tab = useSearchParams().get("tab");
  const { can } = useAdmin();
  const target = tab && LEGACY[tab] && LEGACY[tab] !== "/admin" ? LEGACY[tab] : !can("dashboard.lihat") ? ADMIN_MODULES.find((m) => can(m.perm))?.href ?? null : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (target) return null;
  return (
    <AdminPage module="ringkasan">
      <OverviewTab />
    </AdminPage>
  );
}
