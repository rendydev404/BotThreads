"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Database,
  ExternalLink,
  Loader2,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Save,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  deleteAffiliateProduct,
  fetchAffiliate,
  retryAffiliateReply,
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
  AFF_REPEAT_DAYS_MAX,
  AFF_TEMPLATE_MAX,
  DEFAULT_AFFILIATE,
  FREQUENCY_PRESETS,
  LINK_TOKEN,
  effectivePerDay,
  isShopeeLink,
  looksSpammy,
  presetOf,
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
import { useT } from "@/components/i18n/lang-provider";
import { currentLocale, tr } from "@/lib/i18n/core";
import { Banner, Checkbox, HandleText, ListSkeleton, Switch, accountHandle, apiErrorText, timeOf } from "./shared";

const FIELD =
  "w-full h-10 px-3 rounded-xl border border-line-strong bg-surface text-sm text-fg placeholder-faint outline-none focus:border-accent focus:ring-4 focus:ring-accent/15 transition-colors";
const LABEL = "text-xs font-semibold text-muted uppercase tracking-wider mb-1.5 block";
const SAMPLE_LINK = "https://s.shopee.co.id/contoh";

const errText = (err: unknown, fallback: string): string => apiErrorText(err instanceof ContentApiError ? err.message : fallback);

/** Pola kalimat status affiliate dari server (src/lib/affiliate-pick.ts); kalimat tetap lewat kamus. */
const STATUS_PATTERNS: [RegExp, string][] = [
  [/^Jatah 0 per hari dari (\d+) postingan\. Pilih frekuensi yang lebih tinggi\.$/, "Jatah 0 per hari dari {a} postingan. Pilih frekuensi yang lebih tinggi."],
  [/^Belum ada produk aktif untuk niche (.+)\.$/, "Belum ada produk aktif untuk niche {a}."],
  [/^Semua (\d+) produk baru saja dipakai\. Tersedia lagi (.+), atau tambah produk\.$/, "Semua {a} produk baru saja dipakai. Tersedia lagi {b}, atau tambah produk."],
  [/^Jalan: (\d+) postingan affiliate per hari, (\d+) produk siap dipakai\.$/, "Jalan: {a} postingan affiliate per hari, {b} produk siap dipakai."],
];
/** "12 Okt" -> nama bulan sesuai bahasa. */
const dayMonthText = (s: string): string => s.replace(/^(\d+) (\S+)$/, (_, d: string, m: string) => `${d} ${tr(m)}`);
function statusText(teks: string): string {
  for (const [re, key] of STATUS_PATTERNS) {
    const m = re.exec(teks);
    if (m) return tr(key, { a: m[1], b: m[2] === undefined ? undefined : dayMonthText(m[2]) });
  }
  return tr(teks);
}
const pct = (n: number): number => Math.round(n * 100);

const REPLY_LABEL: Record<AffiliateReplyStatus, { label: string; cls: string }> = {
  MENUNGGU: { label: "Menunggu", cls: "bg-subtle text-muted" },
  TERKIRIM: { label: "Link terkirim", cls: "bg-success-soft text-success" },
  GAGAL: { label: "Link gagal", cls: "bg-danger-soft text-danger" },
  BATAL: { label: "Batal", cls: "bg-subtle text-muted" },
};

/* ------------------------------------------------------------------ kontrol kecil */

function Stepper({ value, min, max, onChange, label, unit }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string; unit: string }) {
  const t = useT();
  const btn =
    "w-10 h-10 rounded-lg inline-flex items-center justify-center text-fg hover:bg-subtle cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed";
  return (
    <div className="flex items-center gap-3">
      <div className="inline-flex items-center gap-1 rounded-xl border border-line-strong p-1">
        <button type="button" aria-label={t("Kurangi {label}", { label: t(label) })} disabled={value <= min} onClick={() => onChange(value - 1)} className={btn}>
          <Minus className="w-4 h-4" />
        </button>
        <span aria-live="polite" className="w-10 text-center text-base font-bold text-fg tabular-nums">
          {value}
        </span>
        <button type="button" aria-label={t("Tambah {label}", { label: t(label) })} disabled={value >= max} onClick={() => onChange(value + 1)} className={btn}>
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <span className="text-sm text-muted">{t(unit)}</span>
    </div>
  );
}

/**
 * Tag niche: chip terpilih + usulan + isian bebas (Enter atau koma menambah). Niche produk dan akun harus sama
 * persis supaya cocok, jadi tiap niche menampilkan berapa pasangannya (`counts`) dan niche tanpa pasangan diberi
 * peringatan: salah ketik langsung terlihat, bukan diam-diam membuat affiliate tidak jalan.
 */
function NicheInput({
  value,
  onChange,
  suggestions,
  id,
  counts,
  unit,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
  id: string;
  /** niche -> jumlah pasangan (produk aktif untuk akun, akun untuk produk). */
  counts: Map<string, number>;
  /** "produk" atau "akun". */
  unit: string;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const tags = raw.split(",").map(normalizeNiche).filter((tag) => tag.length >= 2);
    if (tags.length) onChange([...new Set([...value, ...tags])].slice(0, AFF_NICHE_MAX));
    setDraft("");
  };
  // Usulan yang sudah punya pasangan didahulukan: memilihnya pasti membuat affiliate cocok.
  const rest = suggestions
    .filter((s) => !value.includes(s))
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
    .slice(0, 12);
  const orphan = value.filter((n) => !counts.get(n));
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {value.map((n) => (
          <span
            key={n}
            className={cn(
              "h-8 pl-3 pr-1 rounded-full text-[13px] font-semibold inline-flex items-center gap-1",
              counts.get(n) ? "bg-accent-soft text-accent" : "bg-warning-soft text-warning"
            )}
          >
            {n}
            <span className="text-[11px] font-medium opacity-80 tabular-nums">{counts.get(n) ?? 0}</span>
            <button
              type="button"
              aria-label={t("Hapus niche {n}", { n })}
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
            placeholder={value.length ? t("Tambah niche…") : t("mis. dapur, skincare, otomotif")}
            className="h-8 min-w-40 flex-1 px-2 bg-transparent text-sm text-fg placeholder-faint outline-none"
          />
        )}
      </div>
      {rest.length > 0 && value.length < AFF_NICHE_MAX && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">{t("Usulan:")}</span>
          {rest.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange([...value, s].slice(0, AFF_NICHE_MAX))}
              className="h-7 px-2.5 rounded-full border border-line-strong text-xs font-semibold text-muted hover:border-accent hover:text-accent cursor-pointer"
            >
              + {s}
              <span className="ml-1 font-medium opacity-70 tabular-nums">{counts.get(s) ?? 0}</span>
            </button>
          ))}
        </div>
      )}
      {orphan.length > 0 && (
        <p className="mt-2 text-xs font-medium text-warning flex items-start gap-1">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
          {unit === "produk"
            ? t("Belum ada produk dengan niche {list}. Pastikan ejaannya sama persis, atau pilih dari usulan.", { list: orphan.join(", ") })
            : t("Belum ada akun dengan niche {list}. Pastikan ejaannya sama persis, atau pilih dari usulan.", { list: orphan.join(", ") })}
        </p>
      )}
    </div>
  );
}

/** Jumlah pasangan per niche. */
function nicheCounts(items: { niche: string[] }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of items) for (const n of it.niche) out.set(n, (out.get(n) ?? 0) + 1);
  return out;
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
  const t = useT();
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
  const productCounts = useMemo(() => nicheCounts(products.filter((p) => p.aktif)), [products]);
  const matching = products.filter((p) => p.aktif && p.niche.some((n) => form.niche.includes(n))).length;
  const templateOk = form.templateBalasan.includes(LINK_TOKEN);
  const preset = presetOf(form);
  const [custom, setCustom] = useState(preset === null);
  const spammy = looksSpammy(eff, posts);

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
      title={accounts.length === 1 ? t("Affiliate {handle}", { handle: accountHandle(first) }) : t("Affiliate untuk {n} akun", { n: accounts.length })}
      description={
        accounts.length === 1
          ? t("Pilih niche dan seberapa sering. Sisanya otomatis.")
          : t("Pengaturan ini diterapkan sama ke semua akun terpilih.")
      }
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            {t("Batal")}
          </ModalButton>
          <ModalButton variant="primary" onClick={save} disabled={busy || !templateOk || (form.aktif && form.niche.length === 0)}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t("Simpan")}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Banner tone="danger">{error}</Banner>}

        <div className="flex items-center justify-between gap-4 rounded-xl bg-subtle p-3.5">
          <div>
            <p className="text-sm font-semibold text-fg">{t("Postingan affiliate")}</p>
            <p className="text-xs text-muted">{t("Matikan kapan saja; slot berikutnya kembali jadi postingan biasa.")}</p>
          </div>
          <Switch on={form.aktif} onChange={(aktif) => update({ aktif })} label={t("Nyalakan postingan affiliate")} />
        </div>

        <div>
          <label className={LABEL} htmlFor="aff-niche">
            {t("Niche akun")}
          </label>
          <NicheInput
            id="aff-niche"
            value={form.niche}
            onChange={(niche) => update({ niche })}
            suggestions={suggestions}
            counts={productCounts}
            unit="produk"
          />
          <p className="mt-1.5 text-xs text-muted">
            {t("Angka di tiap niche = jumlah produk aktif di katalog.")}{" "}
            <span className={cn("font-semibold", matching ? "text-fg" : "text-warning")}>{t("{n} produk cocok untuk akun ini.", { n: matching })}</span>
          </p>
        </div>

        <div>
          <p className={LABEL}>{t("Seberapa sering")}</p>
          <div role="radiogroup" aria-label={t("Frekuensi affiliate")} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {FREQUENCY_PRESETS.map((p) => {
              const on = !custom && preset === p.key;
              const n = effectivePerDay({ ...p.values, aktif: true }, posts);
              return (
                <button
                  key={p.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setCustom(false);
                    update(p.values);
                  }}
                  className={cn(
                    "rounded-xl border p-3 text-left cursor-pointer transition-colors",
                    on ? "border-accent bg-accent-soft" : "border-line-strong hover:border-accent"
                  )}
                >
                  <span className={cn("block text-sm font-bold", on ? "text-accent" : "text-fg")}>{t(p.label)}</span>
                  {accounts.length === 1 && <span className="block text-xs font-semibold text-fg tabular-nums">{t("{n}/hari", { n })}</span>}
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted">{t(p.hint)}</span>
                </button>
              );
            })}
            <button
              type="button"
              role="radio"
              aria-checked={custom}
              onClick={() => setCustom(true)}
              className={cn(
                "rounded-xl border p-3 text-left cursor-pointer transition-colors",
                custom ? "border-accent bg-accent-soft" : "border-line-strong hover:border-accent"
              )}
            >
              <span className={cn("block text-sm font-bold", custom ? "text-accent" : "text-fg")}>{t("Atur sendiri")}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted">{t("Batas harian, porsi, jarak, dan jeda produk.")}</span>
            </button>
          </div>
        </div>

        {custom && (
        <div className="grid gap-5 sm:grid-cols-2 rounded-xl border border-line p-4">
          <div>
            <p className={LABEL}>{t("Maks per hari")}</p>
            <Stepper value={form.perHari} min={0} max={AFF_PER_DAY_MAX} onChange={(perHari) => update({ perHari })} label="maks per hari" unit="postingan" />
          </div>
          <div>
            <label className={LABEL} htmlFor="aff-porsi">
              {t("Porsi maksimal")}
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
              <span className="text-sm text-muted">{t("% dari postingan harian")}</span>
            </div>
          </div>
          <div>
            <p className={LABEL}>{t("Jarak antar affiliate")}</p>
            <Stepper value={form.jarakJam} min={0} max={AFF_GAP_HOURS_MAX} onChange={(jarakJam) => update({ jarakJam })} label="jarak jam" unit="jam" />
          </div>
          <div>
            <label className={LABEL} htmlFor="aff-jeda">
              {t("Produk sama boleh diulang setelah")}
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
              <span className="text-sm text-muted">{t("hari")}</span>
            </div>
          </div>
          <p className="sm:col-span-2 text-xs text-muted">{t("Yang berlaku adalah yang paling ketat antara maks per hari dan porsi.")}</p>
        </div>
        )}

        <Banner tone={(accounts.length === 1 && spammy) || eff === 0 ? "warning" : "info"}>
          {accounts.length === 1 ? (
            <>
              {t("Akun ini terbit {n} postingan per hari, jadi yang berlaku", { n: posts })}{" "}
              <b>{t("{n} postingan affiliate per hari", { n: eff })}</b>.
            </>
          ) : (
            <>{t("Jatah efektif dihitung per akun dari jumlah postingan hariannya.")}</>
          )}
          {eff === 0 && ` ${t("Naikkan maks per hari atau porsi supaya affiliate bisa jalan.")}`}
          {accounts.length === 1 &&
            spammy &&
            eff > 0 &&
            ` ${t("Lebih dari sepertiga postingan berisi produk berisiko membuat akun terlihat seperti akun jualan dan menurunkan jangkauan.")}`}
        </Banner>

        <div>
          <label className={LABEL} htmlFor="aff-template">
            {t("Teks balasan pertama (berisi link)")}
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
              {t("Contoh terkirim:")} <span className="whitespace-pre-line text-fg">{replyFromTemplate(form.templateBalasan, SAMPLE_LINK)}</span>
            </p>
          ) : (
            <p className="mt-1.5 text-xs font-semibold text-danger">{t("Wajib memuat {token} sebagai tempat link.", { token: LINK_TOKEN })}</p>
          )}
          <p className="mt-1 text-xs text-muted">{t("Dikirim otomatis 1-3 menit setelah postingan terbit. Sertakan keterangan “link affiliate” supaya jujur ke pembaca.")}</p>
        </div>
      </div>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ modal produk */

function ProductModal({
  product,
  suggestions,
  accountCounts,
  onClose,
  onSaved,
}: {
  product: AffiliateProductDTO | null;
  suggestions: string[];
  /** niche -> jumlah akun yang memakainya. */
  accountCounts: Map<string, number>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
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
      title={product ? t("Ubah produk") : t("Tambah produk")}
      description={t("Salin link dari dashboard Shopee Affiliate (Custom Link / Produk), lalu tempel di sini.")}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            {t("Batal")}
          </ModalButton>
          <ModalButton variant="primary" onClick={save} disabled={busy || !valid}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t("Simpan")}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Banner tone="danger">{error}</Banner>}
        <div>
          <label className={LABEL} htmlFor="aff-nama">
            {t("Nama singkat produk")}
          </label>
          <input
            id="aff-nama"
            value={form.nama}
            maxLength={AFF_NAME_MAX}
            onChange={(e) => update({ nama: e.target.value })}
            placeholder={t("mis. Wajan anti lengket 24 cm")}
            className={FIELD}
          />
          <p className="mt-1 text-xs text-muted">{t("Nama yang wajar disebut orang, bukan judul panjang dari Shopee.")}</p>
        </div>
        <div>
          <label className={LABEL} htmlFor="aff-link">
            {t("Link affiliate")}
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
          {form.link && !linkOk && <p className="mt-1 text-xs font-semibold text-danger">{t("Harus link Shopee Indonesia yang diawali https://.")}</p>}
        </div>
        <div>
          <label className={LABEL} htmlFor="aff-pniche">
            {t("Niche")}
          </label>
          <NicheInput
            id="aff-pniche"
            value={form.niche}
            onChange={(niche) => update({ niche })}
            suggestions={suggestions}
            counts={accountCounts}
            unit="akun"
          />
          <p className="mt-1.5 text-xs text-muted">{t("Angka di tiap niche = jumlah akun yang memakainya. Produk hanya dipakai akun dengan niche yang sama.")}</p>
        </div>
        <div>
          <label className={LABEL} htmlFor="aff-catatan">
            {t("Catatan produk (fakta untuk AI)")}
          </label>
          <textarea
            id="aff-catatan"
            rows={3}
            maxLength={AFF_NOTE_MAX}
            value={form.catatan}
            onChange={(e) => update({ catatan: e.target.value })}
            placeholder={t("mis. Lapisan granit, aman untuk kompor induksi, gagangnya tidak panas. Dipakai sendiri 2 bulan.")}
            className={cn(FIELD, "h-auto py-2.5 resize-y")}
          />
          <p className="mt-1 text-xs text-muted">
            {t("AI hanya boleh menyebut detail yang tertulis di sini. Jangan tulis harga atau diskon yang bisa berubah.")}
          </p>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl bg-subtle p-3.5">
          <p className="text-sm font-semibold text-fg">{t("Produk aktif")}</p>
          <Switch on={form.aktif} onChange={(aktif) => update({ aktif })} label={t("Produk aktif")} />
        </div>
      </div>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ tab */

/** Judul langkah bernomor; centang hijau bila langkah itu sudah beres. */
function StepHead({ n, title, hint, done, children }: { n: number; title: string; hint: string; done: boolean; children?: React.ReactNode }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-line bg-subtle rounded-t-2xl">
      <span
        aria-hidden
        className={cn(
          "w-7 h-7 rounded-full shrink-0 inline-flex items-center justify-center text-xs font-bold",
          done ? "bg-success text-on-accent" : "bg-accent text-on-accent"
        )}
      >
        {done ? <Check className="w-4 h-4" /> : n}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-fg">
          <span className="sr-only">{done ? t("Langkah {n} (selesai):", { n }) : t("Langkah {n}:", { n })} </span>
          {t(title)}
        </p>
        <p className="text-xs text-muted">{t(hint)}</p>
      </div>
      {children}
    </div>
  );
}

/** Balasan gagal masih bisa dikirim ulang selama antrean publisher belum membatalkannya (2 hari). */
const RETRY_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

function Stat({ label, value, tone }: { label: string; value: number; tone?: "success" | "danger" }) {
  const t = useT();
  return (
    <div className="card p-2.5 sm:p-4 min-w-0 flex flex-col">
      <p className="text-[11px] sm:text-xs font-semibold text-muted leading-tight line-clamp-2">{t(label)}</p>
      <p className={cn("mt-auto pt-1 text-lg sm:text-2xl font-bold tabular-nums leading-tight", tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-fg")}>{value}</p>
    </div>
  );
}

function Avatar({ a }: { a: AffiliateAccountDTO }) {
  return <AccountAvatar name={a.username ?? a.displayName} src={a.avatarUrl} size="w-9 h-9" className="text-xs" />;
}

const dateTimeOf = (iso: string): string =>
  `${new Date(iso).toLocaleDateString(currentLocale(), { day: "numeric", month: "short", timeZone: "Asia/Jakarta" })} ${timeOf(iso)}`;

export function AffiliateTab({ active }: { active: boolean }) {
  const t = useT();
  const [data, setData] = useState<AffiliateOverviewResponse | null>(null);
  /** Waktu data dimuat: acuan batas kirim ulang (render tetap murni). */
  const [loadedAt, setLoadedAt] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editAccounts, setEditAccounts] = useState<AffiliateAccountDTO[] | null>(null);
  const [editProduct, setEditProduct] = useState<AffiliateProductDTO | null | "new">(null);
  const [deleting, setDeleting] = useState<AffiliateProductDTO | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const loaded = useRef(false);
  const router = useRouter();

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetchAffiliate(signal);
      setData(res);
      setLoadedAt(Date.now());
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
          {t("Coba lagi")}
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
        <h3 className="mt-4 text-base font-bold text-fg">{t("Fitur affiliate belum aktif")}</h3>
        <p className="mt-1 text-sm text-muted max-w-md mx-auto">
          {t("Minta admin mengaktifkan fitur Shopee Affiliate untuk workspace ini, lalu muat ulang halaman.")}
        </p>
        <p className="mt-2 text-xs text-faint">
          {t("Untuk admin: jalankan")} <code className="font-mono">sql/019_affiliate.sql</code> {t("dan")}{" "}
          <code className="font-mono">sql/032_affiliate_retry.sql</code>.
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

  const productStepDone = activeProducts.length > 0;
  const accountStepDone = data.accounts.some((a) => a.status.ok);
  const accountCounts = nicheCounts(data.accounts.filter((a) => a.config.niche.length > 0).map((a) => a.config));

  const fixAccount = (a: AffiliateAccountDTO) => {
    switch (a.status.aksi) {
      case "NYALAKAN":
        quickToggle(a, true);
        break;
      case "TAMBAH_PRODUK":
        setEditProduct("new");
        break;
      case "LANJUTKAN":
        void run("jeda", () => setAffiliatePaused(true), tr("Affiliate berjalan lagi."));
        break;
      case "AUTOPILOT":
        router.push("/autopilot?tab=akun");
        break;
      default:
        setEditAccounts([a]);
    }
  };
  const FIX_LABEL: Record<NonNullable<AffiliateAccountDTO["status"]["aksi"]>, string> = {
    NYALAKAN: "Nyalakan",
    ATUR_AKUN: "Atur",
    TAMBAH_PRODUK: "Tambah produk",
    AUTOPILOT: "Buka autopilot",
    LANJUTKAN: "Lanjutkan",
  };

  const retry = (r: AffiliateRecentDTO) =>
    void run(`ulang:${r.id}`, () => retryAffiliateReply(r.id), tr("Link dijadwalkan kirim ulang dalam beberapa menit."));

  const quickToggle = (a: AffiliateAccountDTO, on: boolean) => {
    if (on && a.config.niche.length === 0) {
      setEditAccounts([a]);
      return;
    }
    void run(`akun:${a.id}`, () => saveAffiliateAccounts([a.id], { aktif: on }), on ? tr("Affiliate {handle} dinyalakan.", { handle: accountHandle(a) }) : tr("Affiliate {handle} dimatikan.", { handle: accountHandle(a) }));
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
          <h3 className="text-base font-bold text-fg">{t("Shopee Affiliate")}</h3>
          <p className="text-sm text-muted">
            {t(
              "Tiga langkah: isi produk, pilih akun, lalu pantau. AI menyelipkan produk secara natural, dan link dikirim otomatis di balasan pertama 1-3 menit setelah postingan terbit."
            )}
          </p>
        </div>
        <button
          type="button"
          disabled={busyKey === "jeda"}
          onClick={() =>
            void run("jeda", () => setAffiliatePaused(!data.aktif), data.aktif ? tr("Semua affiliate dijeda.") : tr("Affiliate berjalan lagi."))
          }
          className={cn(
            "h-10 px-4 rounded-full text-sm font-semibold inline-flex items-center gap-2 shrink-0 cursor-pointer transition-colors disabled:opacity-50",
            data.aktif ? "border border-line-strong text-fg hover:border-danger hover:text-danger" : "bg-accent text-on-accent hover:bg-accent-hover"
          )}
        >
          {busyKey === "jeda" ? <Loader2 className="w-4 h-4 animate-spin" /> : data.aktif ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          {data.aktif ? t("Jeda semua affiliate") : t("Lanjutkan affiliate")}
        </button>
      </div>

      {!data.aktif && <Banner tone="warning">{t("Affiliate sedang dijeda untuk seluruh workspace. Slot baru ditulis sebagai postingan biasa.")}</Banner>}

      {/* Katalog */}
      <section aria-label={t("Katalog produk affiliate")} className="card">
        <StepHead
          n={1}
          done={productStepDone}
          title="Isi katalog produk"
          hint={
            productStepDone
              ? t("{active} produk aktif dari {total}. Tiap produk dipakai akun dengan niche yang sama.", {
                  active: activeProducts.length,
                  total: data.products.length,
                })
              : "Tempel link dari Shopee Affiliate dan beri niche. Mulai dari sini."
          }
        >
          <button
            type="button"
            onClick={() => setEditProduct("new")}
            className="h-9 px-4 rounded-full bg-accent text-on-accent text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-accent-hover cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            {t("Tambah")}
            <span className="max-sm:sr-only"> {t("produk")}</span>
          </button>
        </StepHead>
        {data.products.length === 0 ? (
          <div className="p-8 text-center">
            <div className="mx-auto w-12 h-12 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <p className="mt-3 text-sm font-semibold text-fg">{t("Katalog masih kosong")}</p>
            <p className="mt-1 text-sm text-muted max-w-sm mx-auto">
              {t("Tambahkan produk dari Shopee Affiliate beserta niche-nya. Satu produk bisa dipakai semua akun dengan niche yang sama.")}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {data.products.map((p) => (
              <li key={p.id} className={cn("px-4 py-3.5 flex items-start gap-3", !p.aktif && "opacity-60")}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-fg">
                    {p.nama}
                    {!p.aktif && <span className="ml-2 text-xs font-semibold text-muted">{t("(nonaktif)")}</span>}
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
                      <span
                        key={n}
                        title={accountCounts.get(n) ? undefined : t("Belum ada akun dengan niche ini")}
                        className={cn(
                          "h-6 px-2 rounded-full text-xs font-semibold inline-flex items-center",
                          accountCounts.get(n) ? "bg-subtle text-muted" : "bg-warning-soft text-warning"
                        )}
                      >
                        {n} · {t("{n} akun", { n: accountCounts.get(n) ?? 0 })}
                      </span>
                    ))}
                    <span className="text-xs text-muted ml-1">
                      · {t("{n}× terbit 30 hari", { n: p.dipakai30 })}
                      {p.terakhir ? ` · ${t("terakhir {when}", { when: dateTimeOf(p.terakhir) })}` : ""}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    aria-label={t("Ubah {name}", { name: p.nama })}
                    onClick={() => setEditProduct(p)}
                    className="w-10 h-10 rounded-full inline-flex items-center justify-center text-muted hover:text-accent hover:bg-subtle cursor-pointer"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("Hapus {name}", { name: p.nama })}
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

      {/* Akun */}
      <section aria-label={t("Pengaturan affiliate per akun")} className="card">
        <StepHead
          n={2}
          done={accountStepDone}
          title="Nyalakan di akun"
          hint={
            accountStepDone
              ? t("{n} akun berjalan. Status tiap akun ada di bawah namanya.", { n: data.accounts.filter((a) => a.status.ok).length })
              : productStepDone
                ? "Pilih niche dan seberapa sering. Ikuti tombol di tiap akun bila ada yang perlu dibereskan."
                : "Isi katalog dulu (langkah 1), lalu nyalakan di akun yang niche-nya cocok."
          }
        />
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-line">
          <div className="flex">
            <Checkbox
              checked={allSelected}
              indeterminate={selected.size > 0 && !allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(data.accounts.map((a) => a.id)))}
              disabled={data.accounts.length === 0}
              label={allSelected ? t("Batalkan pilihan semua akun") : t("Pilih semua akun")}
            />
          </div>
          <p className="flex-1 text-xs font-semibold text-muted uppercase tracking-wide">
            {t("Akun ({n})", { n: data.accounts.length })}
            {selected.size > 0 && ` · ${t("{n} dipilih", { n: selected.size })}`}
          </p>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setEditAccounts(data.accounts.filter((a) => selected.has(a.id)))}
              className="h-9 px-4 rounded-full bg-accent text-on-accent text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-accent-hover cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5" />
              {t("Atur {n} akun", { n: selected.size })}
            </button>
          )}
        </div>
        {data.accounts.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">{t("Belum ada akun yang dipetakan ke cabang.")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.accounts.map((a) => {
              const c = a.config;
              const st = a.status;
              const preset = FREQUENCY_PRESETS.find((p) => p.key === presetOf(c));
              const spammy = c.aktif && looksSpammy(st.perHari, a.postsPerDay);
              return (
                // Layar kecil: rincian memakai lebar penuh di bawah nama, tidak terjepit sakelar dan tombol edit.
                <li key={a.id} className="px-4 py-3.5 grid grid-cols-[auto_auto_minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-start">
                  <div className="flex pt-1.5">
                    <Checkbox checked={selected.has(a.id)} onChange={() => toggle(a.id)} label={t("Pilih {handle}", { handle: accountHandle(a) })} />
                  </div>
                  <Avatar a={a} />
                  <p className="self-center text-sm font-semibold text-fg truncate">
                    <HandleText account={a} />
                  </p>
                  <div className="col-start-4 row-start-1 flex items-center gap-1 shrink-0">
                    <Switch on={c.aktif} busy={busyKey === `akun:${a.id}`} onChange={(on) => quickToggle(a, on)} label={t("Affiliate {handle}", { handle: accountHandle(a) })} />
                    <button
                      type="button"
                      aria-label={t("Atur affiliate {handle}", { handle: accountHandle(a) })}
                      onClick={() => setEditAccounts([a])}
                      className="w-10 h-10 rounded-full inline-flex items-center justify-center text-muted hover:text-accent hover:bg-subtle cursor-pointer"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="col-start-2 col-span-3 sm:col-start-3 sm:col-span-2 min-w-0 sm:-mt-3">
                    <div
                      className={cn(
                        "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium",
                        st.ok ? "text-success" : c.aktif ? "text-warning" : "text-muted"
                      )}
                    >
                      <span className="inline-flex items-start gap-1 min-w-0">
                        {st.ok ? (
                          <CheckCircle2 className="w-3.5 h-3.5 mt-px shrink-0" />
                        ) : c.aktif ? (
                          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
                        ) : null}
                        {statusText(st.teks)}
                      </span>
                      {st.aksi && (c.aktif || st.aksi === "NYALAKAN") && (
                        <button
                          type="button"
                          disabled={busyKey !== null}
                          onClick={() => fixAccount(a)}
                          className="h-7 px-3 rounded-full border border-current text-xs font-semibold hover:bg-subtle cursor-pointer disabled:opacity-50"
                        >
                          {t(FIX_LABEL[st.aksi])}
                        </button>
                      )}
                    </div>
                    {c.aktif && (
                      <p className="mt-1 text-xs text-muted">
                        {preset ? t("Frekuensi {label}", { label: t(preset.label).toLowerCase() }) : t("Frekuensi diatur sendiri")} ·{" "}
                        {t("{a} dari {b} postingan per hari", { a: st.perHari, b: a.postsPerDay })}
                      </p>
                    )}
                    {c.niche.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.niche.map((n) => (
                          <span key={n} className="h-6 px-2 rounded-full bg-subtle text-xs font-semibold text-muted inline-flex items-center">
                            {n}
                          </span>
                        ))}
                      </div>
                    )}
                    {spammy && (
                      <p className="mt-1 text-xs font-medium text-warning flex items-start gap-1">
                        <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
                        {t("Lebih dari sepertiga postingan berisi produk: berisiko terlihat seperti akun jualan.")}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Aktivitas */}
      <section aria-label={t("Aktivitas affiliate 30 hari")} className="card">
        <StepHead
          n={3}
          done={false}
          title="Pantau hasilnya"
          hint="30 hari terakhir. Link yang gagal bisa dikirim ulang sampai 2 hari setelah terbit."
        />
        <div className="grid grid-cols-4 gap-2 sm:gap-3 p-3 sm:p-4 border-b border-line">
          <Stat label="Terbit" value={data.summary.terbit} />
          <Stat label="Terjadwal" value={data.summary.terjadwal} />
          <Stat label="Link terkirim" value={data.summary.balasanTerkirim} tone="success" />
          <Stat label="Link gagal" value={data.summary.balasanGagal} tone={data.summary.balasanGagal ? "danger" : undefined} />
        </div>
        {data.recent.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">{t("Belum ada postingan affiliate.")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.recent.map((r: AffiliateRecentDTO) => {
              const acc = accountById.get(r.accountId);
              const reply = REPLY_LABEL[r.balasan];
              const canRetry = r.balasan === "GAGAL" && loadedAt - new Date(r.slotAt).getTime() < RETRY_WINDOW_MS;
              return (
                <li key={r.id} className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-xs text-muted tabular-nums w-24 shrink-0">{dateTimeOf(r.slotAt)}</span>
                  <span className="text-sm font-semibold text-fg min-w-0 truncate">{acc ? accountHandle(acc) : t("Akun")}</span>
                  <span className="text-sm text-muted min-w-0 truncate flex-1">{r.produk ?? productById.get(r.productId)?.nama ?? t("Produk dihapus")}</span>
                  <span className="h-6 px-2 rounded-full bg-subtle text-xs font-semibold text-muted inline-flex items-center">
                    {t(SLOT_STATUS_LABEL[r.slotStatus as SlotStatus] ?? r.slotStatus)}
                  </span>
                  <span className={cn("h-6 px-2 rounded-full text-xs font-semibold inline-flex items-center", reply.cls)}>{t(reply.label)}</span>
                  {canRetry && (
                    <button
                      type="button"
                      disabled={busyKey !== null}
                      onClick={() => retry(r)}
                      className="h-7 px-3 rounded-full border border-line-strong text-xs font-semibold text-fg inline-flex items-center gap-1.5 hover:border-accent hover:text-accent cursor-pointer disabled:opacity-50"
                    >
                      {busyKey === `ulang:${r.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                      {t("Kirim ulang")}
                    </button>
                  )}
                  {r.releaseUrl && (
                    <a
                      href={r.releaseUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={t("Lihat postingan di Threads")}
                      className="w-8 h-8 rounded-full inline-flex items-center justify-center text-muted hover:text-accent hover:bg-subtle"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                  {/* Alasan gagal tampil langsung: `title` tidak terbaca di layar sentuh. */}
                  {r.balasan === "GAGAL" && r.error && <p className="basis-full text-xs font-medium text-danger">{t("Alasan:")} {apiErrorText(r.error)}</p>}
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
            setNotice({ tone: "success", text: n === 1 ? tr("Pengaturan affiliate disimpan.") : tr("Pengaturan affiliate {n} akun disimpan.", { n }) });
            void load();
          }}
        />
      )}
      {editProduct && (
        <ProductModal
          product={editProduct === "new" ? null : editProduct}
          suggestions={suggestions}
          accountCounts={accountCounts}
          onClose={() => setEditProduct(null)}
          onSaved={() => {
            setEditProduct(null);
            setNotice({ tone: "success", text: tr("Produk disimpan.") });
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
          void run(`hapus:${p.id}`, () => deleteAffiliateProduct(p.id), tr("{name} dihapus dari katalog.", { name: p.nama }));
        }}
        title={t("Hapus produk?")}
        description={
          deleting
            ? t("{name} tidak akan dipakai lagi, dan link-nya yang belum terkirim dibatalkan. Riwayat tetap tersimpan.", { name: deleting.nama })
            : undefined
        }
        confirmLabel={t("Hapus")}
        confirmIcon={<Trash2 className="w-4 h-4" />}
        variant="danger"
      />
    </div>
  );
}
