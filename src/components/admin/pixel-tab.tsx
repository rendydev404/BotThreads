"use client";

import React, { useState } from "react";
import { CheckCircle2, ExternalLink, Eye, KeyRound, Loader2, MousePointerClick, Save, Send, Target, UserPlus } from "lucide-react";
import { call } from "@/lib/content-client";
import type { PixelAdminDTO } from "@/lib/meta-pixel";
import { cn } from "@/lib/utils";
import { Banner, ListSkeleton, Switch } from "@/components/autopilot/shared";
import { FormError, TextField } from "@/components/settings/fields";
import { errorText } from "@/components/settings/format";
import { BTN_OUTLINE, BTN_PRIMARY, Pill, RefreshButton } from "@/components/settings/states";
import { useRemote } from "@/components/settings/use-remote";
import { AdminLoadError, RefreshError, useAdmin } from "./shared";

const LOAD_ERROR = "Gagal memuat pengaturan Meta Pixel.";
const EVENTS_MANAGER = "https://business.facebook.com/events_manager2";

type Payload = { success: true; pixel: PixelAdminDTO };

const fetchPixel = (signal?: AbortSignal) => call<Payload>("/api/admin/pixel", { signal });
const savePixel = (body: Record<string, unknown>) => call<Payload>("/api/admin/pixel", { method: "PUT", body: JSON.stringify(body) });
const testPixel = () => call<{ success: true; received: number }>("/api/admin/pixel", { method: "POST", body: "{}" });

interface FormState {
  pixelId: string;
  accessToken: string;
  testEventCode: string;
}

const SOURCE_LABEL = { database: "dari panel", env: "dari env server", none: "belum diisi" } as const;

/** Event yang dikirim otomatis: ditulis dalam bahasa pemasar, bukan istilah teknis saja. */
const EVENTS: { name: string; when: string; icon: React.ReactNode; server: boolean }[] = [
  { name: "PageView", when: "Setiap halaman dibuka (beranda, harga, fitur, daftar, dashboard). Konsol admin tidak dilacak.", icon: <Eye className="w-4 h-4" />, server: false },
  { name: "ViewContent", when: "Pengunjung membuka halaman Harga atau Fitur: tanda tertarik, cocok untuk retargeting.", icon: <MousePointerClick className="w-4 h-4" />, server: false },
  { name: "CompleteRegistration", when: "Pendaftaran akun berhasil (form atau Google). Pakai ini sebagai tujuan konversi iklan.", icon: <UserPlus className="w-4 h-4" />, server: true },
];

function Step({ no, title, children }: { no: number; title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center gap-3">
        <span className="w-7 h-7 shrink-0 rounded-full bg-accent text-on-accent text-sm font-bold inline-flex items-center justify-center">{no}</span>
        <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
      </div>
      {children}
    </section>
  );
}

export function PixelTab() {
  const { guard, rev, invalidate, can } = useAdmin();
  const manage = can("integrasi.kelola");
  const { data, error, status, loading, refreshing, reload, mutate } = useRemote<Payload>(`pixel:${rev.pixel}`, (signal) => guard(fetchPixel(signal)), LOAD_ERROR);

  const [form, setForm] = useState<FormState | null>(null);
  const [formFor, setFormFor] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<"save" | "toggle" | "test" | "clear" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Formulir diisi ulang setiap data server berganti (muat pertama, muat ulang, sesudah simpan).
  if (data && data !== formFor) {
    setFormFor(data);
    setForm({ pixelId: data.pixel.pixelId, accessToken: "", testEventCode: data.pixel.testEventCode });
  }

  if (loading || (!data && !error)) return <ListSkeleton label="Memuat Meta Pixel" rows={3} />;
  if (!data || !form) return <AdminLoadError message={error ?? LOAD_ERROR} status={status} onRetry={reload} />;
  const px = data.pixel;

  const run = async (kind: "save" | "toggle" | "clear", body: Record<string, unknown>, ok: string) => {
    setBusy(kind);
    setSaveError(null);
    setNotice(null);
    try {
      const res = await guard(savePixel(body));
      mutate(() => res);
      setForm({ pixelId: res.pixel.pixelId, accessToken: "", testEventCode: res.pixel.testEventCode });
      invalidate(["audit"]);
      setNotice(ok);
    } catch (err) {
      setSaveError(errorText(err, "Gagal menyimpan Meta Pixel."));
    } finally {
      setBusy(null);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    void run(
      "save",
      {
        pixelId: form.pixelId,
        testEventCode: form.testEventCode,
        // Tombolnya bertuliskan "Simpan & aktifkan" saat Pixel belum aktif: menyimpan ID sekaligus menyalakannya.
        ...(!px.live && form.pixelId ? { enabled: true } : {}),
        ...(form.accessToken.trim() ? { accessToken: form.accessToken.trim() } : {}),
      },
      "Pengaturan Meta Pixel tersimpan. Situs memakai nilai baru dalam beberapa menit."
    );
  };

  const toggle = (enabled: boolean) =>
    void run("toggle", { enabled, pixelId: form.pixelId }, enabled ? "Meta Pixel menyala di bottrit.com." : "Meta Pixel dimatikan. Skripnya tidak dimuat lagi di situs.");

  const sendTest = async () => {
    setBusy("test");
    setSaveError(null);
    setNotice(null);
    try {
      const res = await guard(testPixel());
      setNotice(
        px.testEventCode
          ? `Event uji diterima Meta (${res.received}). Cek di Events Manager > Test events.`
          : `Event uji diterima Meta (${res.received}). Isi Test Event Code supaya event uji tidak tercampur data iklan.`
      );
    } catch (err) {
      setSaveError(errorText(err, "Event uji gagal dikirim."));
    } finally {
      setBusy(null);
    }
  };

  const dirty = form.pixelId !== px.pixelId || form.testEventCode !== px.testEventCode || !!form.accessToken.trim();

  return (
    <form onSubmit={handleSave}>
      <fieldset disabled={!manage} className="space-y-6 min-w-0">
        {/* Status utama: satu saklar, terbaca sekilas apakah iklan sedang dilacak. */}
        <section className={cn("card p-5 flex items-center gap-4", px.live && "bg-gradient-to-r from-success-soft to-transparent")}>
          <span className={cn("w-12 h-12 shrink-0 rounded-2xl inline-flex items-center justify-center", px.live ? "bg-success text-on-accent" : "bg-subtle text-muted")}>
            <Target className="w-6 h-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-fg">{px.live ? "Meta Pixel aktif di bottrit.com" : "Meta Pixel belum aktif"}</p>
            <p className="text-[13px] text-muted">
              {px.live
                ? `Pixel ${px.pixelId} · ${SOURCE_LABEL[px.source]}${px.hasAccessToken ? " · Conversions API menyala" : ""}`
                : px.pixelId
                  ? "Pixel ID sudah diisi. Nyalakan saklar untuk mulai melacak pengunjung iklan."
                  : "Isi Pixel ID di langkah 1, lalu nyalakan saklar ini."}
            </p>
          </div>
          <Switch on={px.enabled && !!px.pixelId} busy={busy === "toggle"} disabled={!manage || !px.stored || (!px.pixelId && !form.pixelId)} label="Saklar Meta Pixel" onChange={toggle} />
        </section>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-[13px] text-muted max-w-2xl">
            Pixel dimuat setelah halaman tampil, jadi tidak memperlambat situs. Perubahan berlaku untuk pengunjung dalam beberapa menit.
          </p>
          <RefreshButton onClick={reload} busy={refreshing} />
        </div>

        <RefreshError error={error} onRetry={reload} />
        <FormError message={saveError} />
        {notice && (
          <Banner tone="success" onClose={() => setNotice(null)}>
            {notice}
          </Banner>
        )}
        {!px.stored && (
          <Banner tone="warning">
            Kolom Meta Pixel belum dipasang di database, jadi pengaturan belum bisa disimpan dari panel ini. Jalankan sql/048_meta_pixel.sql, atau isi
            META_PIXEL_ID di variabel lingkungan server.
          </Banner>
        )}

        <Step no={1} title="Pixel ID">
          <p className="text-[13px] text-muted">
            Buka Meta Events Manager &gt; Data sources, pilih Pixel Anda (atau buat baru), lalu salin <strong>Pixel ID</strong> (15-16 angka).
          </p>
          <div className="flex flex-col sm:flex-row sm:items-end gap-3 max-w-2xl">
            <div className="flex-1 min-w-0">
              <TextField
                label="Pixel ID"
                inputMode="numeric"
                autoComplete="off"
                value={form.pixelId}
                onChange={(pixelId) => setForm({ ...form, pixelId: pixelId.replace(/[^\d]/g, "") })}
                placeholder="mis. 1234567890123456"
                maxLength={20}
                disabled={busy !== null}
              />
            </div>
            <a href={EVENTS_MANAGER} target="_blank" rel="noopener noreferrer" className={cn(BTN_OUTLINE, "h-11")}>
              Buka Events Manager
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </Step>

        <Step no={2} title="Conversions API (opsional, disarankan)">
          <p className="text-[13px] text-muted">
            Mengirim event daftar langsung dari server BotThreads, jadi tetap terhitung walau pengunjung memakai pemblokir iklan. Buat token di Events
            Manager &gt; Settings &gt; Conversions API &gt; Generate access token. Email pendaftar dikirim dalam bentuk hash (tidak bisa dibaca).
          </p>
          <div className="grid gap-4 sm:grid-cols-2 max-w-3xl">
            <TextField
              label="Access Token"
              type="password"
              autoComplete="off"
              value={form.accessToken}
              onChange={(accessToken) => setForm({ ...form, accessToken })}
              placeholder={px.hasAccessToken ? `Tersimpan: ${px.accessTokenMasked}` : "EAAG..."}
              hint={px.hasAccessToken ? "Kosongkan untuk tetap memakai token tersimpan." : undefined}
              disabled={busy !== null}
            />
            <TextField
              label="Test Event Code (opsional)"
              autoComplete="off"
              value={form.testEventCode}
              onChange={(testEventCode) => setForm({ ...form, testEventCode: testEventCode.toUpperCase() })}
              placeholder="TEST12345"
              hint="Dari Events Manager > Test events. Hapus setelah selesai menguji."
              maxLength={24}
              disabled={busy !== null}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void sendTest()} disabled={busy !== null || !px.live || !px.hasAccessToken} className={BTN_OUTLINE}>
              {busy === "test" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Kirim event uji
            </button>
            {px.hasAccessToken && (
              <button
                type="button"
                onClick={() => void run("clear", { clearAccessToken: true }, "Access Token dihapus. Event hanya dikirim dari peramban.")}
                disabled={busy !== null}
                className="h-10 px-3 rounded-full text-[13px] font-semibold text-muted hover:text-danger cursor-pointer"
              >
                Hapus token
              </button>
            )}
            {!px.live && <span className="text-xs text-muted">Nyalakan Pixel dulu untuk mengirim event uji.</span>}
          </div>
        </Step>

        {manage && (
          <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2">
            {dirty && <p className="text-xs text-warning sm:mr-auto">Ada perubahan yang belum disimpan.</p>}
            <button type="submit" disabled={busy !== null || !dirty || !px.stored} className={BTN_PRIMARY}>
              {busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {busy === "save" ? "Menyimpan..." : px.live || !form.pixelId ? "Simpan" : "Simpan & aktifkan"}
            </button>
          </div>
        )}

        <section className="card p-5 space-y-4">
          <div className="flex items-center gap-3">
            <span className="w-7 h-7 shrink-0 rounded-full bg-subtle text-muted inline-flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </span>
            <h3 className="text-[15px] font-semibold text-fg">Event yang dikirim otomatis</h3>
          </div>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {EVENTS.map((ev) => (
              <li key={ev.name} className="p-3.5 flex items-start gap-3">
                <span className="w-8 h-8 shrink-0 rounded-lg bg-accent-soft text-accent inline-flex items-center justify-center">{ev.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-semibold text-fg font-mono break-all">{ev.name}</p>
                    <Pill tone={ev.server ? "success" : "neutral"}>{ev.server ? "Peramban + server" : "Peramban"}</Pill>
                  </div>
                  <p className="mt-0.5 text-[13px] text-muted">{ev.when}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted flex items-start gap-1.5">
            <KeyRound className="w-3.5 h-3.5 mt-px shrink-0" />
            Event Purchase (pembayaran paket) belum dikirim; bisa ditambahkan setelah alur pembayaran selesai diperbarui.
          </p>
        </section>

      </fieldset>
    </form>
  );
}
