"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, ExternalLink, Loader2, MessageCircle, Reply, RotateCw, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CommentDTO, CommentStatus, RepliesResponse } from "@/lib/replies-service";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { MONTH_SHORT } from "@/components/settings/format";
import { wibParts } from "@/lib/scheduling";
import { useT } from "@/components/i18n/lang-provider";
import { tr } from "@/lib/i18n/core";
import { Banner, ListSkeleton, Switch, accountHandle, apiErrorText, pad2 } from "./shared";

const STATUS: Record<CommentStatus, { label: string; cls: string }> = {
  BARU: { label: "Menunggu", cls: "bg-subtle text-muted" },
  MENULIS: { label: "Sedang dibalas", cls: "bg-accent-soft text-accent" },
  DIBALAS: { label: "Dibalas", cls: "bg-success-soft text-success" },
  DILEWATI: { label: "Dilewati", cls: "bg-subtle text-muted" },
  GAGAL: { label: "Gagal", cls: "bg-danger-soft text-danger" },
};

/** "19 Okt, 09.05 WIB" dari timestamp database (UTC tanpa zona). */
function whenText(raw: string): string {
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`);
  if (Number.isNaN(d.getTime())) return "-";
  const p = wibParts(d);
  return `${p.d} ${tr(MONTH_SHORT[p.m])}, ${pad2(p.h)}.${pad2(p.min)} WIB`;
}

/** Aksi moderasi per komentar (izin threads_manage_replies). */
interface Moderation {
  canManage: boolean;
  busyId: string | null;
  hide: (c: CommentDTO, hidden: boolean) => Promise<void>;
  reply: (c: CommentDTO, text: string) => Promise<boolean>;
}

const THREADS_MAX = 500;

async function call<T>(init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const res = await fetch("/api/autopilot/replies", { ...init, signal, cache: "no-store", headers: { "Content-Type": "application/json" } });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? "Permintaan gagal.");
  return body;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "success" | "danger" }) {
  return (
    <div className="card p-2.5 sm:p-4 min-w-0 flex flex-col">
      <p className="text-[11px] sm:text-xs font-semibold text-muted leading-tight line-clamp-2">{label}</p>
      <p className={cn("mt-auto pt-1 text-lg sm:text-2xl font-bold tabular-nums leading-tight", tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-fg")}>
        {value}
      </p>
    </div>
  );
}

type Account = RepliesResponse["accounts"][number];
interface ThreadNode {
  c: CommentDTO;
  kids: ThreadNode[];
}

/**
 * Susun komentar jadi utas: lanjutan obrolan (parentId) di bawah komentar induknya, urut waktu. Induk di luar
 * halaman daftar = komentar itu tampil sebagai awal utas. Utas diurutkan dari aktivitas terbaru.
 */
function buildThreads(items: CommentDTO[]): ThreadNode[] {
  const nodes = new Map(items.map((c) => [c.id, { c, kids: [] as ThreadNode[] }]));
  const roots: ThreadNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.c.parentId ? nodes.get(n.c.parentId) : undefined;
    (parent ? parent.kids : roots).push(n);
  }
  const latest = new Map<ThreadNode, string>();
  const walk = (n: ThreadNode): string => {
    n.kids.sort((a, b) => a.c.commentedAt.localeCompare(b.c.commentedAt));
    return n.kids.reduce((max, k) => {
      const t = walk(k);
      return t > max ? t : max;
    }, n.c.createdAt);
  };
  for (const r of roots) latest.set(r, walk(r));
  return roots.sort((a, b) => latest.get(b)!.localeCompare(latest.get(a)!));
}

/** Urutan pesan dalam utas: komentar, balasan AI-nya, lalu lanjutan obrolan (kedalaman dulu). */
type Message = { kind: "komentar"; c: CommentDTO; root: boolean } | { kind: "balasan"; c: CommentDTO };
function flatten(n: ThreadNode, root = true, out: Message[] = []): Message[] {
  out.push({ kind: "komentar", c: n.c, root });
  if (n.c.replyText) out.push({ kind: "balasan", c: n.c });
  for (const k of n.kids) flatten(k, false, out);
  return out;
}

function MessageRow({ m, account, last, mod }: { m: Message; account: Account | undefined; last: boolean; mod: Moderation }) {
  const t = useT();
  const c = m.c;
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const busy = mod.busyId === c.id;
  const len = [...draft.trim()].length;
  const send = async () => {
    if (await mod.reply(c, draft)) {
      setDraft("");
      setComposing(false);
    }
  };
  const mine = m.kind === "balasan";
  const name = mine ? (account ? accountHandle(account) : t("@akun")) : `@${c.username ?? t("pengguna")}`;
  const s = STATUS[c.status];
  return (
    <div className="flex gap-3">
      {/* Kolom avatar + garis penyambung ke pesan berikutnya, seperti utas di Threads. */}
      <div className="flex flex-col items-center shrink-0">
        <AccountAvatar
          name={mine ? (account?.displayName ?? "A") : (c.username ?? "?")}
          src={mine ? account?.avatarUrl : null}
          size="w-8 h-8"
          className={mine ? "ring-2 ring-accent-soft" : undefined}
        />
        {!last && <span aria-hidden className="mt-1.5 w-0.5 flex-1 min-h-3 rounded-full bg-line" />}
      </div>
      <div className={cn("min-w-0 flex-1", !last && "pb-4")}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted min-h-8">
          <span className="font-semibold text-fg">{name}</span>
          {mine ? (
            <span className="h-5 px-1.5 rounded-full text-[10px] font-semibold inline-flex items-center bg-accent-soft text-accent">
              {c.manualReply ? t("Manual") : "AI"}
            </span>
          ) : (
            <>
              <span className="tabular-nums">{whenText(c.commentedAt)}</span>
              {c.hidden && (
                <span className="h-5 px-2 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 bg-subtle text-muted">
                  <EyeOff className="w-3 h-3" />
                  {t("Disembunyikan")}
                </span>
              )}
              {c.status !== "DIBALAS" && (
                <span className={cn("h-5 px-2 rounded-full text-[11px] font-semibold inline-flex items-center", s.cls)}>{t(s.label)}</span>
              )}
              {m.root && (c.depth ?? 0) > 0 && <span>· {t("membalas balasan AI")}</span>}
              {m.root && c.releaseUrl && (
                <a href={c.releaseUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                  {t("Postingan")} <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </>
          )}
          {mine && c.repliedAt && <span className="tabular-nums">{whenText(c.repliedAt)}</span>}
        </div>
        <p className={cn("text-sm break-words", !mine && c.hidden ? "text-muted line-through" : "text-fg")}>
          {(mine ? c.replyText : c.text) || <span className="text-muted">{t("(tanpa teks)")}</span>}
        </p>
        {!mine && c.error && c.status !== "DIBALAS" && <p className="mt-1 text-xs text-muted">{t(c.error)}</p>}
        {!mine && mod.canManage && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setComposing((v) => !v)}
              disabled={busy || c.status === "MENULIS"}
              title={t("Tulis balasan sendiri untuk komentar ini")}
              className="h-8 px-3 rounded-full border border-line-strong text-xs font-semibold text-fg inline-flex items-center gap-1.5 hover:border-accent hover:text-accent transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Reply className="w-3.5 h-3.5" />
              {t("Balas")}
            </button>
            <button
              type="button"
              onClick={() => void mod.hide(c, !c.hidden)}
              disabled={busy}
              title={c.hidden ? t("Tampilkan lagi komentar ini di postingan Threads") : t("Sembunyikan komentar ini dari postingan Threads")}
              className="h-8 px-3 rounded-full border border-line-strong text-xs font-semibold text-fg inline-flex items-center gap-1.5 hover:border-accent hover:text-accent transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy && !composing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : c.hidden ? (
                <Eye className="w-3.5 h-3.5" />
              ) : (
                <EyeOff className="w-3.5 h-3.5" />
              )}
              {c.hidden ? t("Tampilkan") : t("Sembunyikan")}
            </button>
          </div>
        )}
        {!mine && composing && (
          <div className="mt-2 rounded-xl border border-line p-2 space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              autoFocus
              disabled={busy}
              aria-label={t("Balasan untuk @{user}", { user: c.username ?? t("pengguna") })}
              placeholder={t("Balasan untuk @{user}", { user: c.username ?? t("pengguna") })}
              className="w-full resize-none bg-transparent text-sm text-fg placeholder:text-muted focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2">
              <span className={cn("text-xs tabular-nums", len > THREADS_MAX ? "text-danger" : "text-muted")}>
                {len}/{THREADS_MAX}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setComposing(false)}
                  disabled={busy}
                  className="h-8 px-3 rounded-full text-xs font-semibold text-muted hover:text-fg cursor-pointer"
                >
                  {t("Batal")}
                </button>
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={busy || len === 0 || len > THREADS_MAX}
                  className="h-8 px-3.5 rounded-full bg-accent text-on-accent text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  {t("Kirim balasan")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CommentThread({ node, account, mod }: { node: ThreadNode; account: Account | undefined; mod: Moderation }) {
  const messages = flatten(node);
  return (
    <li className="p-4">
      {messages.map((m, i) => (
        <MessageRow key={`${m.kind}-${m.c.id}`} m={m} account={account} last={i === messages.length - 1} mod={mod} />
      ))}
    </li>
  );
}

/** Tab Komentar: saklar balas otomatis per akun dan komentar terbaru beserta balasannya. */
export function RepliesTab({ active, canManage }: { active: boolean; canManage: boolean }) {
  const t = useT();
  const [data, setData] = useState<RepliesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [okNotice, setOkNotice] = useState<string | null>(null);
  const [modBusy, setModBusy] = useState<string | null>(null);
  const loaded = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setData(await call<RepliesResponse>(undefined, signal));
      setError(null);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? apiErrorText(err.message) : tr("Komentar gagal dimuat."));
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

  const toggle = async (accountId: string, aktif: boolean) => {
    setBusy(accountId);
    setNotice(null);
    // Optimistis: saklar langsung berubah, dikembalikan bila gagal.
    setData((d) => d && { ...d, accounts: d.accounts.map((a) => (a.id === accountId ? { ...a, aktif } : a)) });
    try {
      await call({ method: "POST", body: JSON.stringify({ accountId, aktif }) });
    } catch (err) {
      setData((d) => d && { ...d, accounts: d.accounts.map((a) => (a.id === accountId ? { ...a, aktif: !aktif } : a)) });
      setNotice(err instanceof Error ? apiErrorText(err.message) : tr("Gagal menyimpan."));
    } finally {
      setBusy(null);
    }
  };

  const patchItem = (id: string, patch: Partial<CommentDTO>) =>
    setData((d) => d && { ...d, items: d.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) });

  const moderate = async (c: CommentDTO, body: Record<string, unknown>, okText: string): Promise<boolean> => {
    setModBusy(c.id);
    setNotice(null);
    setOkNotice(null);
    try {
      await call({ method: "PATCH", body: JSON.stringify({ id: c.id, ...body }) });
      setOkNotice(okText);
      return true;
    } catch (err) {
      setNotice(err instanceof Error ? apiErrorText(err.message) : tr("Gagal menyimpan."));
      return false;
    } finally {
      setModBusy(null);
    }
  };

  const mod: Moderation = {
    canManage,
    busyId: modBusy,
    hide: async (c, hidden) => {
      const user = c.username ?? tr("pengguna");
      const ok = await moderate(
        c,
        { action: hidden ? "hide" : "unhide" },
        hidden ? tr("Komentar @{user} disembunyikan di Threads.", { user }) : tr("Komentar @{user} ditampilkan lagi di Threads.", { user })
      );
      if (ok) patchItem(c.id, { hidden, ...(hidden && c.status === "BARU" ? { status: "DILEWATI" as const } : {}) });
    },
    reply: async (c, text) => {
      const body = text.trim();
      const ok = await moderate(c, { action: "reply", text: body }, tr("Balasan terkirim ke @{user} di Threads.", { user: c.username ?? tr("pengguna") }));
      if (ok) patchItem(c.id, { status: "DIBALAS", replyText: body, manualReply: true, repliedAt: new Date().toISOString(), error: null });
      return ok;
    },
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
      <ListSkeleton label="Memuat komentar" />
    );
  }

  if (!data.installed) {
    return (
      <Banner tone="info">
        {t("Balas komentar otomatis belum dipasang. Pemilik dashboard perlu menjalankan")} <code className="font-mono">sql/023_threads_replies.sql</code>{" "}
        {t("di Supabase.")}
      </Banner>
    );
  }

  const byId = new Map(data.accounts.map((a) => [a.id, a]));
  const on = data.accounts.filter((a) => a.aktif).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-fg">{t("Balas komentar otomatis")}</h3>
          <p className="text-sm text-muted">
            {t(
              "AI membalas komentar di postingan yang terbit lewat BotThreads: singkat, sesuai gaya akun, tanpa jualan. Spam dan komentar kasar dilewati. Bawaannya menyala untuk akun bermode Otomatis."
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="shrink-0 self-start h-10 px-4 rounded-full border border-line-strong text-sm font-semibold text-fg inline-flex items-center gap-2 hover:border-accent hover:text-accent transition-colors cursor-pointer"
        >
          <RotateCw className="w-4 h-4" />
          {t("Segarkan")}
        </button>
      </div>

      {notice && <Banner tone="danger">{notice}</Banner>}
      {okNotice && <Banner tone="success">{okNotice}</Banner>}

      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        <Stat label={t("Dibalas 7 hari")} value={data.counts.dibalas7} tone="success" />
        <Stat label={t("Menunggu")} value={data.counts.menunggu} />
        <Stat label={t("Dilewati 7 hari")} value={data.counts.dilewati7} />
        <Stat label={t("Gagal 7 hari")} value={data.counts.gagal7} tone={data.counts.gagal7 ? "danger" : undefined} />
      </div>

      <section aria-label={t("Saklar balas otomatis per akun")} className="card">
        <p className="px-4 py-3 border-b border-line bg-subtle rounded-t-2xl text-xs font-semibold text-muted uppercase tracking-wide">
          {t("Akun ({on} menyala dari {total})", { on, total: data.accounts.length })}
        </p>
        <ul className="divide-y divide-line">
          {data.accounts.map((a) => (
            <li key={a.id} className="px-4 py-3 flex items-center gap-3">
              <AccountAvatar name={a.displayName} src={a.avatarUrl} size="w-8 h-8" />
              <p className="flex-1 min-w-0 text-sm font-semibold text-fg truncate">{accountHandle(a)}</p>
              <Switch
                on={a.aktif}
                busy={busy === a.id}
                disabled={!canManage}
                onChange={(next) => void toggle(a.id, next)}
                label={t("Balas komentar otomatis {handle}", { handle: accountHandle(a) })}
              />
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={t("Komentar terbaru")} className="card">
        <p className="px-4 py-3 border-b border-line bg-subtle rounded-t-2xl text-xs font-semibold text-muted uppercase tracking-wide">
          {t("Komentar terbaru")}
        </p>
        {data.items.length === 0 ? (
          <div className="p-8 text-center">
            <div className="mx-auto w-12 h-12 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
              <MessageCircle className="w-6 h-6" />
            </div>
            <p className="mt-3 text-sm font-semibold text-fg">{t("Belum ada komentar")}</p>
            <p className="mt-1 text-sm text-muted">{t("Komentar baru dikirim Threads ke sini lewat webhook dan dibalas dalam hitungan detik.")}</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {buildThreads(data.items).map((t) => (
              <CommentThread key={t.c.id} node={t} account={byId.get(t.c.accountId)} mod={mod} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
