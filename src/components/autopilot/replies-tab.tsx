"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { CornerDownRight, ExternalLink, MessageCircle, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CommentDTO, CommentStatus, RepliesResponse } from "@/lib/replies-service";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { MONTH_SHORT } from "@/components/settings/format";
import { wibParts } from "@/lib/scheduling";
import { Banner, ListSkeleton, Switch, accountHandle, pad2 } from "./shared";

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
  return `${p.d} ${MONTH_SHORT[p.m]}, ${pad2(p.h)}.${pad2(p.min)} WIB`;
}

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

function CommentRow({ c, handle }: { c: CommentDTO; handle: string }) {
  const s = STATUS[c.status];
  return (
    <li className="p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span className="font-semibold text-fg">@{c.username ?? "pengguna"}</span>
        <span>di {handle}</span>
        <span className="tabular-nums">· {whenText(c.commentedAt)}</span>
        <span className={cn("h-6 px-2 rounded-full text-[11px] font-semibold inline-flex items-center", s.cls)}>{s.label}</span>
        {c.releaseUrl && (
          <a href={c.releaseUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            Postingan <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
      <p className="text-sm text-fg break-words">{c.text || <span className="text-muted">(tanpa teks)</span>}</p>
      {c.replyText && (
        <p className="flex items-start gap-1.5 text-sm text-fg rounded-xl bg-subtle px-3 py-2 break-words">
          <CornerDownRight className="w-4 h-4 mt-0.5 shrink-0 text-accent" />
          <span>{c.replyText}</span>
        </p>
      )}
      {c.error && c.status !== "DIBALAS" && <p className="text-xs text-muted">{c.error}</p>}
    </li>
  );
}

/** Tab Komentar: saklar balas otomatis per akun dan komentar terbaru beserta balasannya. */
export function RepliesTab({ active, canManage }: { active: boolean; canManage: boolean }) {
  const [data, setData] = useState<RepliesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loaded = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setData(await call<RepliesResponse>(undefined, signal));
      setError(null);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : "Komentar gagal dimuat.");
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
      setNotice(err instanceof Error ? err.message : "Gagal menyimpan.");
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return error ? (
      <Banner tone="danger">
        {error}{" "}
        <button type="button" onClick={() => void load()} className="underline font-semibold cursor-pointer">
          Coba lagi
        </button>
      </Banner>
    ) : (
      <ListSkeleton label="Memuat komentar" />
    );
  }

  if (!data.installed) {
    return (
      <Banner tone="info">
        Balas komentar otomatis belum dipasang. Pemilik dashboard perlu menjalankan <code className="font-mono">sql/023_threads_replies.sql</code> di
        Supabase.
      </Banner>
    );
  }

  const byId = new Map(data.accounts.map((a) => [a.id, a]));
  const on = data.accounts.filter((a) => a.aktif).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-fg">Balas komentar otomatis</h3>
          <p className="text-sm text-muted">
            AI membalas komentar di postingan yang terbit lewat BotThreads: singkat, sesuai gaya akun, tanpa jualan. Spam dan komentar kasar
            dilewati. Bawaannya menyala untuk akun bermode Otomatis.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="shrink-0 self-start h-10 px-4 rounded-full border border-line-strong text-sm font-semibold text-fg inline-flex items-center gap-2 hover:border-accent hover:text-accent transition-colors cursor-pointer"
        >
          <RotateCw className="w-4 h-4" />
          Segarkan
        </button>
      </div>

      {notice && <Banner tone="danger">{notice}</Banner>}

      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        <Stat label="Dibalas 7 hari" value={data.counts.dibalas7} tone="success" />
        <Stat label="Menunggu" value={data.counts.menunggu} />
        <Stat label="Dilewati 7 hari" value={data.counts.dilewati7} />
        <Stat label="Gagal 7 hari" value={data.counts.gagal7} tone={data.counts.gagal7 ? "danger" : undefined} />
      </div>

      <section aria-label="Saklar balas otomatis per akun" className="card">
        <p className="px-4 py-3 border-b border-line bg-subtle rounded-t-2xl text-xs font-semibold text-muted uppercase tracking-wide">
          Akun ({on} menyala dari {data.accounts.length})
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
                label={`Balas komentar otomatis ${accountHandle(a)}`}
              />
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Komentar terbaru" className="card">
        <p className="px-4 py-3 border-b border-line bg-subtle rounded-t-2xl text-xs font-semibold text-muted uppercase tracking-wide">
          Komentar terbaru
        </p>
        {data.items.length === 0 ? (
          <div className="p-8 text-center">
            <div className="mx-auto w-12 h-12 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
              <MessageCircle className="w-6 h-6" />
            </div>
            <p className="mt-3 text-sm font-semibold text-fg">Belum ada komentar</p>
            <p className="mt-1 text-sm text-muted">Komentar baru dikirim Threads ke sini lewat webhook dan dibalas dalam hitungan detik.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {data.items.map((c) => {
              const a = byId.get(c.accountId);
              return <CommentRow key={c.id} c={c} handle={a ? accountHandle(a) : "akun"} />;
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
