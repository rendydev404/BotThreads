"use client";

import React, { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowRight, Bot, CheckCircle2, Link2, Loader2, RefreshCw, Sparkles, Trash2, UserCheck } from "lucide-react";
import {
  connectWorkspaceThreadsAccount,
  fetchConnectedThreadsAccounts,
  removeWorkspaceThreadsAccount,
  syncWorkspaceThreadsAccount,
} from "@/lib/team-client";
import type { ConnectedThreadsAccountDTO, WorkspaceThreadsAccountsResponse } from "@/lib/threads-connect";
import { Banner } from "@/components/autopilot/shared";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { FormError, TextAreaField } from "./fields";
import { errorText, formatDateWib, formatInt } from "./format";
import { BTN_PRIMARY, EmptyState, LoadError, Pill, RefreshButton } from "./states";
import { ThreadsConnectButton, ThreadsMobileHelp } from "./threads-connect-button";
import { useRemote } from "./use-remote";

const BTN_SM =
  "h-9 px-3 rounded-full border border-line-strong text-xs font-semibold text-fg inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors hover:border-accent hover:text-accent disabled:opacity-50 disabled:cursor-not-allowed";

function AccountRow({
  acc,
  canManage,
  oneClickReady,
  busy,
  onSync,
  onRemove,
}: {
  acc: ConnectedThreadsAccountDTO;
  canManage: boolean;
  oneClickReady: boolean;
  busy: boolean;
  onSync: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
      <div className="flex items-start gap-3 min-w-0">
        <AccountAvatar name={acc.displayName} src={acc.avatarUrl} size="w-11 h-11" className="text-sm" />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-bold text-fg truncate">{acc.displayName}</span>
            <span className="text-xs font-mono text-muted">@{acc.username}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill
              tone={acc.needsReconnect ? "danger" : "success"}
              icon={acc.needsReconnect ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
            >
              {acc.needsReconnect ? "Perlu Hubungkan Ulang" : "Terhubung & Siap"}
            </Pill>
            {acc.overQuota && (
              <Pill tone="warning" icon={<AlertTriangle className="w-3 h-3" />}>
                Di luar kuota paket
              </Pill>
            )}
            <Pill tone={acc.autopilotMode !== "MATI" ? "accent" : "neutral"}>Autopilot: {acc.autopilotMode}</Pill>
          </div>
          <p className="text-xs text-muted">
            {acc.connectedAt ? `Terhubung ${formatDateWib(acc.connectedAt)} · ` : ""}Token berlaku s/d {formatDateWib(acc.accessExpiresAt)} · Target{" "}
            {acc.postsPerDay} posting/hari
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0 lg:justify-end">
        <Link href="/autopilot" className={BTN_SM}>
          <Bot className="w-3.5 h-3.5" />
          Atur Autopilot
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
        {canManage && (
          <>
            {oneClickReady && <ThreadsConnectButton label="Hubungkan ulang" size="sm" reconnect />}
            <button type="button" onClick={onSync} disabled={busy} className={BTN_SM} title="Ambil ulang nama, username, dan foto dari Threads">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Sinkronkan
            </button>
            {acc.owned && (
              <button
                type="button"
                onClick={onRemove}
                disabled={busy}
                className={cn(BTN_SM, "hover:border-danger hover:text-danger")}
                aria-label={`Hapus akun @${acc.username}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Hapus
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export function AccountsTab({
  canManage,
  onAccountConnected,
  onOpenSubscription,
}: {
  canManage: boolean;
  onAccountConnected?: () => void;
  onOpenSubscription?: () => void;
}) {
  const searchParams = useSearchParams();
  const oauthConnected = searchParams.get("threads_connected");
  const oauthError = searchParams.get("threads_error");

  const { data, error, status, loading, refreshing, reload, mutate } = useRemote<WorkspaceThreadsAccountsResponse>(
    "akun-threads-ws",
    fetchConnectedThreadsAccounts,
    "Gagal memuat daftar akun Threads."
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ConnectedThreadsAccountDTO | null>(null);
  const [notice, setNotice] = useState<string | null>(() =>
    oauthConnected ? `Akun Threads @${oauthConnected} berhasil dihubungkan.` : null
  );
  const formId = useId();

  // Login Threads di HP bisa selesai di browser/aplikasi lain: begitu pengguna kembali ke tab ini, muat ulang daftar.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  if (loading && !data) {
    return (
      <div className="card p-6 space-y-4 animate-pulse" aria-busy="true">
        <div className="h-5 w-48 rounded bg-subtle" />
        <div className="h-24 rounded-xl bg-subtle" />
      </div>
    );
  }

  if (error && !data) {
    return <LoadError message={error} status={status} onRetry={reload} />;
  }

  const accounts = data?.accounts ?? [];
  const quota = data?.quota ?? { used: 0, max: 1, planNama: null, expired: false };
  const quotaFull = quota.max !== null && quota.used >= quota.max;
  // Satu klik: ke halaman izin Threads lalu kembali dalam keadaan terhubung (perlu App ID Threads + kunci token di server).
  const oneClickReady = !!data?.oauthConfigured && !!data.connectReady;
  // Login Threads wajib https. Komponen ini baru dirender di peramban (data dimuat di klien), jadi aman membaca window.
  const insecure = typeof window !== "undefined" && window.location.protocol === "http:";
  // Tempel Access Token hanya cadangan untuk pengembang (mis. localhost http, yang tidak bisa memakai login Threads).
  const manualAllowed = !!data?.connectReady && (!data.oauthConfigured || insecure);

  const connectButton = (label: string) => (
    <ThreadsConnectButton label={label} disabled={!oneClickReady} disabledTitle="Belum diaktifkan oleh pengelola platform" />
  );
  const openManual = () => {
    setFormError(null);
    setModalOpen(true);
  };

  const submitConnect = async () => {
    if (busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const res = await connectWorkspaceThreadsAccount({ accessToken: accessToken.trim() });
      mutate((prev) => {
        const filtered = prev.accounts.filter((a) => a.id !== res.account.id);
        const nextAccounts = [...filtered, res.account];
        return {
          ...prev,
          accounts: nextAccounts,
          quota: { ...prev.quota, used: nextAccounts.length },
        };
      });
      setModalOpen(false);
      setAccessToken("");
      setNotice(`Akun Threads @${res.account.username} berhasil dihubungkan dan siap dipakai untuk Autopilot.`);
      onAccountConnected?.();
    } catch (e) {
      setFormError(errorText(e, "Gagal menghubungkan akun Threads."));
    } finally {
      setBusy(false);
    }
  };

  const syncAccount = async (acc: ConnectedThreadsAccountDTO) => {
    if (rowBusy) return;
    setRowBusy(acc.id);
    setRowError(null);
    try {
      const res = await syncWorkspaceThreadsAccount(acc.id);
      mutate((prev) => ({ ...prev, accounts: prev.accounts.map((a) => (a.id === acc.id ? { ...a, ...res.account } : a)) }));
      setNotice(`Profil @${res.account.username} diperbarui dari Threads.`);
    } catch (e) {
      setRowError(errorText(e, "Gagal menyinkronkan profil."));
      reload();
    } finally {
      setRowBusy(null);
    }
  };

  const confirmRemove = async () => {
    const acc = removing;
    if (!acc || rowBusy) return;
    setRowBusy(acc.id);
    setRowError(null);
    try {
      await removeWorkspaceThreadsAccount(acc.id);
      mutate((prev) => {
        const nextAccounts = prev.accounts.filter((a) => a.id !== acc.id);
        return { ...prev, accounts: nextAccounts, quota: { ...prev.quota, used: nextAccounts.length } };
      });
      setRemoving(null);
      setNotice(`Akun @${acc.username} dihapus dari workspace. Slot kuotanya bisa dipakai untuk akun lain.`);
      onAccountConnected?.();
    } catch (e) {
      setRowError(errorText(e, "Gagal menghapus akun."));
      setRemoving(null);
    } finally {
      setRowBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      {rowError && (
        <Banner tone="danger" onClose={() => setRowError(null)}>
          {rowError}
        </Banner>
      )}
      {notice && (
        <Banner tone="success" onClose={() => setNotice(null)}>
          {notice}
        </Banner>
      )}
      {oauthError && (
        <Banner tone="warning">
          {oauthError === "threads_oauth_off" || oauthError === "threads_key_off"
            ? "Fitur hubungkan akun Threads belum diaktifkan oleh pengelola platform. Silakan coba lagi nanti atau hubungi admin."
            : oauthError === "threads_insecure"
              ? "Login Threads hanya bisa dari alamat https. Buka dashboard lewat domain https-nya, lalu klik Hubungkan Akun Threads lagi."
              : oauthError}
        </Banner>
      )}
      {insecure && !oauthError && oneClickReady && canManage && (
        <Banner tone="info">
          Halaman ini dibuka lewat http, sedangkan Threads hanya mengizinkan login dari https. Di produksi (https) cukup satu klik.
          Untuk uji di komputer sendiri, jalankan <code className="font-mono">npm run dev:https</code> lalu buka https://localhost:3000.
        </Banner>
      )}
      {data && !oneClickReady && canManage && (
        <Banner tone="info">
          Hubungkan akun Threads sekali klik belum diaktifkan oleh pengelola platform.{" "}
          <span className="text-muted">
            (Pengelola: isi Threads App ID &amp; App Secret di Super Admin &gt; Integrasi
            {data.connectReady ? "" : ", dan TOKEN_ENCRYPTION_KEY di server"}.)
          </span>
        </Banner>
      )}

      {/* Ringkasan Kuota Akun Threads */}
      <div className="card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-fg">Akun Threads Terhubung</h3>
            <Pill tone={quotaFull ? "warning" : "accent"}>
              {formatInt(quota.used)} / {quota.max !== null ? formatInt(quota.max) : "Tanpa batas"} Akun
            </Pill>
          </div>
          <p className="text-xs text-muted">
            {quota.planNama
              ? `Paket aktif: ${quota.planNama}. Setiap akun yang terhubung dapat dijadwalkan dan dijalankan otomatis oleh AI.`
              : "Hubungkan akun Threads Anda untuk mulai menulis dan menerbitkan posting otomatis."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <RefreshButton onClick={reload} busy={refreshing} />
          {canManage && (
            <>
              {quotaFull || quota.expired ? (
                <button type="button" onClick={onOpenSubscription} className={BTN_PRIMARY}>
                  <Sparkles className="w-4 h-4" />
                  {quota.expired ? "Perpanjang Paket" : "Upgrade Kuota Akun"}
                </button>
              ) : (
                accounts.length > 0 && connectButton("Tambah Akun Threads")
              )}
            </>
          )}
        </div>
      </div>

      {quota.max !== null && quota.used > quota.max && !quota.expired && (
        <Banner tone="warning">
          Paket {quota.planNama ?? "Anda"} sekarang maksimal {formatInt(quota.max)} akun, sedangkan ada {formatInt(quota.used)} akun terhubung.{" "}
          {formatInt(quota.used - quota.max)} akun terbaru (bertanda &quot;Di luar kuota paket&quot;) dihentikan sementara: tidak bisa posting,
          Autopilot dijeda, dan komentar tidak dibalas. Hapus akun yang tidak dipakai atau upgrade paket, dan akun itu otomatis aktif lagi.
        </Banner>
      )}
      {canManage && quotaFull && quota.used === quota.max && !quota.expired && accounts.some((a) => a.owned) && (
        <Banner tone="info">
          Kuota akun paket sudah penuh. Hapus akun yang tidak dipakai untuk mengosongkan slot, atau upgrade paket untuk menambah kuota.
        </Banner>
      )}

      {canManage && oneClickReady && !quotaFull && !quota.expired && <ThreadsMobileHelp className="sm:hidden" />}

      {/* Daftar Akun */}
      {accounts.length === 0 ? (
        <EmptyState
          icon={<Link2 className="w-6 h-6" />}
          title="Belum ada akun Threads yang terhubung"
          action={
            canManage && !quota.expired ? (
              <div className="flex flex-col items-center gap-3">
                {connectButton("Hubungkan Akun Threads")}
                {manualAllowed && (
                  <button type="button" onClick={openManual} className="text-xs text-muted underline hover:text-fg cursor-pointer">
                    Untuk developer: hubungkan dengan Access Token
                  </button>
                )}
              </div>
            ) : undefined
          }
        >
          <span className="block">Hubungkan akun Threads brand Anda untuk mengaktifkan penjadwalan dan Autopilot AI.</span>
          <span className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
            <span>1. Klik tombol di bawah</span>
            <span>2. Masuk ke akun Threads Anda</span>
            <span>3. Tekan &quot;Izinkan&quot;, selesai</span>
          </span>
        </EmptyState>
      ) : (
        <ul className="card divide-y divide-line">
          {accounts.map((acc) => (
            <AccountRow
              key={acc.id}
              acc={acc}
              canManage={canManage}
              oneClickReady={oneClickReady}
              busy={rowBusy === acc.id}
              onSync={() => void syncAccount(acc)}
              onRemove={() => setRemoving(acc)}
            />
          ))}
        </ul>
      )}

      {/* Konfirmasi hapus akun */}
      {removing && (
        <ModalShell
          open
          onClose={() => !rowBusy && setRemoving(null)}
          busy={!!rowBusy}
          title={`Hapus akun @${removing.username}?`}
          description="Akun dilepas dari workspace ini dan slot kuotanya bisa dipakai akun lain."
          footer={
            <>
              <ModalButton onClick={() => setRemoving(null)} disabled={!!rowBusy}>
                Batal
              </ModalButton>
              <ModalButton variant="danger" onClick={() => void confirmRemove()} disabled={!!rowBusy}>
                {rowBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {rowBusy ? "Menghapus..." : "Hapus akun"}
              </ModalButton>
            </>
          }
        >
          <ul className="space-y-1.5 text-sm text-fg list-disc pl-5">
            <li>Posting terjadwal dan Autopilot akun ini dihentikan.</li>
            <li>Balas komentar otomatis untuk akun ini dimatikan.</li>
            <li>Riwayat posting yang sudah terbit tetap tersimpan.</li>
            <li>Postingan di Threads tidak ikut terhapus. Akun bisa dihubungkan lagi kapan saja.</li>
          </ul>
        </ModalShell>
      )}

      {/* Modal Hubungkan Akun Threads */}
      {modalOpen && (
        <ModalShell
          open
          onClose={() => !busy && setModalOpen(false)}
          busy={busy}
          title="Hubungkan dengan Access Token"
          description="Cara manual untuk developer. Pengguna biasa cukup memakai tombol Hubungkan Akun Threads."
          footer={
            <>
              <ModalButton onClick={() => setModalOpen(false)} disabled={busy}>
                Batal
              </ModalButton>
              <ModalButton variant="primary" type="submit" form={formId} disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                {busy ? "Menghubungkan..." : "Verifikasi & Hubungkan"}
              </ModalButton>
            </>
          }
        >
          <form
            id={formId}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submitConnect();
            }}
            className="space-y-4"
          >
            <TextAreaField
              label="Access Token Threads"
              rows={3}
              value={accessToken}
              onChange={(v) => {
                setAccessToken(v);
                setFormError(null);
              }}
              placeholder="Tempel token akses Threads Anda (diawali TH...)"
              hint="Buat token di Meta for Developers > aplikasi Anda > Threads > Access Token (izin threads_basic dan threads_content_publish). Token dicek ke Threads lalu disimpan terenkripsi."
              disabled={busy}
            />
            <FormError message={formError} />
          </form>
        </ModalShell>
      )}
    </div>
  );
}
