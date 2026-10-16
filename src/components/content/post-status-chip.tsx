"use client";

import React from "react";
import { AlertCircle, CalendarClock, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, type PostStatusKey } from "@/lib/content-types";

/**
 * Foto profil akun; inisial bila tidak ada foto atau gambarnya gagal dimuat (URL CDN Meta bisa
 * kedaluwarsa sebelum disegarkan server, jangan sampai tampil ikon gambar rusak).
 */
export function AccountAvatar({
  name,
  src,
  size = "w-8 h-8",
  className,
}: {
  name: string;
  src?: string | null;
  size?: string;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const show = src && src !== failedSrc;
  return (
    <span
      className={cn(
        "rounded-full overflow-hidden bg-subtle shrink-0 inline-flex items-center justify-center text-[11px] font-semibold text-muted",
        size,
        className
      )}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          className="w-full h-full object-cover"
        />
      ) : (
        name.replace(/^@/, "").slice(0, 2).toUpperCase()
      )}
    </span>
  );
}

const STYLE: Record<PostStatusKey, { cls: string; Icon: React.ComponentType<{ className?: string }> }> = {
  SCHEDULED: { cls: "bg-accent-soft text-accent", Icon: CalendarClock },
  QUEUED: { cls: "bg-warning-soft text-warning", Icon: Clock },
  PROCESSING: { cls: "bg-warning-soft text-warning", Icon: Loader2 },
  PUBLISHED: { cls: "bg-success-soft text-success", Icon: CheckCircle2 },
  FAILED: { cls: "bg-danger-soft text-danger", Icon: AlertCircle },
};

export function PostStatusChip({ status, className }: { status: PostStatusKey; className?: string }) {
  const { cls, Icon } = STYLE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-semibold whitespace-nowrap",
        cls,
        className
      )}
    >
      <Icon className={cn("w-3.5 h-3.5", status === "PROCESSING" && "animate-spin")} />
      {STATUS_LABEL[status]}
    </span>
  );
}
