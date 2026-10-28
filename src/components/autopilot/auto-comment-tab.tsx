"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Loader2, MessageSquareText, Play, Plus, RotateCw, Save, X } from "lucide-react";
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
  SLOT_SUGGESTIONS,
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
    <div className="card p-2.5 sm:p-4 min-w-0 flex flex-col">
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

function Chip({ children, onRemove, removeLabel, disabled }: { children: React.ReactNode; onRemove?: () => void; removeLabel: string; disabled?: boolean }) {
  return (
    <span className="h-8 pl-3 pr-1 rounded-full bg-subtle text-sm text-fg inline-flex items-center gap-1 max-w-full">
      <span className="truncate tabular-nums">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={removeLabel}
          className="w-7 h-7 rounded-full inline-flex items-center justify-center text-muted hover:text-danger cursor-pointer disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ aturan workspace */

function WorkspaceRules({ config, canAdmin, onSaved }: { config: AutoCommentConfig; canAdmin: boolean; onSaved: (c: AutoCommentConfig) => void }) {
  const t = useT();
  const [form, setForm] = useState({
    aktif: config.aktif,
    gapMinutes: String(config.gapMinutes),
    cooldownDays: String(config.cooldownDays),
    maxPostAgeHours: String(config.maxPostAgeHours),
    blockList: config.blockList.join("\n"),
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const save = async (next = form) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await call<{ config: AutoCommentConfig }>("/settings", {
        method: "POST",
        body: JSON.stringify({
          scope: "workspace",
          aktif: next.aktif,
          gapMinutes: Number(next.gapMinutes),
          cooldownDays: Number(next.cooldownDays),
          maxPostAgeHours: Number(next.maxPostAgeHours),
          blockList: next.blockList.split(/[\s,]+/).filter(Boolean),
        }),
      });
      onSaved(res.config);
      setForm({ ...next, blockList: res.config.blockList.join("\n") });
      setMsg({ tone: "success", text: tr("Aturan disimpan.") });
    } catch (err) {
      setMsg({ tone: "danger", text: errText(err, "Gagal menyimpan.") });
    } finally {
      setBusy(false);
    }
  };

  const num = (key: "gapMinutes" | "cooldownDays" | "maxPostAgeHours", label: string, hint: string, min: number, max: number) => (
    <label className="block min-w-0">
      <span className="text-xs font-semibold text-muted">{t(label)}</span>
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
    <section aria-label={t("Aturan workspace")} className="card">
      <div className="px-4 py-3 border-b border-line bg-subtle rounded-t-2xl flex items-center gap-3">
        <p className="flex-1 text-xs font-semibold text-muted uppercase tracking-wide">{t("Aturan workspace")}</p>
        <span className="text-sm font-semibold text-fg">{form.aktif ? t("Menyala") : t("Mati")}</span>
        <Switch
          on={form.aktif}
          busy={busy}
          disabled={!canAdmin}
          label={t("Saklar Auto Komentar workspace")}
          onChange={(aktif) => {
            const next = { ...form, aktif };
            setForm(next);
            void save(next);
          }}
        />
      </div>
      <div className="p-4 space-y-4">
        <p className="text-sm text-muted">
          {t(
            "Berlaku untuk semua akun di workspace ini. Satu postingan hanya pernah menerima satu auto komentar dari akun BotThreads mana pun, dan penulis yang sudah dikomentari tidak disasar lagi selama masa cooldown."
          )}
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          {num("gapMinutes", "Jeda antar-komentar (menit)", "Minimal {min}, maksimal {max}.", WS_GAP_MIN, WS_GAP_MAX)}
          {num("cooldownDays", "Cooldown penulis (hari)", "Minimal {min}, maksimal {max}.", COOLDOWN_MIN, COOLDOWN_MAX)}
          {num("maxPostAgeHours", "Umur postingan maksimal (jam)", "Minimal {min}, maksimal {max}.", POST_AGE_MIN, POST_AGE_MAX)}
        </div>
        <label className="block">
          <span className="text-xs font-semibold text-muted">{t("Daftar blokir (username, satu per baris)")}</span>
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
    </section>
  );
}

/* ------------------------------------------------------------------ kartu akun */

function AccountCard({
  account,
  canEdit,
  canAdmin,
  onSaved,
  onRan,
}: {
  account: AutoCommentAccountDTO;
  canEdit: boolean;
  canAdmin: boolean;
  onSaved: (a: AutoCommentAccountDTO) => void;
  onRan: () => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<AutoCommentMode>(account.mode);
  const [slots, setSlots] = useState<string[]>(account.slots);
  const [keywords, setKeywords] = useState<string[]>(account.keywords);
  const [cap, setCap] = useState(String(account.dailyCap));
  const [slotInput, setSlotInput] = useState("");
  const [kwInput, setKwInput] = useState("");
  const [busy, setBusy] = useState<"save" | "run" | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);

  // Mengubah akun yang Otomatis (atau menjadikannya Otomatis) hanya Admin/Pemilik; server menegakkan hal yang sama.
  const locked = !canEdit || (!canAdmin && (account.mode === "OTOMATIS" || mode === "OTOMATIS"));
  const dirty =
    mode !== account.mode || cap !== String(account.dailyCap) || slots.join() !== account.slots.join() || keywords.join("\n") !== account.keywords.join("\n");

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

  const save = async () => {
    setBusy("save");
    setMsg(null);
    try {
      await call("/settings", {
        method: "POST",
        body: JSON.stringify({ scope: "account", accountId: account.id, mode, slots, keywords, dailyCap: Number(cap) }),
      });
      onSaved({ ...account, mode, slots, keywords, dailyCap: Number(cap) });
      setMsg({ tone: "success", text: tr("Pengaturan akun disimpan.") });
    } catch (err) {
      setMsg({ tone: "danger", text: errText(err, "Gagal menyimpan.") });
    } finally {
      setBusy(null);
    }
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
  return (
    <li className="p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <AccountAvatar name={account.displayName} src={account.avatarUrl} size="w-9 h-9" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-fg truncate">{handle}</p>
          <p className="text-xs text-muted tabular-nums">
            {t("Hari ini {used} dari {cap} komentar", { used: account.usedToday, cap: account.dailyCap })}
          </p>
        </div>
        <Segmented
          ariaLabel="Mode Auto Komentar"
          options={MODE_OPTIONS.map((o) => ({
            ...o,
            activeClass: MODE_ACTIVE_CLASS[o.value],
            disabled: !canEdit || (o.value === "OTOMATIS" && !canAdmin) || (!canAdmin && account.mode === "OTOMATIS"),
            title: o.value === "OTOMATIS" && !canAdmin ? "Hanya Admin atau Pemilik yang bisa menyalakan mode Otomatis." : undefined,
          }))}
          value={mode}
          onChange={setMode}
          fit
          className="w-full sm:w-auto"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted">{t("Jam berjalan (WIB), bebas pilih menit")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {slots.length === 0 && <span className="text-sm text-muted">{t("Belum ada jam.")}</span>}
            {slots.map((s) => (
              <Chip key={s} disabled={locked} removeLabel={t("Hapus jam {slot}", { slot: s })} onRemove={locked ? undefined : () => setSlots(slots.filter((x) => x !== s))}>
                {s}
              </Chip>
            ))}
          </div>
          {!locked && (
            <>
              <div className="mt-2 flex gap-2">
                <input
                  type="time"
                  step={60}
                  value={slotInput}
                  onChange={(e) => setSlotInput(e.target.value)}
                  aria-label={t("Jam baru")}
                  className={cn(inputCls, "w-32 tabular-nums")}
                />
                <button type="button" onClick={() => addSlot(slotInput)} disabled={!slotInput} className={cn(btnCls, "border border-line-strong text-fg hover:border-accent")}>
                  <Plus className="w-4 h-4" />
                  {t("Tambah jam")}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <span>{t("Contoh:")}</span>
                {SLOT_SUGGESTIONS.filter((s) => !slots.includes(s)).map((s) => (
                  <button key={s} type="button" onClick={() => addSlot(s)} className="h-7 px-2.5 rounded-full border border-line hover:border-accent hover:text-accent tabular-nums cursor-pointer">
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="mt-2 text-[11px] text-muted">
            {t("Tiap jam berjalan sekali sehari dan menghasilkan paling banyak satu komentar. Jam yang terlewat masih dijalankan sampai 2 jam setelahnya.")}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted">{t("Kata kunci pencarian ({n}/{max})", { n: keywords.length, max: KEYWORDS_MAX })}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {keywords.length === 0 && <span className="text-sm text-muted">{t("Belum ada kata kunci.")}</span>}
            {keywords.map((k) => (
              <Chip key={k} disabled={locked} removeLabel={t("Hapus kata kunci {kw}", { kw: k })} onRemove={locked ? undefined : () => setKeywords(keywords.filter((x) => x !== k))}>
                {k}
              </Chip>
            ))}
          </div>
          {!locked && (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addKeyword();
              }}
            >
              <input
                value={kwInput}
                maxLength={KEYWORD_MAX_CHARS}
                onChange={(e) => setKwInput(e.target.value)}
                placeholder={t("mis. kopi susu")}
                aria-label={t("Kata kunci baru")}
                className={cn(inputCls, "flex-1 min-w-0")}
              />
              <button type="submit" disabled={!kwInput.trim()} className={cn(btnCls, "border border-line-strong text-fg hover:border-accent")}>
                <Plus className="w-4 h-4" />
                {t("Tambah")}
              </button>
            </form>
          )}
          <label className="mt-3 flex items-center gap-2 text-sm text-fg">
            <span className="text-xs font-semibold text-muted">{t("Batas per hari")}</span>
            <input
              type="number"
              min={1}
              max={DAILY_CAP_MAX}
              value={cap}
              disabled={locked}
              onChange={(e) => setCap(e.target.value)}
              className={cn(inputCls, "w-20 tabular-nums")}
            />
            <span className="text-xs text-muted">{t("komentar (draf menunggu ikut dihitung)")}</span>
          </label>
        </div>
      </div>

      {account.lastNote && (
        <p className="text-xs text-muted">
          <span className="font-semibold">{t("Putaran terakhir")}</span> {whenText(account.lastRunAt)}: {reasonText(account.lastNote)}
        </p>
      )}
      {msg && <Banner tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Banner>}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={!canEdit || busy !== null || account.mode === "MATI" || dirty}
          title={dirty ? t("Simpan perubahan dulu.") : undefined}
          className={cn(btnCls, "border border-line-strong text-fg hover:border-accent hover:text-accent")}
        >
          {busy === "run" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {t("Jalankan sekarang")}
        </button>
        {!locked && (
          <button type="button" onClick={() => void save()} disabled={busy !== null || !dirty} className={cn(btnCls, "bg-accent text-on-accent hover:bg-accent-hover")}>
            {busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t("Simpan")}
          </button>
        )}
      </div>
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

/** Tab Auto Komentar: aturan workspace, pengaturan per akun, antrean tinjau, dan riwayat. */
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

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-fg">{t("Auto Komentar")}</h3>
          <p className="text-sm text-muted">
            {t(
              "Pada jam yang Anda pilih, akun mencari postingan publik terbaru dengan kata kunci lalu meninggalkan paling banyak satu komentar singkat yang relevan, ditulis sebagai akun itu sendiri. Tanpa link, mention, hashtag, harga, atau ajakan jualan."
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="shrink-0 self-start h-10 px-4 rounded-full border border-line-strong text-sm font-semibold text-fg inline-flex items-center gap-2 hover:border-accent hover:text-accent transition-colors cursor-pointer"
        >
          <RotateCw className="w-4 h-4" />
          {t("Segarkan")}
        </button>
      </div>

      {data.blockedReason && <Banner tone="warning">{t(data.blockedReason)}</Banner>}
      {!data.config.aktif && <Banner tone="info">{t("Saklar Auto Komentar workspace masih mati. Tidak ada yang dicari atau dikirim sampai Admin menyalakannya.")}</Banner>}

      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        <Stat label={t("Terkirim 7 hari")} value={data.counts.terkirim7} tone="success" />
        <Stat label={t("Menunggu tinjau")} value={data.counts.draf} tone={data.counts.draf ? "warning" : undefined} />
        <Stat label={t("Dilewati 7 hari")} value={data.counts.dilewati7} />
        <Stat label={t("Gagal 7 hari")} value={data.counts.gagal7} tone={data.counts.gagal7 ? "danger" : undefined} />
      </div>

      <WorkspaceRules config={data.config} canAdmin={canAdmin} onSaved={(config) => setData((d) => d && { ...d, config })} />

      <section aria-label={t("Pengaturan per akun")} className="card">
        <p className="px-4 py-3 border-b border-line bg-subtle rounded-t-2xl text-xs font-semibold text-muted uppercase tracking-wide">
          {t("Akun ({on} menyala dari {total})", { on: data.accounts.filter((a) => a.mode !== "MATI").length, total: data.accounts.length })}
        </p>
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
                onSaved={(next) => setData((d) => d && { ...d, accounts: d.accounts.map((x) => (x.id === next.id ? next : x)) })}
                onRan={refresh}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-label={t("Antrean tinjau")} className="card">
        <p className="px-4 py-3 border-b border-line bg-subtle rounded-t-2xl text-xs font-semibold text-muted uppercase tracking-wide">
          {t("Antrean tinjau")}
        </p>
        {data.queue.length === 0 ? (
          <div className="p-8 text-center">
            <div className="mx-auto w-12 h-12 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
              <MessageSquareText className="w-6 h-6" />
            </div>
            <p className="mt-3 text-sm font-semibold text-fg">{t("Tidak ada draf menunggu")}</p>
            <p className="mt-1 text-sm text-muted">{t("Akun bermode Tinjau dulu menaruh draf komentar di sini. Tidak ada yang terkirim sebelum Editor menyetujuinya.")}</p>
          </div>
        ) : (
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
        )}
      </section>

      <History active={active} handles={handles} version={version} />
    </div>
  );
}
