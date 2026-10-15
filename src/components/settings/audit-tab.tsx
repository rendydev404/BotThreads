"use client";

import React, { useMemo } from "react";
import { BookOpen, Bot, KeyRound, ScrollText, Settings, Trash2, UserPlus, Users } from "lucide-react";
import { MODE_LABEL, SLOT_STATUS_LABEL, pausedText, type AutopilotMode, type SlotStatus } from "@/lib/autopilot-types";
import type { PublishAccountDTO } from "@/lib/content-types";
import { KNOWLEDGE_KIND_LABEL, type KnowledgeKind } from "@/lib/radar-types";
import { formatWibFull } from "@/lib/scheduling";
import { ROLE_LABELS, fetchAudit, type AuditResponse, type AuditRow, type MemberRow, type Role } from "@/lib/team-client";
import { usePublishAccounts } from "@/components/content/use-publish-accounts";
import { Banner, ListSkeleton, LoadMoreButton, accountHandle } from "@/components/autopilot/shared";
import { EmptyState, LoadError, RefreshButton } from "./states";
import { memberName } from "./team-dialogs";
import { usePaged } from "./use-remote";

const LOAD_ERROR = "Gagal memuat catatan audit.";

type IconType = React.ComponentType<{ className?: string }>;

/** Tindakan yang dicatat server (fungsi SQL `dash_*` dan route) beserta kalimatnya. */
const ACTIONS: Record<string, { label: string; Icon: IconType }> = {
  ANGGOTA_UBAH: { label: "Mengubah akses anggota", Icon: Users },
  ANGGOTA_KELUAR: { label: "Mengeluarkan anggota", Icon: Users },
  UNDANGAN_BUAT: { label: "Mengundang anggota", Icon: UserPlus },
  UNDANGAN_CABUT: { label: "Mencabut undangan", Icon: UserPlus },
  UNDANGAN_TERIMA: { label: "Menerima undangan", Icon: UserPlus },
  RESET_PASSWORD_BUAT: { label: "Membuat tautan reset password", Icon: KeyRound },
  PENGATURAN_WORKSPACE: { label: "Mengubah pengaturan brand", Icon: Settings },
  KNOWLEDGE_SIMPAN: { label: "Menyimpan butir pengetahuan", Icon: BookOpen },
  KNOWLEDGE_HAPUS: { label: "Menghapus butir pengetahuan", Icon: BookOpen },
  AUTOPILOT_CONFIG: { label: "Mengubah pengaturan autopilot", Icon: Bot },
  AUTOPILOT_JEDA_SEMUA: { label: "Menjeda autopilot semua akun", Icon: Bot },
  AUTOPILOT_LANJUT_SEMUA: { label: "Melanjutkan autopilot semua akun", Icon: Bot },
  AUTOPILOT_JEDA: { label: "Autopilot akun dijeda", Icon: Bot },
  AUTOPILOT_LANJUT: { label: "Autopilot akun dilanjutkan", Icon: Bot },
  AUTOPILOT_TURUN_MODE: { label: "Mode autopilot diturunkan ke Tinjau dulu", Icon: Bot },
  AUTOPILOT_SETUJUI: { label: "Menyetujui draf autopilot", Icon: Bot },
  AUTOPILOT_TOLAK: { label: "Menolak draf autopilot", Icon: Bot },
  AUTOPILOT_TULIS_ULANG: { label: "Meminta draf ditulis ulang", Icon: Bot },
  AUTOPILOT_LEWATI: { label: "Melewati slot autopilot", Icon: Bot },
  STATISTIK_HAPUS: { label: "Menghapus baris statistik", Icon: Trash2 },
};

/** Tindakan yang `target`-nya id anggota: nama anggota diambil dari daftar tim. */
const MEMBER_ACTIONS = new Set(["ANGGOTA_UBAH", "ANGGOTA_KELUAR", "RESET_PASSWORD_BUAT"]);
/** Tindakan yang `target`-nya id akun Threads. */
const ACCOUNT_ACTIONS = new Set(["AUTOPILOT_CONFIG", "AUTOPILOT_JEDA", "AUTOPILOT_LANJUT", "AUTOPILOT_TURUN_MODE"]);

const text = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const roleText = (v: unknown): string | null => {
  const r = text(v);
  return r ? (ROLE_LABELS[r as Role] ?? r) : null;
};
/** "AKSI_LAIN" menjadi "Aksi lain" untuk tindakan yang belum dikenal UI. */
const humanize = (action: string): string => {
  const s = action.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function actorText(row: AuditRow): string {
  if (row.actorName) return row.actorName;
  if (row.actor.startsWith("system:")) return "Sistem autopilot";
  return "Pengguna yang sudah dihapus";
}

interface Lookup {
  accounts: Map<string, PublishAccountDTO>;
  /** null = daftar tim belum (atau tidak bisa) dimuat. */
  members: Map<string, MemberRow> | null;
}

/** Sasaran tindakan dalam bahasa manusia. Server hanya mengirim id, jadi nama dicari dari data yang sudah ada. */
function targetText(row: AuditRow, { accounts, members }: Lookup): string | null {
  const d = row.detail ?? {};
  if (MEMBER_ACTIONS.has(row.action)) {
    const m = row.target ? members?.get(row.target) : null;
    if (m) return `Anggota: ${memberName(m)}`;
    return members ? "Anggota yang sudah tidak ada di tim" : "Seorang anggota";
  }
  const accountId = ACCOUNT_ACTIONS.has(row.action) ? row.target : text(d.accountId);
  if (accountId) {
    const a = accounts.get(accountId);
    return a ? `Akun ${accountHandle(a)}` : "Satu akun Threads";
  }
  if (row.action === "UNDANGAN_BUAT") return text(d.email);
  if (row.action === "KNOWLEDGE_SIMPAN") return text(d.judul) ? `"${text(d.judul)}"` : null;
  return null;
}

/** Rincian tambahan dari kolom `detail` (peran lama dan baru, mode, alasan jeda, dst.). */
function detailText(row: AuditRow): string | null {
  const d = row.detail ?? {};
  switch (row.action) {
    case "ANGGOTA_UBAH": {
      const from = roleText(d.dari);
      const to = roleText(d.ke);
      const role = from && to ? (from === to ? `Peran tetap ${to}` : `${from} menjadi ${to}`) : null;
      const scope = d.lingkup === "SEMUA" ? "semua akun" : d.lingkup === "PILIHAN" ? "akun tertentu" : null;
      return [role, scope].filter(Boolean).join(", ") || null;
    }
    case "ANGGOTA_KELUAR":
      return roleText(d.peran) ? `Peran terakhir ${roleText(d.peran)}` : null;
    case "UNDANGAN_BUAT":
    case "UNDANGAN_TERIMA":
      return roleText(d.peran) ? `Sebagai ${roleText(d.peran)}` : null;
    case "KNOWLEDGE_SIMPAN":
      return text(d.jenis) ? (KNOWLEDGE_KIND_LABEL[d.jenis as KnowledgeKind] ?? null) : null;
    case "AUTOPILOT_CONFIG": {
      const modeKey = text(d.mode);
      const mode = modeKey ? `Mode ${MODE_LABEL[modeKey as AutopilotMode] ?? modeKey}` : null;
      const posts = typeof d.postsPerDay === "number" ? `${d.postsPerDay} posting per hari` : null;
      const strategy = d.slotStrategy === "JAM_TETAP" ? "jam tetap" : d.slotStrategy === "JAM_RAMAI" ? "jam ramai" : null;
      return [mode, posts, strategy].filter(Boolean).join(", ") || null;
    }
    case "AUTOPILOT_JEDA":
      return pausedText(text(d.alasan));
    case "AUTOPILOT_TURUN_MODE":
      return "Kinerja turun tajam, jadi draf kembali menunggu persetujuan.";
    case "AUTOPILOT_SETUJUI":
    case "AUTOPILOT_TOLAK":
    case "AUTOPILOT_TULIS_ULANG":
    case "AUTOPILOT_LEWATI": {
      const statusKey = text(d.status);
      return statusKey ? `Status slot: ${SLOT_STATUS_LABEL[statusKey as SlotStatus] ?? statusKey}` : null;
    }
    default:
      return null;
  }
}

interface AuditTabProps {
  /** Anggota tim bila sudah dimuat (untuk nama sasaran); null = belum ada. */
  members: MemberRow[] | null;
  /** Dipanggil saat halaman audit memuat tindakan yang menyasar anggota, supaya daftar tim ikut dimuat. */
  onNeedMembers: () => void;
}

/** Tab Audit: siapa mengubah apa dan kapan (WIB), terbaru dulu, berhalaman lewat kursor server. */
export function AuditTab({ members, onNeedMembers }: AuditTabProps) {
  const accounts = usePublishAccounts();
  const audit = usePaged<AuditRow, AuditResponse>(
    "audit",
    async (cursor, signal) => {
      const res = await fetchAudit(cursor, signal);
      if (res.items.some((row) => MEMBER_ACTIONS.has(row.action))) onNeedMembers();
      return res;
    },
    (row) => row.id,
    LOAD_ERROR
  );
  const { items, error, status, loading, refreshing, reload, nextCursor, loadMore, loadingMore, moreError } = audit;

  const lookup = useMemo<Lookup>(
    () => ({
      accounts: new Map(accounts.accounts.map((a) => [a.id, a])),
      members: members ? new Map(members.map((m) => [m.id, m])) : null,
    }),
    [accounts.accounts, members]
  );

  if (loading) return <ListSkeleton label="Memuat catatan audit" rows={5} />;
  if (!audit.data) return <LoadError message={error ?? LOAD_ERROR} status={status} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted max-w-xl">Setiap perubahan penting di workspace ini tercatat, terbaru di atas.</p>
        <div className="ml-auto">
          <RefreshButton onClick={reload} busy={refreshing} />
        </div>
      </div>

      {error && (
        <Banner tone="danger">
          Gagal menyegarkan data: {error}{" "}
          <button type="button" onClick={reload} className="underline font-semibold cursor-pointer">
            Coba lagi
          </button>
        </Banner>
      )}

      {items.length === 0 ? (
        <EmptyState icon={<ScrollText className="w-6 h-6" />} title="Belum ada catatan audit.">
          Perubahan peran, undangan, pengaturan brand, pengetahuan, dan autopilot akan tercatat di sini.
        </EmptyState>
      ) : (
        <>
          <ul className="card divide-y divide-line">
            {items.map((row) => {
              const known = ACTIONS[row.action];
              const Icon = known?.Icon ?? ScrollText;
              const target = targetText(row, lookup);
              const detail = detailText(row);
              return (
                <li key={row.id} className="p-4 flex items-start gap-3">
                  <span className="w-9 h-9 rounded-full bg-subtle text-muted flex items-center justify-center shrink-0" aria-hidden>
                    <Icon className="w-4 h-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-x-3 gap-y-0.5 sm:flex-row sm:items-baseline sm:justify-between">
                      <p className="text-sm font-semibold text-fg break-words">{known?.label ?? humanize(row.action)}</p>
                      <time dateTime={row.createdAt} className="shrink-0 text-xs text-muted tabular-nums">
                        {formatWibFull(new Date(row.createdAt))}
                      </time>
                    </div>
                    <p className="mt-0.5 text-[13px] text-muted break-words">
                      <span className="font-semibold text-fg">{actorText(row)}</span>
                      {target ? ` · ${target}` : ""}
                    </p>
                    {detail && <p className="mt-0.5 text-[13px] text-muted break-words">{detail}</p>}
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
