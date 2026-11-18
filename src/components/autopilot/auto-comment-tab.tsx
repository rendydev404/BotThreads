"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ExternalLink, Info, Lightbulb, Loader2, MessageSquareText, Minus, Play, Plus, RotateCw, Save, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DAILY_CAP_MAX,
  KEYWORDS_MAX,
  KEYWORD_MAX_CHARS,
  KEYWORD_MIN_CHARS,
  POST_AGE_MAX,
  POST_AGE_MIN,
  COOLDOWN_MAX,
  COOLDOWN_MIN,
  SLOTS_MAX,
  WS_GAP_MAX,
  WS_GAP_MIN,
  normalizeSlot,
  type AutoCommentConfig,
  type AutoCommentMode,
  type TargetStatus,
} from "@/lib/auto-comment-rules";
import type { AutoCommentAccountDTO, AutoCommentItemDTO, AutoCommentOverview } from "@/lib/auto-comment-service";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { MONTH_SHORT } from "@/components/settings/format";
import { wibParts } from "@/lib/scheduling";
import { useT } from "@/components/i18n/lang-provider";
import { tr } from "@/lib/i18n/core";
import { Banner, ListSkeleton, LoadMoreButton, MODE_ACTIVE_CLASS, Segmented, Switch, accountHandle, apiErrorText, pad2 } from "./shared";

const API = "/api/autopilot/auto-comment";
const RANK = { VIEWER: 0, EDITOR: 1, ADMIN: 2, OWNER: 3 } as const;

async function call<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, signal, cache: "no-store", headers: { "Content-Type": "application/json" } });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? "Permintaan gagal.");
  return body;
}

const errText = (err: unknown, fallback: string) => (err instanceof Error ? apiErrorText(err.message) : tr(fallback));

/** "19 Okt, 09.05 WIB" dari timestamp database (UTC tanpa zona). */
function whenText(raw: string | null): string {
  if (!raw) return "-";
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`);
  if (Number.isNaN(d.getTime())) return "-";
  const p = wibParts(d);
  return `${p.d} ${tr(MONTH_SHORT[p.m])}, ${pad2(p.h)}.${pad2(p.min)} WIB`;
}

/** Alasan dari server: alasan AI diawali "AI: " (teks bebas), selebihnya kalimat tetap yang diterjemahkan. */
function reasonText(reason: string | null | undefined): string {
  if (!reason) return "";
  return reason.startsWith("AI: ") ? `${tr("Dilewati AI:")} ${reason.slice(4)}` : tr(reason);
}

const MODE_OPTIONS: { value: AutoCommentMode; label: string }[] = [
  { value: "MATI", label: "Mati" },
  { value: "TINJAU", label: "Tinjau dulu" },
  { value: "OTOMATIS", label: "Otomatis" },
];

const STATUS: Record<TargetStatus, { label: string; cls: string }> = {
  DILEWATI: { label: "Dilewati", cls: "bg-subtle text-muted" },
  DRAF: { label: "Menunggu tinjau", cls: "bg-warning-soft text-warning" },
  DITOLAK: { label: "Ditolak", cls: "bg-subtle text-muted" },
  MENGIRIM: { label: "Mengirim", cls: "bg-accent-soft text-accent" },
  TERKIRIM: { label: "Terkirim", cls: "bg-success-soft text-success" },
  GAGAL: { label: "Gagal", cls: "bg-danger-soft text-danger" },
};

const FILTERS: { value: TargetStatus | "SEMUA"; label: string }[] = [
  { value: "SEMUA", label: "Semua" },
  { value: "TERKIRIM", label: "Terkirim" },
  { value: "DRAF", label: "Menunggu tinjau" },
  { value: "DILEWATI", label: "Dilewati" },
  { value: "GAGAL", label: "Gagal" },
  { value: "DITOLAK", label: "Ditolak" },
];

const inputCls =
  "h-10 rounded-xl border border-line-strong bg-surface px-3 text-sm text-fg focus:outline-none focus:border-accent disabled:opacity-60";
const btnCls =
  "h-10 px-4 rounded-full text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

function Stat({ label, value, tone }: { label: string; value: number; tone?: "success" | "danger" | "warning" }) {
  return (
    <div className="p-3 sm:p-4 min-w-0 flex flex-col items-center text-center">
      <p className="text-[11px] sm:text-xs font-semibold text-muted leading-tight line-clamp-2">{label}</p>
      <p
        className={cn(
          "mt-auto pt-1 text-lg sm:text-2xl font-bold tabular-nums leading-tight",
          tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-fg"
        )}
      >
        {value}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ bantuan tampilan */

/** Pilihan cepat jam: label waktu sehari-hari lebih mudah dipilih daripada mengetik jam. */
const PRESETS: { slot: string; label: string }[] = [
  { slot: "07:40", label: "Pagi" },
  { slot: "12:20", label: "Siang" },
  { slot: "16:50", label: "Sore" },
  { slot: "19:35", label: "Malam" },
];

const MODE_HELP: Record<AutoCommentMode, string> = {
  MATI: "Akun ini tidak berkomentar.",
  TINJAU: "AI menyiapkan draf komentar, lalu Anda menyetujuinya sebelum terkirim.",
  OTOMATIS: "Komentar yang lolos pemeriksaan langsung terkirim atas nama akun ini.",
};

/** Catatan putaran yang berarti "belum ketemu postingan yang pas": beri saran yang bisa langsung dilakukan. */
const EMPTY_NOTES = new Set(["Semua kandidat dilewati karena tidak cocok dikomentari.", "Tidak ada postingan baru yang cocok."]);

const slotText = (s: string) => s.replace(":", ".");

/** Jam berjalan berikutnya (WIB); besok bila semua jam hari ini sudah lewat. */
function nextSlot(slots: string[], now = new Date()): { slot: string; tomorrow: boolean } | null {
  if (!slots.length) return null;
  const p = wibParts(now);
  const cur = `${pad2(p.h)}:${pad2(p.min)}`;
  const sorted = [...slots].sort();
  const later = sorted.find((s) => s > cur);
  return later ? { slot: later, tomorrow: false } : { slot: sorted[0], tomorrow: true };
}

function Chip({ children, onRemove, removeLabel, disabled }: { children: React.ReactNode; onRemove?: () => void; removeLabel: string; disabled?: boolean }) {
  return (
    <span className={cn("h-9 pl-3.5 rounded-full bg-accent-soft text-sm font-medium text-accent inline-flex items-center gap-1 max-w-full", onRemove ? "pr-1" : "pr-3.5")}>
      <span className="truncate tabular-nums">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={removeLabel}
          className="w-7 h-7 rounded-full inline-flex items-center justify-center text-accent hover:text-danger hover:bg-surface cursor-pointer disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </span>
  );
}

function Dot({ tone }: { tone: "success" | "warning" | "muted" }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block w-2 h-2 rounded-full shrink-0", tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-line-strong")}
    />
  );
}

/** Satu pertanyaan bernomor di kartu akun: orang awam cukup menjawab 1, 2, 3 dari atas ke bawah. */
function Question({ no, title, hint, children }: { no: number; title: string; hint?: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2.5">
        <span className="w-6 h-6 shrink-0 rounded-full bg-accent text-on-accent text-xs font-bold inline-flex items-center justify-center tabular-nums">{no}</span>
        <p className="text-sm font-semibold text-fg">{t(title)}</p>
      </div>
      {hint && <p className="mt-1 pl-[34px] text-xs text-muted leading-relaxed">{t(hint)}</p>}
      <div className="mt-2.5 pl-[34px]">{children}</div>
    </div>
  );
}

async function saveWorkspace(config: AutoCommentConfig): Promise<AutoCommentConfig> {
  const res = await call<{ config: AutoCommentConfig }>("/settings", {
    method: "POST",
    body: JSON.stringify({
      scope: "workspace",
      aktif: config.aktif,
      gapMinutes: config.gapMinutes,
      cooldownDays: config.cooldownDays,
      maxPostAgeHours: config.maxPostAgeHours,
      blockList: config.blockList,
    }),
  });
  return res.config;
}

/* ------------------------------------------------------------------ status utama */

/** Kartu paling atas: satu saklar untuk semua akun dan angka 7 hari, supaya status terbaca sekilas. */
function StatusCard({ data, canAdmin, onSaved }: { data: AutoCommentOverview; canAdmin: boolean; onSaved: (c: AutoCommentConfig) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = data.config.aktif;
  const activeAccounts = data.accounts.filter((a) => a.mode !== "MATI").length;

  const toggle = async (aktif: boolean) => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveWorkspace({ ...data.config, aktif }));
    } catch (err) {
      setError(errText(err, "Gagal menyimpan."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={t("Status Auto Komentar")} className="card overflow-hidden">
      <div className={cn("p-4 sm:p-5 flex items-center gap-3.5", on && "bg-gradient-to-r from-accent-soft to-transparent")}>
        <span className={cn("w-11 h-11 shrink-0 rounded-2xl inline-flex items-center justify-center", on ? "bg-accent text-on-accent" : "bg-subtle text-muted")}>
          <MessageSquareText className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-fg">{on ? t("Auto Komentar menyala") : t("Auto Komentar mati")}</p>
          <p className="text-[13px] text-muted leading-relaxed">
            {on
              ? activeAccounts
                ? t("{n} akun ikut berkomentar sesuai jadwalnya.", { n: activeAccounts })
                : t("Belum ada akun yang ikut. Pilih mode di kartu akun di bawah.")
              : canAdmin
                ? t("Nyalakan saklar ini supaya akun-akun mulai berkomentar.")
                : t("Hanya Admin atau Pemilik yang bisa menyalakannya.")}
          </p>
        </div>
        <Switch on={on} busy={busy} disabled={!canAdmin} label={t("Saklar Auto Komentar workspace")} onChange={(v) => void toggle(v)} />
      </div>
      {error && (
        <Banner tone="danger" className="mx-4 mb-4">
          {error}
        </Banner>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line border-t border-line [&>*]:bg-surface">
        <Stat label={t("Terkirim")} value={data.counts.terkirim7} tone="success" />
        <Stat label={t("Menunggu Anda")} value={data.counts.draf} tone={data.counts.draf ? "warning" : undefined} />
        <Stat label={t("Dilewati")} value={data.counts.dilewati7} />
        <Stat label={t("Gagal")} value={data.counts.gagal7} tone={data.counts.gagal7 ? "danger" : undefined} />
      </div>
      <p className="px-4 py-2 border-t border-line text-[11px] text-muted text-center">{t("Angka 7 hari terakhir")}</p>
    </section>
  );
}

/* ------------------------------------------------------------------ aturan lanjutan */

function AdvancedRules({ config, canAdmin, onSaved }: { config: AutoCommentConfig; canAdmin: boolean; onSaved: (c: AutoCommentConfig) => void }) {
  const t = useT();
  const [form, setForm] = useState({
    gapMinutes: String(config.gapMinutes),
    cooldownDays: String(config.cooldownDays),
    maxPostAgeHours: String(config.maxPostAgeHours),
    blockList: config.blockList.join("\n"),
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const saved = await saveWorkspace({
        ...config,
        gapMinutes: Number(form.gapMinutes),
        cooldownDays: Number(form.cooldownDays),
        maxPostAgeHours: Number(form.maxPostAgeHours),
        blockList: form.blockList.split(/[\s,]+/).filter(Boolean),
      });
      onSaved(saved);
      setForm((f) => ({ ...f, blockList: saved.blockList.join("\n") }));
      setMsg({ tone: "success", text: tr("Aturan disimpan.") });
    } catch (err) {
      setMsg({ tone: "danger", text: errText(err, "Gagal menyimpan.") });
    } finally {
      setBusy(false);
    }
  };

  const num = (key: "gapMinutes" | "cooldownDays" | "maxPostAgeHours", label: string, hint: string, min: number, max: number) => (
    <label className="block min-w-0">
      <span className="text-xs font-semibold text-fg">{t(label)}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={form[key]}
        disabled={!canAdmin || busy}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className={cn(inputCls, "mt-1 w-full tabular-nums")}
      />
      <span className="mt-1 block text-[11px] text-muted">{t(hint, { min, max })}</span>
    </label>
  );

  return (
    <details className="card group">
      <summary className="list-none [&::-webkit-details-marker]:hidden p-4 flex items-center gap-3 cursor-pointer select-none">
        <Settings2 className="w-5 h-5 text-muted shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg">{t("Aturan lanjutan")}</p>
          <p className="text-xs text-muted">{t("Opsional. Pengaturan bawaan sudah aman untuk sebagian besar akun.")}</p>
        </div>
        <ChevronDown className="w-4 h-4 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4 pt-4 space-y-4 border-t border-line">
        <p className="text-[13px] text-muted leading-relaxed">
          {t(
            "Berlaku untuk semua akun. Satu postingan hanya pernah menerima satu komentar dari akun BotThreads mana pun, dan penulis yang sudah dikomentari tidak disasar lagi selama masa jeda."
          )}
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          {num("gapMinutes", "Jeda antar-komentar (menit)", "Minimal {min}, maksimal {max}.", WS_GAP_MIN, WS_GAP_MAX)}
          {num("cooldownDays", "Jeda per penulis (hari)", "Minimal {min}, maksimal {max}.", COOLDOWN_MIN, COOLDOWN_MAX)}
          {num("maxPostAgeHours", "Umur postingan maksimal (jam)", "Minimal {min}, maksimal {max}.", POST_AGE_MIN, POST_AGE_MAX)}
        </div>
        <label className="block">
          <span className="text-xs font-semibold text-fg">{t("Jangan pernah komentari akun ini (satu username per baris)")}</span>
          <textarea
            rows={3}
            value={form.blockList}
            disabled={!canAdmin || busy}
            onChange={(e) => setForm((f) => ({ ...f, blockList: e.target.value }))}
            placeholder="@pesaing&#10;@akun_lain"
            className="mt-1 w-full rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent disabled:opacity-60"
          />
        </label>
        {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">{t("Jeda per akun tetap minimal 30 menit.")}</p>
          {canAdmin ? (
            <button type="button" onClick={() => void save()} disabled={busy} className={cn(btnCls, "bg-accent text-on-accent hover:bg-accent-hover")}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {t("Simpan aturan")}
            </button>
          ) : (
            <p className="text-xs text-muted">{t("Hanya Admin atau Pemilik yang bisa mengubah aturan ini.")}</p>
          )}
        </div>
      </div>
    </details>
  );
}

/* ------------------------------------------------------------------ kartu akun */

function AccountCard({
  account,
  canEdit,
  canAdmin,
  defaultOpen,
  onSaved,
  onRan,
}: {
  account: AutoCommentAccountDTO;
  canEdit: boolean;
  canAdmin: boolean;
  defaultOpen: boolean;
  onSaved: (a: AutoCommentAccountDTO) => void;
  onRan: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const [mode, setMode] = useState<AutoCommentMode>(account.mode);
  const [slots, setSlots] = useState<string[]>(account.slots);
  const [keywords, setKeywords] = useState<string[]>(account.keywords);
  const [cap, setCap] = useState(account.dailyCap);
  const [slotInput, setSlotInput] = useState("");
  const [kwInput, setKwInput] = useState("");
  const [busy, setBusy] = useState<"save" | "run" | "mode" | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);
  const bodyId = `acmt-${account.id}`;

  // Mengubah akun yang Otomatis (atau menjadikannya Otomatis) hanya Admin/Pemilik; server menegakkan hal yang sama.
  const locked = !canEdit || (!canAdmin && (account.mode === "OTOMATIS" || mode === "OTOMATIS"));
  const fieldsDirty = cap !== account.dailyCap || slots.join() !== account.slots.join() || keywords.join("\n") !== account.keywords.join("\n");
  const dirty = fieldsDirty || mode !== account.mode;

  const addSlot = (raw: string) => {
    const s = normalizeSlot(raw);
    if (!s) return setMsg({ tone: "danger", text: tr("Jam harus berformat JJ:MM (00:00 sampai 23:59).") });
    if (slots.includes(s)) return;
    if (slots.length >= SLOTS_MAX) return setMsg({ tone: "danger", text: tr("Paling banyak 12 jam per hari.") });
    setMsg(null);
    setSlots([...slots, s].sort());
    setSlotInput("");
  };
  const addKeyword = () => {
    const kw = kwInput.replace(/\s+/g, " ").trim();
    if ([...kw].length < KEYWORD_MIN_CHARS || [...kw].length > KEYWORD_MAX_CHARS) {
      return setMsg({ tone: "danger", text: tr("Kata kunci 2-60 karakter.") });
    }
    if (keywords.some((k) => k.toLowerCase() === kw.toLowerCase())) return setKwInput("");
    if (keywords.length >= KEYWORDS_MAX) return setMsg({ tone: "danger", text: tr("Paling banyak 20 kata kunci.") });
    setMsg(null);
    setKeywords([...keywords, kw]);
    setKwInput("");
  };

  const persist = async (nextMode: AutoCommentMode, kind: "save" | "mode"): Promise<boolean> => {
    setBusy(kind);
    setMsg(null);
    try {
      await call("/settings", {
        method: "POST",
        body: JSON.stringify({ scope: "account", accountId: account.id, mode: nextMode, slots, keywords, dailyCap: cap }),
      });
      onSaved({ ...account, mode: nextMode, slots, keywords, dailyCap: cap });
      setMsg({ tone: "success", text: kind === "mode" ? tr(MODE_HELP[nextMode]) : tr("Pengaturan akun disimpan.") });
      return true;
    } catch (err) {
      setMsg({ tone: "danger", text: errText(err, "Gagal menyimpan.") });
      return false;
    } finally {
      setBusy(null);
    }
  };

  // Mode langsung tersimpan saat dipilih (tanpa tombol Simpan terpisah); gagal = kembali ke mode lama.
  // Akun yang topik/jamnya belum diisi tidak bisa dinyalakan server: tahan modenya, buka kartu, dan arahkan
  // pengguna mengisi dulu (tombol Simpan menyimpan mode sekaligus), bukannya menampilkan galat.
  const changeMode = async (next: AutoCommentMode) => {
    const prev = mode;
    setMode(next);
    if (next !== "MATI" && (!keywords.length || !slots.length)) {
      setOpen(true);
      setMsg({ tone: "info", text: tr("Isi topik dan jam di bawah, lalu tekan Simpan untuk menyalakannya.") });
      return;
    }
    if (!(await persist(next, "mode"))) setMode(prev);
  };

  const run = async () => {
    setBusy("run");
    setMsg(null);
    try {
      const res = await call<{ note: string; outcome: string }>("/run", { method: "POST", body: JSON.stringify({ accountId: account.id }) });
      setMsg({ tone: res.outcome === "TERKIRIM" || res.outcome === "DRAF" ? "success" : "info", text: tr(res.note) });
      onRan();
    } catch (err) {
      setMsg({ tone: "danger", text: errText(err, "Gagal menjalankan.") });
    } finally {
      setBusy(null);
    }
  };

  const handle = accountHandle(account);
  const next = nextSlot(account.slots);
  const savedIncomplete = !account.keywords.length || !account.slots.length;
  const status =
    account.mode === "MATI"
      ? { tone: "muted" as const, text: t("Mati, tidak berkomentar") }
      : savedIncomplete || !next
        ? { tone: "warning" as const, text: t("Belum lengkap: isi topik dan jam") }
        : {
            tone: account.mode === "OTOMATIS" ? ("success" as const) : ("warning" as const),
            text: `${
              next.tomorrow ? t("Berikutnya besok {slot}", { slot: slotText(next.slot) }) : t("Berikutnya {slot} WIB", { slot: slotText(next.slot) })
            } · ${t("{used}/{cap} hari ini", { used: account.usedToday, cap: account.dailyCap })}`,
          };
  const emptyRun = account.lastNote ? EMPTY_NOTES.has(account.lastNote) || account.lastNote.startsWith("AI: ") : false;
  const toggleBtnCls = "hidden sm:inline-flex h-10 px-3 rounded-full text-[13px] font-semibold text-muted hover:text-fg hover:bg-subtle items-center gap-1 cursor-pointer";

  return (
    <li className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
        >
          <AccountAvatar name={account.displayName} src={account.avatarUrl} size="w-10 h-10" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-fg truncate">{handle}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted tabular-nums min-w-0">
              <Dot tone={status.tone} />
              <span className="truncate">{status.text}</span>
            </span>
          </span>
          <ChevronDown className={cn("w-4 h-4 text-muted shrink-0 transition-transform sm:hidden", open && "rotate-180")} />
        </button>
        <Segmented
          ariaLabel="Mode Auto Komentar"
          options={MODE_OPTIONS.map((o) => ({
            ...o,
            activeClass: MODE_ACTIVE_CLASS[o.value],
            disabled: !canEdit || (o.value === "OTOMATIS" && !canAdmin) || (!canAdmin && account.mode === "OTOMATIS"),
            title: o.value === "OTOMATIS" && !canAdmin ? "Hanya Admin atau Pemilik yang bisa menyalakan mode Otomatis." : undefined,
          }))}
          value={mode}
          busyValue={busy === "mode" ? mode : null}
          disabled={busy !== null}
          onChange={(v) => void changeMode(v)}
          fit
          className="w-full sm:w-auto"
        />
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={bodyId} className={toggleBtnCls}>
          {open ? t("Tutup") : t("Atur")}
          <ChevronDown className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {!open && msg && (
        <Banner tone={msg.tone} onClose={() => setMsg(null)} className="mt-3">
          {msg.text}
        </Banner>
      )}

      {open && (
        <div id={bodyId} className="mt-4 space-y-5">
          <p className="text-[13px] text-muted">{t(MODE_HELP[mode])}</p>
          {msg?.tone === "info" && (
            <Banner tone="info" onClose={() => setMsg(null)}>
              {msg.text}
            </Banner>
          )}

          <Question
            no={1}
            title="Topik apa yang mau dikomentari?"
            hint="Pakai 2-3 kata yang spesifik, mis. “belajar coding”. Kata yang terlalu umum lebih sering menemukan balasan orang, bukan postingan."
          >
            <div className="flex flex-wrap gap-2">
              {keywords.length === 0 && <span className="text-sm text-muted">{t("Belum ada topik.")}</span>}
              {keywords.map((k) => (
                <Chip key={k} disabled={locked} removeLabel={t("Hapus kata kunci {kw}", { kw: k })} onRemove={locked ? undefined : () => setKeywords(keywords.filter((x) => x !== k))}>
                  {k}
                </Chip>
              ))}
            </div>
            {!locked && (
              <form
                className="mt-2.5 flex gap-2 max-w-md"
                onSubmit={(e) => {
                  e.preventDefault();
                  addKeyword();
                }}
              >
                <input
                  value={kwInput}
                  maxLength={KEYWORD_MAX_CHARS}
                  onChange={(e) => setKwInput(e.target.value)}
                  placeholder={t("Ketik topik, mis. kopi susu")}
                  aria-label={t("Kata kunci baru")}
                  className={cn(inputCls, "flex-1 min-w-0")}
                />
                <button type="submit" disabled={!kwInput.trim()} className={cn(btnCls, "border border-line-strong text-fg hover:border-accent hover:text-accent")}>
                  <Plus className="w-4 h-4" />
                  {t("Tambah")}
                </button>
              </form>
            )}
          </Question>

          <Question no={2} title="Kapan akun ini berkomentar?" hint="Tiap jam menghasilkan paling banyak satu komentar. Waktu WIB.">
            <div className="flex flex-wrap gap-2">
              {slots.length === 0 && <span className="text-sm text-muted">{t("Belum ada jam.")}</span>}
              {slots.map((s) => (
                <Chip key={s} disabled={locked} removeLabel={t("Hapus jam {slot}", { slot: s })} onRemove={locked ? undefined : () => setSlots(slots.filter((x) => x !== s))}>
                  {slotText(s)}
                </Chip>
              ))}
            </div>
            {!locked && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {PRESETS.filter((p) => !slots.includes(p.slot)).map((p) => (
                  <button
                    key={p.slot}
                    type="button"
                    onClick={() => addSlot(p.slot)}
                    className="h-9 px-3 rounded-full border border-dashed border-line-strong text-[13px] text-fg hover:border-accent hover:text-accent cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t(p.label)} <span className="text-muted tabular-nums">{slotText(p.slot)}</span>
                  </button>
                ))}
                <span className="inline-flex items-center gap-1.5">
                  <input
                    type="time"
                    step={60}
                    value={slotInput}
                    onChange={(e) => setSlotInput(e.target.value)}
                    aria-label={t("Jam lain")}
                    className={cn(inputCls, "h-9 w-[7.5rem] tabular-nums")}
                  />
                  <button
                    type="button"
                    onClick={() => addSlot(slotInput)}
                    disabled={!slotInput}
                    className={cn(btnCls, "h-9 px-3 border border-line-strong text-fg hover:border-accent hover:text-accent")}
                  >
                    {t("Tambah jam")}
                  </button>
                </span>
              </div>
            )}
          </Question>

          <Question no={3} title="Paling banyak berapa komentar per hari?" hint="Sedikit tapi relevan terlihat lebih alami. Draf yang menunggu persetujuan ikut dihitung.">
            <div className="inline-flex items-center rounded-full border border-line-strong">
              <button
                type="button"
                aria-label={t("Kurangi")}
                disabled={locked || cap <= 1}
                onClick={() => setCap((c) => Math.max(1, c - 1))}
                className="w-10 h-10 rounded-full inline-flex items-center justify-center text-fg hover:bg-subtle cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="w-10 text-center text-base font-bold text-fg tabular-nums" aria-live="polite">
                {cap}
              </span>
              <button
                type="button"
                aria-label={t("Tambah")}
                disabled={locked || cap >= DAILY_CAP_MAX}
                onClick={() => setCap((c) => Math.min(DAILY_CAP_MAX, c + 1))}
                className="w-10 h-10 rounded-full inline-flex items-center justify-center text-fg hover:bg-subtle cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </Question>

          {account.lastNote && (
            <div className="rounded-xl bg-subtle p-3.5 flex items-start gap-2.5 text-[13px]">
              {emptyRun ? <Lightbulb className="w-4 h-4 mt-0.5 text-warning shrink-0" /> : <Info className="w-4 h-4 mt-0.5 text-muted shrink-0" />}
              <div className="min-w-0 space-y-0.5">
                <p className="text-xs text-muted">{t("Terakhir dicek {when}", { when: whenText(account.lastRunAt) })}</p>
                <p className="text-fg">{reasonText(account.lastNote)}</p>
                {emptyRun && <p className="text-muted">{t("Saran: ganti atau tambah topik yang lebih spesifik, lalu coba lagi.")}</p>}
              </div>
            </div>
          )}
          {msg && msg.tone !== "info" && (
            <Banner tone={msg.tone} onClose={() => setMsg(null)}>
              {msg.text}
            </Banner>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2">
            {dirty && <p className="text-xs text-warning sm:mr-auto">{t("Ada perubahan yang belum disimpan.")}</p>}
            <button
              type="button"
              onClick={() => void run()}
              disabled={!canEdit || busy !== null || account.mode === "MATI" || dirty || savedIncomplete}
              title={dirty ? t("Simpan perubahan dulu.") : account.mode === "MATI" ? t("Pilih mode Tinjau dulu atau Otomatis.") : undefined}
              className={cn(btnCls, "border border-line-strong text-fg hover:border-accent hover:text-accent")}
            >
              {busy === "run" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {t("Coba sekarang")}
            </button>
            {!locked && (
              <button
                type="button"
                onClick={() => void persist(mode, "save")}
                disabled={busy !== null || !dirty}
                className={cn(btnCls, "bg-accent text-on-accent hover:bg-accent-hover")}
              >
                {busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {t("Simpan")}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ antrean tinjau */

function PostLink({ href, label }: { href: string | null | undefined; label: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
      {label} <ExternalLink className="w-3 h-3" />
    </a>
  );
}

function QueueItem({ item, handle, canEdit, onDone }: { item: AutoCommentItemDTO; handle: string; canEdit: boolean; onDone: (id: string, status: TargetStatus) => void }) {
  const t = useT();
  const [text, setText] = useState(item.replyText ?? "");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: "approve" | "reject") => {
    setBusy(action);
    setError(null);
    try {
      const res = await call<{ status: TargetStatus }>("/review", { method: "POST", body: JSON.stringify({ id: item.id, action, text }) });
      onDone(item.id, res.status);
    } catch (err) {
      setError(errText(err, "Gagal memproses draf."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span className="font-semibold text-fg">{handle}</span>
        <span>→ @{item.authorUsername}</span>
        {item.keyword && <span>· {t("kata kunci")} “{item.keyword}”</span>}
        <span className="tabular-nums">· {whenText(item.createdAt)}</span>
        <PostLink href={item.permalink} label={t("Postingan asli")} />
      </div>
      <p className="text-sm text-fg bg-subtle rounded-xl p-3 break-words">{item.excerpt}</p>
      <label className="block">
        <span className="sr-only">{t("Teks komentar")}</span>
        <textarea
          rows={2}
          maxLength={280}
          value={text}
          disabled={!canEdit || busy !== null}
          onChange={(e) => setText(e.target.value)}
          className="w-full rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent disabled:opacity-60"
        />
      </label>
      {error && <Banner tone="danger">{error}</Banner>}
      {canEdit && (
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => void act("reject")} disabled={busy !== null} className={cn(btnCls, "border border-line-strong text-fg hover:border-danger hover:text-danger")}>
            {busy === "reject" ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
            {t("Tolak")}
          </button>
          <button
            type="button"
            onClick={() => void act("approve")}
            disabled={busy !== null || !text.trim()}
            className={cn(btnCls, "bg-accent text-on-accent hover:bg-accent-hover")}
          >
            {busy === "approve" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {text.trim() !== (item.replyText ?? "").trim() ? t("Simpan & kirim") : t("Setujui & kirim")}
          </button>
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ riwayat */

function History({ active, handles, version }: { active: boolean; handles: Map<string, string>; version: number }) {
  const t = useT();
  const [filter, setFilter] = useState<TargetStatus | "SEMUA">("SEMUA");
  const [items, setItems] = useState<AutoCommentItemDTO[] | null>(null);
  const [next, setNext] = useState<{ at: string; id: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  type Page = { items: AutoCommentItemDTO[]; next: { at: string; id: string } | null };
  const fetchPage = useCallback(
    (cursor: { at: string; id: string } | null, signal?: AbortSignal) => {
      const qs = new URLSearchParams();
      if (filter !== "SEMUA") qs.set("status", filter);
      if (cursor) {
        qs.set("before", cursor.at);
        qs.set("beforeId", cursor.id);
      }
      return call<Page>(`/history?${qs}`, undefined, signal);
    },
    [filter]
  );

  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    fetchPage(null, ctrl.signal)
      .then((res) => {
        if (ctrl.signal.aborted) return;
        setItems(res.items);
        setNext(res.next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) setError(errText(err, "Riwayat gagal dimuat."));
      });
    return () => ctrl.abort();
  }, [active, fetchPage, version]);

  const more = async () => {
    if (!next) return;
    setLoading(true);
    try {
      const res = await fetchPage(next);
      setItems((prev) => [...(prev ?? []), ...res.items]);
      setNext(res.next);
      setError(null);
    } catch (err) {
      setError(errText(err, "Riwayat gagal dimuat."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section aria-label={t("Riwayat Auto Komentar")} className="card">
      <div className="px-4 py-3 border-b border-line bg-subtle rounded-t-2xl space-y-2">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">{t("Riwayat")}</p>
        <div className="overflow-x-auto [scrollbar-width:none]">
          <Segmented ariaLabel="Saring riwayat" options={FILTERS} value={filter} onChange={setFilter} fit className="w-max" />
        </div>
      </div>
      {error && <Banner tone="danger" className="m-4">{error}</Banner>}
      {items === null ? (
        <div className="p-4">
          <ListSkeleton label="Memuat riwayat" rows={2} />
        </div>
      ) : items.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted">{t("Belum ada riwayat.")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((it) => {
            const s = it.status ? STATUS[it.status] : null;
            return (
              <li key={it.id} className="p-4 space-y-1.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  {s && <span className={cn("h-5 px-2 rounded-full text-[11px] font-semibold inline-flex items-center", s.cls)}>{t(s.label)}</span>}
                  <span className="font-semibold text-fg">{handles.get(it.accountId) ?? t("@akun")}</span>
                  <span>→ @{it.authorUsername}</span>
                  {it.keyword && <span>· “{it.keyword}”</span>}
                  {it.slot && <span className="tabular-nums">· {it.slot}</span>}
                  <span className="tabular-nums">· {whenText(it.sentAt ?? it.createdAt)}</span>
                </div>
                <p className="text-sm text-muted break-words line-clamp-3">{it.excerpt}</p>
                {it.replyText && (it.status === "TERKIRIM" || it.status === "DRAF" || it.status === "MENGIRIM" || it.status === "GAGAL" || it.status === "DITOLAK") && (
                  <p className="text-sm text-fg break-words border-l-2 border-accent pl-3">{it.replyText}</p>
                )}
                {it.reason && <p className="text-xs text-muted">{reasonText(it.reason)}</p>}
                <div className="flex flex-wrap gap-3 text-xs">
                  <PostLink href={it.permalink} label={t("Postingan asli")} />
                  <PostLink href={it.replyPermalink} label={t("Komentar kita")} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {next && (
        <div className="p-4 border-t border-line">
          <LoadMoreButton loading={loading} onClick={() => void more()} />
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ tab */

/** Tab Auto Komentar: status & saklar utama, persetujuan, kartu per akun, riwayat, lalu aturan lanjutan. */
export function AutoCommentTab({ active }: { active: boolean }) {
  const t = useT();
  const [data, setData] = useState<AutoCommentOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const loaded = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setData(await call<AutoCommentOverview>("", undefined, signal));
      setError(null);
    } catch (err) {
      if (signal?.aborted) return;
      setError(errText(err, "Auto Komentar gagal dimuat."));
    }
  }, []);

  useEffect(() => {
    if (!active || loaded.current) return;
    const ctrl = new AbortController();
    void load(ctrl.signal).then(() => {
      if (!ctrl.signal.aborted) loaded.current = true;
    });
    return () => ctrl.abort();
  }, [active, load]);

  const refresh = () => {
    void load();
    setVersion((v) => v + 1);
  };

  if (!data) {
    return error ? (
      <Banner tone="danger">
        {error}{" "}
        <button type="button" onClick={() => void load()} className="underline font-semibold cursor-pointer">
          {t("Coba lagi")}
        </button>
      </Banner>
    ) : (
      <ListSkeleton label="Memuat Auto Komentar" />
    );
  }

  if (!data.installed) {
    return (
      <Banner tone="info">
        {t("Auto Komentar belum dipasang. Pemilik dashboard perlu menjalankan")} <code className="font-mono">sql/043_auto_comment.sql</code> {t("di Supabase.")}
      </Banner>
    );
  }

  const canEdit = RANK[data.role] >= RANK.EDITOR;
  const canAdmin = RANK[data.role] >= RANK.ADMIN;
  const handles = new Map(data.accounts.map((a) => [a.id, accountHandle(a)]));
  const setConfig = (config: AutoCommentConfig) => setData((d) => d && { ...d, config });

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-fg">{t("Auto Komentar")}</h3>
          <p className="text-sm text-muted leading-relaxed">
            {t("Akun Anda ikut menyapa postingan orang lain yang relevan dengan komentar singkat dan sopan. Tanpa link, mention, atau jualan.")}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          aria-label={t("Segarkan")}
          title={t("Segarkan")}
          className="shrink-0 w-10 h-10 rounded-full border border-line-strong text-muted inline-flex items-center justify-center hover:border-accent hover:text-accent transition-colors cursor-pointer"
        >
          <RotateCw className="w-4 h-4" />
        </button>
      </div>

      {data.blockedReason && <Banner tone="warning">{t(data.blockedReason)}</Banner>}

      <StatusCard data={data} canAdmin={canAdmin} onSaved={setConfig} />

      {/* Yang menunggu keputusan pengguna diletakkan paling atas; kalau kosong, bagian ini tidak tampil. */}
      {data.queue.length > 0 && (
        <section aria-label={t("Perlu persetujuan Anda")} className="card">
          <p className="px-4 py-3 border-b border-line text-sm font-semibold text-fg flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-warning" aria-hidden />
            {t("Perlu persetujuan Anda ({n})", { n: data.queue.length })}
          </p>
          <ul className="divide-y divide-line">
            {data.queue.map((it) => (
              <QueueItem
                key={it.id}
                item={it}
                handle={handles.get(it.accountId) ?? t("@akun")}
                canEdit={canEdit}
                onDone={(id) => {
                  setData((d) => d && { ...d, queue: d.queue.filter((q) => q.id !== id), counts: { ...d.counts, draf: Math.max(0, d.counts.draf - 1) } });
                  setVersion((v) => v + 1);
                }}
              />
            ))}
          </ul>
        </section>
      )}

      <section aria-label={t("Pengaturan per akun")} className="card">
        <div className="px-4 sm:px-5 py-3 border-b border-line flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-fg">{t("Akun Anda")}</p>
          <p className="text-xs text-muted">
            {t("{on} dari {total} ikut berkomentar", { on: data.accounts.filter((a) => a.mode !== "MATI").length, total: data.accounts.length })}
          </p>
        </div>
        {data.accounts.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">{t("Belum ada akun Threads di workspace ini.")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.accounts.map((a) => (
              <AccountCard
                key={a.id}
                account={a}
                canEdit={canEdit}
                canAdmin={canAdmin}
                defaultOpen={data.accounts.length === 1 || (a.mode !== "MATI" && (!a.keywords.length || !a.slots.length))}
                onSaved={(next) => setData((d) => d && { ...d, accounts: d.accounts.map((x) => (x.id === next.id ? next : x)) })}
                onRan={refresh}
              />
            ))}
          </ul>
        )}
      </section>

      <History active={active} handles={handles} version={version} />

      <AdvancedRules config={data.config} canAdmin={canAdmin} onSaved={setConfig} />
    </div>
  );
}
