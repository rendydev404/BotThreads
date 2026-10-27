"use client";

import React, { useState } from "react";
import { CalendarClock, Clock, FileText, ListChecks, Send, Sparkles, Target, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_BRIEF_CHARS } from "@/lib/content-validation";
import { AccountPicker } from "@/components/content/account-picker";
import { usePublishAccounts } from "@/components/content/use-publish-accounts";
import { OrchestratorCard, type OrchestratorPreset } from "@/components/orchestrator/orchestrator-card";
import { useOrchestrator, type PublishMode } from "@/components/orchestrator/orchestrator-store";
import { useT } from "@/components/i18n/lang-provider";
import { tr } from "@/lib/i18n/core";

type Action = "draft" | "now" | "schedule";

const ACTIONS: { action: Action; label: string; icon: React.ElementType }[] = [
  { action: "now", label: "Posting sekarang", icon: Send },
  { action: "schedule", label: "Jadwalkan otomatis", icon: CalendarClock },
  { action: "draft", label: "Draf saja", icon: FileText },
];

type Mode = "all" | "some" | "one";

const OPTIONS: { mode: Mode; title: string; icon: React.ElementType; desc: (ready: number) => string }[] = [
  { mode: "all", title: "Semua akun", icon: Users, desc: (n) => tr("{n} akun siap, satu agen per akun", { n }) },
  { mode: "some", title: "Beberapa akun", icon: ListChecks, desc: () => tr("Pilih sendiri akun mana saja") },
  { mode: "one", title: "Satu akun", icon: User, desc: () => tr("Fokus ke satu akun tertentu") },
];

/**
 * Dialog klarifikasi saat permintaan konten belum menyebut cakupan akun. Setelah dipilih, kartu ini
 * berubah menjadi Multi-Agent Orchestrator yang langsung berjalan untuk akun terpilih.
 */
export function ScopeDialog({
  sessionId,
  topic: initialTopic,
  time,
  publish,
}: {
  sessionId: string;
  topic: string;
  time: string | null;
  publish: PublishMode | null;
}) {
  const { state } = useOrchestrator(sessionId);
  const t = useT();
  const { accounts, loading } = usePublishAccounts();
  const [mode, setMode] = useState<Mode>("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [topic, setTopic] = useState(initialTopic);
  const [preset, setPreset] = useState<OrchestratorPreset | null>(null);
  const [action, setAction] = useState<Action>(publish?.mode ?? "draft");

  if (preset || state.launched) return <OrchestratorCard sessionId={sessionId} preset={preset ?? undefined} />;

  const ready = accounts.filter((a) => a.ready).length;
  const ids = mode === "all" ? null : mode === "one" ? picked.slice(0, 1) : picked;
  const count = ids ? ids.length : ready;
  const canStart = !loading && count > 0;

  return (
    <div className="mt-3 rounded-2xl border border-line bg-surface overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-line bg-subtle flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-accent-soft text-accent flex items-center justify-center shrink-0">
          <Target className="w-4 h-4" />
        </div>
        <div className="min-w-0 leading-tight">
          <h3 className="text-sm font-semibold text-fg">{t("Untuk akun mana?")}</h3>
          <p className="text-xs text-muted">{t("AI menulis satu draf per akun dengan gaya dan jam ramai akunnya sendiri.")}</p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div role="radiogroup" aria-label={t("Cakupan akun")} className="grid gap-2 sm:grid-cols-3">
          {OPTIONS.map((o) => {
            const active = mode === o.mode;
            const Icon = o.icon;
            return (
              <button
                key={o.mode}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  setMode(o.mode);
                  if (o.mode === "one") setPicked((p) => p.slice(0, 1));
                }}
                className={cn(
                  "text-left rounded-xl border p-3 transition-colors cursor-pointer",
                  active ? "border-accent bg-accent-soft/60 ring-1 ring-accent" : "border-line hover:border-line-strong hover:bg-subtle"
                )}
              >
                <span
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center",
                    active ? "bg-accent text-on-accent" : "bg-subtle text-muted"
                  )}
                >
                  <Icon className="w-4 h-4" />
                </span>
                <span className="mt-2 block text-sm font-semibold text-fg">{t(o.title)}</span>
                <span className="block text-xs text-muted">{loading && o.mode === "all" ? t("Memuat akun…") : o.desc(ready)}</span>
              </button>
            );
          })}
        </div>

        {mode !== "all" && (
          <AccountPicker
            accounts={accounts}
            value={mode === "one" ? picked.slice(0, 1) : picked}
            onChange={setPicked}
            multiple={mode === "some"}
            max={100}
            loading={loading}
            placeholder={mode === "some" ? t("Pilih beberapa akun") : t("Pilih satu akun")}
          />
        )}

        <div>
          <label htmlFor={`${sessionId}-scope-topic`} className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
            {t("Topik (opsional)")}
          </label>
          <input
            id={`${sessionId}-scope-topic`}
            type="text"
            maxLength={MAX_BRIEF_CHARS}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={t("Kosongkan agar tiap akun memilih topik dari niche-nya sendiri")}
            className="w-full h-10 px-3 bg-surface border border-line rounded-lg text-sm text-fg placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/20 hover:border-muted transition-colors"
          />
        </div>

        <div>
          <span className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">{t("Setelah draf jadi")}</span>
          <div role="radiogroup" aria-label={t("Tindakan")} className="flex flex-wrap gap-1.5">
            {ACTIONS.map((a) => {
              const Icon = a.icon;
              const active = action === a.action;
              return (
                <button
                  key={a.action}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setAction(a.action)}
                  className={cn(
                    "h-8 px-3 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors cursor-pointer",
                    active ? "bg-accent text-on-accent border-accent" : "border-line-strong text-fg hover:border-accent hover:text-accent"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t(a.label)}
                </button>
              );
            })}
          </div>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Clock className="w-3.5 h-3.5" />
          {action === "now"
            ? t("Langsung masuk antrean terbit; tiap draf masih bisa dibatalkan.")
            : action === "schedule"
              ? t("Dijadwalkan ke {when}{day}; bisa dibatalkan.", {
                  when: time ? `${time} WIB` : t("jam ramai masing-masing akun"),
                  day: publish?.dayOffset === 1 ? ` ${t("besok")}` : publish?.dayOffset === 2 ? ` ${t("lusa")}` : "",
                })
              : t("Ditinjau dulu sebelum dijadwalkan. Jam: {when}.", { when: time ? `${time} WIB` : t("jam ramai masing-masing akun") })}
        </p>

        <button
          type="button"
          disabled={!canStart}
          onClick={() =>
            setPreset({
              accountIds: ids,
              topic: topic.trim(),
              time,
              publish:
                action === "draft"
                  ? null
                  : { mode: action, dayOffset: publish?.dayOffset ?? null, hourWib: publish?.hourWib ?? null },
            })
          }
          className="w-full h-10 rounded-lg bg-accent text-on-accent text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Sparkles className="w-4 h-4" />
          {count === 0
            ? t("Pilih akun dulu")
            : action === "now"
              ? t("Tulis & posting ke {n} akun", { n: count })
              : action === "schedule"
                ? t("Tulis & jadwalkan {n} akun", { n: count })
                : t("Buat draf untuk {n} akun", { n: count })}
        </button>
      </div>
    </div>
  );
}
