"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, CalendarClock, Loader2, Minus, Plus, Save, Trash2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { BriefExpandButton } from "@/components/ai/brief-editor";
import { previewAutopilotPlan, saveAutopilotSettings } from "@/lib/autopilot-client";
import {
  ACTIVE_FIRST_HOUR,
  ACTIVE_LAST_HOUR,
  BRIEF_MAX_CHARS,
  MODE_LABEL,
  POSTS_PER_DAY_MAX,
  POSTS_PER_DAY_MIN,
  VOICE_STYLES,
  pausedText,
  type AutopilotAccountDTO,
  type AutopilotConfigDTO,
  type AutopilotMode,
  type AutopilotPillar,
  type AutopilotSettings,
  type PlanPreviewResponse,
  type SlotStrategy,
  type VoiceStyle,
} from "@/lib/autopilot-types";
import { ContentApiError } from "@/lib/content-client";
import { REASON_LABEL } from "@/lib/content-types";
import { DEFAULT_SLOT_HOURS } from "@/lib/scheduling";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { ConfirmModal, autoModeWarning } from "./confirm-modal";
import { Dropdown, type DropdownOption } from "./dropdown";
import { Banner, DAY_LABELS, Segmented, SlotKindChip, accountHandle, dayKeyLabel, dowOfDayKey, pad2 } from "./shared";

const PREVIEW_DEBOUNCE_MS = 400;
const MAX_PILLARS = 8;
const FIXED_MIN = 3;
const FIXED_MAX = 6;
const GAP_CHOICES = [120, 150, 180, 240];
const EXPLORE_CHOICES = [0, 0.1, 0.15, 0.2, 0.3];
const MODES: AutopilotMode[] = ["MATI", "TINJAU", "OTOMATIS"];
const HOURS = Array.from({ length: ACTIVE_LAST_HOUR - ACTIVE_FIRST_HOUR + 1 }, (_, i) => ACTIVE_FIRST_HOUR + i);

const MODE_INFO: Record<AutopilotMode, string> = {
  MATI: "Tidak ada yang dijadwalkan.",
  TINJAU: "AI menulis, Anda menyetujui. Yang tidak disetujui 15 menit sebelum tayang dilewati.",
  OTOMATIS: "AI menulis dan langsung menjadwalkan.",
};

const STRATEGIES: { value: SlotStrategy; label: string }[] = [
  { value: "JAM_RAMAI", label: "Jam ramai (otomatis dari data)" },
  { value: "JAM_TETAP", label: "Jam tetap" },
];

const SOURCE_NOTE: Record<PlanPreviewResponse["source"], string> = {
  account: "Dari data jam ramai akun ini",
  network: "Data akun belum cukup, memakai jam ramai jaringan",
  none: "Belum ada data jam, memakai jam bawaan",
};

type VoiceChoice = VoiceStyle | "auto";
const VOICE_OPTIONS: DropdownOption<VoiceChoice>[] = [
  { value: "auto", label: "Ikuti gaya akun (otomatis)", hint: "Mengikuti gaya sapaan dari postingan akun." },
  ...(Object.keys(VOICE_STYLES) as VoiceStyle[]).map((key) => ({
    value: key,
    label: VOICE_STYLES[key].label,
    hint: VOICE_STYLES[key].hint,
  })),
];

interface PillarRow {
  id: number;
  key: string;
  bobot: string;
}

interface FormState {
  mode: AutopilotMode;
  postsPerDay: number;
  slotStrategy: SlotStrategy;
  fixedHours: number[];
  minGapMinutes: number;
  activeDays: number[];
  exploreRate: number;
  voiceStyle: VoiceStyle | null;
  brief: string;
  pillars: PillarRow[];
}

const sortNumbers = (list: number[]): number[] => [...new Set(list)].sort((a, b) => a - b);
const sameNumbers = (a: number[], b: number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
const cleanKey = (s: string): string => s.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
const cleanBrief = (s: string): string | null => s.replace(/\s+/g, " ").trim() || null;

/** Sama dengan batas server: posting per hari yang muat di jendela tayang dengan jeda tertentu. */
const maxPostsForGap = (gap: number): number => Math.floor(((ACTIVE_LAST_HOUR - ACTIVE_FIRST_HOUR) * 60) / gap) + 1;

const gapHint = (minutes: number): string => {
  const hours = minutes / 60;
  return `${String(hours).replace(".", ",")} jam`;
};

const toForm = (c: AutopilotConfigDTO): FormState => ({
  mode: c.mode,
  postsPerDay: c.postsPerDay,
  slotStrategy: c.slotStrategy,
  fixedHours: sortNumbers(c.fixedHours),
  minGapMinutes: c.minGapMinutes,
  activeDays: sortNumbers(c.activeDays),
  exploreRate: c.exploreRate,
  voiceStyle: c.voiceStyle,
  brief: c.brief ?? "",
  pillars: c.pillars.map((p, i) => ({ id: i, key: p.key, bobot: String(p.bobot) })),
});

/** Baris pilar yang namanya kosong diabaikan (dianggap belum diisi). */
const toPillars = (rows: PillarRow[]): AutopilotPillar[] =>
  rows.filter((r) => cleanKey(r.key)).map((r) => ({ key: cleanKey(r.key), bobot: Number(r.bobot) }));

function pillarError(rows: PillarRow[]): string | null {
  const seen = new Set<string>();
  for (const r of rows) {
    const key = cleanKey(r.key);
    if (!key) continue;
    if (key.length < 2 || key.length > 40) return "Nama kategori harus 2-40 karakter.";
    if (seen.has(key.toLowerCase())) return "Nama kategori tidak boleh berulang.";
    seen.add(key.toLowerCase());
    const bobot = Number(r.bobot);
    if (!r.bobot || !Number.isInteger(bobot) || bobot < 1 || bobot > 100) return "Porsi kategori harus bilangan 1-100.";
  }
  return null;
}

/** Validasi lokal untuk field yang memengaruhi jadwal (pesannya sama dengan server). */
function planError(form: FormState): string | null {
  if (form.activeDays.length === 0) return "Pilih minimal satu hari aktif.";
  if (form.slotStrategy === "JAM_TETAP") {
    const hours = form.fixedHours;
    if (hours.length < FIXED_MIN || hours.length > FIXED_MAX) return `Pilih ${FIXED_MIN} sampai ${FIXED_MAX} jam tetap.`;
    for (let i = 1; i < hours.length; i++) {
      if ((hours[i] - hours[i - 1]) * 60 < form.minGapMinutes) {
        return `Jarak antar jam tetap minimal ${form.minGapMinutes} menit.`;
      }
    }
    return null;
  }
  const max = maxPostsForGap(form.minGapMinutes);
  if (form.postsPerDay > max) return `Dengan jeda ${form.minGapMinutes} menit, paling banyak ${max} posting per hari.`;
  return null;
}

/** Hanya field yang berubah; field tersembunyi untuk strategi yang tidak dipakai tidak ikut dikirim. */
function buildPatch(initial: AutopilotConfigDTO, form: FormState): Partial<AutopilotSettings> {
  const patch: Partial<AutopilotSettings> = {};
  if (form.mode !== initial.mode) patch.mode = form.mode;
  if (form.slotStrategy !== initial.slotStrategy) patch.slotStrategy = form.slotStrategy;
  if (form.minGapMinutes !== initial.minGapMinutes) patch.minGapMinutes = form.minGapMinutes;
  if (!sameNumbers(form.activeDays, sortNumbers(initial.activeDays))) patch.activeDays = form.activeDays;
  if (form.slotStrategy === "JAM_TETAP") {
    if (!sameNumbers(form.fixedHours, sortNumbers(initial.fixedHours))) patch.fixedHours = form.fixedHours;
  } else {
    if (form.postsPerDay !== initial.postsPerDay) patch.postsPerDay = form.postsPerDay;
    if (form.exploreRate !== initial.exploreRate) patch.exploreRate = form.exploreRate;
  }
  if (form.voiceStyle !== initial.voiceStyle) patch.voiceStyle = form.voiceStyle;
  const brief = cleanBrief(form.brief);
  if (brief !== (initial.brief ?? null)) patch.brief = brief;
  const pillars = toPillars(form.pillars);
  const before = initial.pillars.map((p) => ({ key: p.key, bobot: p.bobot }));
  if (JSON.stringify(pillars) !== JSON.stringify(before)) patch.pillars = pillars;
  return patch;
}

/** Bagian pengaturan yang menentukan jam tayang; kuncinya memicu pratinjau. */
function planSettings(form: FormState): Partial<AutopilotSettings> {
  return form.slotStrategy === "JAM_TETAP"
    ? {
        slotStrategy: "JAM_TETAP",
        fixedHours: form.fixedHours,
        minGapMinutes: form.minGapMinutes,
        activeDays: form.activeDays,
      }
    : {
        slotStrategy: "JAM_RAMAI",
        postsPerDay: form.postsPerDay,
        minGapMinutes: form.minGapMinutes,
        activeDays: form.activeDays,
        exploreRate: form.exploreRate,
      };
}

const CHIP =
  "h-10 rounded-lg border text-[13px] font-semibold tabular-nums inline-flex items-center justify-center transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed";
const CHIP_ON = "bg-accent text-on-accent border-accent";
const CHIP_OFF = "bg-surface text-fg border-line-strong hover:border-accent hover:text-accent";
const FIELD =
  "h-10 px-3 rounded-xl border border-line-strong bg-surface text-sm text-fg placeholder-faint outline-none focus:border-accent focus:ring-4 focus:ring-accent/15 transition-colors";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (labelId: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <p id={id} className="text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
        {label}
      </p>
      {children(id)}
      {hint && <p className="mt-1.5 text-xs text-muted leading-relaxed">{hint}</p>}
    </div>
  );
}

interface PreviewState {
  key: string;
  res: PlanPreviewResponse | null;
  error: { message: string; validation: boolean } | null;
}

interface DialogProps {
  account: AutopilotAccountDTO;
  maxPostsPerDay: number;
  onClose: () => void;
  onSaved: (account: AutopilotAccountDTO) => void;
}

function SettingsDialog({ account, maxPostsPerDay, onClose, onSaved }: DialogProps) {
  // Nilai awal dikunci saat dialog dibuka: polling ringkasan di belakang tidak menimpa isian.
  const [initial] = useState(() => account.config);
  const [form, setForm] = useState<FormState>(() => toForm(account.config));
  const [preview, setPreview] = useState<PreviewState>({ key: "", res: null, error: null });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const nextPillarId = useRef(account.config.pillars.length);
  const firstPreview = useRef(true);

  const handle = accountHandle(account);
  const fixed = form.slotStrategy === "JAM_TETAP";
  const gapMax = maxPostsForGap(form.minGapMinutes);
  const postsMax = Math.max(POSTS_PER_DAY_MIN, Math.min(POSTS_PER_DAY_MAX, maxPostsPerDay, gapMax));
  const postsPerDay = fixed ? form.fixedHours.length : form.postsPerDay;

  const planIssue = planError(form);
  const pillarIssue = pillarError(form.pillars);
  const planKey = JSON.stringify(planSettings(form));
  const previewCurrent = preview.key === planKey;
  const previewLoading = !planIssue && !previewCurrent;
  const serverIssue = !planIssue && previewCurrent && preview.error?.validation ? preview.error.message : null;

  const update = (part: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...part }));
    setSaveError(null);
  };

  // Pratinjau jam besok: ditunda 400 ms, permintaan sebelumnya dibatalkan, dan hanya dipanggil saat
  // field penentu jadwal berubah (mengetik tema atau pilar tidak memicu permintaan).
  const accountId = account.id;
  useEffect(() => {
    if (planIssue) return;
    const ctrl = new AbortController();
    const delay = firstPreview.current ? 0 : PREVIEW_DEBOUNCE_MS;
    firstPreview.current = false;
    const timer = setTimeout(() => {
      previewAutopilotPlan(accountId, JSON.parse(planKey) as Partial<AutopilotSettings>, ctrl.signal)
        .then((res) => {
          if (!ctrl.signal.aborted) setPreview({ key: planKey, res, error: null });
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          const validation = e instanceof ContentApiError && e.status === 400;
          setPreview({
            key: planKey,
            res: null,
            error: { message: e instanceof Error ? e.message : "Pratinjau gagal dimuat.", validation },
          });
        });
    }, delay);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [accountId, planKey, planIssue]);

  const setStrategy = (next: SlotStrategy) => {
    if (next === form.slotStrategy) return;
    if (next === "JAM_RAMAI") {
      update({ slotStrategy: next, postsPerDay: Math.min(Math.max(form.postsPerDay, POSTS_PER_DAY_MIN), postsMax) });
      return;
    }
    // Belum pernah memilih jam tetap: mulai dari jam pratinjau terakhir (atau jam bawaan) supaya tidak kosong.
    const fromPreview = sortNumbers((preview.res?.slots ?? []).map((s) => s.hour)).filter(
      (h) => h >= ACTIVE_FIRST_HOUR && h <= ACTIVE_LAST_HOUR
    );
    const usable = planError({ ...form, slotStrategy: "JAM_TETAP", fixedHours: fromPreview }) === null;
    const seed = usable ? fromPreview : sortNumbers(DEFAULT_SLOT_HOURS);
    update({ slotStrategy: next, fixedHours: form.fixedHours.length ? form.fixedHours : seed });
  };

  const toggleHour = (hour: number) => {
    const has = form.fixedHours.includes(hour);
    update({ fixedHours: has ? form.fixedHours.filter((h) => h !== hour) : sortNumbers([...form.fixedHours, hour]) });
  };

  const toggleDay = (dayIndex: number) => {
    const has = form.activeDays.includes(dayIndex);
    update({ activeDays: has ? form.activeDays.filter((d) => d !== dayIndex) : sortNumbers([...form.activeDays, dayIndex]) });
  };

  const setGap = (minutes: number) => {
    update({ minGapMinutes: minutes, postsPerDay: Math.min(form.postsPerDay, Math.max(POSTS_PER_DAY_MIN, maxPostsForGap(minutes))) });
  };

  const setPillar = (id: number, part: Partial<PillarRow>) => {
    update({ pillars: form.pillars.map((p) => (p.id === id ? { ...p, ...part } : p)) });
  };

  const addPillar = () => {
    const id = nextPillarId.current++;
    update({ pillars: [...form.pillars, { id, key: "", bobot: "50" }] });
  };

  const save = async () => {
    const patch = buildPatch(initial, form);
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await saveAutopilotSettings(account.id, patch);
      onSaved(account);
    } catch (e) {
      setSaveError(e instanceof ContentApiError ? e.message : "Gagal menyimpan pengaturan. Coba lagi.");
      setSaving(false);
    }
  };

  const submit = () => {
    if (saving || planIssue || pillarIssue || serverIssue) return;
    if (form.mode === "OTOMATIS" && initial.mode !== "OTOMATIS") {
      setConfirmAuto(true);
      return;
    }
    void save();
  };

  const gapOptions: DropdownOption<number>[] = sortNumbers([...GAP_CHOICES, form.minGapMinutes, initial.minGapMinutes]).map(
    (m) => ({ value: m, label: `${m} menit`, hint: gapHint(m) })
  );
  const exploreOptions = EXPLORE_CHOICES.map((rate) => ({ value: rate, label: `${Math.round(rate * 100)}%` }));
  const pillarTotal = form.pillars.reduce((sum, p) => (cleanKey(p.key) ? sum + (Number(p.bobot) || 0) : sum), 0);
  const blocked = !!planIssue || !!pillarIssue || !!serverIssue;
  const paused = pausedText(initial.pausedReason);
  const tomorrowOff =
    preview.res && preview.res.slots.length === 0 && !form.activeDays.includes(dowOfDayKey(preview.res.dayKey));

  return (
    <>
      <ModalShell
        open
        onClose={onClose}
        busy={saving}
        size="lg"
        title="Atur autopilot"
        description={`${handle}${account.outletNama ? ` · ${account.outletNama}` : ""}`}
        footer={
          <>
            <ModalButton onClick={onClose} disabled={saving}>
              Batal
            </ModalButton>
            <ModalButton variant="primary" onClick={submit} disabled={saving || blocked}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? "Menyimpan..." : "Simpan"}
            </ModalButton>
            {saveError && (
              <p role="alert" className="sm:order-first sm:mr-auto flex items-start gap-1.5 text-[13px] font-medium text-danger">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {saveError}
              </p>
            )}
          </>
        }
      >
        <div className="space-y-5">
          {(!account.ready || paused) && (
            <Banner tone="warning">
              {!account.ready && (
                <p>
                  Akun belum siap diposting{account.reason ? ` (${REASON_LABEL[account.reason]})` : ""}. Autopilot baru bisa
                  dinyalakan setelah akun siap.
                </p>
              )}
              {paused && <p>{paused}</p>}
            </Banner>
          )}

          <Field label="Mode">
            {(labelId) => (
              <div role="group" aria-labelledby={labelId} className="grid gap-2 sm:grid-cols-3">
                {MODES.map((m) => {
                  const active = form.mode === m;
                  const locked = !account.ready && m !== "MATI" && m !== initial.mode;
                  return (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={active}
                      disabled={locked}
                      title={locked ? "Akun belum siap diposting" : undefined}
                      onClick={() => update({ mode: m })}
                      className={cn(
                        "min-h-14 p-3 rounded-xl border text-left transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed",
                        active ? "border-accent bg-accent-soft" : "border-line-strong bg-surface hover:border-accent"
                      )}
                    >
                      <span className={cn("flex items-center gap-1.5 text-sm font-semibold", active ? "text-accent" : "text-fg")}>
                        {m === "OTOMATIS" && <Zap className="w-3.5 h-3.5 shrink-0" />}
                        {MODE_LABEL[m]}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted leading-snug">{MODE_INFO[m]}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          <Field label="Jam tayang">
            {(labelId) => (
              <div className="space-y-3">
                <div role="group" aria-labelledby={labelId} className="grid gap-1 p-1 rounded-xl bg-subtle sm:grid-cols-2">
                  {STRATEGIES.map((s) => {
                    const active = form.slotStrategy === s.value;
                    return (
                      <button
                        key={s.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setStrategy(s.value)}
                        className={cn(
                          "h-10 px-3 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer",
                          active ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
                        )}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>

                {fixed ? (
                  <div>
                    <div role="group" aria-label="Jam tetap (WIB)" className="grid grid-cols-6 sm:grid-cols-9 gap-1.5">
                      {HOURS.map((h) => {
                        const on = form.fixedHours.includes(h);
                        const tooClose = form.fixedHours.some((s) => s !== h && Math.abs(s - h) * 60 < form.minGapMinutes);
                        const full = form.fixedHours.length >= FIXED_MAX;
                        return (
                          <button
                            key={h}
                            type="button"
                            aria-pressed={on}
                            aria-label={`Jam ${pad2(h)}.00`}
                            disabled={!on && (full || tooClose)}
                            title={!on && tooClose ? `Terlalu dekat dengan jam lain (jeda ${form.minGapMinutes} menit)` : undefined}
                            onClick={() => toggleHour(h)}
                            className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}
                          >
                            {pad2(h)}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      Pilih {FIXED_MIN} sampai {FIXED_MAX} jam (WIB). Posting per hari:{" "}
                      <span className="font-semibold text-fg tabular-nums">{postsPerDay}</span>, mengikuti jumlah jam.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="inline-flex items-center gap-1 rounded-xl border border-line-strong p-1">
                      <button
                        type="button"
                        aria-label="Kurangi posting per hari"
                        disabled={form.postsPerDay <= POSTS_PER_DAY_MIN}
                        onClick={() => update({ postsPerDay: form.postsPerDay - 1 })}
                        className="w-10 h-10 rounded-lg inline-flex items-center justify-center text-fg hover:bg-subtle cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span aria-live="polite" className="w-10 text-center text-base font-bold text-fg tabular-nums">
                        {form.postsPerDay}
                      </span>
                      <button
                        type="button"
                        aria-label="Tambah posting per hari"
                        disabled={form.postsPerDay >= postsMax}
                        onClick={() => update({ postsPerDay: form.postsPerDay + 1 })}
                        className="w-10 h-10 rounded-lg inline-flex items-center justify-center text-fg hover:bg-subtle cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-sm text-muted">
                      posting per hari
                      <span className="block text-xs">
                        {POSTS_PER_DAY_MIN} sampai {postsMax}
                        {postsMax < POSTS_PER_DAY_MAX &&
                          (gapMax < Math.min(POSTS_PER_DAY_MAX, maxPostsPerDay)
                            ? ` (dibatasi jeda ${form.minGapMinutes} menit)`
                            : " (batas dashboard)")}
                      </span>
                    </p>
                  </div>
                )}
              </div>
            )}
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Jeda minimal antar posting">
              {() => (
                <Dropdown
                  ariaLabel="Jeda minimal antar posting"
                  value={form.minGapMinutes}
                  options={gapOptions}
                  onChange={setGap}
                />
              )}
            </Field>

            {!fixed && (
              <Field
                label="Eksplorasi jam baru"
                hint="Sesekali mencoba jam yang jarang dipakai supaya data jam ramai terus bertambah."
              >
                {() => (
                  <Segmented
                    ariaLabel="Porsi eksplorasi jam baru"
                    options={exploreOptions}
                    value={form.exploreRate}
                    onChange={(rate) => update({ exploreRate: rate })}
                  />
                )}
              </Field>
            )}
          </div>

          <Field label="Hari aktif">
            {(labelId) => (
              <div role="group" aria-labelledby={labelId} className="grid grid-cols-7 gap-1.5">
                {DAY_LABELS.map((label, dayIndex) => {
                  const on = form.activeDays.includes(dayIndex);
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleDay(dayIndex)}
                      className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          {/* Pratinjau jam besok */}
          <section aria-label="Pratinjau jadwal besok" className="rounded-xl border border-line bg-subtle p-3.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-bold text-fg">
                <CalendarClock className="w-4 h-4 text-accent" />
                Jadwal besok
                {preview.res && <span className="text-xs font-medium text-muted">{dayKeyLabel(preview.res.dayKey)}</span>}
              </h3>
              {previewLoading && <Loader2 className="w-4 h-4 text-muted animate-spin" aria-label="Memuat pratinjau" />}
            </div>

            {planIssue || serverIssue ? (
              <p role="alert" className="mt-2 flex items-start gap-1.5 text-[13px] font-medium text-danger">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {planIssue ?? serverIssue}
              </p>
            ) : previewCurrent && preview.error ? (
              <p className="mt-2 text-[13px] text-muted">Pratinjau belum bisa dimuat: {preview.error.message}</p>
            ) : preview.res ? (
              <div className={cn("mt-2.5 transition-opacity", previewLoading && "opacity-50")}>
                {preview.res.slots.length === 0 ? (
                  <p className="text-[13px] text-muted">
                    {tomorrowOff
                      ? "Besok bukan hari aktif, jadi tidak ada posting yang dijadwalkan."
                      : "Tidak ada jam yang muat untuk besok dengan pengaturan ini."}
                  </p>
                ) : (
                  <>
                    <ul className="space-y-2">
                      {preview.res.slots.map((s) => (
                        <li key={s.slotAt} className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span className="text-sm font-bold text-fg tabular-nums">
                            {pad2(s.hour)}.{pad2(s.minute)} WIB
                          </span>
                          <SlotKindChip kind={s.kind} className="bg-surface" />
                          <span className="basis-full text-xs text-muted">{s.reason}</span>
                        </li>
                      ))}
                    </ul>
                    {/* Jam tetap dipilih pengguna, jadi catatan asal data jam hanya untuk strategi jam ramai. */}
                    {!fixed && <p className="mt-2.5 text-xs text-muted">{SOURCE_NOTE[preview.res.source]}</p>}
                  </>
                )}
                {form.mode === "MATI" && (
                  <p className="mt-1 text-xs text-muted">Mode masih Mati: jadwal ini baru dipakai setelah autopilot dinyalakan.</p>
                )}
              </div>
            ) : (
              // Kerangka setinggi hasil nyata (satu baris per posting) supaya isi di bawahnya tidak melompat.
              <div className="mt-2.5 animate-pulse" aria-hidden>
                <div className="space-y-2">
                  {Array.from({ length: Math.max(postsPerDay, 1) }, (_, i) => (
                    <div key={i} className="space-y-1">
                      <div className="h-6 w-36 rounded bg-line" />
                      <div className="h-4 w-3/4 rounded bg-line" />
                    </div>
                  ))}
                </div>
                <div className="mt-2.5 h-4 w-1/2 rounded bg-line" />
              </div>
            )}
          </section>

          <Field label="Gaya sapaan">
            {() => (
              <Dropdown<VoiceChoice>
                ariaLabel="Gaya sapaan"
                value={form.voiceStyle ?? "auto"}
                options={VOICE_OPTIONS}
                onChange={(next) => update({ voiceStyle: next === "auto" ? null : next })}
              />
            )}
          </Field>

          <Field
            label="Peran & tema akun (Profil AI)"
            hint="Berlaku untuk SEMUA fitur AI akun ini (Studio AI, edit dengan AI, Autopilot, balas komentar), sama dengan Profil AI di halaman Akun Threads. AI juga memakainya untuk mencari tren di niche akun. Bila kosong, niche disimpulkan dari postingan akun."
          >
            {(labelId) => (
              <div className="rounded-xl border border-line-strong bg-surface transition-colors focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15">
                <textarea
                  aria-labelledby={labelId}
                  value={form.brief}
                  onChange={(e) => update({ brief: e.target.value })}
                  rows={8}
                  maxLength={BRIEF_MAX_CHARS}
                  placeholder="Contoh: akun cabang dekat kampus, audiensnya mahasiswa. Bahas menu andalan, suasana makan bareng, dan cerita ringan seputar cabang. Hindari bahasa yang terlalu formal."
                  className="w-full resize-y bg-transparent border-0 px-3.5 pt-3 pb-1 text-sm leading-relaxed text-fg placeholder-faint outline-none focus:outline-none focus-visible:outline-none focus:ring-0"
                />
                <div className="flex items-center justify-between gap-2 pl-2 pr-3.5 pb-2 text-xs">
                  <BriefExpandButton value={form.brief} onChange={(brief) => update({ brief })} maxLength={BRIEF_MAX_CHARS} />
                  <span
                    aria-live="polite"
                    className={cn(
                      "font-semibold tabular-nums",
                      form.brief.length >= BRIEF_MAX_CHARS ? "text-danger" : form.brief.length > BRIEF_MAX_CHARS * 0.9 ? "text-warning" : "text-muted"
                    )}
                  >
                    {form.brief.length}/{BRIEF_MAX_CHARS}
                  </span>
                </div>
              </div>
            )}
          </Field>

          <Field
            label="Kategori topik (opsional)"
            hint={`Maksimal ${MAX_PILLARS} kategori. Angka di sebelah nama menentukan seberapa sering kategori itu dipakai dibanding yang lain; persentasenya dihitung otomatis. Baris tanpa nama diabaikan.`}
          >
            {() => (
              <div className="space-y-2">
                {form.pillars.map((p, index) => {
                  const counted = cleanKey(p.key) !== "";
                  const share = counted && pillarTotal > 0 ? Math.round(((Number(p.bobot) || 0) / pillarTotal) * 100) : null;
                  return (
                    <div key={p.id} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={p.key}
                        onChange={(e) => setPillar(p.id, { key: e.target.value })}
                        maxLength={40}
                        placeholder="Nama kategori, mis. Tips & trik"
                        aria-label={`Nama kategori ${index + 1}`}
                        className={cn(FIELD, "flex-1 min-w-0")}
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        value={p.bobot}
                        onChange={(e) => setPillar(p.id, { bobot: e.target.value.replace(/\D/g, "").slice(0, 3) })}
                        placeholder="1-100"
                        aria-label={`Porsi kategori ${index + 1} (1 sampai 100)`}
                        className={cn(FIELD, "w-16 px-2 text-center tabular-nums")}
                      />
                      <span className="w-10 shrink-0 text-right text-xs font-semibold text-muted tabular-nums" aria-label="Persentase kategori">
                        {share === null ? "-" : `${share}%`}
                      </span>
                      <button
                        type="button"
                        onClick={() => update({ pillars: form.pillars.filter((row) => row.id !== p.id) })}
                        aria-label={`Hapus kategori ${index + 1}`}
                        className="w-10 h-10 shrink-0 rounded-lg inline-flex items-center justify-center text-muted hover:text-danger hover:bg-danger-soft transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
                {pillarIssue && (
                  <p role="alert" className="text-xs font-medium text-danger">
                    {pillarIssue}
                  </p>
                )}
                <button
                  type="button"
                  onClick={addPillar}
                  disabled={form.pillars.length >= MAX_PILLARS}
                  className="h-10 px-4 rounded-full border border-line-strong text-[13px] font-semibold text-fg inline-flex items-center gap-1.5 hover:border-accent hover:text-accent transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Tambah kategori
                </button>
              </div>
            )}
          </Field>
        </div>
      </ModalShell>

      <ConfirmModal
        open={confirmAuto}
        onClose={() => setConfirmAuto(false)}
        onConfirm={() => {
          setConfirmAuto(false);
          void save();
        }}
        title="Aktifkan mode Otomatis?"
        confirmLabel="Ya, aktifkan Otomatis"
        confirmIcon={<Zap className="w-4 h-4" />}
      >
        <p className="text-sm text-fg leading-relaxed">{autoModeWarning(handle, postsPerDay)}</p>
      </ConfirmModal>
    </>
  );
}

interface AutopilotSettingsModalProps {
  /** null = tertutup. */
  account: AutopilotAccountDTO | null;
  maxPostsPerDay: number;
  onClose: () => void;
  onSaved: (account: AutopilotAccountDTO) => void;
}

/** Pengaturan autopilot satu akun, dengan pratinjau jam tayang besok yang mengikuti isian. */
export function AutopilotSettingsModal({ account, maxPostsPerDay, onClose, onSaved }: AutopilotSettingsModalProps) {
  if (!account) return null;
  return <SettingsDialog key={account.id} account={account} maxPostsPerDay={maxPostsPerDay} onClose={onClose} onSaved={onSaved} />;
}
