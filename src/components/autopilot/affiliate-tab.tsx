"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Database,
  ExternalLink,
  Loader2,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  Save,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  deleteAffiliateProduct,
  fetchAffiliate,
  saveAffiliateAccounts,
  saveAffiliateProduct,
  setAffiliatePaused,
  type ProductInput,
} from "@/lib/affiliate-client";
import {
  AFF_GAP_HOURS_MAX,
  AFF_LINK_MAX,
  AFF_NAME_MAX,
  AFF_NICHE_MAX,
  AFF_NOTE_MAX,
  AFF_PER_DAY_MAX,
  AFF_RATIO_WARN,
  AFF_REPEAT_DAYS_MAX,
  AFF_TEMPLATE_MAX,
  DEFAULT_AFFILIATE,
  LINK_TOKEN,
  effectivePerDay,
  isShopeeLink,
  normalizeNiche,
  replyFromTemplate,
  type AffiliateAccountDTO,
  type AffiliateOverviewResponse,
  type AffiliateProductDTO,
  type AffiliateRecentDTO,
  type AffiliateReplyStatus,
  type AffiliateSettings,
} from "@/lib/affiliate-types";
import { SLOT_STATUS_LABEL, type SlotStatus } from "@/lib/autopilot-types";
import { ContentApiError } from "@/lib/content-client";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { ConfirmModal } from "./confirm-modal";
import { Banner, Checkbox, HandleText, ListSkeleton, accountHandle, timeOf } from "./shared";

const FIELD =
  "w-full h-10 px-3 rounded-xl border border-line-strong bg-surface text-sm text-fg placeholder-faint outline-none focus:border-accent focus:ring-4 focus:ring-accent/15 transition-colors";
const LABEL = "text-xs font-semibold text-muted uppercase tracking-wider mb-1.5 block";
const SAMPLE_LINK = "https://s.shopee.co.id/contoh";

const errText = (err: unknown, fallback: string): string => (err instanceof ContentApiError ? err.message : fallback);
const pct = (n: number): number => Math.round(n * 100);

const REPLY_LABEL: Record<AffiliateReplyStatus, { label: string; cls: string }> = {
  MENUNGGU: { label: "Menunggu", cls: "bg-subtle text-muted" },
  TERKIRIM: { label: "Link terkirim", cls: "bg-success-soft text-success" },
  GAGAL: { label: "Link gagal", cls: "bg-danger-soft text-danger" },
  BATAL: { label: "Batal", cls: "bg-subtle text-muted" },
};

/* ------------------------------------------------------------------ kontrol kecil */

function Switch({ on, onChange, label, busy, disabled }: { on: boolean; onChange: (next: boolean) => void; label: string; busy?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled || busy}
      onClick={() => onChange(!on)}
      className="w-12 h-10 -my-2 shrink-0 inline-flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <span className={cn("relative w-10 h-6 rounded-full transition-colors", on ? "bg-accent" : "bg-line-strong")}>
        <span
          className={cn(
            "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-surface shadow-sm transition-transform inline-flex items-center justify-center",
            on && "translate-x-4"
          )}
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin text-muted" />}
        </span>
      </span>
    </button>
  );
}

function Stepper({ value, min, max, onChange, label, unit }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string; unit: string }) {
  const btn =
    "w-10 h-10 rounded-lg inline-flex items-center justify-center text-fg hover:bg-subtle cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed";
  return (
    <div className="flex items-center gap-3">
      <div className="inline-flex items-center gap-1 rounded-xl border border-line-strong p-1">
        <button type="button" aria-label={`Kurangi ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)} className={btn}>
          <Minus className="w-4 h-4" />
        </button>
        <span aria-live="polite" className="w-10 text-center text-base font-bold text-fg tabular-nums">
          {value}
        </span>
        <button type="button" aria-label={`Tambah ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)} className={btn}>
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <span className="text-sm text-muted">{unit}</span>
    </div>
  );
}

/** Tag niche: chip terpilih + usulan + isian bebas (Enter atau koma menambah). */
function NicheInput({ value, onChange, suggestions, id }: { value: string[]; onChange: (next: string[]) => void; suggestions: string[]; id: string }) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const tags = raw.split(",").map(normalizeNiche).filter((t) => t.length >= 2);
    if (tags.length) onChange([...new Set([...value, ...tags])].slice(0, AFF_NICHE_MAX));
    setDraft("");
  };
  const rest = suggestions.filter((s) => !value.includes(s)).slice(0, 12);
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {value.map((n) => (
          <span key={n} className="h-8 pl-3 pr-1 rounded-full bg-accent-soft text-accent text-[13px] font-semibold inline-flex items-center gap-1">
            {n}
            <button
              type="button"
              aria-label={`Hapus niche ${n}`}
              onClick={() => onChange(value.filter((v) => v !== n))}
              className="w-6 h-6 rounded-full inline-flex items-center justify-center hover:bg-accent/15 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        ))}
        {value.length < AFF_NICHE_MAX && (
          <input
            id={id}
            value={draft}
            onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setDraft(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(draft);
              }
            }}
            onBlur={() => draft && add(draft)}
            placeholder={value.length ? "Tambah niche…" : "mis. dapur, skincare, otomotif"}
            className="h-8 min-w-40 flex-1 px-2 bg-transparent text-sm text-fg placeholder-faint outline-none"
          />
        )}
      </div>
      {rest.length > 0 && value.length < AFF_NICHE_MAX && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Usulan:</span>
          {rest.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange([...value, s].slice(0, AFF_NICHE_MAX))}
              className="h-7 px-2.5 rounded-full border border-line-strong text-xs font-semibold text-muted hover:border-accent hover:text-accent cursor-pointer"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ modal pengaturan akun */

function AccountModal({
  accounts,
  suggestions,
  products,
  onClose,
  onSaved,
}: {
  accounts: AffiliateAccountDTO[];
  suggestions: string[];
  products: AffiliateProductDTO[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const first = accounts[0];
  const [form, setForm] = useState<AffiliateSettings>(() => {
    const { updatedAt, ...s } = first?.config ?? { ...DEFAULT_AFFILIATE, updatedAt: null };
    void updatedAt;
    return { ...s, niche: [...s.niche] };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (p: Partial<AffiliateSettings>) => setForm((f) => ({ ...f, ...p }));

  const posts = first?.postsPerDay ?? 3;
  const eff = effectivePerDay({ ...form, aktif: true }, posts);
  const matching = products.filter((p) => p.aktif && p.niche.some((n) => form.niche.includes(n))).length;
  const templateOk = form.templateBalasan.includes(LINK_TOKEN);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveAffiliateAccounts(
        accounts.map((a) => a.id),
        form
      );
      onSaved();
    } catch (err) {
      setError(errText(err, "Pengaturan gagal disimpan."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      busy={busy}
      size="lg"
      title={accounts.length === 1 ? `Affiliate ${accountHandle(first)}` : `Affiliate untuk ${accounts.length} akun`}
      description={
        accounts.length === 1
          ? "Semua angka bebas Anda atur. Yang paling ketat antara maks per hari dan porsi yang berlaku."
          : "Pengaturan ini diterapkan sama ke semua akun terpilih."
      }
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            Batal
          </ModalButton>
          <ModalButton variant="primary" onClick={save} disabled={busy || !templateOk || (form.aktif && form.niche.length === 0)}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Simpan
          </ModalButton>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Banner tone="danger">{error}</Banner>}

        <div className="flex items-center justify-between gap-4 rounded-xl bg-subtle p-3.5">
          <div>
            <p className="text-sm font-semibold text-fg">Postingan affiliate</p>
            <p className="text-xs text-muted">Matikan kapan saja; slot berikutnya kembali jadi postingan biasa.</p>
          </div>
          <Switch on={form.aktif} onChange={(aktif) => update({ aktif })} label="Nyalakan postingan affiliate" />
        </div>

        <div>
          <label className={LABEL} htmlFor="aff-niche">
            Niche akun
          </label>
          <NicheInput id="aff-niche" value={form.niche} onChange={(niche) => update({ niche })} suggestions={suggestions} />
          <p className="mt-1.5 text-xs text-muted">
            Produk katalog dengan niche yang sama yang akan dipakai.{" "}
            <span className={cn("font-semibold", matching ? "text-fg" : "text-warning")}>{matching} produk aktif cocok.</span>
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <p className={LABEL}>Maks per hari</p>
            <Stepper value={form.perHari} min={0} max={AFF_PER_DAY_MAX} onChange={(perHari) => update({ perHari })} label="maks per hari" unit="postingan" />
          </div>
          <div>
            <label className={LABEL} htmlFor="aff-porsi">
              Porsi maksimal
            </label>
            <div className="flex items-center gap-2">
              <input
                id="aff-porsi"
                type="number"
                min={0}
                max={100}
                step={5}
                value={pct(form.porsi)}
                onChange={(e) => update({ porsi: Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100 })}
                className={cn(FIELD, "w-24 tabular-nums")}
              />
              <span className="text-sm text-muted">% dari postingan harian</span>
            </div>
          </div>
          <div>
            <p className={LABEL}>Jarak antar affiliate</p>
            <Stepper value={form.jarakJam} min={0} max={AFF_GAP_HOURS_MAX} onChange={(jarakJam) => update({ jarakJam })} label="jarak jam" unit="jam" />
          </div>
          <div>
            <label className={LABEL} htmlFor="aff-jeda">
              Produk sama boleh diulang setelah
            </label>
            <div className="flex items-center gap-2">
              <input
                id="aff-jeda"
                type="number"
                min={0}
                max={AFF_REPEAT_DAYS_MAX}
                value={form.jedaHari}
                onChange={(e) => update({ jedaHari: Math.min(AFF_REPEAT_DAYS_MAX, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
                className={cn(FIELD, "w-24 tabular-nums")}
              />
              <span className="text-sm text-muted">hari</span>
            </div>
          </div>
        </div>

        <Banner tone={form.porsi > AFF_RATIO_WARN || eff === 0 ? "warning" : "info"}>
          {accounts.length === 1 ? (
            <>
              Akun ini terbit {posts} postingan per hari, jadi yang berlaku <b>{eff} postingan affiliate per hari</b>.
            </>
          ) : (
            <>Jatah efektif dihitung per akun dari jumlah postingan hariannya.</>
          )}
          {eff === 0 && " Naikkan maks per hari atau porsi supaya affiliate bisa jalan."}
          {form.porsi > AFF_RATIO_WARN &&
            ` Porsi di atas ${pct(AFF_RATIO_WARN)}% berisiko membuat akun terlihat seperti akun jualan dan menurunkan jangkauan.`}
        </Banner>

        <div>
          <label className={LABEL} htmlFor="aff-template">
            Teks balasan pertama (berisi link)
          </label>
          <textarea
            id="aff-template"
            rows={3}
            maxLength={AFF_TEMPLATE_MAX}
            value={form.templateBalasan}
            onChange={(e) => update({ templateBalasan: e.target.value })}
            className={cn(FIELD, "h-auto py-2.5 resize-y")}
          />
          {templateOk ? (
            <p className="mt-1.5 text-xs text-muted">
              Contoh terkirim: <span className="whitespace-pre-line text-fg">{replyFromTemplate(form.templateBalasan, SAMPLE_LINK)}</span>
            </p>
          ) : (
            <p className="mt-1.5 text-xs font-semibold text-danger">Wajib memuat {LINK_TOKEN} sebagai tempat link.</p>
          )}
          <p className="mt-1 text-xs text-muted">Dikirim otomatis 1-3 menit setelah postingan terbit. Sertakan keterangan &ldquo;link affiliate&rdquo; supaya jujur ke pembaca.</p>
        </div>
      </div>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ modal produk */

function ProductModal({
  product,
  suggestions,
  onClose,
  onSaved,
}: {
  product: AffiliateProductDTO | null;
  suggestions: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ProductInput>(() =>
    product
      ? { id: product.id, nama: product.nama, link: product.link, niche: [...product.niche], catatan: product.catatan, aktif: product.aktif }
      : { nama: "", link: "", niche: [], catatan: "", aktif: true }
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (p: Partial<ProductInput>) => setForm((f) => ({ ...f, ...p }));
  const linkOk = isShopeeLink(form.link.trim());
  const valid = form.nama.trim().length >= 2 && linkOk && form.niche.length > 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveAffiliateProduct({ ...form, link: form.link.trim() });
      onSaved();
    } catch (err) {
      setError(errText(err, "Produk gagal disimpan."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      busy={busy}
      title={product ? "Ubah produk" : "Tambah produk"}
      description="Salin link dari dashboard Shopee Affiliate (Custom Link / Produk), lalu tempel di sini."
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            Batal
          </ModalButton>
          <ModalButton variant="primary" onClick={save} disabled={busy || !valid}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Simpan
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Banner tone="danger">{error}</Banner>}
        <div>
          <label className={LABEL} htmlFor="aff-nama">
            Nama singkat produk
          </label>
          <input
            id="aff-nama"
            value={form.nama}
            maxLength={AFF_NAME_MAX}
            onChange={(e) => update({ nama: e.target.value })}
            placeholder="mis. Wajan anti lengket 24 cm"
            className={FIELD}
          />
          <p className="mt-1 text-xs text-muted">Nama yang wajar disebut orang, bukan judul panjang dari Shopee.</p>
        </div>
        <div>
          <label className={LABEL} htmlFor="aff-link">
            Link affiliate
          </label>
          <input
            id="aff-link"
            value={form.link}
            maxLength={AFF_LINK_MAX}
            onChange={(e) => update({ link: e.target.value })}
            placeholder="https://s.shopee.co.id/xxxx"
            inputMode="url"
            className={cn(FIELD, form.link && !linkOk && "border-danger")}
          />
          {form.link && !linkOk && <p className="mt-1 text-xs font-semibold text-danger">Harus link Shopee Indonesia yang diawali https://.</p>}
        </div>
        <div>
          <label className={LABEL} htmlFor="aff-pniche">
            Niche
          </label>
          <NicheInput id="aff-pniche" value={form.niche} onChange={(niche) => update({ niche })} suggestions={suggestions} />
        </div>
        <div>
          <label className={LABEL} htmlFor="aff-catatan">
            Catatan produk (fakta untuk AI)
          </label>
          <textarea
            id="aff-catatan"
            rows={3}
            maxLength={AFF_NOTE_MAX}
            value={form.catatan}
            onChange={(e) => update({ catatan: e.target.value })}
            placeholder="mis. Lapisan granit, aman untuk kompor induksi, gagangnya tidak panas. Dipakai sendiri 2 bulan."
            className={cn(FIELD, "h-auto py-2.5 resize-y")}
          />
          <p className="mt-1 text-xs text-muted">
            AI hanya boleh menyebut detail yang tertulis di sini. Jangan tulis harga atau diskon yang bisa berubah.
          </p>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl bg-subtle p-3.5">
          <p className="text-sm font-semibold text-fg">Produk aktif</p>
          <Switch on={form.aktif} onChange={(aktif) => update({ aktif })} label="Produk aktif" />
        </div>
      </div>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ tab */

function Stat({ label, value, tone }: { label: string; value: number; tone?: "success" | "danger" }) {
  return (
    <div className="card p-2.5 sm:p-4 min-w-0 flex flex-col">
      <p className="text-[11px] sm:text-xs font-semibold text-muted leading-tight line-clamp-2">{label}</p>
      <p className={cn("mt-auto pt-1 text-lg sm:text-2xl font-bold tabular-nums leading-tight", tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-fg")}>{value}</p>
    </div>
  );
}

function Avatar({ a }: { a: AffiliateAccountDTO }) {
  return <AccountAvatar name={a.username ?? a.displayName} src={a.avatarUrl} size="w-9 h-9" className="text-xs" />;
}

const dateTimeOf = (iso: string): string =>
  `${new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" })} ${timeOf(iso)}`;

export function AffiliateTab({ active }: { active: boolean }) {
  const [data, setData] = useState<AffiliateOverviewResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editAccounts, setEditAccounts] = useState<AffiliateAccountDTO[] | null>(null);
  const [editProduct, setEditProduct] = useState<AffiliateProductDTO | null | "new">(null);
  const [deleting, setDeleting] = useState<AffiliateProductDTO | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const loaded = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetchAffiliate(signal);
      setData(res);
      setLoadError(null);
      setSelected((s) => new Set([...s].filter((id) => res.accounts.some((a) => a.id === id))));
    } catch (err) {
      if (signal?.aborted) return;
      setLoadError(errText(err, "Data affiliate gagal dimuat."));
    }
  }, []);

  useEffect(() => {
    if (!active || loaded.current) return;
    const ctrl = new AbortController();
    // Ditandai termuat hanya setelah datanya tiba: permintaan yang dibatalkan (tab ditinggal sebelum
    // selesai, atau efek dipasang ulang) harus diulang saat tab terlihat lagi, bukan tertahan di skeleton.
    void load(ctrl.signal).then(() => {
      if (!ctrl.signal.aborted) loaded.current = true;
    });
    return () => ctrl.abort();
  }, [active, load]);

  const productById = useMemo(() => new Map((data?.products ?? []).map((p) => [p.id, p])), [data]);
  const accountById = useMemo(() => new Map((data?.accounts ?? []).map((a) => [a.id, a])), [data]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusyKey(key);
    setNotice(null);
    try {
      await fn();
      await load();
      setNotice({ tone: "success", text: ok });
    } catch (err) {
      setNotice({ tone: "danger", text: errText(err, "Perubahan gagal disimpan.") });
    } finally {
      setBusyKey(null);
    }
  };

  if (!data) {
    return loadError ? (
      <Banner tone="danger">
        {loadError}{" "}
        <button type="button" onClick={() => void load()} className="underline font-semibold cursor-pointer">
          Coba lagi
        </button>
      </Banner>
    ) : (
      <ListSkeleton label="Memuat affiliate" />
    );
  }

  if (!data.installed) {
    return (
      <div className="card p-10 text-center">
        <div className="mx-auto w-12 h-12 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
          <Database className="w-6 h-6" />
        </div>
        <h3 className="mt-4 text-base font-bold text-fg">Fitur affiliate belum dipasang</h3>
        <p className="mt-1 text-sm text-muted max-w-md mx-auto">
          Jalankan <code className="font-mono">sql/019_affiliate.sql</code> di SQL Editor Supabase, lalu muat ulang halaman ini.
        </p>
      </div>
    );
  }

  const suggestions = data.nicheSuggestions;
  const activeProducts = data.products.filter((p) => p.aktif);
  const allSelected = data.accounts.length > 0 && selected.size === data.accounts.length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const quickToggle = (a: AffiliateAccountDTO, on: boolean) => {
    if (on && a.config.niche.length === 0) {
      setEditAccounts([a]);
      return;
    }
    void run(`akun:${a.id}`, () => saveAffiliateAccounts([a.id], { aktif: on }), on ? `Affiliate ${accountHandle(a)} dinyalakan.` : `Affiliate ${accountHandle(a)} dimatikan.`);
  };

  return (
    <div className="space-y-6">
      {notice && (
        <Banner tone={notice.tone} onClose={() => setNotice(null)}>
          {notice.text}
        </Banner>
      )}

      {/* Ringkasan + saklar workspace */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-fg">Shopee Affiliate</h3>
          <p className="text-sm text-muted">
            AI menyelipkan produk secara natural sesuai niche akun. Link dikirim di balasan pertama setelah postingan terbit.
          </p>
        </div>
        <button
          type="button"
          disabled={busyKey === "jeda"}
          onClick={() =>
            void run("jeda", () => setAffiliatePaused(!data.aktif), data.aktif ? "Semua affiliate dijeda." : "Affiliate berjalan lagi.")
          }
          className={cn(
            "h-10 px-4 rounded-full text-sm font-semibold inline-flex items-center gap-2 shrink-0 cursor-pointer transition-colors disabled:opacity-50",
            data.aktif ? "border border-line-strong text-fg hover:border-danger hover:text-danger" : "bg-accent text-on-accent hover:bg-accent-hover"
          )}
        >
          {busyKey === "jeda" ? <Loader2 className="w-4 h-4 animate-spin" /> : data.aktif ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          {data.aktif ? "Jeda semua affiliate" : "Lanjutkan affiliate"}
        </button>
      </div>

      {!data.aktif && <Banner tone="warning">Affiliate sedang dijeda untuk seluruh workspace. Slot baru ditulis sebagai postingan biasa.</Banner>}

      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        <Stat label="Terbit 30 hari" value={data.summary.terbit} />
        <Stat label="Terjadwal" value={data.summary.terjadwal} />
        <Stat label="Link terkirim" value={data.summary.balasanTerkirim} tone="success" />
        <Stat label="Link gagal" value={data.summary.balasanGagal} tone={data.summary.balasanGagal ? "danger" : undefined} />
      </div>

      {/* Akun */}
      <section aria-label="Pengaturan affiliate per akun" className="card">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line bg-subtle rounded-t-2xl">
          <div className="flex">
            <Checkbox
              checked={allSelected}
              indeterminate={selected.size > 0 && !allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(data.accounts.map((a) => a.id)))}
              disabled={data.accounts.length === 0}
              label={allSelected ? "Batalkan pilihan semua akun" : "Pilih semua akun"}
            />
          </div>
          <p className="flex-1 text-xs font-semibold text-muted uppercase tracking-wide">
            Akun ({data.accounts.length}){selected.size > 0 && ` · ${selected.size} dipilih`}
          </p>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setEditAccounts(data.accounts.filter((a) => selected.has(a.id)))}
              className="h-9 px-4 rounded-full bg-accent text-on-accent text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-accent-hover cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5" />
              Atur {selected.size} akun
            </button>
          )}
        </div>
        {data.accounts.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">Belum ada akun yang dipetakan ke cabang.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.accounts.map((a) => {
              const c = a.config;
              const eff = effectivePerDay(c, a.postsPerDay);
              const matching = activeProducts.filter((p) => p.niche.some((n) => c.niche.includes(n))).length;
              const warnings = c.aktif
                ? [
                    a.mode === "MATI" && "Autopilot akun ini mati, jadi affiliate belum berjalan.",
                    eff === 0 && "Jatah efektif 0 per hari: naikkan maks per hari atau porsi.",
                    matching === 0 && "Belum ada produk aktif untuk niche akun ini.",
                    c.porsi > AFF_RATIO_WARN && `Porsi ${pct(c.porsi)}% berisiko terlihat seperti akun jualan.`,
                  ].filter((w): w is string => !!w)
                : [];
              return (
                // Layar kecil: rincian memakai lebar penuh di bawah nama, tidak terjepit sakelar dan tombol edit.
                <li key={a.id} className="px-4 py-3.5 grid grid-cols-[auto_auto_minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-start">
                  <div className="flex pt-1.5">
                    <Checkbox checked={selected.has(a.id)} onChange={() => toggle(a.id)} label={`Pilih ${accountHandle(a)}`} />
                  </div>
                  <Avatar a={a} />
                  <p className="self-center text-sm font-semibold text-fg truncate">
                    <HandleText account={a} />
                  </p>
                  <div className="col-start-4 row-start-1 flex items-center gap-1 shrink-0">
                    <Switch on={c.aktif} busy={busyKey === `akun:${a.id}`} onChange={(on) => quickToggle(a, on)} label={`Affiliate ${accountHandle(a)}`} />
                    <button
                      type="button"
                      aria-label={`Atur affiliate ${accountHandle(a)}`}
                      onClick={() => setEditAccounts([a])}
                      className="w-10 h-10 rounded-full inline-flex items-center justify-center text-muted hover:text-accent hover:bg-subtle cursor-pointer"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="col-start-2 col-span-3 sm:col-start-3 sm:col-span-2 min-w-0 sm:-mt-3">
                    <p className="text-xs text-muted">
                      {c.aktif
                        ? `${eff} affiliate/hari dari ${a.postsPerDay} postingan · maks ${c.perHari} · porsi ${pct(c.porsi)}% · jarak ${c.jarakJam} jam · ulang produk ${c.jedaHari} hari`
                        : "Affiliate mati"}
                    </p>
                    {c.niche.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.niche.map((n) => (
                          <span key={n} className="h-6 px-2 rounded-full bg-subtle text-xs font-semibold text-muted inline-flex items-center">
                            {n}
                          </span>
                        ))}
                      </div>
                    )}
                    {warnings.map((w) => (
                      <p key={w} className="mt-1 text-xs font-medium text-warning flex items-start gap-1">
                        <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
                        {w}
                      </p>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Katalog */}
      <section aria-label="Katalog produk affiliate" className="card">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line bg-subtle rounded-t-2xl">
          <p className="flex-1 text-xs font-semibold text-muted uppercase tracking-wide">
            Katalog produk ({activeProducts.length} aktif dari {data.products.length})
          </p>
          <button
            type="button"
            onClick={() => setEditProduct("new")}
            className="h-9 px-4 rounded-full bg-accent text-on-accent text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-accent-hover cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Tambah<span className="max-sm:sr-only"> produk</span>
          </button>
        </div>
        {data.products.length === 0 ? (
          <div className="p-8 text-center">
            <div className="mx-auto w-12 h-12 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <p className="mt-3 text-sm font-semibold text-fg">Katalog masih kosong</p>
            <p className="mt-1 text-sm text-muted max-w-sm mx-auto">
              Tambahkan produk dari Shopee Affiliate beserta niche-nya. Satu produk bisa dipakai semua akun dengan niche yang sama.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {data.products.map((p) => (
              <li key={p.id} className={cn("px-4 py-3.5 flex items-start gap-3", !p.aktif && "opacity-60")}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-fg">
                    {p.nama}
                    {!p.aktif && <span className="ml-2 text-xs font-semibold text-muted">(nonaktif)</span>}
                  </p>
                  <a
                    href={p.link}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-xs text-accent hover:underline inline-flex items-center gap-1 max-w-full"
                  >
                    <span className="truncate">{p.link}</span>
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                  {p.catatan && <p className="mt-1 text-xs text-muted line-clamp-2">{p.catatan}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {p.niche.map((n) => (
                      <span key={n} className="h-6 px-2 rounded-full bg-subtle text-xs font-semibold text-muted inline-flex items-center">
                        {n}
                      </span>
                    ))}
                    <span className="text-xs text-muted ml-1">
                      · {p.dipakai30}× terbit 30 hari{p.terakhir ? ` · terakhir ${dateTimeOf(p.terakhir)}` : ""}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    aria-label={`Ubah ${p.nama}`}
                    onClick={() => setEditProduct(p)}
                    className="w-10 h-10 rounded-full inline-flex items-center justify-center text-muted hover:text-accent hover:bg-subtle cursor-pointer"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Hapus ${p.nama}`}
                    onClick={() => setDeleting(p)}
                    className="w-10 h-10 rounded-full inline-flex items-center justify-center text-muted hover:text-danger hover:bg-subtle cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Aktivitas */}
      <section aria-label="Aktivitas affiliate 30 hari" className="card">
        <div className="px-4 py-3 border-b border-line bg-subtle rounded-t-2xl">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">Aktivitas 30 hari terakhir</p>
        </div>
        {data.recent.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">Belum ada postingan affiliate.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.recent.map((r: AffiliateRecentDTO) => {
              const acc = accountById.get(r.accountId);
              const reply = REPLY_LABEL[r.balasan];
              return (
                <li key={r.id} className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-xs text-muted tabular-nums w-24 shrink-0">{dateTimeOf(r.slotAt)}</span>
                  <span className="text-sm font-semibold text-fg min-w-0 truncate">{acc ? accountHandle(acc) : "Akun"}</span>
                  <span className="text-sm text-muted min-w-0 truncate flex-1">{r.produk ?? productById.get(r.productId)?.nama ?? "Produk dihapus"}</span>
                  <span className="h-6 px-2 rounded-full bg-subtle text-xs font-semibold text-muted inline-flex items-center">
                    {SLOT_STATUS_LABEL[r.slotStatus as SlotStatus] ?? r.slotStatus}
                  </span>
                  <span title={r.error ?? undefined} className={cn("h-6 px-2 rounded-full text-xs font-semibold inline-flex items-center", reply.cls)}>
                    {reply.label}
                  </span>
                  {r.releaseUrl && (
                    <a
                      href={r.releaseUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label="Lihat postingan di Threads"
                      className="w-8 h-8 rounded-full inline-flex items-center justify-center text-muted hover:text-accent hover:bg-subtle"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editAccounts && (
        <AccountModal
          accounts={editAccounts}
          suggestions={suggestions}
          products={data.products}
          onClose={() => setEditAccounts(null)}
          onSaved={() => {
            const n = editAccounts.length;
            setEditAccounts(null);
            setSelected(new Set());
            setNotice({ tone: "success", text: n === 1 ? "Pengaturan affiliate disimpan." : `Pengaturan affiliate ${n} akun disimpan.` });
            void load();
          }}
        />
      )}
      {editProduct && (
        <ProductModal
          product={editProduct === "new" ? null : editProduct}
          suggestions={suggestions}
          onClose={() => setEditProduct(null)}
          onSaved={() => {
            setEditProduct(null);
            setNotice({ tone: "success", text: "Produk disimpan." });
            void load();
          }}
        />
      )}
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const p = deleting;
          if (!p) return;
          setDeleting(null);
          void run(`hapus:${p.id}`, () => deleteAffiliateProduct(p.id), `${p.nama} dihapus dari katalog.`);
        }}
        title="Hapus produk?"
        description={deleting ? `${deleting.nama} tidak akan dipakai lagi, dan link-nya yang belum terkirim dibatalkan. Riwayat tetap tersimpan.` : undefined}
        confirmLabel="Hapus"
        confirmIcon={<Trash2 className="w-4 h-4" />}
        variant="danger"
      />
    </div>
  );
}
