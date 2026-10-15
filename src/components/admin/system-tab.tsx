"use client";

import React, { useId, useLayoutEffect, useState } from "react";
import { Loader2, Megaphone, OctagonX, Save } from "lucide-react";
import { fetchAdminSettings, saveAdminSettings } from "@/lib/admin-client";
import { ADMIN_ANNOUNCEMENT_MAX, type AdminFlags, type AdminSettingsResponse } from "@/lib/admin-types";
import { ConfirmModal } from "@/components/autopilot/confirm-modal";
import { Banner, ListSkeleton } from "@/components/autopilot/shared";
import { FormError, TextAreaField } from "@/components/settings/fields";
import { errorText } from "@/components/settings/format";
import { BTN_OUTLINE, BTN_PRIMARY, Pill, RefreshButton } from "@/components/settings/states";
import { useRemote } from "@/components/settings/use-remote";
import { AdminLoadError, RefreshError, Switch, tidyText, useAdmin } from "./shared";

const LOAD_ERROR = "Gagal memuat pengaturan sistem.";
const SAVE_ERROR = "Gagal menyimpan. Coba lagi.";

type Control = "signup" | "autopilot" | "announcement";

function SwitchCard({
  title,
  description,
  state,
  checked,
  onChange,
  busy,
  disabled,
  children,
}: {
  title: string;
  description: string;
  /** Keadaan yang sedang berlaku, sebagai chip di samping judul. */
  state: React.ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  busy: boolean;
  disabled: boolean;
  children?: React.ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-label`} className="card p-4 sm:p-5 space-y-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 id={`${id}-label`} className="text-[15px] font-semibold text-fg">
              {title}
            </h3>
            {state}
          </div>
          <p id={`${id}-desc`} className="mt-1 text-[13px] text-muted leading-relaxed">
            {description}
          </p>
        </div>
        <Switch checked={checked} onChange={onChange} labelledBy={`${id}-label`} describedBy={`${id}-desc`} busy={busy} disabled={disabled} />
      </div>
      {children}
    </section>
  );
}

/** Tab Sistem: saklar pendaftaran, saklar darurat autopilot, dan pengumuman untuk semua pengguna. */
export function SystemTab() {
  const { guard, invalidate, can } = useAdmin();
  const manage = can("sistem.kelola");
  const { data, error, status, loading, refreshing, reload, mutate } = useRemote<AdminSettingsResponse>(
    "sistem",
    (signal) => guard(fetchAdminSettings(signal)),
    LOAD_ERROR
  );
  // null = isian mengikuti pengumuman di server (belum diubah).
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState<Control | null>(null);
  const [failure, setFailure] = useState<{ where: Control; message: string } | null>(null);
  const [stopOpen, setStopOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Tab atau halaman yang disembunyikan (Activity) tidak boleh kembali dengan dialog atau pesan lama.
  useLayoutEffect(
    () => () => {
      setStopOpen(false);
      setNotice(null);
    },
    []
  );

  if (loading) return <ListSkeleton label="Memuat pengaturan sistem" rows={3} />;
  if (!data) return <AdminLoadError message={error ?? LOAD_ERROR} status={status} onRetry={reload} />;

  const { flags, signupEnv } = data;
  const current = flags.announcement ?? "";
  const text = draft ?? current;
  // Dirapikan seperti di server, jadi pratinjau sama persis dengan yang akan tersimpan.
  const clean = tidyText(text);
  const changed = clean !== tidyText(current);
  const failureAt = (where: Control): string | null => (failure?.where === where ? failure.message : null);

  /** Kirim hanya saklar yang berubah, lalu pakai balasan server sebagai keadaan terbaru. */
  const save = async (where: Control, patch: Partial<AdminFlags>, done: string): Promise<boolean> => {
    if (saving) return false;
    setSaving(where);
    setFailure(null);
    try {
      const res = await guard(saveAdminSettings(patch));
      mutate((d) => ({ ...d, flags: res.flags, signupEnv: res.signupEnv }));
      invalidate(["ringkasan", "audit"]);
      setNotice(done);
      return true;
    } catch (e) {
      setFailure({ where, message: errorText(e, SAVE_ERROR) });
      return false;
    } finally {
      setSaving(null);
    }
  };

  const toggleAutopilot = (next: boolean) => {
    setFailure(null);
    // Menghentikan autopilot semua workspace selalu lewat konfirmasi; menyalakannya lagi tidak.
    if (next) void save("autopilot", { autopilotGlobal: true }, "Autopilot global dinyalakan lagi.");
    else setStopOpen(true);
  };

  const saveAnnouncement = async (value: string) => {
    const ok = await save("announcement", { announcement: value || null }, value ? "Pengumuman disimpan." : "Pengumuman dihapus.");
    if (ok) setDraft(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted max-w-xl">Saklar di sini berlaku untuk seluruh platform dan tercatat di audit.</p>
        <div className="ml-auto">
          <RefreshButton onClick={reload} busy={refreshing} disabled={saving !== null} />
        </div>
      </div>

      <RefreshError error={error} onRetry={reload} />
      {notice && (
        <Banner tone="success" onClose={() => setNotice(null)}>
          {notice}
        </Banner>
      )}

      <SwitchCard
        title="Pendaftaran mandiri"
        description="Saat menyala, siapa pun bisa mendaftar sendiri dan langsung mendapat workspace baru. Saat mati, pengguna baru hanya bisa masuk lewat undangan."
        state={
          !signupEnv ? (
            <Pill tone="warning">Tertutup di server</Pill>
          ) : flags.signupOpen ? (
            <Pill tone="success">Terbuka</Pill>
          ) : (
            <Pill>Tertutup</Pill>
          )
        }
        checked={flags.signupOpen}
        onChange={(next) => void save("signup", { signupOpen: next }, next ? "Pendaftaran mandiri dibuka." : "Pendaftaran mandiri ditutup.")}
        busy={saving === "signup"}
        disabled={saving !== null || !manage}
      >
        {!signupEnv && (
          <Banner tone="warning">
            Saklar tingkat server <code className="font-semibold">SIGNUP_ENABLED</code> sedang mati, jadi pendaftaran tetap tertutup apa pun
            posisi saklar ini. Saklar ini baru berpengaruh setelah variabel itu dinyalakan di server.
          </Banner>
        )}
        <FormError message={failureAt("signup")} />
      </SwitchCard>

      <SwitchCard
        title="Autopilot global"
        description="Saklar darurat. Selama menyala, autopilot berjalan di tiap workspace yang mengaktifkannya; mematikannya menghentikan autopilot semua workspace sekaligus."
        state={flags.autopilotGlobal ? <Pill tone="success">Menyala</Pill> : <Pill tone="danger">Dihentikan</Pill>}
        checked={flags.autopilotGlobal}
        onChange={toggleAutopilot}
        busy={saving === "autopilot"}
        disabled={saving !== null || !manage}
      >
        {!flags.autopilotGlobal && (
          <Banner tone="danger">
            Autopilot sedang dihentikan untuk semua workspace. Nyalakan lagi saklar ini setelah masalahnya selesai.
          </Banner>
        )}
        {!stopOpen && <FormError message={failureAt("autopilot")} />}
      </SwitchCard>

      <section aria-label="Pengumuman" className="card p-4 sm:p-5">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (changed) void saveAnnouncement(clean);
          }}
        >
          <fieldset disabled={!manage} className="space-y-4 min-w-0">
          <TextAreaField
            label="Pengumuman"
            rows={3}
            value={text}
            onChange={(v) => {
              setDraft(v);
              setFailure(null);
            }}
            maxLength={ADMIN_ANNOUNCEMENT_MAX}
            placeholder="Contoh: Pemeliharaan server Sabtu pukul 22.00 WIB, dashboard tidak bisa dibuka sekitar 30 menit."
            hint="Tampil untuk semua pengguna di bagian atas dashboard sebagai satu paragraf (baris baru menjadi spasi). Kosongkan untuk tidak menampilkan pengumuman."
            disabled={saving !== null}
          />

          <div>
            <p className="text-[13px] font-semibold text-fg">Pratinjau</p>
            {clean ? (
              <div className="mt-1.5 flex items-start gap-3 rounded-xl bg-accent-soft text-fg p-4 text-sm">
                <Megaphone className="w-[18px] h-[18px] mt-0.5 text-accent shrink-0" />
                <p className="min-w-0 leading-relaxed break-words">{clean}</p>
              </div>
            ) : (
              <p className="mt-1.5 rounded-xl border border-dashed border-line-strong p-4 text-[13px] text-muted">
                Kosong: tidak ada pengumuman yang tampil di dashboard.
              </p>
            )}
            <p role="status" aria-live="polite" className="mt-1.5 text-xs text-muted">
              {changed
                ? "Belum disimpan. Pengguna masih melihat pengumuman yang lama."
                : current
                  ? "Pengumuman ini sedang tampil untuk semua pengguna."
                  : "Saat ini tidak ada pengumuman."}
            </p>
          </div>

          <FormError message={failureAt("announcement")} />

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            {changed && (
              <button type="button" onClick={() => setDraft(null)} disabled={saving !== null} className={BTN_OUTLINE}>
                Batalkan perubahan
              </button>
            )}
            {!changed && current && (
              <button type="button" onClick={() => void saveAnnouncement("")} disabled={saving !== null} className={BTN_OUTLINE}>
                {saving === "announcement" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Hapus pengumuman
              </button>
            )}
            <button type="submit" disabled={!changed || saving !== null} className={BTN_PRIMARY}>
              {saving === "announcement" && changed ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {clean || !changed ? "Simpan pengumuman" : "Simpan (hapus pengumuman)"}
            </button>
          </div>
          </fieldset>
        </form>
      </section>

      <ConfirmModal
        open={stopOpen}
        onClose={() => {
          setStopOpen(false);
          setFailure(null);
        }}
        onConfirm={async () => {
          if (await save("autopilot", { autopilotGlobal: false }, "Autopilot global dihentikan untuk semua workspace.")) setStopOpen(false);
        }}
        busy={saving === "autopilot"}
        error={stopOpen ? failureAt("autopilot") : null}
        variant="danger"
        title="Hentikan autopilot untuk semua workspace?"
        confirmLabel="Ya, hentikan semua"
        confirmIcon={<OctagonX className="w-4 h-4" />}
      >
        <p className="text-sm text-fg leading-relaxed">
          Autopilot langsung berhenti di setiap workspace di platform ini dan tidak berjalan lagi sampai saklar ini dinyalakan kembali.
        </p>
      </ConfirmModal>
    </div>
  );
}
