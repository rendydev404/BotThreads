"use client";

import React, { useId, useState } from "react";
import { BadgePercent, Ban, BookOpen, Loader2, Package, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PublishAccountDTO } from "@/lib/content-types";
import { saveKnowledge } from "@/lib/radar-client";
import {
  KNOWLEDGE_BODY_MAX,
  KNOWLEDGE_KIND_HINT,
  KNOWLEDGE_KIND_LABEL,
  KNOWLEDGE_TITLE_MAX,
  type KnowledgeDTO,
  type KnowledgeKind,
} from "@/lib/radar-types";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { Dropdown, type DropdownOption } from "@/components/autopilot/dropdown";
import { Segmented, accountHandle, type SegmentedOption } from "@/components/autopilot/shared";
import { DayField, addDays, dayDiff } from "./day-field";
import { ControlLabel, FormError, TextAreaField, TextField } from "./fields";
import { errorDetails, errorText, formatDayKey } from "./format";
import type { PillTone } from "./states";

export const KNOWLEDGE_KINDS: KnowledgeKind[] = ["FAKTA", "PRODUK", "PROMO", "LARANGAN"];

export const KIND_STYLE: Record<KnowledgeKind, { tone: PillTone; short: string; Icon: React.ComponentType<{ className?: string }> }> = {
  FAKTA: { tone: "accent", short: "Fakta", Icon: BookOpen },
  PRODUK: { tone: "success", short: "Produk", Icon: Package },
  PROMO: { tone: "warning", short: "Promo", Icon: BadgePercent },
  LARANGAN: { tone: "danger", short: "Larangan", Icon: Ban },
};

const EXAMPLE: Record<KnowledgeKind, { judul: string; isi: string }> = {
  FAKTA: { judul: "Jam buka", isi: "Buka setiap hari pukul 10.00 sampai 22.00, termasuk hari libur nasional." },
  PRODUK: { judul: "Harga menu utama", isi: "Menu reguler Rp25.000, ukuran jumbo Rp35.000, paket berdua Rp55.000." },
  PROMO: { judul: "Promo akhir bulan", isi: "Beli 2 gratis 1 untuk semua menu, khusus makan di tempat." },
  LARANGAN: { judul: "Klaim berlebihan", isi: "nomor satu di Indonesia\npaling murah\ndijamin sembuh" },
};

/** Promo baru berakhir sekian hari dari hari ini sampai pengguna memilih tanggalnya. */
const PROMO_DEFAULT_DAYS = 7;
const DATED_DEFAULT_DAYS = 30;

type Lifetime = "none" | "dated";
const LIFETIME_OPTIONS: SegmentedOption<Lifetime>[] = [
  { value: "none", label: "Tanpa batas" },
  { value: "dated", label: "Sampai tanggal" },
];

/** Perapian untuk validasi dan penghitung karakter di form; yang tersimpan tetap hasil perapian server. */
const cleanTitle = (s: string): string => s.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
const cleanBody = (kind: KnowledgeKind, s: string): string =>
  kind === "LARANGAN"
    ? s
        .replace(/[<>]/g, " ")
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n")
    : s.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();

const SCOPED_ACCOUNT = "Pilih akun: Anda hanya bisa mengatur butir untuk akun yang Anda kelola.";

interface KnowledgeDialogProps {
  /** null = butir baru. */
  item: KnowledgeDTO | null;
  defaultKind: KnowledgeKind;
  /** Hari ini (WIB), "YYYY-MM-DD", diambil saat dialog dibuka. */
  today: string;
  accounts: PublishAccountDTO[];
  accountsLoading: boolean;
  /** Pengguna dibatasi ke akun tertentu: butir "semua akun" tidak bisa ia buat atau ubah. */
  accountScoped: boolean;
  onClose: () => void;
  onSaved: (item: KnowledgeDTO, created: boolean) => void;
}

/** Tambah atau ubah satu butir pengetahuan. Dipasang ulang (key) tiap kali dibuka, jadi isian selalu segar. */
export function KnowledgeDialog({ item, defaultKind, today, accounts, accountsLoading, accountScoped, onClose, onSaved }: KnowledgeDialogProps) {
  const [jenis, setJenis] = useState<KnowledgeKind>(item?.jenis ?? defaultKind);
  const [accountId, setAccountId] = useState(item?.accountId ?? "");
  const [judul, setJudul] = useState(item?.judul ?? "");
  const [isi, setIsi] = useState(item?.isi ?? "");
  const [until, setUntil] = useState<string | null>(
    () => item?.berlakuSampai ?? ((item?.jenis ?? defaultKind) === "PROMO" ? addDays(today, PROMO_DEFAULT_DAYS) : null)
  );
  // Tanggal terakhir yang dipilih, supaya bolak-balik "Tanpa batas" tidak menghapusnya.
  const [keptUntil, setKeptUntil] = useState<string | null>(item?.berlakuSampai ?? null);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<{ message: string; details?: string[] } | null>(null);
  const formId = useId();

  const title = cleanTitle(judul);
  const body = cleanBody(jenis, isi);
  const titleError = title.length < 2 || title.length > KNOWLEDGE_TITLE_MAX ? `Judul harus 2-${KNOWLEDGE_TITLE_MAX} karakter.` : null;
  const bodyError = body.length < 2 || body.length > KNOWLEDGE_BODY_MAX ? `Isi harus 2-${KNOWLEDGE_BODY_MAX} karakter.` : null;
  const dateError = jenis === "PROMO" && !until ? "Promo wajib punya tanggal berakhir." : null;
  const accountError = accountScoped && !accountId ? SCOPED_ACCOUNT : null;
  const invalid = !!(titleError || bodyError || dateError || accountError);
  const daysLeft = until ? dayDiff(today, until) : null;

  const accountOptions: DropdownOption<string>[] = [
    ...(accountScoped ? [] : [{ value: "", label: "Semua akun", hint: "Berlaku untuk seluruh akun di workspace." }]),
    ...accounts.map((a) => ({ value: a.id, label: accountHandle(a), hint: a.outletNama ?? a.displayName })),
  ];
  // Daftar akun belum selesai dimuat: akun butir yang sedang diubah tetap punya label.
  if (accountId && !accountOptions.some((o) => o.value === accountId)) {
    accountOptions.push({ value: accountId, label: accountsLoading ? "Memuat akun..." : "Akun terpilih" });
  }

  const pickDay = (next: string | null) => {
    setUntil(next);
    if (next) setKeptUntil(next);
    setFailure(null);
  };

  const pickKind = (next: KnowledgeKind) => {
    setJenis(next);
    setFailure(null);
    if (next === "PROMO" && !until) pickDay(keptUntil ?? addDays(today, PROMO_DEFAULT_DAYS));
  };

  const submit = async () => {
    setSubmitted(true);
    if (saving || invalid) return;
    setSaving(true);
    setFailure(null);
    const values = { accountId: accountId || null, jenis, judul: title, isi: body, berlakuSampai: until };
    try {
      const res = await saveKnowledge(item ? { id: item.id, ...values } : values);
      // Baris lokal memakai butir dari balasan server (tanpa fetch ulang).
      onSaved(res.item, !item);
    } catch (e) {
      setFailure({ message: errorText(e, "Gagal menyimpan butir. Coba lagi."), details: errorDetails(e) });
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      busy={saving}
      title={item ? "Ubah butir pengetahuan" : "Tambah butir pengetahuan"}
      description="AI wajib mengikuti butir yang masih berlaku saat menulis posting."
      footer={
        <>
          <ModalButton onClick={onClose} disabled={saving}>
            Batal
          </ModalButton>
          <ModalButton variant="primary" type="submit" form={formId} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "Menyimpan..." : "Simpan"}
          </ModalButton>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-5"
      >
        <div>
          <ControlLabel>Jenis</ControlLabel>
          <div role="group" aria-label="Jenis butir" className="grid grid-cols-2 gap-2">
            {KNOWLEDGE_KINDS.map((k) => {
              const { Icon } = KIND_STYLE[k];
              const active = jenis === k;
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={active}
                  disabled={saving}
                  onClick={() => pickKind(k)}
                  className={cn(
                    "min-h-11 px-3 py-2 rounded-xl border text-left text-[13px] font-semibold leading-snug inline-flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
                    active ? "border-accent bg-accent-soft text-accent" : "border-line-strong bg-surface text-fg hover:border-accent"
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="min-w-0">{KNOWLEDGE_KIND_LABEL[k]}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-muted leading-relaxed">{KNOWLEDGE_KIND_HINT[jenis]}</p>
        </div>

        <TextField
          label="Judul"
          data-autofocus
          value={judul}
          onChange={(v) => {
            setJudul(v);
            setFailure(null);
          }}
          maxLength={KNOWLEDGE_TITLE_MAX}
          showCount
          autoComplete="off"
          placeholder={`Contoh: ${EXAMPLE[jenis].judul}`}
          error={submitted ? titleError : null}
          disabled={saving}
        />

        <TextAreaField
          label={jenis === "LARANGAN" ? "Kata atau frasa terlarang" : "Isi"}
          value={isi}
          onChange={(v) => {
            setIsi(v);
            setFailure(null);
          }}
          maxLength={KNOWLEDGE_BODY_MAX}
          rows={jenis === "LARANGAN" ? 5 : 4}
          placeholder={EXAMPLE[jenis].isi}
          error={submitted ? bodyError : null}
          hint={jenis === "LARANGAN" ? "Satu kata atau frasa per baris." : "Tulis apa adanya; disimpan sebagai satu paragraf."}
          disabled={saving}
        />

        <div>
          <ControlLabel hint="Butir untuk satu akun hanya dipakai saat AI menulis untuk akun itu.">Berlaku untuk</ControlLabel>
          <Dropdown
            ariaLabel="Berlaku untuk"
            value={accountId}
            options={accountOptions}
            onChange={(next) => {
              setAccountId(next);
              setFailure(null);
            }}
            disabled={saving}
          />
          {submitted && accountError && (
            <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
              {accountError}
            </p>
          )}
        </div>

        <div>
          <ControlLabel
            hint={
              jenis === "PROMO"
                ? "Wajib untuk promo. Setelah lewat tanggal ini AI berhenti menulis promonya."
                : "Opsional. Butir yang sudah lewat tanggalnya tidak dipakai AI lagi."
            }
          >
            {jenis === "PROMO" ? "Promo berakhir" : "Masa berlaku"}
          </ControlLabel>
          {jenis !== "PROMO" && (
            <Segmented
              ariaLabel="Masa berlaku"
              options={LIFETIME_OPTIONS}
              value={until ? "dated" : "none"}
              onChange={(mode) => pickDay(mode === "none" ? null : (keptUntil ?? addDays(today, DATED_DEFAULT_DAYS)))}
              disabled={saving}
              className="mb-2"
            />
          )}
          {until && (
            <>
              <DayField label="Tanggal berakhir" value={until} onChange={pickDay} today={today} disabled={saving} />
              <p className={cn("mt-1.5 text-xs", daysLeft !== null && daysLeft < 0 ? "font-medium text-warning" : "text-muted")} aria-live="polite">
                {daysLeft !== null && daysLeft < 0
                  ? `${formatDayKey(until)} sudah lewat: butir langsung dianggap berakhir dan tidak dipakai AI.`
                  : `Berlaku sampai ${formatDayKey(until)}${daysLeft === 0 ? " (hari ini)" : daysLeft ? ` (${daysLeft} hari lagi)` : ""}.`}
              </p>
            </>
          )}
          {submitted && dateError && (
            <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
              {dateError}
            </p>
          )}
        </div>

        <FormError message={failure?.message} details={failure?.details} />
      </form>
    </ModalShell>
  );
}
