"use client";

import React, { useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, CreditCard, Globe, KeyRound, Link2, Loader2, Save, ShieldCheck } from "lucide-react";
import { fetchAdminIntegrations, saveAdminIntegrations, type AdminIntegrationsPayload } from "@/lib/admin-client";
import type { PlatformIntegrationsDTO } from "@/lib/billing-types";
import { Banner, ListSkeleton } from "@/components/autopilot/shared";
import { FormError, TextField } from "@/components/settings/fields";
import { errorText } from "@/components/settings/format";
import { BTN_OUTLINE, BTN_PRIMARY, Pill, RefreshButton } from "@/components/settings/states";
import { useRemote } from "@/components/settings/use-remote";
import { AdminLoadError, RefreshError, useAdmin } from "./shared";

const LOAD_ERROR = "Gagal memuat konfigurasi integrasi dan API keys.";

/** Kolom rahasia selalu kosong di formulir; diisi hanya untuk mengganti nilai tersimpan. */
interface FormState {
  appUrl: string;
  xenditSecretKey: string;
  xenditCallbackToken: string;
  googleClientId: string;
  googleClientSecret: string;
  threadsAppId: string;
  threadsAppSecret: string;
}

const toFormState = (dto: PlatformIntegrationsDTO): FormState => ({
  appUrl: dto.appUrl,
  xenditSecretKey: "",
  xenditCallbackToken: "",
  googleClientId: dto.googleOauth.clientId,
  googleClientSecret: "",
  threadsAppId: dto.threadsOauth.appId,
  threadsAppSecret: "",
});

const SOURCE_LABEL = { database: "dari panel", env: "dari env server", none: "belum diisi" } as const;

function CopyEndpointRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="rounded-xl bg-subtle p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted">{label}</p>
        <p className="text-xs font-mono text-fg break-all">{url}</p>
      </div>
      <button type="button" onClick={copy} className={BTN_OUTLINE}>
        {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? "Tersalin" : "Salin URL"}
      </button>
    </div>
  );
}

function SectionHead({ icon, title, children, status }: { icon: React.ReactNode; title: string; children: React.ReactNode; status: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent-soft text-accent flex items-center justify-center shrink-0">{icon}</div>
        <div>
          <h4 className="text-sm font-bold text-fg">{title}</h4>
          <p className="text-xs text-muted mt-0.5">{children}</p>
        </div>
      </div>
      <div className="shrink-0">{status}</div>
    </div>
  );
}

export function IntegrationsTab() {
  const { guard, rev, invalidate } = useAdmin();
  const { data, error, status, loading, refreshing, reload, mutate } = useRemote<AdminIntegrationsPayload>(
    `integrasi:${rev.integrasi}`,
    (signal) => guard(fetchAdminIntegrations(signal)),
    LOAD_ERROR
  );

  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Formulir diisi ulang setiap data server berganti (muat pertama, muat ulang, sesudah simpan).
  const [formFor, setFormFor] = useState<AdminIntegrationsPayload | null>(null);
  if (data && data !== formFor) {
    setFormFor(data);
    setForm(toFormState(data.integrations));
  }

  if (loading || (!data && !error)) return <ListSkeleton label="Memuat konfigurasi integrasi" rows={4} />;
  if (!data || !form) return <AdminLoadError message={error ?? LOAD_ERROR} status={status} onRetry={reload} />;

  const dto = data.integrations;
  const tokenKey = data.tokenKey;

  const update = (patch: Partial<FormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    setSaveError(null);
    setNotice(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setSaveError(null);
    setNotice(null);
    try {
      const secret = (v: string) => (v.trim() ? v.trim() : undefined);
      const res = await guard(
        saveAdminIntegrations({
          xendit: { secretKey: secret(form.xenditSecretKey), callbackToken: secret(form.xenditCallbackToken) },
          googleOauth: { clientId: form.googleClientId, clientSecret: secret(form.googleClientSecret), appUrl: form.appUrl },
          threadsOauth: { appId: form.threadsAppId, appSecret: secret(form.threadsAppSecret) },
        })
      );
      mutate(() => res);
      setForm(toFormState(res.integrations));
      invalidate(["ringkasan", "audit"]);
      setNotice("Kunci integrasi tersimpan dan langsung aktif.");
    } catch (err) {
      setSaveError(errorText(err, "Gagal menyimpan konfigurasi integrasi."));
    } finally {
      setBusy(false);
    }
  };

  const googleReady = !!(dto.googleOauth.clientId && dto.googleOauth.hasClientSecret);
  const threadsReady = !!(dto.threadsOauth.appId && dto.threadsOauth.hasAppSecret);
  const keyOk = tokenKey.configured && tokenKey.matchesWorker !== false;

  return (
    <form onSubmit={(e) => void handleSave(e)} className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-fg">Integrasi & Kunci API</h3>
          <p className="text-xs text-muted mt-0.5">
            Isi kunci dari Xendit, Google Cloud, dan Meta. Berlaku langsung tanpa restart. Kolom yang dikosongkan tidak mengubah
            kunci yang sudah tersimpan.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <RefreshButton onClick={reload} busy={refreshing} />
          <button type="submit" disabled={busy || !dto.stored} className={BTN_PRIMARY}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {busy ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </div>

      <RefreshError error={error} onRetry={reload} />
      <FormError message={saveError} />
      {notice && (
        <Banner tone="success" onClose={() => setNotice(null)}>
          {notice}
        </Banner>
      )}
      {!dto.stored && (
        <Banner tone="warning">
          Tabel konfigurasi belum dipasang, jadi kunci belum bisa disimpan dari panel ini. Jalankan
          sql/012_billing_and_integrations.sql di Supabase SQL Editor, atau isi kunci lewat variabel lingkungan server.
        </Banner>
      )}

      {/* Alamat aplikasi */}
      <section className="card p-5 space-y-4">
        <SectionHead
          icon={<Globe className="w-5 h-5" />}
          title="Alamat Publik Aplikasi"
          status={dto.appUrl ? <Pill tone="success">{dto.appUrl}</Pill> : <Pill tone="warning">Ikuti alamat browser</Pill>}
        >
          Dipakai untuk semua URL callback di bawah. Isi dengan domain produksi (https). Biarkan kosong saat uji di localhost.
        </SectionHead>
        <div className="max-w-xl">
          <TextField
            label="App URL"
            autoComplete="off"
            value={form.appUrl}
            onChange={(appUrl) => update({ appUrl })}
            placeholder="https://wargi.sukashawarma.com"
            disabled={busy}
          />
        </div>
      </section>

      {/* Xendit */}
      <section className="card p-5 space-y-5">
        <SectionHead
          icon={<CreditCard className="w-5 h-5" />}
          title="Xendit (Pembayaran Langganan)"
          status={
            dto.xendit.ready ? (
              <Pill tone={dto.xendit.mode === "live" ? "success" : "warning"}>
                {dto.xendit.mode === "live" ? "Live" : "Mode uji"} · {SOURCE_LABEL[dto.xendit.source]}
              </Pill>
            ) : (
              <Pill tone="warning">Belum diisi</Pill>
            )
          }
        >
          Pelanggan membayar paket lewat halaman Xendit (QRIS, Virtual Account, e-wallet, retail). Paket aktif otomatis setelah
          Xendit mengonfirmasi pembayaran.
        </SectionHead>

        <ol className="text-xs text-muted space-y-1 list-decimal pl-5">
          <li>Xendit Dashboard &gt; Settings &gt; API Keys: buat Secret Key dengan izin <strong>Write</strong> untuk Money-in (Invoices).</li>
          <li>Xendit Dashboard &gt; Settings &gt; Webhooks: isi URL &quot;Invoices paid&quot; dengan URL di bawah, lalu salin Verification Token.</li>
        </ol>

        <CopyEndpointRow label="Webhook URL (Invoices paid)" url={dto.xendit.webhookUrl} />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Secret API Key"
            type="password"
            autoComplete="off"
            value={form.xenditSecretKey}
            onChange={(xenditSecretKey) => update({ xenditSecretKey })}
            placeholder={dto.xendit.ready ? `Tersimpan (${dto.xendit.secretKeyMasked}), isi untuk mengganti` : "xnd_development_... atau xnd_production_..."}
            hint="xnd_development_ untuk uji coba, xnd_production_ untuk pembayaran sungguhan."
            disabled={busy}
          />
          <TextField
            label="Webhook Verification Token"
            type="password"
            autoComplete="off"
            value={form.xenditCallbackToken}
            onChange={(xenditCallbackToken) => update({ xenditCallbackToken })}
            placeholder={dto.xendit.hasCallbackToken ? `Tersimpan (${dto.xendit.callbackTokenMasked}), isi untuk mengganti` : "Token dari halaman Webhooks Xendit"}
            hint="Dicocokkan dengan header x-callback-token. Status lunas tetap dicek ulang ke API Xendit."
            disabled={busy}
          />
        </div>
      </section>

      {/* Google OAuth */}
      <section className="card p-5 space-y-5">
        <SectionHead
          icon={<KeyRound className="w-5 h-5" />}
          title="Google OAuth (Masuk & Daftar dengan Google)"
          status={<Pill tone={googleReady ? "success" : "warning"}>{googleReady ? `Siap · ${SOURCE_LABEL[dto.googleOauth.source]}` : "Belum diisi"}</Pill>}
        >
          Daftarkan Redirect URI di bawah persis sama di Google Cloud Console &gt; Credentials &gt; OAuth Client &gt; Authorized redirect URIs.
        </SectionHead>
        <CopyEndpointRow label="Authorized redirect URI" url={dto.googleOauth.callbackUrl} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Client ID"
            autoComplete="off"
            value={form.googleClientId}
            onChange={(googleClientId) => update({ googleClientId })}
            placeholder="1234567890-abc.apps.googleusercontent.com"
            disabled={busy}
          />
          <TextField
            label="Client Secret"
            type="password"
            autoComplete="off"
            value={form.googleClientSecret}
            onChange={(googleClientSecret) => update({ googleClientSecret })}
            placeholder={dto.googleOauth.hasClientSecret ? `Tersimpan (${dto.googleOauth.clientSecretMasked}), isi untuk mengganti` : "GOCSPX-..."}
            disabled={busy}
          />
        </div>
      </section>

      {/* Threads */}
      <section className="card p-5 space-y-5">
        <SectionHead
          icon={<Link2 className="w-5 h-5" />}
          title="Meta Threads (Hubungkan Akun Pelanggan)"
          status={<Pill tone={threadsReady && keyOk ? "success" : "warning"}>{threadsReady ? (keyOk ? "Login Threads siap" : "Cek kunci enkripsi") : "Hanya Access Token"}</Pill>}
        >
          Dengan App ID dan App Secret, pelanggan cukup klik &quot;Login dengan Threads&quot;. Tanpanya, pelanggan menempel Access
          Token sendiri. Daftarkan Redirect URI di Meta App &gt; Use cases &gt; Threads API &gt; Settings (wajib https).
        </SectionHead>

        <CopyEndpointRow label="Redirect Callback URL" url={dto.threadsOauth.callbackUrl} />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Threads App ID"
            autoComplete="off"
            value={form.threadsAppId}
            onChange={(threadsAppId) => update({ threadsAppId })}
            placeholder="Angka dari developers.facebook.com"
            disabled={busy}
          />
          <TextField
            label="Threads App Secret"
            type="password"
            autoComplete="off"
            value={form.threadsAppSecret}
            onChange={(threadsAppSecret) => update({ threadsAppSecret })}
            placeholder={dto.threadsOauth.hasAppSecret ? `Tersimpan (${dto.threadsOauth.appSecretMasked}), isi untuk mengganti` : "Threads App Secret"}
            disabled={busy}
          />
        </div>

        <div
          className={`rounded-xl p-3 flex items-start gap-2.5 text-xs ${keyOk ? "bg-subtle text-muted" : "bg-warning-soft text-fg"}`}
          role={keyOk ? undefined : "alert"}
        >
          {keyOk ? <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />}
          <span>
            {!tokenKey.configured
              ? "TOKEN_ENCRYPTION_KEY belum diisi di env server dashboard. Isi dengan nilai yang SAMA dengan worker auto-suka, lalu restart. Tanpa ini akun Threads tidak bisa dihubungkan."
              : tokenKey.matchesWorker === false
                ? "TOKEN_ENCRYPTION_KEY tidak cocok dengan token yang disimpan worker auto-suka. Akun yang dihubungkan dari dashboard tidak akan bisa diposting. Samakan nilainya dengan env worker."
                : tokenKey.matchesWorker
                  ? "Kunci enkripsi token cocok dengan worker auto-suka."
                  : "Kunci enkripsi token terisi (belum ada token tersimpan untuk dicocokkan dengan worker)."}
          </span>
        </div>
      </section>

      <p className="text-xs text-muted inline-flex items-center gap-1.5">
        <ShieldCheck className="w-4 h-4 text-accent shrink-0" />
        Kunci rahasia hanya dibaca server dan tidak pernah dikirim balik ke browser; catatan audit hanya mencatat kolom yang diubah.
      </p>
    </form>
  );
}
