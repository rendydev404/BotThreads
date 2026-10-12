"use client";

import React from "react";
import { AlertCircle, CheckCircle2, CircleSlash, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentState, AgentStatus } from "./orchestrator-store";

const TILE: Record<AgentStatus, string> = {
  PENDING: "border-line bg-surface opacity-60",
  THINKING: "border-accent/60 bg-accent-soft/40 animate-pulse",
  RETRYING: "border-warning/60 bg-warning-soft/40 animate-pulse",
  SUCCESS: "border-success/50 bg-success-soft/40",
  ERROR: "border-danger/50 bg-danger-soft/40",
  SKIPPED: "border-line bg-subtle opacity-70",
};

const LABEL: Record<AgentStatus, string> = {
  PENDING: "Menunggu giliran",
  THINKING: "Sedang menulis",
  RETRYING: "Mencoba ulang",
  SUCCESS: "Draf siap",
  ERROR: "Gagal",
  SKIPPED: "Dilewati",
};

function StatusIcon({ status }: { status: AgentStatus }) {
  const cls = "w-4 h-4 shrink-0";
  if (status === "THINKING") return <Loader2 className={cn(cls, "text-accent animate-spin")} />;
  if (status === "RETRYING") return <RefreshCw className={cn(cls, "text-warning animate-spin")} />;
  if (status === "SUCCESS") return <CheckCircle2 className={cn(cls, "text-success")} />;
  if (status === "ERROR") return <AlertCircle className={cn(cls, "text-danger")} />;
  if (status === "SKIPPED") return <CircleSlash className={cn(cls, "text-muted")} />;
  return <span className={cn(cls, "rounded-full border-2 border-line")} />;
}

/** Satu ubin per agen (akun): menunggu, menulis, mencoba ulang, selesai, gagal, atau dilewati. */
export function AgentNodeGrid({ agents }: { agents: AgentState[] }) {
  if (agents.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="w-4 h-4 animate-spin text-accent" />
        Memuat gaya dan jam ramai tiap akun...
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-2 @lg:grid-cols-3 @2xl:grid-cols-4 gap-2">
      {agents.map((a) => {
        const detail = a.status === "ERROR" || a.status === "SKIPPED" ? a.error : undefined;
        return (
          <li
            key={a.id}
            title={detail ? `${LABEL[a.status]}: ${detail}` : LABEL[a.status]}
            className={cn("px-2.5 py-2 rounded-lg border flex items-center gap-2 transition-colors duration-300", TILE[a.status])}
          >
            <StatusIcon status={a.status} />
            <span className="min-w-0">
              <span className="block text-xs font-medium text-fg truncate">@{a.username ?? a.displayName}</span>
              {detail && <span className="block text-[11px] text-muted truncate">{detail}</span>}
            </span>
            <span className="sr-only">{LABEL[a.status]}</span>
          </li>
        );
      })}
    </ul>
  );
}
