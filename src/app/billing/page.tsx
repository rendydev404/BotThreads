"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { AlertTriangle, CreditCard, Link2, RotateCw, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMe } from "@/components/layout/use-me";
import { PlanCard } from "@/components/settings/plan-card";
import { BTN_OUTLINE, BTN_PRIMARY, Pill } from "@/components/settings/states";
import { SubscriptionTab } from "@/components/settings/subscription-tab";

function BillingSkeleton() {
  return (
    <div className="space-y-5 animate-pulse" aria-busy="true" aria-label="Memuat halaman billing">
      <div className="h-12 w-64 rounded-xl bg-subtle" />
      <div className="card p-5 h-32 bg-subtle" />
      <div className="grid md:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card p-6 h-72 bg-subtle" />
        ))}
      </div>
    </div>
  );
}

function BillingInner() {
  const { me, loading, error, isAdmin, reload } = useMe();

  if (loading) return <BillingSkeleton />;

  if (!me) {
    return (
      <div role="alert" className="card p-8 text-center">
        <AlertTriangle className="w-8 h-8 text-danger mx-auto" />
        <p className="mt-3 text-sm font-semibold text-fg">{error ?? "Gagal memuat profil."}</p>
        <button type="button" onClick={() => void reload()} className={cn(BTN_PRIMARY, "mt-4")}>
          <RotateCw className="w-4 h-4" />
          Coba lagi
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
            <CreditCard className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-fg leading-tight">Billing & Paket Sewa</h2>
            <p className="text-sm text-muted">
              Pilih atau upgrade paket langganan, bayar lewat Payment Gateway, dan pantau riwayat invoice workspace Anda.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <a href="/api/threads/oauth" className={BTN_OUTLINE}>
            <Link2 className="w-3.5 h-3.5" />
            Hubungkan Akun Threads
          </a>
          {me.superadmin && (
            <Link href="/admin?tab=transaksi" className={BTN_OUTLINE}>
              <ShieldCheck className="w-3.5 h-3.5" />
              Kelola di Super Admin
            </Link>
          )}
          <Pill tone="accent">{me.roleLabel}</Pill>
        </div>
      </div>

      <PlanCard />

      <SubscriptionTab canManage={isAdmin} />
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<BillingSkeleton />}>
      <BillingInner />
    </Suspense>
  );
}
