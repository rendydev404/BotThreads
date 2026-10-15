"use client";

import React, { useId, useLayoutEffect, useState } from "react";
import { Loader2, Package, Pencil, Plus, Save, Star, StarOff, Trash2 } from "lucide-react";
import { deleteAdminPlan, saveAdminPlan, setDefaultPlan } from "@/lib/admin-client";
import { PLAN_DESC_MAX, PLAN_ID_PATTERN, PLAN_NAME_MAX, PLAN_POSTS_MAX, formatRupiah, type PlanDTO } from "@/lib/plan-types";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { ConfirmModal } from "@/components/autopilot/confirm-modal";
import { Banner, ListSkeleton, Segmented, type SegmentedOption } from "@/components/autopilot/shared";
import { ControlLabel, FormError, TextAreaField, TextField } from "@/components/settings/fields";
import { errorText, formatInt } from "@/components/settings/format";
import { BTN_PRIMARY, EmptyState, NotInstalled, Pill, RefreshButton } from "@/components/settings/states";
import {
  ActionMenu,
  AdminLoadError,
  PLANS_SQL_FILE,
  RefreshError,
  Switch,
  sortPlans,
  tidyText,
  useAdmin,
  type MenuAction,
  type PlansRemote,
} from "./shared";

const LOAD_ERROR = "Gagal memuat daftar paket.";
/** Batas yang sama dengan validasi server (plan.ts). */
const PRICE_MAX = 1_000_000_000;
const COUNT_MAX = 1000;
const ORDER_MAX = 999;

const POSTS_OPTIONS: SegmentedOption<number>[] = Array.from({ length: PLAN_POSTS_MAX }, (_, i) => ({ value: i + 1, label: String(i + 1) }));

type SavedPlan = Omit<PlanDTO, "bawaan" | "dipakai">;

/** Hanya angka, dipotong ke `max` digit. */
const digits = (raw: string, max: number): string => raw.replace(/\D/g, "").slice(0, max);
const toInt = (s: string): number | null => (s === "" ? null : Number(s));
const inRange = (n: number | null, min: number, max: number): n is number => n !== null && n >= min && n <= max;
/** Kode paket saat diketik: huruf kecil, spasi menjadi tanda hubung, karakter lain dibuang. */
const tidyCode = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 32);

/* ------------------------------------------------------------------ dialog paket */

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div className="py-2.5 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p id={`${id}-label`} className="text-[13px] font-semibold text-fg">
          {label}
        </p>
        <p id={`${id}-hint`} className="text-xs text-muted leading-relaxed">
          {hint}
        </p>
      </div>
      <Switch checked={checked} onChange={onChange} labelledBy={`${id}-label`} describedBy={`${id}-hint`} disabled={disabled} />
    </div>
  );
}

interface PlanForm {
  id: string;
  nama: string;
  deskripsi: string;
  harga: string;
  maxAkun: string;
  posts: number | null;
  maxAnggota: string;
  modeOtomatis: boolean;
  publik: boolean;
  aktif: boolean;
  urutan: string;
}

/** Paket baru sengaja tanpa angka bawaan: harga dan batasnya keputusan super admin. */
const formOf = (plan: PlanDTO | null): PlanForm => ({
  id: plan?.id ?? "",
  nama: plan?.nama ?? "",
  deskripsi: plan?.deskripsi ?? "",
  harga: plan ? String(plan.hargaBulanan) : "",
  maxAkun: plan ? String(plan.maxAkun) : "",
  posts: plan?.maxPostingPerHari ?? null,
  maxAnggota: plan ? String(plan.maxAnggota) : "",
  modeOtomatis: plan?.modeOtomatis ?? true,
  publik: plan?.publik ?? true,
  aktif: plan?.aktif ?? true,
  urutan: plan ? String(plan.urutan) : "",
});

interface PlanDialogProps {
  /** Paket yang diubah; null = paket baru. */
  plan: PlanDTO | null;
  /** Semua paket yang ada, untuk memperingatkan kode yang sudah dipakai. */
  existing: PlanDTO[];
  onClose: () => void;
  onSaved: (plan: SavedPlan, created: boolean) => void;
}

function PlanDialog({ plan, existing, onClose, onSaved }: PlanDialogProps) {
  const { guard } = useAdmin();
  const [form, setForm] = useState<PlanForm>(() => formOf(plan));
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const formId = useId();

  const update = (part: Partial<PlanForm>) => {
    setForm((prev) => ({ ...prev, ...part }));
    setFailure(null);
  };

  const id = form.id.trim();
  const nama = tidyText(form.nama);
  const deskripsi = tidyText(form.deskripsi);
  const harga = toInt(form.harga);
  const maxAkun = toInt(form.maxAkun);
  const maxAnggota = toInt(form.maxAnggota);
  // Kode yang sama dengan paket lain berarti menimpa paket itu (aturan server), jadi diperingatkan dulu.
  const clash = plan ? null : (existing.find((p) => p.id === id) ?? null);

  const errors = {
    id: PLAN_ID_PATTERN.test(id) ? null : "Kode 2-32 karakter: huruf kecil, angka, atau tanda hubung, diawali huruf atau angka.",
    nama: nama.length >= 2 && nama.length <= PLAN_NAME_MAX ? null : `Nama paket harus 2-${PLAN_NAME_MAX} karakter.`,
    harga: inRange(harga, 0, PRICE_MAX) ? null : `Isi harga per bulan dalam rupiah: 0 untuk gratis, paling banyak ${formatRupiah(PRICE_MAX)}.`,
    maxAkun: inRange(maxAkun, 1, COUNT_MAX) ? null : `Isi 1-${COUNT_MAX}.`,
    posts: form.posts !== null ? null : "Pilih jumlah posting per akun per hari.",
    maxAnggota: inRange(maxAnggota, 1, COUNT_MAX) ? null : `Isi 1-${COUNT_MAX}.`,
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = <K extends keyof typeof errors>(key: K): string | null => (submitted ? errors[key] : null);

  const submit = async () => {
    setSubmitted(true);
    if (busy || invalid || harga === null || maxAkun === null || maxAnggota === null || form.posts === null) return;
    const next: SavedPlan = {
      id,
      nama,
      deskripsi: deskripsi || null,
      hargaBulanan: harga,
      maxAkun,
      maxPostingPerHari: form.posts,
      maxAnggota,
      modeOtomatis: form.modeOtomatis,
      publik: form.publik,
      aktif: form.aktif,
      urutan: toInt(form.urutan) ?? 0,
    };
    setBusy(true);
    setFailure(null);
    try {
      await guard(saveAdminPlan(next));
      onSaved(next, !plan && !clash);
    } catch (e) {
      setFailure(errorText(e, "Gagal menyimpan paket. Coba lagi."));
      setBusy(false);
    }
  };

  const inUse = plan ? plan.dipakai : (clash?.dipakai ?? 0);
  const isDefault = plan ? plan.bawaan : (clash?.bawaan ?? false);

  return (
    <ModalShell
      open
      onClose={onClose}
      busy={busy}
      size="lg"
      title={plan ? "Ubah paket" : "Tambah paket"}
      description={plan ? `${plan.nama} · ${plan.id}` : "Paket baru langsung bisa dipasang ke workspace."}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            Batal
          </ModalButton>
          <ModalButton variant="primary" type="submit" form={formId} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {busy ? "Menyimpan..." : clash ? "Timpa paket" : "Simpan paket"}
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
        {(inUse > 0 || isDefault) && (
          <Banner tone="info">
            Perubahan batas langsung berlaku untuk{" "}
            {[inUse > 0 ? `${formatInt(inUse)} workspace yang memakai paket ini` : null, isDefault ? "semua workspace yang mengikuti paket bawaan" : null]
              .filter(Boolean)
              .join(" dan ")}
            .
          </Banner>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Kode"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            data-autofocus={plan ? undefined : true}
            value={form.id}
            onChange={(v) => update({ id: tidyCode(v) })}
            maxLength={32}
            placeholder="contoh: pro"
            error={show("id")}
            hint={plan ? "Kode tidak bisa diubah setelah paket dibuat." : "Huruf kecil, angka, dan tanda hubung. Tidak bisa diubah nanti."}
            className="font-mono"
            disabled={busy || !!plan}
          />
          <TextField
            label="Nama"
            data-autofocus={plan ? true : undefined}
            value={form.nama}
            onChange={(v) => update({ nama: v })}
            maxLength={PLAN_NAME_MAX}
            showCount
            placeholder="contoh: Pro"
            error={show("nama")}
            disabled={busy}
          />
        </div>

        {clash && (
          <Banner tone="warning">
            Kode <span className="font-mono">{clash.id}</span> sudah dipakai paket {clash.nama}. Menyimpan akan menimpa paket itu dengan isian
            di bawah.
          </Banner>
        )}

        <TextAreaField
          label="Deskripsi"
          rows={2}
          value={form.deskripsi}
          onChange={(v) => update({ deskripsi: v })}
          maxLength={PLAN_DESC_MAX}
          placeholder="Satu kalimat tentang untuk siapa paket ini."
          hint="Opsional. Tampil di halaman perkenalan bila paketnya publik."
          className="min-h-16"
          disabled={busy}
        />

        <TextField
          label="Harga per bulan (rupiah)"
          inputMode="numeric"
          autoComplete="off"
          value={form.harga}
          onChange={(v) => update({ harga: digits(v, 10) })}
          placeholder="0"
          error={show("harga")}
          hint={
            harga === null
              ? "Angka saja tanpa titik. Isi 0 untuk paket gratis / trial. Harga ini langsung berlaku pada halaman sewa paket & perhitungan MRR."
              : `Tampil sebagai ${formatRupiah(harga)}${harga > 0 ? " per bulan" : ""}. Langsung berlaku pada checkout langganan & perhitungan MRR.`
          }
          disabled={busy}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Akun ber-autopilot"
            inputMode="numeric"
            autoComplete="off"
            value={form.maxAkun}
            onChange={(v) => update({ maxAkun: digits(v, 4) })}
            placeholder={`1-${COUNT_MAX}`}
            error={show("maxAkun")}
            hint="Akun Threads yang autopilot-nya boleh menyala bersamaan."
            disabled={busy}
          />
          <TextField
            label="Anggota tim"
            inputMode="numeric"
            autoComplete="off"
            value={form.maxAnggota}
            onChange={(v) => update({ maxAnggota: digits(v, 4) })}
            placeholder={`1-${COUNT_MAX}`}
            error={show("maxAnggota")}
            hint="Termasuk undangan yang belum diterima."
            disabled={busy}
          />
        </div>

        <div>
          <ControlLabel hint="Batas posting otomatis untuk tiap akun dalam sehari.">Posting per akun per hari</ControlLabel>
          <Segmented
            ariaLabel="Posting per akun per hari"
            options={POSTS_OPTIONS}
            value={form.posts}
            onChange={(posts) => update({ posts })}
            disabled={busy}
            className="sm:max-w-sm"
          />
          {show("posts") && (
            <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
              {show("posts")}
            </p>
          )}
        </div>

        <div className="divide-y divide-line border-y border-line">
          <SwitchRow
            label="Mode Otomatis"
            hint="Saat mati, workspace dengan paket ini hanya bisa memakai mode Tinjau dulu."
            checked={form.modeOtomatis}
            onChange={(modeOtomatis) => update({ modeOtomatis })}
            disabled={busy}
          />
          <SwitchRow
            label="Tampil di halaman perkenalan"
            hint="Paket publik ditampilkan ke calon pengguna selama paketnya aktif."
            checked={form.publik}
            onChange={(publik) => update({ publik })}
            disabled={busy}
          />
          <SwitchRow
            label="Aktif"
            hint="Paket nonaktif tidak bisa dipilih untuk workspace atau dijadikan bawaan. Workspace yang sudah memakainya tidak berubah."
            checked={form.aktif}
            onChange={(aktif) => update({ aktif })}
            disabled={busy}
          />
        </div>

        <TextField
          label="Urutan"
          inputMode="numeric"
          autoComplete="off"
          value={form.urutan}
          onChange={(v) => update({ urutan: digits(v, String(ORDER_MAX).length) })}
          placeholder="0"
          hint={`Opsional, 0-${ORDER_MAX}. Angka kecil tampil lebih dulu; kosong berarti 0.`}
          className="sm:max-w-40"
          disabled={busy}
        />

        <FormError message={failure} />
      </form>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ tab */

/** Tindakan yang menunggu konfirmasi. */
type Pending = { kind: "default" | "undefault" | "delete"; plan: PlanDTO };

function Limit({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-[13px] font-semibold text-fg tabular-nums">{value}</dd>
    </div>
  );
}

/** Tab Paket: paket langganan yang didefinisikan super admin, paket bawaan, dan batas tiap paket. */
export function PlansTab({ plans }: { plans: PlansRemote }) {
  const { guard, invalidate } = useAdmin();
  const { data, error, status, loading, refreshing, reload, mutate } = plans;
  const [editing, setEditing] = useState<{ plan: PlanDTO | null } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Tab atau halaman yang disembunyikan (Activity) tidak boleh kembali dengan dialog atau pesan lama.
  useLayoutEffect(
    () => () => {
      setEditing(null);
      setPending(null);
      setNotice(null);
    },
    []
  );

  const intro = (
    <p className="text-sm text-muted max-w-2xl leading-relaxed">
      Kelola paket sewa dan harga bulanan BotThreads secara real-time. Setiap perubahan harga, kuota akun Threads, atau batas posting per hari langsung berlaku di halaman pendaftaran, menu Langganan & Tagihan pelanggan, dan checkout Payment Gateway.
    </p>
  );

  if (loading || (!data && !error)) return <ListSkeleton label="Memuat daftar paket" rows={3} />;
  if (!data) return <AdminLoadError message={error ?? LOAD_ERROR} status={status} onRetry={reload} />;
  if (!data.installed) {
    return (
      <div className="space-y-4">
        {intro}
        <NotInstalled title="Paket langganan belum dipasang." file={PLANS_SQL_FILE} />
      </div>
    );
  }

  const items = data.items;
  const current = items.find((p) => p.bawaan) ?? null;

  const openPending = (next: Pending) => {
    setPendingError(null);
    setPending(next);
  };

  const runPending = async () => {
    if (!pending || busy) return;
    const { kind, plan } = pending;
    setBusy(true);
    setPendingError(null);
    try {
      if (kind === "delete") {
        await guard(deleteAdminPlan(plan.id));
        mutate((d) => ({ ...d, items: d.items.filter((p) => p.id !== plan.id) }));
        setNotice(`Paket ${plan.nama} dihapus.`);
      } else {
        const id = kind === "default" ? plan.id : null;
        await guard(setDefaultPlan(id));
        mutate((d) => ({ ...d, items: d.items.map((p) => ({ ...p, bawaan: p.id === id })) }));
        setNotice(id ? `${plan.nama} sekarang paket bawaan.` : "Paket bawaan dilepas. Workspace tanpa paket sendiri kini tanpa batas.");
      }
      invalidate(["audit"]);
      setPending(null);
    } catch (e) {
      // Penolakan server (mis. paket masih dipakai workspace) ditampilkan apa adanya.
      setPendingError(errorText(e, "Tindakan gagal. Coba lagi."));
    } finally {
      setBusy(false);
    }
  };

  const onSaved = (saved: SavedPlan, created: boolean) => {
    // Server hanya membalas { success: true }; isinya sudah dirapikan dengan aturan yang sama, jadi daftar cukup diperbarui lokal.
    mutate((d) => {
      const prev = d.items.find((p) => p.id === saved.id);
      return {
        ...d,
        items: sortPlans([...d.items.filter((p) => p.id !== saved.id), { ...saved, bawaan: prev?.bawaan ?? false, dipakai: prev?.dipakai ?? 0 }]),
      };
    });
    invalidate(["audit"]);
    setNotice(created ? `Paket ${saved.nama} ditambahkan.` : `Paket ${saved.nama} diperbarui.`);
    setEditing(null);
  };

  const actionsFor = (p: PlanDTO): MenuAction[] => [
    { key: "edit", label: "Ubah", icon: <Pencil className="w-4 h-4" />, onSelect: () => setEditing({ plan: p }) },
    p.bawaan
      ? {
          key: "undefault",
          label: "Lepas sebagai bawaan",
          icon: <StarOff className="w-4 h-4" />,
          onSelect: () => openPending({ kind: "undefault", plan: p }),
        }
      : {
          key: "default",
          label: "Jadikan paket bawaan",
          icon: <Star className="w-4 h-4" />,
          onSelect: () => openPending({ kind: "default", plan: p }),
          disabledReason: p.aktif ? null : "Paket nonaktif tidak bisa menjadi bawaan. Aktifkan dulu.",
        },
    {
      key: "delete",
      label: "Hapus",
      icon: <Trash2 className="w-4 h-4" />,
      danger: true,
      onSelect: () => openPending({ kind: "delete", plan: p }),
    },
  ];

  const copy =
    pending?.kind === "default"
      ? {
          title: `Jadikan ${pending.plan.nama} paket bawaan?`,
          body: `Setiap workspace yang belum punya paket sendiri langsung dibatasi oleh paket ini${
            current ? `, menggantikan ${current.nama}` : ""
          }.`,
          label: "Ya, jadikan bawaan",
          icon: <Star className="w-4 h-4" />,
          danger: true,
        }
      : pending?.kind === "undefault"
        ? {
            title: `Lepas ${pending.plan.nama} sebagai paket bawaan?`,
            body: "Setiap workspace yang belum punya paket sendiri langsung menjadi tanpa batas.",
            label: "Ya, lepas",
            icon: <StarOff className="w-4 h-4" />,
            danger: true,
          }
        : pending?.kind === "delete"
          ? {
              title: `Hapus paket ${pending.plan.nama}?`,
              body: "Paket dihapus permanen. Paket yang masih dipakai workspace atau masih menjadi bawaan tidak bisa dihapus.",
              label: "Ya, hapus",
              icon: <Trash2 className="w-4 h-4" />,
              danger: true,
            }
          : null;

  const addButton = (
    <button type="button" onClick={() => setEditing({ plan: null })} className={BTN_PRIMARY}>
      <Plus className="w-4 h-4" />
      Tambah paket
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        {intro}
        <div className="flex items-center gap-2 ml-auto lg:ml-0 shrink-0">
          <RefreshButton onClick={reload} busy={refreshing} />
          {addButton}
        </div>
      </div>

      <RefreshError error={error} onRetry={reload} />
      {notice && (
        <Banner tone="success" onClose={() => setNotice(null)}>
          {notice}
        </Banner>
      )}

      {items.length === 0 ? (
        <EmptyState icon={<Package className="w-6 h-6" />} title="Belum ada paket." action={addButton}>
          Selama belum ada paket bawaan, semua workspace tanpa batas seperti sebelumnya.
        </EmptyState>
      ) : (
        <>
          <Banner tone="info">
            {current
              ? `Paket bawaan saat ini ${current.nama}: workspace tanpa paket sendiri dibatasi olehnya.`
              : "Belum ada paket bawaan: workspace tanpa paket sendiri tidak dibatasi."}
          </Banner>
          <ul className="card divide-y divide-line">
            {items.map((p) => (
              <li key={p.id} className="p-4 flex items-start gap-3">
                <span className="w-9 h-9 rounded-full bg-subtle text-muted flex items-center justify-center shrink-0" aria-hidden>
                  <Package className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold text-fg break-words min-w-0">{p.nama}</span>
                    {p.bawaan && (
                      <Pill tone="solid" icon={<Star className="w-3.5 h-3.5 shrink-0" />}>
                        Bawaan
                      </Pill>
                    )}
                    <Pill tone={p.publik ? "accent" : "neutral"}>{p.publik ? "Publik" : "Tersembunyi"}</Pill>
                    {!p.aktif && <Pill tone="danger">Nonaktif</Pill>}
                  </div>
                  <p className="text-[11px] font-mono text-faint break-all">{p.id}</p>
                  <p className="text-base font-bold text-fg tabular-nums">
                    {formatRupiah(p.hargaBulanan)}
                    {p.hargaBulanan > 0 && <span className="text-xs font-medium text-muted"> per bulan</span>}
                  </p>
                  {p.deskripsi && <p className="text-[13px] text-muted break-words">{p.deskripsi}</p>}
                  <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-2 pt-0.5">
                    <Limit label="Akun ber-autopilot" value={formatInt(p.maxAkun)} />
                    <Limit label="Posting per akun per hari" value={formatInt(p.maxPostingPerHari)} />
                    <Limit label="Anggota tim" value={formatInt(p.maxAnggota)} />
                    <Limit label="Mode Otomatis" value={p.modeOtomatis ? "Ya" : "Tidak, hanya Tinjau dulu"} />
                  </dl>
                  <p className="text-xs text-muted">
                    {p.dipakai > 0 ? `Dipakai ${formatInt(p.dipakai)} workspace` : "Belum dipakai workspace mana pun"}
                    {p.bawaan ? ", ditambah workspace yang mengikuti paket bawaan" : ""}
                  </p>
                </div>
                <div className="-mr-2 -mt-1.5">
                  <ActionMenu label={`Tindakan untuk paket ${p.nama}`} actions={actionsFor(p)} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {editing && (
        <PlanDialog key={editing.plan?.id ?? "baru"} plan={editing.plan} existing={items} onClose={() => setEditing(null)} onSaved={onSaved} />
      )}

      <ConfirmModal
        open={!!copy}
        onClose={() => setPending(null)}
        onConfirm={runPending}
        busy={busy}
        error={pendingError}
        variant={copy?.danger ? "danger" : "primary"}
        title={copy?.title ?? ""}
        confirmLabel={copy?.label ?? ""}
        confirmIcon={copy?.icon}
      >
        <p className="text-sm text-fg leading-relaxed">{copy?.body}</p>
      </ConfirmModal>
    </div>
  );
}
