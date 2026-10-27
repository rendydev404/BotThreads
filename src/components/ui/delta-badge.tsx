"use client";

import React from "react";
import type { Delta } from "@/lib/report";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n/lang-provider";

/** Perubahan dibanding periode sebelumnya: ▲40%, ▼12%, atau "baru". */
export function DeltaBadge({
  delta,
  unit = "%",
  className,
}: {
  delta: Delta | undefined;
  unit?: string;
  className?: string;
}) {
  const t = useT();
  if (delta === null || delta === undefined) return null;
  if (delta === "new") {
    return <span className={cn("text-xs font-medium text-accent", className)}>{t("baru")}</span>;
  }
  if (delta === 0) {
    return <span className={cn("text-xs text-muted tabular-nums", className)}>0{unit}</span>;
  }
  const up = delta > 0;
  return (
    <span
      className={cn(
        "text-xs font-semibold tabular-nums",
        up ? "text-success" : "text-danger",
        className
      )}
    >
      {up ? "▲" : "▼"}
      {Math.abs(delta)}
      {unit}
    </span>
  );
}
