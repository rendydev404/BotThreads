"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Sparkles, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";
import { saveAutopilotSettings } from "@/lib/autopilot-client";
import { ContentApiError } from "@/lib/content-client";
import { VOICE_STYLES, type VoiceStyle } from "@/lib/autopilot-types";

export interface RolePromptProfileDTO {
  accountId: string;
  handle: string;
  brief: string;
  pillars: string[];
  voiceStyle: VoiceStyle | null;
  current?: { brief: string; pillars: string[]; voiceStyle: VoiceStyle | null };
}

const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/** Satu baris "sebelum -> sesudah"; bagian yang tidak berubah ditandai. */
function Change({ label, before, after, unchanged }: { label: string; before: React.ReactNode; after: React.ReactNode; unchanged: boolean }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="mt-1 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-subtle p-2.5">
          <p className="text-[11px] font-semibold text-muted mb-1">Sebelum</p>
          <div className="max-h-56 overflow-auto whitespace-pre-line text-muted leading-relaxed">{before}</div>
        </div>
        <div className="rounded-lg bg-accent-soft/60 border border-accent/25 p-2.5">
          <p className="text-[11px] font-semibold text-accent mb-1">Sesudah{unchanged ? " (sama)" : ""}</p>
          <div className="max-h-56 overflow-auto whitespace-pre-line text-fg leading-relaxed">{after}</div>
        </div>
      </dd>
    </div>
  );
}

const chips = (list: string[], tone: "accent" | "muted") =>
  list.length ? (
    <div className="flex flex-wrap gap-1.5">
      {list.map((p) => (
        <span
          key={p}
          className={cn(
            "h-6 px-2.5 rounded-full text-xs font-semibold inline-flex items-center",
            tone === "accent" ? "bg-accent-soft text-accent" : "bg-surface text-muted"
          )}
        >
          {p}
        </span>
      ))}
    </div>
  ) : (
    <span className="text-xs">-</span>
  );

const BTN =
  "h-9 px-3.5 rounded-full text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [
    copied,
    (text: string) => {
      void navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1800);
        })
        .catch(() => undefined);
    },
  ];
}

/** Blok ```prompt di jawaban asisten: prompt peran utuh dengan tombol salin. */
export function PromptBlock({ text }: { text: string }) {
  const [copied, copy] = useCopied();
  return (
    <div className="rounded-xl border border-accent/30 bg-accent-soft/40 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-accent/20">
        <Sparkles className="w-4 h-4 text-accent shrink-0" />
        <span className="text-xs font-bold text-fg flex-1">Prompt peran siap pakai</span>
        <span className="text-[11px] text-muted tabular-nums">{text.trim().split(/\s+/).length} kata</span>
        <button type="button" onClick={() => copy(text.trim())} className={cn(BTN, "h-8 px-3 bg-accent text-on-accent hover:bg-accent-hover")}>
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Tersalin" : "Salin prompt"}
        </button>
      </div>
      <pre className="max-h-[28rem] overflow-auto p-3 text-[13px] leading-relaxed text-fg whitespace-pre-wrap break-words font-mono">{text.trim()}</pre>
    </div>
  );
}

/**
 * Versi ringkas prompt peran untuk Profil AI akun (peran, kategori topik, gaya sapaan). "Terapkan" menyimpan ke
 * pengaturan akun; karena topiknya berubah, agen otomatis riset tren dan menyusun ide baru dari profil ini.
 */
export function RolePromptCard({ profile }: { profile: RolePromptProfileDTO }) {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const cur = profile.current;
  const briefSame = !!cur && same(cur.brief, profile.brief);

  const apply = async () => {
    setState("saving");
    setError(null);
    const bobot = Math.max(1, Math.floor(100 / Math.max(1, profile.pillars.length)));
    try {
      await saveAutopilotSettings(profile.accountId, {
        brief: profile.brief,
        ...(profile.pillars.length ? { pillars: profile.pillars.map((key) => ({ key, bobot })) } : {}),
        ...(profile.voiceStyle ? { voiceStyle: profile.voiceStyle } : {}),
      });
      setState("saved");
    } catch (e) {
      setState("idle");
      setError(e instanceof ContentApiError ? e.message : "Profil AI gagal disimpan. Coba lagi.");
    }
  };

  return (
    <div className="mt-3 rounded-2xl border border-line bg-surface p-4 space-y-3">
      <div className="flex items-center gap-2">
        <UserCog className="w-4 h-4 text-accent shrink-0" />
        <p className="text-sm font-bold text-fg">Profil AI baru untuk {profile.handle}</p>
        <span className="ml-auto text-[11px] text-muted tabular-nums">{profile.brief.length.toLocaleString("id-ID")} karakter</span>
      </div>
      <dl className="space-y-3 text-[13px]">
        {cur ? (
          <>
            <Change label="Peran & tema akun" before={cur.brief || "-"} after={profile.brief} unchanged={briefSame} />
            {profile.pillars.length > 0 && (
              <Change label="Kategori topik" before={chips(cur.pillars, "muted")} after={chips(profile.pillars, "accent")} unchanged={false} />
            )}
            {profile.voiceStyle && (
              <Change
                label="Gaya sapaan"
                before={cur.voiceStyle ? VOICE_STYLES[cur.voiceStyle].label : "Otomatis"}
                after={VOICE_STYLES[profile.voiceStyle].label}
                unchanged={false}
              />
            )}
          </>
        ) : (
          <>
            <div>
              <dt className="text-xs font-semibold text-muted">Peran & tema akun</dt>
              <dd className="mt-0.5 max-h-56 overflow-auto whitespace-pre-line text-fg leading-relaxed">{profile.brief}</dd>
            </div>
            {profile.pillars.length > 0 && (
              <div>
                <dt className="text-xs font-semibold text-muted">Kategori topik</dt>
                <dd className="mt-1">{chips(profile.pillars, "accent")}</dd>
              </div>
            )}
          </>
        )}
      </dl>
      {briefSame && (
        <p className="text-xs font-medium text-warning">Peran ini sama dengan Profil AI sekarang. Minta AI menyusun ulang bila ingin versi yang berbeda.</p>
      )}
      {error && <p className="rounded-lg bg-danger-soft text-danger p-2.5 text-[13px] font-medium">{error}</p>}
      {state === "saved" ? (
        <p className="rounded-lg bg-success-soft text-success p-2.5 text-[13px] font-medium flex items-start gap-2">
          <Check className="w-4 h-4 mt-0.5 shrink-0" />
          Profil AI {profile.handle} diperbarui ({profile.brief.length} karakter). Buka ulang Atur autopilot untuk melihatnya. AI otomatis riset
          tren dan menyusun ide baru dari profil ini; pantau di Radar &gt; Ide.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void apply()} disabled={state === "saving"} className={cn(BTN, "bg-accent text-on-accent hover:bg-accent-hover")}>
            {state === "saving" ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCog className="w-4 h-4" />}
            Terapkan ke Profil AI
          </button>
          <p className="text-xs text-muted">Mengganti peran, kategori topik, dan gaya sapaan akun ini.</p>
        </div>
      )}
    </div>
  );
}
