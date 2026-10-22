"use client";

import React from "react";
import { formatNumber } from "@/lib/utils";
import { Users, Eye, FileText, TrendingUp, UserCheck, type LucideIcon } from "lucide-react";
import type { Delta } from "@/lib/report";
import { DeltaBadge } from "@/components/ui/delta-badge";

interface FleetSummaryCardsProps {
  isAll: boolean;
  displayName: string;
  accountName: string;
  totalViews: number;
  totalPosts: number;
  totalInteractions: number;
  totalLikes: number;
  totalReplies: number;
  avgER: number;
  activeAccounts: number;
  totalFollowers?: number | null;
  deltas?: { views: Delta; posts: Delta; er: number; followers?: number | null } | null;
  loading?: boolean;
}

interface Card {
  title: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  tone: string;
  delta?: React.ReactNode;
}

export function FleetSummaryCards({
  isAll,
  displayName,
  accountName,
  totalViews,
  totalPosts,
  totalInteractions,
  totalLikes,
  totalReplies,
  avgER,
  activeAccounts,
  totalFollowers,
  deltas,
  loading = false,
}: FleetSummaryCardsProps) {
  const cards: Card[] = [
    {
      title: isAll ? "Akun" : "Akun dipilih",
      value: isAll ? String(activeAccounts) : `@${accountName}`,
      hint: isAll ? "Semua akun terhubung" : displayName,
      icon: Users,
      tone: "bg-subtle text-muted",
    },
    {
      title: isAll ? "Total pengikut" : "Pengikut akun",
      value:
        totalFollowers !== null && totalFollowers !== undefined
          ? formatNumber(totalFollowers)
          : "-",
      hint: isAll
        ? `Gabungan dari ${activeAccounts} cabang`
        : displayName,
      icon: UserCheck,
      tone: "bg-accent-soft text-accent",
      delta:
        deltas?.followers !== undefined && deltas?.followers !== null ? (
          <DeltaBadge delta={deltas.followers} unit="" />
        ) : undefined,
    },
    {
      title: "Total penayangan",
      value: formatNumber(totalViews),
      hint: "Berapa kali postingan dilihat",
      icon: Eye,
      tone: "bg-accent-soft text-accent",
      delta: deltas && <DeltaBadge delta={deltas.views} />,
    },
    {
      title: "Postingan terbit",
      value: formatNumber(totalPosts),
      hint: "Postingan baru pada periode ini",
      icon: FileText,
      tone: "bg-warning-soft text-warning",
      delta: deltas && <DeltaBadge delta={deltas.posts} />,
    },
    {
      title: "Tingkat interaksi",
      value: `${avgER}%`,
      hint: `${formatNumber(totalInteractions)} interaksi: ${formatNumber(totalLikes)} suka, ${formatNumber(totalReplies)} komentar`,
      icon: TrendingUp,
      tone: "bg-success-soft text-success",
      delta: deltas && <DeltaBadge delta={deltas.er} unit=" poin" />,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.title} className="card p-5">
            <div className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${card.tone}`}
              >
                <Icon className="w-[18px] h-[18px]" />
              </div>
              <span className="text-sm font-medium text-muted">{card.title}</span>
            </div>

            {loading ? (
              <div className="mt-4 space-y-2.5 animate-pulse">
                <div className="h-8 w-24 rounded-md bg-subtle" />
                <div className="h-3.5 w-40 rounded bg-subtle" />
              </div>
            ) : (
              <>
                <p className="mt-3 flex items-baseline gap-2">
                  <span className="text-[28px] leading-9 font-bold text-fg truncate">
                    {card.value}
                  </span>
                  {card.delta}
                </p>
                <p className="mt-1 text-[13px] text-muted line-clamp-2" title={card.hint}>
                  {card.hint}
                </p>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
