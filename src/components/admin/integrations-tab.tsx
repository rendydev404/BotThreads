"use client";

import React, { useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, CreditCard, Globe, KeyRound, Link2, Loader2, Save, ShieldCheck } from "lucide-react";
import { fetchAdminIntegrations, saveAdminIntegrations, type AdminIntegrationsPayload } from "@/lib/admin-client";
import { PAYMENT_METHODS, type PaymentMethodId, type PlatformIntegrationsDTO } from "@/lib/billing-types";
import { cn } from "@/lib/utils";
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
  midtransMerchantId: string;
  midtransClientKey: string;
  midtransServerKey: string;
  midtransProduction: boolean;
  midtransMethods: PaymentMethodId[];
  googleClientId: string;
  googleClientSecret: string;
  threadsAppId: string;
  threadsAppSecret: string;
}

const toFormState = (dto: PlatformIntegrationsDTO): FormState => ({
  appUrl: dto.appUrl,
  midtransMerchantId: dto.midtrans.merchantId,
  midtransClientKey: dto.midtrans.clientKey,
  midtransServerKey: "",
  midtransProduction: dto.midtrans.mode === "production",
  midtransMethods: dto.midtrans.methods,
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
        <div className="w-9 h-9 rounded-lg bg-subtle text-muted flex items-center justify-center shrink-0">{icon}</div>
        <div>
          <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
          <p className="text-[13px] text-muted mt-0.5">{children}</p>
        </div>
      </div>
      <div className="shrink-0">{status}</div>
    </div>
  );
}

export function IntegrationsTab() {
  const { guard, rev, invalidate, can } = useAdmin();
  const manage = can("integrasi.kelola");
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
          midtrans: {
            merchantId: form.midtransMerchantId,
            clientKey: form.midtransClientKey,
            serverKey: secret(form.midtransServerKey),
            isProduction: form.midtransProduction,
            methods: form.midtransMethods,
          },
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
    <form onSubmit={(e) => void handleSave(e)}>
      <fieldset disabled={!manage} className="space-y-6 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-[13px] text-muted max-w-2xl">
          Berlaku langsung tanpa restart. Kolom rahasia yang dikosongkan tidak mengubah kunci yang sudah tersimpan.
        </p>
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

      {/* Midtrans */}
      <section className="card p-5 space-y-5">
        <SectionHead
          icon={<CreditCard className="w-5 h-5" />}
          title="Midtrans (Pembayaran Langganan)"
          status={
            dto.midtrans.ready ? (
              <Pill tone={dto.midtrans.mode === "production" ? "success" : "warning"}>
                {dto.midtrans.mode === "production" ? "Production" : "Sandbox"} · {SOURCE_LABEL[dto.midtrans.source]}
              </Pill>
            ) : (
              <Pill tone="warning">Belum diisi</Pill>
            )
          }
        >
          Pelanggan membayar paket di halaman bayar aplikasi ini (Core API, tanpa Snap): QRIS, GoPay, ShopeePay, dan Virtual
          Account. Paket aktif otomatis setelah Midtrans mengonfirmasi pembayaran.
        </SectionHead>

        <ol className="text-xs text-muted space-y-1 list-decimal pl-5">
          <li>Dashboard Midtrans &gt; Settings &gt; Access Keys: salin Merchant ID, Client Key, dan Server Key (sandbox dan production berbeda).</li>
          <li>
            Dashboard Midtrans &gt; Settings &gt; Configuration: isi <strong>Payment Notification URL</strong> dengan URL di bawah (charge juga
            otomatis mengirim notifikasi ke URL ini).
          </li>
          <li>Production: pastikan tiap metode yang dicentang sudah aktif di akun Midtrans, selain itu charge ditolak.</li>
        </ol>

        <CopyEndpointRow label="Payment Notification URL" url={dto.midtrans.notificationUrl} />

        <div role="group" aria-label="Lingkungan Midtrans" className="inline-flex p-1 rounded-xl bg-subtle border border-line">
          {[
            { v: false, label: "Sandbox (uji coba)" },
            { v: true, label: "Production (uang sungguhan)" },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              aria-pressed={form.midtransProduction === o.v}
              onClick={() => update({ midtransProduction: o.v })}
              disabled={busy}
              className={cn(
                "h-8 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer",
                form.midtransProduction === o.v ? "bg-surface text-fg shadow-xs" : "text-muted hover:text-fg"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="Merchant ID"
            autoComplete="off"
            value={form.midtransMerchantId}
            onChange={(midtransMerchantId) => update({ midtransMerchantId })}
            placeholder="M123456789"
            disabled={busy}
          />
          <TextField
            label="Client Key"
            autoComplete="off"
            value={form.midtransClientKey}
            onChange={(midtransClientKey) => update({ midtransClientKey })}
            placeholder="Mid-client-..."
            disabled={busy}
          />
          <TextField
            label="Server Key"
            type="password"
            autoComplete="off"
            value={form.midtransServerKey}
            onChange={(midtransServerKey) => update({ midtransServerKey })}
            placeholder={dto.midtrans.ready ? `Tersimpan (${dto.midtrans.serverKeyMasked}), isi untuk mengganti` : "Mid-server-..."}
            hint="Rahasia. Dipakai server untuk charge dan memverifikasi notifikasi."
            disabled={busy}
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted">Metode bayar yang ditawarkan</p>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((m) => {
              const on = form.midtransMethods.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() =>
                    update({
                      midtransMethods: on
                        ? form.midtransMethods.filter((x) => x !== m.id)
                        : PAYMENT_METHODS.map((x) => x.id).filter((x) => x === m.id || form.midtransMethods.includes(x)),
                    })
                  }
                  className={cn(
                    "h-8 px-3 rounded-full border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer",
                    on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"
                  )}
                >
                  {on && <Check className="w-3.5 h-3.5" />}
                  {m.label}
                </button>
              );
            })}
          </div>
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
      </fieldset>
    </form>
  );
}
