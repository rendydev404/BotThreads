"use client";

import React from "react";
import { Building2, KeyRound, Link2, Package, Receipt, ScrollText, Settings, User } from "lucide-react";
import { fetchAdminAudit } from "@/lib/admin-client";
import { ADMIN_ACTION_LABEL, type AdminAuditDTO, type AdminAuditResponse } from "@/lib/admin-types";
import { formatWibFull } from "@/lib/scheduling";
import { ROLE_LABELS, type Role } from "@/lib/team-client";
import { Banner, ListSkeleton, LoadMoreButton } from "@/components/autopilot/shared";
import { formatInt } from "@/components/settings/format";
import { EmptyState, RefreshButton } from "@/components/settings/states";
import { usePaged } from "@/components/settings/use-remote";
import { AdminLoadError, RefreshError, humanize, useAdmin } from "./shared";

const LOAD_ERROR = "Gagal memuat audit platform.";

type IconType = React.ComponentType<{ className?: string }>;

const TARGET: Record<AdminAuditDTO["targetType"], { label: string; Icon: IconType }> = {
  PENGGUNA: { label: "Pengguna", Icon: User },
  WORKSPACE: { label: "Workspace", Icon: Building2 },
  SUMBER: { label: "Sumber akun", Icon: Link2 },
  SISTEM: { label: "Sistem", Icon: Settings },
  PAKET: { label: "Paket", Icon: Package },
  TAGIHAN: { label: "Tagihan", Icon: Receipt },
  AKSES: { label: "Hak akses", Icon: KeyRound },
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** "signupOpen" menjadi "Signup open" untuk kunci rincian yang belum dikenal UI. */
const humanizeKey = (key: string): string => humanize(key.replace(/([a-z0-9])([A-Z])/g, "$1_$2"));

function actorText(row: AdminAuditDTO): string {
  if (row.actor.startsWith("system:")) return "Sistem";
  return row.actorName || row.actor;
}

/** Sasaran tindakan: jenisnya, lalu username (bila dicatat) atau id-nya. */
function TargetText({ row }: { row: AdminAuditDTO }) {
  const { label } = TARGET[row.targetType] ?? { label: humanize(row.targetType) };
  const username = row.targetType === "PENGGUNA" ? text(row.detail?.username) : null;
  if (username) return <>{`${label} @${username}`}</>;
  if (!row.targetId) return <>{label}</>;
  return (
    <>
      {label} <span className="font-mono text-[11px] break-all">{row.targetId}</span>
    </>
  );
}

/** Rincian tindakan dari kolom `detail` dalam kalimat; kunci yang belum dikenal tetap ditampilkan apa adanya. */
function detailLines(row: AdminAuditDTO): string[] {
  const d = row.detail ?? {};
  // Username sudah tampil sebagai sasaran.
  const used = new Set<string>(["username"]);
  const lines: string[] = [];
  const seen = (...keys: string[]) => keys.forEach((k) => used.add(k));

  if (row.action === "SISTEM_PENGATURAN") {
    seen("signupOpen", "autopilotGlobal", "announcement");
    if (typeof d.signupOpen === "boolean") lines.push(d.signupOpen ? "Pendaftaran mandiri dibuka" : "Pendaftaran mandiri ditutup");
    if (typeof d.autopilotGlobal === "boolean") {
      lines.push(d.autopilotGlobal ? "Autopilot global dinyalakan" : "Autopilot global dihentikan untuk semua workspace");
    }
    if ("announcement" in d) lines.push(text(d.announcement) ? `Pengumuman diubah menjadi "${text(d.announcement)}"` : "Pengumuman dihapus");
  } else if (row.action === "SUMBER_TAUTKAN") {
    seen("dari", "ke", "akun");
    const from = text(d.dari);
    const to = text(d.ke);
    // Tenant sebuah sumber tanpa tautan adalah dirinya sendiri, jadi id sumber di salah satu sisi berarti tautan baru atau dilepas.
    if (from && to) {
      lines.push(to === row.targetId ? `Tautan ke ${from} dilepas` : from === row.targetId ? `Ditautkan ke ${to}` : `Dipindah dari ${from} ke ${to}`);
    }
    if (typeof d.akun === "number") lines.push(`${formatInt(d.akun)} akun Threads ikut pindah`);
  } else if (row.action === "WORKSPACE_ANGGOTA_ATUR" || row.action === "WORKSPACE_ANGGOTA_HAPUS") {
    seen("userId", "peran");
    const user = text(d.userId);
    const role = text(d.peran);
    const roleLabel = role ? (ROLE_LABELS[role as Role] ?? role) : null;
    if (user) lines.push(row.action === "WORKSPACE_ANGGOTA_HAPUS" ? `Pengguna ${user} dikeluarkan` : `Pengguna ${user}${roleLabel ? ` menjadi ${roleLabel}` : ""}`);
  }

  seen("alasan");
  if (text(d.alasan)) lines.push(`Alasan: ${text(d.alasan)}`);

  for (const [key, value] of Object.entries(d)) {
    if (used.has(key)) continue;
    if (typeof value === "string" && value) lines.push(`${humanizeKey(key)}: ${value}`);
    else if (typeof value === "number") lines.push(`${humanizeKey(key)}: ${formatInt(value)}`);
    else if (typeof value === "boolean") lines.push(`${humanizeKey(key)}: ${value ? "ya" : "tidak"}`);
  }
  return lines;
}

/** Tab Audit: tindakan super admin di seluruh platform (siapa, apa, sasaran, kapan dalam WIB), terbaru dulu. */
export function AuditTab() {
  const { guard, rev } = useAdmin();
  const audit = usePaged<AdminAuditDTO, AdminAuditResponse>(
    `audit:${rev.audit}`,
    (cursor, signal) => guard(fetchAdminAudit(cursor, signal)),
    (row) => row.id,
    LOAD_ERROR
  );
  const { items, error, status, loading, refreshing, reload, nextCursor, loadMore, loadingMore, moreError } = audit;

  if (loading) return <ListSkeleton label="Memuat audit platform" rows={5} />;
  if (!audit.data) return <AdminLoadError message={error ?? LOAD_ERROR} status={status} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted max-w-xl">Setiap tindakan admin tercatat permanen, terbaru di atas.</p>
        <div className="ml-auto">
          <RefreshButton onClick={reload} busy={refreshing} />
        </div>
      </div>

      <RefreshError error={error} onRetry={reload} />

      {items.length === 0 ? (
        <EmptyState icon={<ScrollText className="w-6 h-6" />} title="Belum ada catatan audit platform.">
          Pemblokiran pengguna, penangguhan workspace, penautan sumber akun, dan perubahan saklar sistem akan tercatat di sini.
        </EmptyState>
      ) : (
        <>
          <ul className="card divide-y divide-line">
            {items.map((row) => {
              const Icon = TARGET[row.targetType]?.Icon ?? ScrollText;
              const lines = detailLines(row);
              return (
                <li key={row.id} className="p-4 flex items-start gap-3">
                  <span className="w-9 h-9 rounded-full bg-subtle text-muted flex items-center justify-center shrink-0" aria-hidden>
                    <Icon className="w-4 h-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-x-3 gap-y-0.5 sm:flex-row sm:items-baseline sm:justify-between">
                      <p className="text-sm font-semibold text-fg break-words">{ADMIN_ACTION_LABEL[row.action] ?? humanize(row.action)}</p>
                      <time dateTime={row.createdAt} className="shrink-0 text-xs text-muted tabular-nums">
                        {formatWibFull(new Date(row.createdAt))}
                      </time>
                    </div>
                    <p className="mt-0.5 text-[13px] text-muted break-words">
                      <span className="font-semibold text-fg">{actorText(row)}</span>
                      {" · "}
                      <TargetText row={row} />
                    </p>
                    {lines.map((line, i) => (
                      <p key={i} className="mt-0.5 text-[13px] text-muted break-words">
                        {line}
                      </p>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
          {moreError && <Banner tone="danger">{moreError}</Banner>}
          {nextCursor && <LoadMoreButton onClick={() => void loadMore()} loading={loadingMore} />}
        </>
      )}
    </div>
  );
}
