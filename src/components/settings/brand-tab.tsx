"use client";

import React, { useId, useLayoutEffect, useState } from "react";
import { CheckCircle2, Loader2, Plus, Save, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchWorkspaceSettings, saveWorkspaceSettings, type WorkspaceSettingsResponse } from "@/lib/team-client";
import { Banner } from "@/components/autopilot/shared";
import { FormError, INPUT_CLS, TextAreaField, TextField } from "./fields";
import { errorDetails, errorText } from "./format";
import { BTN_OUTLINE, BTN_PRIMARY, LoadError } from "./states";
import { useRemote } from "./use-remote";

/** Batas yang sama dengan validasi server (team-service.ts `saveSettings`). */
const NAME_MIN = 2;
const NAME_MAX = 80;
const DESC_MAX = 600;
const TOPIC_MIN = 3;
const TOPIC_MAX = 60;
const TOPICS_MAX = 100;

const LOAD_ERROR = "Gagal memuat pengaturan brand.";

/** Perapian yang sama dengan server: tanpa "<>", spasi dirapatkan. */
const clean = (s: string, max: number): string => s.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const cleanTopic = (s: string): string => s.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

interface BrandValues {
  namaBrand: string;
  deskripsiBrand: string;
  topikTerlarang: string[];
}

function BrandSkeleton() {
  return (
    <div className="card p-4 sm:p-6 space-y-5 animate-pulse" aria-busy="true" aria-label="Memuat pengaturan brand">
      {[11, 28, 11].map((h, i) => (
        <div key={i}>
          <div className="h-3.5 w-28 rounded bg-subtle" />
          <div className="mt-2 rounded-xl bg-subtle" style={{ height: `${h * 4}px` }} />
        </div>
      ))}
    </div>
  );
}

/** Tampilan baca saja untuk peran yang tidak boleh menyimpan (di bawah Admin). */
function BrandReadOnly({ data }: { data: WorkspaceSettingsResponse }) {
  return (
    <div className="space-y-4">
      <Banner tone="info">Hanya Admin dan Pemilik yang bisa mengubah pengaturan brand.</Banner>
      <dl className="card p-4 sm:p-6 space-y-5">
        <div>
          <dt className="text-[13px] font-semibold text-muted">Nama brand</dt>
          <dd className="mt-1 text-sm font-semibold text-fg break-words">{data.namaBrand || "Belum diisi"}</dd>
        </div>
        <div>
          <dt className="text-[13px] font-semibold text-muted">Deskripsi brand</dt>
          <dd className="mt-1 text-sm text-fg leading-relaxed break-words">{data.deskripsiBrand || "Belum diisi"}</dd>
        </div>
        <div>
          <dt className="text-[13px] font-semibold text-muted">Topik terlarang</dt>
          <dd className="mt-2">
            {data.topikTerlarang.length === 0 ? (
              <span className="text-sm text-fg">Belum ada topik terlarang.</span>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {data.topikTerlarang.map((t) => (
                  <li key={t} className="h-8 px-3 rounded-full bg-subtle text-[13px] font-medium text-fg inline-flex items-center max-w-full">
                    <span className="truncate">{t}</span>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

const valuesOf = (d: BrandValues): BrandValues => ({
  namaBrand: d.namaBrand,
  deskripsiBrand: d.deskripsiBrand,
  topikTerlarang: d.topikTerlarang,
});
const sameValues = (a: BrandValues, b: BrandValues): boolean =>
  a.namaBrand === b.namaBrand && a.deskripsiBrand === b.deskripsiBrand && sameList(a.topikTerlarang, b.topikTerlarang);

interface BrandFormProps {
  data: WorkspaceSettingsResponse;
  onSaved: (next: BrandValues) => void;
}

function BrandForm({ data, onSaved }: BrandFormProps) {
  // `base` = nilai tersimpan yang dikenal form ini; "ada perubahan" dihitung terhadapnya.
  const [base, setBase] = useState<BrandValues>(() => valuesOf(data));
  const [nama, setNama] = useState(data.namaBrand);
  const [deskripsi, setDeskripsi] = useState(data.deskripsiBrand);
  const [topik, setTopik] = useState<string[]>(data.topikTerlarang);
  const [draft, setDraft] = useState("");
  const [topicError, setTopicError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<{ message: string; details?: string[] } | null>(null);
  const topicId = useId();

  // Pesan "tersimpan" tidak boleh menyambut pengguna yang kembali ke tab ini (Activity).
  useLayoutEffect(() => () => setSaved(false), []);

  const namaClean = clean(nama, NAME_MAX);
  const deskripsiClean = clean(deskripsi, DESC_MAX);
  const dirty =
    namaClean !== clean(base.namaBrand, NAME_MAX) ||
    deskripsiClean !== clean(base.deskripsiBrand, DESC_MAX) ||
    !sameList(topik, base.topikTerlarang);

  // Data di server berubah (penyegaran membawa isi dari admin lain) selagi form belum disentuh: ikuti
  // isi baru. Isian yang sedang diubah tidak pernah ditimpa.
  if (!dirty && !saving && !sameValues(base, data)) {
    setBase(valuesOf(data));
    setNama(data.namaBrand);
    setDeskripsi(data.deskripsiBrand);
    setTopik(data.topikTerlarang);
  }

  const nameError = dirty && namaClean.length < NAME_MIN ? `Nama brand harus ${NAME_MIN}-${NAME_MAX} karakter.` : null;
  const full = topik.length >= TOPICS_MAX;

  const touch = () => {
    setSaved(false);
    setFailure(null);
  };

  /** Masukkan isian ke daftar; beberapa topik sekaligus boleh dipisah koma. Yang tidak sah tetap di kolom isian. */
  const addTopics = () => {
    const parts = [...new Set(draft.split(/[,\n]/).map(cleanTopic).filter(Boolean))];
    if (parts.length === 0) return;
    const bad = parts.filter((t) => t.length < TOPIC_MIN || t.length > TOPIC_MAX);
    const fresh = parts.filter((t) => !bad.includes(t) && !topik.includes(t));
    const room = TOPICS_MAX - topik.length;
    if (fresh.length > 0 && room > 0) {
      setTopik([...topik, ...fresh.slice(0, room)]);
      touch();
    }
    setDraft(bad.join(", "));
    setTopicError(
      bad.length > 0
        ? `Topik harus ${TOPIC_MIN}-${TOPIC_MAX} karakter.`
        : fresh.length === 0
          ? "Topik ini sudah ada di daftar."
          : fresh.length > room
            ? `Maksimal ${TOPICS_MAX} topik.`
            : null
    );
  };

  const reset = () => {
    setNama(base.namaBrand);
    setDeskripsi(base.deskripsiBrand);
    setTopik(base.topikTerlarang);
    setDraft("");
    setTopicError(null);
    setFailure(null);
  };

  const save = async () => {
    if (!dirty || nameError || saving) return;
    setSaving(true);
    setFailure(null);
    try {
      const res = await saveWorkspaceSettings({ namaBrand: namaClean, deskripsiBrand: deskripsiClean || null, topikTerlarang: topik });
      // Balasan memuat nilai yang benar-benar tersimpan (dirapikan server), jadi cukup dipasang ke form
      // dan data lokal tanpa fetch ulang. Form tidak dipasang ulang: fokus dan pesan status tetap di tempatnya.
      const next: BrandValues = res.settings;
      setBase(next);
      setNama(next.namaBrand);
      setDeskripsi(next.deskripsiBrand);
      setTopik(next.topikTerlarang);
      setSaved(true);
      onSaved(next);
    } catch (e) {
      setFailure({ message: errorText(e, "Gagal menyimpan pengaturan brand. Coba lagi."), details: errorDetails(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="card p-4 sm:p-6 space-y-5"
    >
      <TextField
        label="Nama brand"
        value={nama}
        onChange={(v) => {
          setNama(v);
          touch();
        }}
        maxLength={NAME_MAX}
        showCount
        autoComplete="off"
        placeholder="Nama yang dipakai di posting"
        error={nameError}
        hint="AI menyebut brand dengan nama ini."
        disabled={saving}
      />

      <TextAreaField
        label="Deskripsi brand"
        value={deskripsi}
        onChange={(v) => {
          setDeskripsi(v);
          touch();
        }}
        maxLength={DESC_MAX}
        rows={5}
        placeholder="Contoh: kedai makan keluarga dengan harga terjangkau. Gaya bicara santai dan hangat, suka bercanda ringan, tidak pernah menjelekkan kompetitor."
        hint="AI memakai deskripsi ini supaya posting terdengar seperti brand Anda: ceritakan apa yang dijual, untuk siapa, dan gaya bicaranya. Disimpan sebagai satu paragraf."
        disabled={saving}
      />

      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <label htmlFor={topicId} className="text-[13px] font-semibold text-fg">
            Topik terlarang
          </label>
          <span className="text-xs text-faint tabular-nums shrink-0">
            {topik.length}/{TOPICS_MAX}
          </span>
        </div>
        <div className="flex gap-2">
          <input
            id={topicId}
            type="text"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setTopicError(null);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== ",") return;
              e.preventDefault();
              addTopics();
            }}
            maxLength={400}
            autoComplete="off"
            placeholder="Contoh: politik"
            disabled={saving || full}
            aria-invalid={topicError ? true : undefined}
            aria-describedby={`${topicId}-msg`}
            className={cn(INPUT_CLS, "flex-1 min-w-0", topicError && "border-danger focus:border-danger")}
          />
          <button type="button" onClick={addTopics} disabled={saving || full || !draft.trim()} className={cn(BTN_OUTLINE, "h-11 shrink-0")}>
            <Plus className="w-4 h-4" />
            Tambah
          </button>
        </div>
        {topicError ? (
          <p id={`${topicId}-msg`} role="alert" className="mt-1.5 text-xs font-medium text-danger">
            {topicError}
          </p>
        ) : (
          <p id={`${topicId}-msg`} className="mt-1.5 text-xs text-muted leading-relaxed">
            {full
              ? `Daftar sudah penuh (${TOPICS_MAX} topik). Hapus satu untuk menambah yang lain.`
              : `AI tidak akan menulis tentang topik ini di akun mana pun. Tekan Enter atau koma untuk menambahkan; satu topik ${TOPIC_MIN}-${TOPIC_MAX} karakter.`}
          </p>
        )}

        {topik.length > 0 && (
          <ul aria-label="Daftar topik terlarang" className="mt-3 flex flex-wrap gap-2">
            {topik.map((t) => (
              <li key={t} className="h-10 pl-3.5 rounded-full bg-subtle text-[13px] font-medium text-fg inline-flex items-center max-w-full">
                <span className="truncate">{t}</span>
                <button
                  type="button"
                  onClick={() => {
                    setTopik(topik.filter((v) => v !== t));
                    setTopicError(null);
                    touch();
                  }}
                  disabled={saving}
                  aria-label={`Hapus topik ${t}`}
                  className="w-10 h-10 shrink-0 rounded-full inline-flex items-center justify-center text-muted hover:text-danger cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <FormError message={failure?.message} details={failure?.details} />

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
        <p role="status" aria-live="polite" className="min-h-5 text-[13px] font-medium">
          {saved && !dirty ? (
            <span className="inline-flex items-center gap-1.5 text-success">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Perubahan tersimpan.
            </span>
          ) : dirty ? (
            <span className="text-muted">Ada perubahan yang belum disimpan.</span>
          ) : null}
        </p>
        <div className="flex flex-col-reverse sm:flex-row gap-2">
          {dirty && (
            <button type="button" onClick={reset} disabled={saving} className={BTN_OUTLINE}>
              <Undo2 className="w-4 h-4" />
              Batalkan
            </button>
          )}
          <button type="submit" disabled={!dirty || !!nameError || saving} className={BTN_PRIMARY}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </div>
    </form>
  );
}

/** Tab Brand: nama dan deskripsi brand (dipakai prompt AI) dan daftar topik terlarang. */
export function BrandTab() {
  const { data, error, status, loading, reload, mutate } = useRemote<WorkspaceSettingsResponse>("brand", fetchWorkspaceSettings, LOAD_ERROR);

  if (loading) return <BrandSkeleton />;
  if (!data) return <LoadError message={error ?? LOAD_ERROR} status={status} onRetry={reload} />;
  if (!data.canEdit) return <BrandReadOnly data={data} />;

  return (
    <div className="space-y-4">
      {error && (
        <Banner tone="danger">
          Gagal menyegarkan data: {error}{" "}
          <button type="button" onClick={reload} className="underline font-semibold cursor-pointer">
            Coba lagi
          </button>
        </Banner>
      )}
      {/* Kunci workspace: pindah workspace memasang form baru, bukan membawa isian workspace lama. */}
      <BrandForm key={data.workspaceId} data={data} onSaved={(next) => mutate((d) => ({ ...d, ...next }))} />
    </div>
  );
}
