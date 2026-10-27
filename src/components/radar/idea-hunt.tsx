"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchOnboarding, type OnboardingDTO, type OnboardStepKey, type OnboardStepStatus } from "@/lib/ai-client";
import { AgentSteps, type AgentStepStatus } from "@/components/ai/agent-ui";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { useT } from "@/components/i18n/lang-provider";
import { tr } from "@/lib/i18n/core";

const LABELS: Record<OnboardStepKey, string> = {
  baca: "Membaca postingan & metrik akun",
  kenali: "Membaca Profil AI terbaru akun",
  riset: "Mencari tren viral di niche akun",
  ide: "Menyusun ide baru (ide lama diganti)",
  tulis: "Menyiapkan postingan berikutnya",
};
const STATUS: Record<OnboardStepStatus, AgentStepStatus> = {
  MENUNGGU: "pending",
  BERJALAN: "active",
  SELESAI: "done",
  DILEWATI: "skipped",
  GAGAL: "failed",
};
const POLL_MS = 2500;

interface AccountLite {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Progres agen pencari ide. Agen berjalan OTOMATIS saat peran/tema, kategori topik, atau gaya sapaan akun
 * diubah (atau autopilot baru dinyalakan): riset tren niche, lalu ide baru dari Profil AI terbaru, dan ide
 * lama yang belum disematkan diganti. Panel ini hanya muncul selama agen bekerja (dan ringkasannya sesudahnya);
 * polling ringan hanya selama itu dan selama tab terlihat. Saat selesai daftar ide dimuat ulang.
 */
export function IdeaAgentProgress({ accounts, onDone }: { accounts: AccountLite[]; onDone: (summary: string) => void }) {
  const t = useT();
  const [items, setItems] = useState<OnboardingDTO[]>([]);
  const [watching, setWatching] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const watchRef = useRef<string[]>([]);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  // Saat tab dibuka: pantau agen yang sedang berjalan (mis. baru saja menyimpan Profil AI).
  useEffect(() => {
    let alive = true;
    void fetchOnboarding()
      .then((res) => {
        if (!alive) return;
        const running = res.items.filter((i) => i.status === "BERJALAN").map((i) => i.accountId);
        if (!running.length) return;
        watchRef.current = running;
        setWatching(running);
        setItems(res.items.filter((i) => running.includes(i.accountId)));
        setOpen(true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!watching.length) return;
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const res = await fetchOnboarding().catch(() => null);
      if (!res) return;
      const watched = res.items.filter((i) => watchRef.current.includes(i.accountId));
      setItems(watched);
      if (watched.length && watched.every((i) => i.status !== "BERJALAN")) {
        watchRef.current = [];
        setWatching([]);
        const ide = watched.map((i) => i.steps.find((s) => s.key === "ide")?.detail).filter((d): d is string => !!d);
        onDoneRef.current(
          ide.length ? tr("Ide baru siap: {list}", { list: ide.map((d) => tr(d)).join(" · ") }) : tr("Pencarian ide selesai.")
        );
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [watching]);

  if (!open) return null;
  const busy = watching.length > 0;
  const byId = new Map(accounts.map((a) => [a.id, a]));

  return (
    <div className="card p-4 space-y-3" aria-live="polite">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-fg">{busy ? t("AI sedang mencari ide baru") : t("Ide sudah diperbarui")}</p>
          <p className="text-xs text-muted">
            {t("Berjalan otomatis karena Profil AI akun diubah. Ide lama yang belum disematkan diganti setelah ide baru masuk.")}
          </p>
        </div>
        {!busy && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("Tutup")}
            className="w-8 h-8 rounded-full text-muted hover:text-fg hover:bg-subtle inline-flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className={cn("grid gap-4", items.length > 1 && "md:grid-cols-2")}>
        {items.map((it) => {
          const a = byId.get(it.accountId);
          return (
            <div key={it.accountId} className="rounded-xl bg-subtle p-3">
              <div className="mb-2.5 flex items-center gap-2">
                <AccountAvatar name={a?.displayName ?? t("Akun")} src={a?.avatarUrl ?? null} size="w-7 h-7" />
                <span className="text-[13px] font-semibold text-fg truncate">@{a?.username ?? a?.displayName ?? t("akun")}</span>
              </div>
              <AgentSteps
                steps={it.steps.map((s) => ({ key: s.key, label: t(LABELS[s.key]), status: STATUS[s.status], detail: s.detail ? t(s.detail) : s.detail, items: s.items }))}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
