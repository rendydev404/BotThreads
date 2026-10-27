"use client";

import React, { Suspense } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, AtSign, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMe } from "@/components/layout/use-me";
import { AccountsTab } from "@/components/settings/accounts-tab";
import { BTN_PRIMARY, Pill } from "@/components/settings/states";
import { useT } from "@/components/i18n/lang-provider";

function AccountsSkeleton() {
  const t = useT();
  return (
    <div className="space-y-5 animate-pulse" aria-busy="true" aria-label={t("Memuat akun Threads")}>
      <div className="h-12 w-64 rounded-xl bg-subtle" />
      <div className="card p-5 h-24 bg-subtle" />
      <div className="card p-5 h-40 bg-subtle" />
    </div>
  );
}

/** Kelola akun Threads workspace: tambah (login Threads), hubungkan ulang, sinkronkan profil, dan hapus. */
function AccountsInner() {
  const { me, loading, error, isAdmin, reload } = useMe();
  const router = useRouter();
  const t = useT();

  if (loading) return <AccountsSkeleton />;

  if (!me) {
    return (
      <div role="alert" className="card p-8 text-center">
        <AlertTriangle className="w-8 h-8 text-danger mx-auto" />
        <p className="mt-3 text-sm font-semibold text-fg">{t(error ?? "Gagal memuat profil.")}</p>
        <button type="button" onClick={() => void reload()} className={cn(BTN_PRIMARY, "mt-4")}>
          <RotateCw className="w-4 h-4" />
          {t("Coba lagi")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
            <AtSign className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-fg leading-tight">{t("Akun Threads")}</h2>
            <p className="text-sm text-muted">{t("Tambah, hubungkan ulang, perbarui, dan hapus akun Threads yang dipakai workspace ini.")}</p>
          </div>
        </div>
        <Pill tone="accent">{t(me.roleLabel)}</Pill>
      </div>

      {!isAdmin && (
        <p className="text-sm text-muted">{t("Hanya Pemilik atau Admin yang bisa menambah, mengubah, atau menghapus akun.")}</p>
      )}

      <AccountsTab canManage={isAdmin} onAccountConnected={() => void reload()} onOpenSubscription={() => router.push("/billing")} />
    </div>
  );
}

export default function AccountsPage() {
  return (
    <Suspense fallback={<AccountsSkeleton />}>
      <AccountsInner />
    </Suspense>
  );
}
