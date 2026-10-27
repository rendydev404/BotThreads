"use client";

import React, { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Filter, Search, SlidersHorizontal, Users, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { saveAutopilotBulk, saveAutopilotSettings } from "@/lib/autopilot-client";
import {
  MODE_LABEL,
  pausedText,
  type AutopilotAccountDTO,
  type AutopilotMode,
  type AutopilotOverviewResponse,
  type AutopilotSlotDTO,
} from "@/lib/autopilot-types";
import { ContentApiError } from "@/lib/content-client";
import { REASON_LABEL } from "@/lib/content-types";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { AutopilotSettingsModal } from "./autopilot-settings-modal";
import { ConfirmModal, autoModeWarning } from "./confirm-modal";
import { Dropdown, type DropdownOption } from "./dropdown";
import { useT } from "@/components/i18n/lang-provider";
import { tr } from "@/lib/i18n/core";
import { Banner, Checkbox, HandleText, MODE_ACTIVE_CLASS, Segmented, accountHandle, apiErrorText, type SegmentedOption } from "./shared";
import { SlotTimeline, TimelineLegend, TimelineScale } from "./slot-timeline";

type ModeFilter = "ALL" | AutopilotMode;
type DayKey = "today" | "tomorrow";
interface Feedback {
  tone: "success" | "error";
  text: string;
}

const MODE_FILTERS: DropdownOption<ModeFilter>[] = [
  { value: "ALL", label: "Semua mode" },
  { value: "OTOMATIS", label: MODE_LABEL.OTOMATIS },
  { value: "TINJAU", label: MODE_LABEL.TINJAU },
  { value: "MATI", label: MODE_LABEL.MATI },
];

const DAY_OPTIONS: SegmentedOption<DayKey>[] = [
  { value: "today", label: "Hari ini" },
  { value: "tomorrow", label: "Besok" },
];

const MODES: AutopilotMode[] = ["MATI", "TINJAU", "OTOMATIS"];
const EMPTY_SLOTS: AutopilotSlotDTO[] = [];
const FEEDBACK_MS = 6000;
/** Garis "sekarang" cukup presisi 5 menit; baris tidak perlu render ulang tiap polling. */
const NOW_STEP_MS = 5 * 60_000;

/** Kolom tabel (desktop lebar). Semua lebar tetap kecuali dua kolom fr, jadi kepala dan baris sejajar. */
const TABLE_COLS =
  "xl:grid-cols-[1.25rem_minmax(0,1.5fr)_13.5rem_3.75rem_minmax(11.5rem,1.2fr)_5rem_4.5rem] xl:gap-x-3 xl:items-center";
/**
 * Satu pohon DOM untuk tiga tata letak (tanpa menggandakan baris):
 * - < lg  : kartu bertumpuk (akun + Atur, mode, ringkasan, garis waktu)
 * - lg-xl : dua baris ringkas (akun | mode | Atur, lalu ringkasan | garis waktu)
 * - >= xl : tabel tujuh kolom
 */
const ROW_GRID =
  "grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-2.5 items-start p-3.5 sm:p-4 lg:gap-y-3 lg:max-xl:grid-cols-[1.25rem_minmax(0,1fr)_14rem_4.5rem] lg:max-xl:items-center xl:py-3 xl:gap-y-2";

const BULK_COPY: Record<AutopilotMode, { title: (n: number) => string; body: (n: number, total: number) => string; confirm: string }> = {
  OTOMATIS: {
    title: (n) => tr("Jadikan {n} akun Otomatis?", { n }),
    body: (n, total) =>
      tr(
        "AI akan memposting ke {n} akun tanpa persetujuan per posting, total {total} posting per hari. Anda tetap bisa mengubah atau membatalkan posting di halaman Jadwal.",
        { n, total }
      ),
    confirm: "Ya, jadikan Otomatis",
  },
  TINJAU: {
    title: (n) => tr("Jadikan {n} akun Tinjau dulu?", { n }),
    body: (n, total) =>
      tr(
        "AI akan menulis draf untuk {n} akun, total {total} posting per hari. Setiap draf menunggu persetujuan Anda; yang belum disetujui 15 menit sebelum tayang dilewati.",
        { n, total }
      ),
    confirm: "Ya, jadikan Tinjau dulu",
  },
  MATI: {
    title: (n) => tr("Matikan autopilot {n} akun?", { n }),
    body: (n, total) =>
      tr(
        "Autopilot berhenti menjadwalkan {n} akun, total {total} posting per hari tidak lagi dibuat. Posting yang sudah masuk antrean tetap bisa diubah atau dibatalkan di halaman Jadwal.",
        { n, total }
      ),
    confirm: "Ya, matikan",
  },
};

/* ------------------------------------------------------------------ baris akun */

interface AccountRowProps {
  account: AutopilotAccountDTO;
  slots: AutopilotSlotDTO[];
  dayLabel: string;
  nowMs: number | null;
  selected: boolean;
  savingMode: AutopilotMode | null;
  feedback: Feedback | undefined;
  onToggle: (id: string, next: boolean) => void;
  onMode: (account: AutopilotAccountDTO, mode: AutopilotMode) => void;
  onSettings: (id: string) => void;
}

const AccountRow = memo(function AccountRow({
  account,
  slots,
  dayLabel,
  nowMs,
  selected,
  savingMode,
  feedback,
  onToggle,
  onMode,
  onSettings,
}: AccountRowProps) {
  const t = useT();
  const { config, stats7d } = account;
  const handle = accountHandle(account);
  const pausedRaw = pausedText(config.pausedReason);
  const paused = pausedRaw && t(pausedRaw);
  const mode = savingMode ?? config.mode;
  const compliant = !!stats7d && stats7d.hari > 0 && stats7d.hariPatuh === stats7d.hari;

  const modeOptions: SegmentedOption<AutopilotMode>[] = MODES.map((m) => ({
    value: m,
    label: t(MODE_LABEL[m]),
    activeClass: MODE_ACTIVE_CLASS[m],
    // Akun yang belum siap tidak bisa dinyalakan (server menolaknya); mematikan selalu boleh.
    disabled: !account.ready && m !== "MATI" && m !== config.mode,
    title: !account.ready && m !== "MATI" && m !== config.mode ? t("Akun belum siap diposting") : undefined,
  }));

  return (
    <li className={cn(ROW_GRID, TABLE_COLS, selected && "bg-accent-soft/40")}>
      <div className="pt-2 lg:pt-0 flex">
        <Checkbox checked={selected} onChange={(next) => onToggle(account.id, next)} label={t("Pilih {handle}", { handle })} />
      </div>

      <div className="min-w-0 flex items-start gap-2.5">
        <AccountAvatar name={account.displayName} src={account.avatarUrl} size="w-9 h-9" />
        <div className="min-w-0 leading-tight">
          <p className="text-sm font-semibold text-fg truncate lg:whitespace-normal lg:break-words lg:line-clamp-2" title={handle}>
            <HandleText account={account} />
          </p>
          <p className="text-xs text-muted truncate">{account.outletNama ?? account.displayName}</p>
          {!account.ready && (
            <p className="mt-1 flex items-start gap-1 text-xs font-medium text-muted">
              <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0 text-warning" />
              <span>{t("Belum siap:")} {account.reason ? t(REASON_LABEL[account.reason]) : t("akun belum bisa diposting")}</span>
            </p>
          )}
          {paused && <p className="mt-1 text-xs font-semibold text-warning">{paused}</p>}
        </div>
      </div>

      <Segmented
        ariaLabel={t("Mode autopilot {handle}", { handle })}
        options={modeOptions}
        value={mode}
        busyValue={savingMode}
        disabled={savingMode !== null}
        fit
        onChange={(next) => onMode(account, next)}
        className="max-lg:col-span-full max-lg:row-start-2 sm:max-lg:max-w-md"
      />

      <p className="hidden xl:block text-sm font-semibold text-fg text-center tabular-nums">{config.postsPerDay}</p>

      <div className="min-w-0 max-lg:col-span-full max-lg:row-start-4 max-lg:-mt-1 lg:max-xl:col-start-3 lg:max-xl:col-span-2 lg:max-xl:row-start-2">
        <SlotTimeline slots={slots} dayLabel={dayLabel} nowMs={nowMs} dimmed={config.mode === "MATI"} />
        <TimelineScale className="xl:hidden" />
      </div>

      <p
        className="text-xs text-muted max-lg:col-span-full max-lg:row-start-3 lg:max-xl:col-start-2 lg:max-xl:row-start-2 xl:leading-tight"
        title={
          stats7d
            ? t("7 hari terakhir: {terbit} terbit, {gagal} gagal, {dilewati} dilewati", {
                terbit: stats7d.terbit,
                gagal: stats7d.gagal,
                dilewati: stats7d.dilewati,
              })
            : undefined
        }
      >
        <span className="xl:hidden">
          <span className="font-semibold text-fg tabular-nums">{config.postsPerDay}</span> {t("posting/hari")} ·{" "}
        </span>
        {stats7d ? (
          <>
            <span className={cn("font-semibold tabular-nums", compliant ? "text-success" : "text-fg")}>
              {t("{a}/{b} hari", { a: stats7d.hariPatuh, b: stats7d.hari })}
            </span>{" "}
            <span className="xl:block">{t("≥ 3 posting")}</span>
          </>
        ) : (
          <>
            <span className="xl:hidden">{t("kepatuhan 7 hari:")} </span>-
          </>
        )}
      </p>

      <button
        type="button"
        onClick={() => onSettings(account.id)}
        aria-label={t("Atur autopilot {handle}", { handle })}
        className="max-lg:col-start-3 max-lg:row-start-1 lg:max-xl:col-start-4 lg:max-xl:row-start-1 lg:w-full h-9 lg:h-10 xl:h-9 max-sm:w-9 max-sm:px-0 px-3 rounded-full border border-line-strong text-[13px] font-semibold text-fg inline-flex items-center justify-center gap-1.5 hover:border-accent hover:text-accent transition-colors cursor-pointer"
      >
        <SlidersHorizontal className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
        <span className="max-sm:sr-only">{t("Atur")}</span>
      </button>

      {feedback && (
        <p
          role={feedback.tone === "error" ? "alert" : "status"}
          className={cn(
            "col-span-full flex items-start gap-1.5 text-[13px] font-medium",
            feedback.tone === "success" ? "text-success" : "text-danger"
          )}
        >
          {feedback.tone === "success" ? (
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          )}
          {feedback.text}
        </p>
      )}
    </li>
  );
});

/* ------------------------------------------------------------------ tab */

interface AccountsTabProps {
  data: AutopilotOverviewResponse;
  /** Epoch ms data terakhir diterima (pengganti Date.now() saat render). */
  loadedAt: number | null;
  refetch: () => Promise<void>;
  patch: (fn: (data: AutopilotOverviewResponse) => AutopilotOverviewResponse) => void;
}

interface BulkResult {
  mode: AutopilotMode;
  saved: number;
  skipped: { name: string; error: string }[];
}

export function AccountsTab({ data, loadedAt, refetch, patch }: AccountsTabProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("ALL");
  const [day, setDay] = useState<DayKey>("today");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState<Record<string, AutopilotMode>>({});
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [confirmAuto, setConfirmAuto] = useState<AutopilotAccountDTO | null>(null);
  const [bulkMode, setBulkMode] = useState<AutopilotMode | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<{ message: string; details?: string[] } | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach(clearTimeout);
      map.clear();
    };
  }, []);

  // Halaman yang disembunyikan (pindah rute dengan Cache Components) tidak boleh kembali dengan dialog terbuka.
  useLayoutEffect(
    () => () => {
      setSettingsId(null);
      setConfirmAuto(null);
      setBulkMode(null);
    },
    []
  );

  const showFeedback = useCallback((id: string, next: Feedback) => {
    setFeedback((prev) => ({ ...prev, [id]: next }));
    clearTimeout(timers.current.get(id));
    if (next.tone !== "success") return;
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        setFeedback((prev) => {
          const { [id]: gone, ...rest } = prev;
          void gone;
          return rest;
        });
      }, FEEDBACK_MS)
    );
  }, []);

  const deferredQuery = useDeferredValue(query);
  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase().replace(/^@/, "");
    return data.accounts.filter(
      (a) =>
        (modeFilter === "ALL" || a.config.mode === modeFilter) &&
        (!q ||
          a.username?.toLowerCase().includes(q) ||
          a.displayName.toLowerCase().includes(q) ||
          a.outletNama?.toLowerCase().includes(q))
    );
  }, [data.accounts, deferredQuery, modeFilter]);

  const dayKey = day === "today" ? data.today : data.tomorrow;
  const slotsByAccount = useMemo(() => {
    const map = new Map<string, AutopilotSlotDTO[]>();
    for (const s of data.slots) {
      if (s.dayKey !== dayKey) continue;
      const list = map.get(s.accountId);
      if (list) list.push(s);
      else map.set(s.accountId, [s]);
    }
    for (const list of map.values()) list.sort((a, b) => a.slotAt.localeCompare(b.slotAt));
    return map;
  }, [data.slots, dayKey]);

  const selectedAccounts = useMemo(() => data.accounts.filter((a) => selected.has(a.id)), [data.accounts, selected]);
  const selectedTotal = selectedAccounts.reduce((sum, a) => sum + a.config.postsPerDay, 0);
  const filteredSelected = filtered.filter((a) => selected.has(a.id)).length;
  const allFilteredSelected = filtered.length > 0 && filteredSelected === filtered.length;

  const toggleOne = useCallback((id: string, next: boolean) => {
    setSelected((prev) => {
      const out = new Set(prev);
      if (next) out.add(id);
      else out.delete(id);
      return out;
    });
  }, []);

  const toggleAll = (next: boolean) => {
    setSelected((prev) => {
      const out = new Set(prev);
      for (const a of filtered) {
        if (next) out.add(a.id);
        else out.delete(a.id);
      }
      return out;
    });
  };

  const applyMode = useCallback(
    async (account: AutopilotAccountDTO, mode: AutopilotMode) => {
      const id = account.id;
      setSaving((prev) => ({ ...prev, [id]: mode }));
      try {
        await saveAutopilotSettings(id, { mode });
        // Perubahan lokal dulu supaya baris langsung benar, lalu satu fetch ringkasan untuk slot dan jeda.
        patch((d) => ({
          ...d,
          accounts: d.accounts.map((a) => (a.id === id ? { ...a, config: { ...a.config, mode } } : a)),
        }));
        showFeedback(id, { tone: "success", text: tr("Mode {handle} sekarang {mode}.", { handle: accountHandle(account), mode: tr(MODE_LABEL[mode]) }) });
        await refetch();
      } catch (e) {
        showFeedback(id, { tone: "error", text: e instanceof ContentApiError ? apiErrorText(e.message) : tr("Gagal menyimpan mode. Coba lagi.") });
      } finally {
        setSaving((prev) => {
          const { [id]: gone, ...rest } = prev;
          void gone;
          return rest;
        });
      }
    },
    [patch, refetch, showFeedback]
  );

  const requestMode = useCallback(
    (account: AutopilotAccountDTO, mode: AutopilotMode) => {
      if (mode === account.config.mode) return;
      if (mode === "OTOMATIS") setConfirmAuto(account);
      else void applyMode(account, mode);
    },
    [applyMode]
  );

  const openSettings = useCallback((id: string) => setSettingsId(id), []);

  const runBulk = async () => {
    if (!bulkMode || selectedAccounts.length === 0) return;
    const mode = bulkMode;
    const names = new Map(selectedAccounts.map((a) => [a.id, accountHandle(a)]));
    setBulkBusy(true);
    setBulkError(null);
    try {
      const res = await saveAutopilotBulk([...names.keys()], { mode });
      setBulkResult({
        mode,
        saved: res.saved,
        skipped: res.skipped.map((s) => ({ name: names.get(s.accountId) ?? s.accountId, error: apiErrorText(s.error) })),
      });
      setBulkMode(null);
      setSelected(new Set());
      void refetch();
    } catch (e) {
      setBulkError(
        e instanceof ContentApiError
          ? { message: apiErrorText(e.message), details: e.details?.map(apiErrorText) }
          : { message: tr("Gagal menyimpan perubahan. Coba lagi.") }
      );
    } finally {
      setBulkBusy(false);
    }
  };

  const settingsAccount = settingsId ? (data.accounts.find((a) => a.id === settingsId) ?? null) : null;
  const dayLabel = day === "today" ? t("Hari ini") : t("Besok");
  const nowMs = day === "today" && loadedAt ? Math.floor(loadedAt / NOW_STEP_MS) * NOW_STEP_MS : null;
  const filtering = query.trim() !== "" || modeFilter !== "ALL";

  return (
    <div className="space-y-4">
      {/* Pencarian + filter */}
      <div className="flex flex-col lg:flex-row gap-2.5">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-faint absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Cari @username atau nama cabang")}
            aria-label={t("Cari akun")}
            className="w-full h-12 xl:h-10 pl-10 pr-4 rounded-full bg-surface border border-line-strong text-sm text-fg placeholder-faint outline-none focus:border-accent focus:ring-4 focus:ring-accent/15 transition-colors"
          />
        </div>
        <div className="flex gap-2.5">
          <Dropdown
            ariaLabel={t("Filter mode")}
            value={modeFilter}
            options={MODE_FILTERS}
            onChange={setModeFilter}
            icon={<Filter className="w-4 h-4 text-muted shrink-0" />}
            className="flex-1 min-w-0 lg:w-44 lg:flex-none"
            buttonClassName="h-12 xl:h-10"
          />
          <Segmented
            ariaLabel={t("Hari yang ditampilkan di garis waktu")}
            options={DAY_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))}
            value={day}
            onChange={setDay}
            className="w-36 sm:w-44 shrink-0"
          />
        </div>
      </div>

      {notice && (
        <Banner tone="success" onClose={() => setNotice(null)}>
          {notice}
        </Banner>
      )}
      {bulkResult && (
        <Banner tone={bulkResult.skipped.length ? "warning" : "success"} onClose={() => setBulkResult(null)}>
          <p>
            {t("{n} akun disimpan ke mode {mode}.", { n: bulkResult.saved, mode: t(MODE_LABEL[bulkResult.mode]) })}
            {bulkResult.skipped.length > 0 && ` ${t("{n} akun dilewati:", { n: bulkResult.skipped.length })}`}
          </p>
          {bulkResult.skipped.length > 0 && (
            <ul className="mt-1.5 space-y-1 font-normal">
              {bulkResult.skipped.map((s, i) => (
                <li key={i}>
                  <span className="font-semibold">{s.name}</span>: {s.error}
                </li>
              ))}
            </ul>
          )}
        </Banner>
      )}

      {/* Aksi massal */}
      {selectedAccounts.length > 0 && (
        <div
          role="region"
          aria-label={t("Aksi untuk akun terpilih")}
          className="sticky top-[4.5rem] z-10 card p-3 shadow-pop grid grid-cols-3 gap-2 sm:flex sm:items-center"
        >
          <p className="col-span-2 self-center text-sm font-semibold text-fg sm:flex-1 sm:pl-1">
            {t("{n} akun dipilih", { n: selectedAccounts.length })}
          </p>
          {(
            [
              { mode: "OTOMATIS", label: "Otomatis", cls: "bg-accent text-on-accent hover:bg-accent-hover" },
              { mode: "TINJAU", label: "Tinjau dulu", cls: "bg-accent-soft text-accent hover:bg-accent hover:text-on-accent" },
              { mode: "MATI", label: "Matikan", cls: "bg-danger-soft text-danger hover:bg-danger hover:text-on-accent" },
            ] as const
          ).map((b) => (
            <button
              key={b.mode}
              type="button"
              onClick={() => {
                setBulkError(null);
                setBulkMode(b.mode);
              }}
              className={cn(
                "row-start-2 h-10 px-2 sm:px-4 rounded-full text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer",
                b.cls
              )}
            >
              {b.mode === "OTOMATIS" && <Zap className="w-3.5 h-3.5 shrink-0" />}
              {t(b.label)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="col-start-3 row-start-1 h-10 px-2 sm:px-3 rounded-full text-[13px] font-semibold text-muted inline-flex items-center justify-center gap-1.5 whitespace-nowrap hover:text-fg hover:bg-subtle transition-colors cursor-pointer"
          >
            <X className="hidden sm:block w-3.5 h-3.5 shrink-0" />
            {t("Batal pilih")}
          </button>
        </div>
      )}

      {/* Daftar */}
      {data.accounts.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
            <Users className="w-6 h-6" />
          </div>
          <h3 className="mt-4 text-base font-bold text-fg">{t("Belum ada akun")}</h3>
          <p className="mt-1 text-sm text-muted max-w-sm mx-auto">
            {t("Akun Threads yang bisa Anda kelola akan muncul di sini setelah terhubung di SukaPost.")}
          </p>
        </div>
      ) : (
        <section aria-label={t("Daftar akun autopilot")} data-tour="autopilot-accounts" className="card">
          <div
            className={cn(
              "grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 items-center px-4 py-3 border-b border-line bg-subtle rounded-t-2xl",
              TABLE_COLS
            )}
          >
            <div className="flex">
              <Checkbox
                checked={allFilteredSelected}
                indeterminate={filteredSelected > 0 && !allFilteredSelected}
                onChange={toggleAll}
                disabled={filtered.length === 0}
                label={allFilteredSelected ? t("Batalkan pilihan semua akun yang tampil") : t("Pilih semua akun yang tampil")}
              />
            </div>
            <p className="text-xs font-semibold text-muted">
              <span className="xl:hidden">
                {t("Pilih semua · {shown} dari {total} akun", { shown: filtered.length, total: data.accounts.length })}
              </span>
              <span className="hidden xl:inline uppercase tracking-wide">{t("Akun ({n})", { n: filtered.length })}</span>
            </p>
            <p className="hidden xl:block text-xs font-semibold text-muted uppercase tracking-wide">{t("Mode")}</p>
            <p className="hidden xl:block text-xs font-semibold text-muted uppercase tracking-wide text-center">{t("Per hari")}</p>
            <div className="hidden xl:block min-w-0">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide">{t("Jadwal {day} (WIB)", { day: dayLabel.toLowerCase() })}</p>
              <TimelineScale />
            </div>
            <p className="hidden xl:block text-xs font-semibold text-muted uppercase tracking-wide">{t("7 hari")}</p>
            <span className="hidden xl:block" aria-hidden />
          </div>

          {filtered.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-semibold text-fg">{t("Tidak ada akun yang cocok.")}</p>
              <p className="mt-1 text-sm text-muted">{t("Ubah kata pencarian atau filter mode.")}</p>
              {filtering && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setModeFilter("ALL");
                  }}
                  className="mt-4 h-10 px-5 rounded-full border border-line-strong text-sm font-semibold text-fg hover:border-accent hover:text-accent transition-colors cursor-pointer"
                >
                  {t("Hapus filter")}
                </button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {filtered.map((a) => (
                <AccountRow
                  key={a.id}
                  account={a}
                  slots={slotsByAccount.get(a.id) ?? EMPTY_SLOTS}
                  dayLabel={dayLabel}
                  nowMs={nowMs}
                  selected={selected.has(a.id)}
                  savingMode={saving[a.id] ?? null}
                  feedback={feedback[a.id]}
                  onToggle={toggleOne}
                  onMode={requestMode}
                  onSettings={openSettings}
                />
              ))}
            </ul>
          )}

          <div className="px-4 py-3 border-t border-line">
            <TimelineLegend />
          </div>
        </section>
      )}

      {/* Konfirmasi mode Otomatis (satu akun) */}
      <ConfirmModal
        open={confirmAuto !== null}
        onClose={() => setConfirmAuto(null)}
        onConfirm={() => {
          const account = confirmAuto;
          setConfirmAuto(null);
          if (account) void applyMode(account, "OTOMATIS");
        }}
        title={t("Aktifkan mode Otomatis?")}
        confirmLabel={t("Ya, aktifkan Otomatis")}
        confirmIcon={<Zap className="w-4 h-4" />}
      >
        {confirmAuto && (
          <p className="text-sm text-fg leading-relaxed">
            {autoModeWarning(accountHandle(confirmAuto), confirmAuto.config.postsPerDay)}
          </p>
        )}
      </ConfirmModal>

      {/* Konfirmasi aksi massal */}
      <ConfirmModal
        open={bulkMode !== null}
        onClose={() => setBulkMode(null)}
        onConfirm={runBulk}
        busy={bulkBusy}
        error={bulkError?.message}
        details={bulkError?.details}
        variant={bulkMode === "MATI" ? "danger" : "primary"}
        title={bulkMode ? BULK_COPY[bulkMode].title(selectedAccounts.length) : ""}
        confirmLabel={bulkMode ? t(BULK_COPY[bulkMode].confirm) : ""}
      >
        {bulkMode && (
          <>
            <p className="text-sm text-fg leading-relaxed">{BULK_COPY[bulkMode].body(selectedAccounts.length, selectedTotal)}</p>
            <ul className="mt-3 max-h-56 overflow-y-auto overscroll-contain rounded-xl border border-line divide-y divide-line">
              {selectedAccounts.map((a) => (
                <li key={a.id} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
                  <AccountAvatar name={a.displayName} src={a.avatarUrl} size="w-6 h-6" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-fg truncate">{accountHandle(a)}</span>
                    {bulkMode !== "MATI" && !a.ready && (
                      <span className="block text-xs font-medium text-warning">{t("Belum siap diposting, akan dilewati")}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-muted tabular-nums">{t("{n} per hari", { n: a.config.postsPerDay })}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </ConfirmModal>

      <AutopilotSettingsModal
        account={settingsAccount}
        maxPostsPerDay={data.limits.maxPostsPerDay}
        onClose={() => setSettingsId(null)}
        onSaved={(account) => {
          setSettingsId(null);
          setNotice(tr("Pengaturan autopilot {handle} disimpan.", { handle: accountHandle(account) }));
          void refetch();
        }}
      />
    </div>
  );
}
