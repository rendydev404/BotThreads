"use client";

import React from "react";
import { Send, RefreshCw, Bot } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { useT } from "@/components/i18n/lang-provider";
import type { TFunction } from "@/lib/i18n/core";

interface ActivityItem {
  id: string;
  title?: string;
  desc?: string;
  status: string;
  createdAt: string;
}

interface RecentActivityCardProps {
  activities?: ActivityItem[];
  loading?: boolean;
}

const icons = [Send, RefreshCw, Bot];

/** Deskripsi dari server: "Periode: <kunci> terkirim sukses". */
const descText = (desc: string | undefined, t: TFunction) => {
  const m = desc ? /^Periode: (.+) terkirim sukses$/.exec(desc) : null;
  return m ? t("Periode: {period} terkirim sukses", { period: m[1] }) : desc;
};

export function RecentActivityCard({
  activities = [],
  loading = false,
}: RecentActivityCardProps) {
  const t = useT();
  const items = activities.slice(0, 5);

  return (
    <section className="card p-5 h-full">
      <h3 className="text-base font-semibold text-fg">{t("Aktivitas bot")}</h3>
      <p className="text-[13px] text-muted mt-0.5">
        {t("Laporan dan sinkronisasi terbaru")}
      </p>

      <ul className="mt-4 space-y-4">
        {loading ? (
          [0, 1, 2].map((i) => (
            <li key={i} className="h-10 rounded-md bg-subtle animate-pulse" />
          ))
        ) : items.length === 0 ? (
          <li className="text-sm text-muted">{t("Belum ada aktivitas.")}</li>
        ) : (
          items.map((item, i) => {
            const Icon = icons[i % icons.length];
            return (
              <li key={item.id} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-subtle text-muted flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg truncate">
                    {item.title && t(item.title)}
                  </p>
                  <p className="text-[13px] text-muted truncate">{descText(item.desc, t)}</p>
                </div>
                <span className="text-xs text-faint shrink-0 pt-0.5">
                  {formatRelativeTime(item.createdAt)}
                </span>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
