"use client";

import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Edit3,
  ExternalLink,
  Loader2,
  Megaphone,
  MessageSquare,
  Play,
  Quote,
  RefreshCw,
  Repeat2,
  RotateCcw,
  Send,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Users,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  actAdminBuzzerCampaign,
  deployAdminBuzzer,
  fetchAdminBuzzerCampaigns,
  fetchAdminBuzzerOverview,
  fetchAdminBuzzerPosts,
  generateAdminBuzzerProfilesAI,
  previewAdminBuzzerDrafts,
  runAdminBuzzerQueue,
  saveAdminBuzzerProfiles,
} from "@/lib/admin-client";
import { VOICE_STYLES, type VoiceStyle } from "@/lib/autopilot-types";
import {
  BUZZER_ACTIONS,
  BUZZER_ACTION_LABELS,
  BUZZER_TIMING_PRESETS,
  NICHE_RELATION_META,
  type BuzzerAccountDTO,
  type BuzzerAction,
  type BuzzerCampaignDTO,
  type BuzzerCampaignListResponse,
  type BuzzerCampaignStatus,
  type BuzzerDraftItem,
  type BuzzerNicheRelation,
  type BuzzerOverviewResponse,
  type BuzzerPostsResponse,
  type BuzzerTargetAccountDTO,
  type BuzzerTargetPostDTO,
} from "@/lib/buzzer-types";
import { ConfirmModal } from "@/components/autopilot/confirm-modal";
import { Banner, ListSkeleton } from "@/components/autopilot/shared";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { FormError, TextAreaField, TextField } from "@/components/settings/fields";
import { errorText, formatDateWib, formatInt } from "@/components/settings/format";
import { BTN_OUTLINE, BTN_PRIMARY, EmptyState, Pill, RefreshButton } from "@/components/settings/states";
import { useRemote } from "@/components/settings/use-remote";
import {
  AdminLoadError,
  FilterChips,
  RefreshError,
  SEARCH_DEBOUNCE_MS,
  SearchField,
  useAdmin,
  useDebounced,
  type ChipOption,
} from "./shared";
import { Panel, StatStrip, Toolbar } from "./ui";

type SectionTab = "KERAHKAN" | "RIWAYAT" | "NICHE";

const SECTION_CHIPS: ChipOption<SectionTab>[] = [
  { value: "KERAHKAN", label: "Kerahkan Buzzer" },
  { value: "RIWAYAT", label: "Riwayat & Antrean" },
  { value: "NICHE", label: "Niche & Persona Buzzer" },
];

const ACTION_ICONS: Record<BuzzerAction, React.ComponentType<{ className?: string }>> = {
  KOMEN: MessageSquare,
  REPOST: Repeat2,
  QUOTE: Quote,
};

const VOICE_OPTIONS: { key: VoiceStyle; label: string; desc: string }[] = [
  { key: "aku_kamu", label: "Aku / Kamu (Hangat & Kasual)", desc: "Akrab, ramah, cocok untuk ibu muda, anak kos, atau pekerja kantor" },
  { key: "gue_lo", label: "Gue / Lo (Santai & Anak Muda)", desc: "Gaya obrolan tongkrongan, mahasiswa, atau kerja kreatif/IT" },
  { key: "saya_kamu", label: "Saya / Kak (Sopan & Natural)", desc: "Sopan namun tetap ringan seperti netizen sehari-hari" },
  { key: "kita", label: "Kita / Bareng (Komunitas)", desc: "Inklusif dan hangat seperti teman satu lingkaran" },
];

/* ------------------------------------------------------------------ Modal Edit Niche & Persona Satu Akun */

function EditBuzzerProfileModal({
  buzzer,
  onClose,
  onSaved,
}: {
  buzzer: BuzzerAccountDTO;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { guard } = useAdmin();
  const [aktif, setAktif] = useState(buzzer.aktif);
  const [niche, setNiche] = useState(buzzer.niche);
  const [persona, setPersona] = useState(buzzer.persona);
  const [voiceStyle, setVoiceStyle] = useState<VoiceStyle>(
    buzzer.voiceStyle && buzzer.voiceStyle in VOICE_STYLES ? buzzer.voiceStyle : "aku_kamu"
  );
  const [catatan, setCatatan] = useState(buzzer.catatan ?? "");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleAiSuggest = async () => {
    setAiBusy(true);
    setErr(null);
    try {
      const res = await guard(generateAdminBuzzerProfilesAI([buzzer.accountId]));
      const first = res.items?.[0];
      if (first) {
        setNiche(first.niche);
        setPersona(first.persona);
        setVoiceStyle(first.voiceStyle);
      }
      onSaved();
    } catch (e) {
      setErr(errorText(e, "Gagal menyusun saran niche dengan AI."));
    } finally {
      setAiBusy(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await guard(
        saveAdminBuzzerProfiles([
          {
            accountId: buzzer.accountId,
            aktif,
            niche,
            persona,
            voiceStyle,
            catatan: catatan.trim() || null,
            inferredFrom: "MANUAL",
          },
        ])
      );
      onSaved();
      onClose();
    } catch (e) {
      setErr(errorText(e, "Gagal menyimpan profil buzzer."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      onClose={busy ? () => undefined : onClose}
      title="Atur Niche & Persona Buzzer"
      description={`@${buzzer.username ?? buzzer.displayName}${buzzer.outletNama ? ` · ${buzzer.outletNama}` : ""}`}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy || aiBusy}>
            Batal
          </ModalButton>
          <ModalButton variant="primary" type="submit" form="buzzer-profile-form" disabled={busy || aiBusy}>
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Simpan Profil
          </ModalButton>
        </>
      }
    >
      <form id="buzzer-profile-form" onSubmit={handleSave} className="space-y-4">
        <FormError message={err} />

        <div className="flex items-center justify-between gap-3 rounded-xl bg-subtle p-3.5 border border-line">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-fg">Status Akun Buzzer</p>
            <p className="text-xs text-muted">Akun nonaktif tidak akan diikutkan saat memilih buzzer otomatis.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={aktif}
            onClick={() => setAktif((v) => !v)}
            className={cn(
              "h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0",
              aktif ? "bg-success-soft text-success" : "bg-surface text-muted border border-line"
            )}
          >
            {aktif ? <Check className="w-3.5 h-3.5" /> : null}
            {aktif ? "Aktif" : "Nonaktif"}
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted">
            Isi niche dan karakter bicara agar komentar lintas-niche terasa seperti manusia asli.
          </p>
          <button
            type="button"
            disabled={busy || aiBusy}
            onClick={handleAiSuggest}
            className={cn(BTN_OUTLINE, "h-8 px-2.5 text-xs shrink-0")}
          >
            {aiBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-accent" />}
            Susun dengan AI
          </button>
        </div>

        <TextField
          label="Niche Akun Buzzer"
          value={niche}
          onChange={setNiche}
          maxLength={140}
          showCount
          placeholder="Contoh: Ibu rumah tangga, parenting anak SD & masak praktis"
          hint="Menentukan apakah topik postingan target tergolong Sejalur, Jembatan Niche, atau Lintas Jauh."
        />

        <TextAreaField
          label="Persona & Karakter Bicara"
          value={persona}
          onChange={setPersona}
          maxLength={280}
          rows={3}
          placeholder="Contoh: Ibu 2 anak SD yang hangat, suka cerita keseharian rumah dan cemilan keluarga, ketikan santai di HP"
          hint="Dipakai AI untuk menyesuaikan kosakata, sudut pandang, dan cara nimbrung di kolom komentar."
        />

        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-fg">Gaya Sapaan (Kata Ganti)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Gaya sapaan buzzer">
            {VOICE_OPTIONS.map((opt) => {
              const on = voiceStyle === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setVoiceStyle(opt.key)}
                  className={cn(
                    "p-2.5 rounded-xl border text-left transition-colors cursor-pointer flex items-start justify-between gap-2",
                    on ? "bg-accent-soft border-accent text-accent" : "bg-subtle border-transparent text-fg hover:border-line"
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold">{opt.label}</span>
                    <span className={cn("block text-[11px] mt-0.5", on ? "text-accent" : "text-muted")}>{opt.desc}</span>
                  </span>
                  {on && <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                </button>
              );
            })}
          </div>
        </div>

        <TextField
          label="Catatan Khusus (Opsional)"
          value={catatan}
          onChange={setCatatan}
          maxLength={200}
          showCount
          placeholder="Contoh: Hindari istilah teknis Inggris, sering sebut suasana malam di kosan"
        />

        {buzzer.samplePosts.length > 0 && (
          <div className="rounded-xl bg-subtle p-3 border border-line space-y-1.5">
            <p className="text-xs font-semibold text-muted">Contoh Postingan Terakhir Akun Ini:</p>
            {buzzer.samplePosts.map((sp, i) => (
              <p key={i} className="text-xs text-fg leading-relaxed line-clamp-2">
                &ldquo;{sp}&rdquo;
              </p>
            ))}
          </div>
        )}
      </form>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ Modal Rincian Kampanye */

function CampaignDetailModal({
  campaign,
  canManage,
  onClose,
  onChanged,
}: {
  campaign: BuzzerCampaignDTO;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { guard } = useAdmin();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const hasPending = campaign.tasks.some((t) => t.status === "TERJADWAL" || t.status === "DIPROSES");
  const hasFailed = campaign.tasks.some((t) => t.status === "GAGAL");

  const runAction = async (action: "CANCEL" | "RETRY_FAILED" | "RUN_NOW") => {
    setBusyAction(action);
    setErr(null);
    try {
      await guard(actAdminBuzzerCampaign(campaign.id, action));
      onChanged();
    } catch (e) {
      setErr(errorText(e, "Gagal menjalankan aksi kampanye."));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <ModalShell
      open
      onClose={busyAction ? () => undefined : onClose}
      title={`Pengerahan ke @${campaign.targetUsername}`}
      description={`${formatInt(campaign.doneTasks)}/${formatInt(campaign.totalTasks)} selesai · Dibuat ${formatDateWib(campaign.createdAt)}`}
      size="lg"
      footer={
        <>
          {canManage && hasPending && (
            <ModalButton
              variant="danger"
              disabled={!!busyAction}
              onClick={() => runAction("CANCEL")}
            >
              {busyAction === "CANCEL" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Batalkan Sisa Antrean
            </ModalButton>
          )}
          {canManage && hasFailed && (
            <ModalButton
              disabled={!!busyAction}
              onClick={() => runAction("RETRY_FAILED")}
            >
              {busyAction === "RETRY_FAILED" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5" />
              )}
              Coba Ulang yang Gagal
            </ModalButton>
          )}
          {canManage && hasPending && (
            <ModalButton
              variant="primary"
              disabled={!!busyAction}
              onClick={() => runAction("RUN_NOW")}
            >
              {busyAction === "RUN_NOW" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              Eksekusi Antrean Sekarang
            </ModalButton>
          )}
          <ModalButton onClick={onClose} disabled={!!busyAction}>
            Tutup
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={err} />

        <div className="rounded-xl bg-subtle p-3.5 border border-line space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-fg">
              Postingan Target (@{campaign.targetUsername})
              {campaign.targetNiche ? ` · Niche: ${campaign.targetNiche}` : ""}
            </span>
            {campaign.targetPermalink && (
              <a
                href={campaign.targetPermalink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
              >
                Buka di Threads
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          <p className="text-xs text-muted leading-relaxed line-clamp-3">{campaign.targetText || "(Tanpa teks)"}</p>
        </div>

        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {campaign.tasks.map((t) => {
            const ActionIcon = ACTION_ICONS[t.action] ?? MessageSquare;
            const relMeta = t.nicheRelation ? NICHE_RELATION_META[t.nicheRelation] : null;
            const statusTone =
              t.status === "BERHASIL"
                ? "success"
                : t.status === "GAGAL"
                  ? "danger"
                  : t.status === "DIBATALKAN"
                    ? "neutral"
                    : "warning";

            return (
              <div key={t.id} className="rounded-xl border border-line bg-surface p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-7 h-7 rounded-lg bg-subtle text-fg flex items-center justify-center shrink-0">
                      <ActionIcon className="w-3.5 h-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-fg truncate">
                        @{t.buzzerUsername ?? t.buzzerDisplayName}
                        <span className="ml-1.5 font-normal text-muted">· {BUZZER_ACTION_LABELS[t.action].label}</span>
                      </p>
                      {t.buzzerNiche && <p className="text-[11px] text-muted truncate">Niche: {t.buzzerNiche}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {relMeta && <Pill tone={relMeta.tone}>{relMeta.label}</Pill>}
                    <Pill tone={statusTone}>{t.status}</Pill>
                  </div>
                </div>

                {t.text && (
                  <p className="text-xs text-fg bg-subtle rounded-lg px-3 py-2 leading-relaxed">
                    &ldquo;{t.text}&rdquo;
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                  <span>
                    {t.executedAt ? `Terkirim ${formatDateWib(t.executedAt)}` : `Dijadwalkan ${formatDateWib(t.scheduledAt)}`}
                  </span>
                  {t.resultPermalink && (
                    <a
                      href={t.resultPermalink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-accent hover:underline"
                    >
                      Lihat Hasil
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                {t.lastError && (
                  <p className="text-xs text-danger bg-danger-soft/60 rounded-lg px-2.5 py-1.5">{t.lastError}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ Komponen Utama BuzzerTab */

export function BuzzerTab() {
  const { guard, rev, can } = useAdmin();
  const canManage = can("buzzer.kelola");

  const [section, setSection] = useState<SectionTab>("KERAHKAN");
  const [notice, setNotice] = useState<{ tone: "info" | "warning" | "danger"; text: string } | null>(null);

  // Data utama overview buzzer
  const overview = useRemote<BuzzerOverviewResponse>(
    `admin-buzzer-overview:${rev.buzzer}`,
    (signal) => guard(fetchAdminBuzzerOverview(signal)),
    "Gagal memuat data Workspace Buzzer."
  );

  // State pengerahan on-demand
  const [targetSearch, setTargetSearch] = useState("");
  const [selectedTarget, setSelectedTarget] = useState<BuzzerTargetAccountDTO | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualMediaId, setManualMediaId] = useState("");
  const [manualUsername, setManualUsername] = useState("");
  const [manualNiche, setManualNiche] = useState("");
  const [manualText, setManualText] = useState("");
  const [selectedPost, setSelectedPost] = useState<BuzzerTargetPostDTO | null>(null);

  const [selectedActions, setSelectedActions] = useState<BuzzerAction[]>(["KOMEN"]);
  const [timingKey, setTimingKey] = useState<string>("cepat");
  const [catatanAdmin, setCatatanAdmin] = useState("");
  const [buzzerSearch, setBuzzerSearch] = useState("");
  const [selectedBuzzerIds, setSelectedBuzzerIds] = useState<string[]>([]);

  // Pratinjau & custom draft komentar/quote lintas-niche
  const [drafts, setDrafts] = useState<BuzzerDraftItem[]>([]);
  const [detectedTargetNiche, setDetectedTargetNiche] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [deployBusy, setDeployBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // State tab Riwayat
  const [campaignStatusFilter, setCampaignStatusFilter] = useState<BuzzerCampaignStatus | "ALL">("ALL");
  const [campaignRev, setCampaignRev] = useState(0);
  const [inspectCampaign, setInspectCampaign] = useState<BuzzerCampaignDTO | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);

  // State tab Niche & Persona
  const [nicheSearch, setNicheSearch] = useState("");
  const [editingBuzzer, setEditingBuzzer] = useState<BuzzerAccountDTO | null>(null);
  const [aiBulkBusy, setAiBulkBusy] = useState(false);
  const [confirmAiBulk, setConfirmAiBulk] = useState(false);

  // Muat daftar postingan saat akun target dipilih
  const targetAccountId = selectedTarget?.accountId ?? "";
  const targetPosts = useRemote<BuzzerPostsResponse>(
    targetAccountId ? `admin-buzzer-posts:${targetAccountId}:${campaignRev}` : null,
    (signal) => guard(fetchAdminBuzzerPosts(targetAccountId, true, signal)),
    "Gagal memuat postingan akun target."
  );

  // Muat riwayat kampanye saat tab RIWAYAT dibuka atau setelah deploy
  const campaignsRemote = useRemote<BuzzerCampaignListResponse>(
    `admin-buzzer-campaigns:${campaignStatusFilter}:${campaignRev}:${rev.buzzer}`,
    (signal) =>
      guard(
        fetchAdminBuzzerCampaigns(
          { status: campaignStatusFilter === "ALL" ? null : campaignStatusFilter },
          signal
        )
      ),
    "Gagal memuat riwayat pengerahan buzzer."
  );

  const debouncedTargetQ = useDebounced(targetSearch, SEARCH_DEBOUNCE_MS).toLowerCase().trim();
  const debouncedBuzzerQ = useDebounced(buzzerSearch, SEARCH_DEBOUNCE_MS).toLowerCase().trim();
  const debouncedNicheQ = useDebounced(nicheSearch, SEARCH_DEBOUNCE_MS).toLowerCase().trim();

  const filteredTargets = useMemo(() => {
    const list = overview.data?.targets ?? [];
    if (!debouncedTargetQ) return list;
    return list.filter(
      (t) =>
        (t.username ?? "").toLowerCase().includes(debouncedTargetQ) ||
        t.displayName.toLowerCase().includes(debouncedTargetQ) ||
        t.tenantNama.toLowerCase().includes(debouncedTargetQ) ||
        (t.outletNama ?? "").toLowerCase().includes(debouncedTargetQ)
    );
  }, [overview.data?.targets, debouncedTargetQ]);

  const readyBuzzers = useMemo(
    () => (overview.data?.buzzers ?? []).filter((b) => b.ready),
    [overview.data?.buzzers]
  );

  const filteredBuzzersForDeploy = useMemo(() => {
    const list = overview.data?.buzzers ?? [];
    if (!debouncedBuzzerQ) return list;
    return list.filter(
      (b) =>
        (b.username ?? "").toLowerCase().includes(debouncedBuzzerQ) ||
        b.displayName.toLowerCase().includes(debouncedBuzzerQ) ||
        b.niche.toLowerCase().includes(debouncedBuzzerQ) ||
        b.persona.toLowerCase().includes(debouncedBuzzerQ) ||
        (b.outletNama ?? "").toLowerCase().includes(debouncedBuzzerQ)
    );
  }, [overview.data?.buzzers, debouncedBuzzerQ]);

  const filteredBuzzersForNiche = useMemo(() => {
    const list = overview.data?.buzzers ?? [];
    if (!debouncedNicheQ) return list;
    return list.filter(
      (b) =>
        (b.username ?? "").toLowerCase().includes(debouncedNicheQ) ||
        b.displayName.toLowerCase().includes(debouncedNicheQ) ||
        b.niche.toLowerCase().includes(debouncedNicheQ) ||
        b.persona.toLowerCase().includes(debouncedNicheQ) ||
        (b.outletNama ?? "").toLowerCase().includes(debouncedNicheQ)
    );
  }, [overview.data?.buzzers, debouncedNicheQ]);

  if (!overview.data && overview.loading) return <ListSkeleton label="Memuat data buzzer" rows={4} />;
  if (!overview.data && overview.error) {
    return <AdminLoadError message={overview.error} status={overview.status} onRetry={overview.reload} />;
  }
  if (!overview.data) return null;

  const { stats, buzzers, workspaces } = overview.data;

  const toggleAction = (act: BuzzerAction) => {
    setSelectedActions((prev) =>
      prev.includes(act) ? (prev.length > 1 ? prev.filter((x) => x !== act) : prev) : [...prev, act]
    );
  };

  const toggleBuzzer = (accountId: string) => {
    setSelectedBuzzerIds((prev) =>
      prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]
    );
  };

  const pickRandomBuzzers = (count: number) => {
    const pool = [...readyBuzzers];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    setSelectedBuzzerIds(pool.slice(0, count).map((b) => b.accountId));
  };

  const activeTargetMediaId = manualMode ? manualMediaId.trim() : selectedPost?.mediaId ?? "";
  const activeTargetText = manualMode ? manualText.trim() : selectedPost?.text ?? "";
  const activeTargetUsername = manualMode
    ? manualUsername.trim() || "threads"
    : selectedTarget?.username ?? selectedTarget?.displayName ?? "threads";
  const activeTargetNiche = manualMode
    ? manualNiche.trim()
    : selectedTarget?.brief || selectedTarget?.pillars.map((p) => p.key).join(", ") || "";

  const timingPreset = BUZZER_TIMING_PRESETS.find((p) => p.key === timingKey) ?? BUZZER_TIMING_PRESETS[1];

  const handlePreviewDrafts = async () => {
    setActionError(null);
    if (!activeTargetText || activeTargetText.length < 5) {
      setActionError("Pilih postingan target yang memiliki teks terlebih dahulu.");
      return;
    }
    if (selectedBuzzerIds.length === 0) {
      setActionError("Pilih minimal 1 akun buzzer terlebih dahulu.");
      return;
    }
    setPreviewBusy(true);
    try {
      const res = await guard(
        previewAdminBuzzerDrafts({
          targetUsername: activeTargetUsername,
          targetDisplayName: selectedTarget?.displayName ?? null,
          targetNiche: activeTargetNiche || null,
          targetText: activeTargetText,
          catatanAdmin: catatanAdmin.trim() || null,
          actions: selectedActions,
          buzzerAccountIds: selectedBuzzerIds,
        })
      );
      setDrafts(res.items);
      setDetectedTargetNiche(res.targetNiche);
    } catch (e) {
      setActionError(errorText(e, "Gagal menyusun pratinjau komentar lintas-niche."));
    } finally {
      setPreviewBusy(false);
    }
  };

  const handleDeploy = async () => {
    setActionError(null);
    if (!activeTargetMediaId) {
      setActionError("Pilih postingan target terlebih dahulu.");
      return;
    }
    if (selectedBuzzerIds.length === 0) {
      setActionError("Pilih minimal 1 akun buzzer yang akan dikerahkan.");
      return;
    }
    setDeployBusy(true);
    try {
      const res = await guard(
        deployAdminBuzzer({
          targetAccountId: manualMode ? null : selectedTarget?.accountId ?? null,
          targetUsername: activeTargetUsername,
          targetDisplayName: manualMode ? null : selectedTarget?.displayName ?? null,
          targetNiche: detectedTargetNiche || activeTargetNiche || null,
          targetMediaId: activeTargetMediaId,
          targetText: activeTargetText,
          targetPermalink: manualMode ? null : selectedPost?.permalink ?? null,
          targetPostedAt: manualMode ? null : selectedPost?.postedAt ?? null,
          actions: selectedActions,
          catatanAdmin: catatanAdmin.trim() || null,
          jedaMinDetik: timingPreset.minSec,
          jedaMaxDetik: timingPreset.maxSec,
          buzzerAccountIds: selectedBuzzerIds,
          customDrafts: drafts,
        })
      );
      setNotice({
        tone: "info",
        text: `Berhasil mengerahkan ${formatInt(res.inserted)} tugas buzzer ke postingan @${activeTargetUsername} (${formatInt(res.executedNow)} langsung tayang, sisanya berjalan sesuai jeda natural).`,
      });
      setDrafts([]);
      setCampaignRev((v) => v + 1);
      overview.reload();
      setSection("RIWAYAT");
    } catch (e) {
      setActionError(errorText(e, "Gagal mengerahkan buzzer."));
    } finally {
      setDeployBusy(false);
    }
  };

  const handleBulkGenerateNiche = async () => {
    setConfirmAiBulk(false);
    setAiBulkBusy(true);
    setNotice(null);
    try {
      const res = await guard(generateAdminBuzzerProfilesAI());
      setNotice({
        tone: "info",
        text: `Berhasil menyusun dan menyimpan niche serta persona untuk ${formatInt(res.updated)} akun buzzer.`,
      });
      overview.reload();
    } catch (e) {
      setNotice({
        tone: "danger",
        text: errorText(e, "Gagal menyusun niche otomatis untuk akun buzzer."),
      });
    } finally {
      setAiBulkBusy(false);
    }
  };

  const handleRunQueueNow = async () => {
    setQueueBusy(true);
    setNotice(null);
    try {
      const res = await guard(runAdminBuzzerQueue());
      setNotice({
        tone: "info",
        text:
          res.processed > 0
            ? `Antrean diproses: ${formatInt(res.succeeded)} interaksi berhasil tayang di Threads.`
            : "Tidak ada antrean yang tertunda saat ini.",
      });
      setCampaignRev((v) => v + 1);
      overview.reload();
    } catch (e) {
      setNotice({ tone: "danger", text: errorText(e, "Gagal memproses antrean buzzer.") });
    } finally {
      setQueueBusy(false);
    }
  };

  const buzzerMap = new Map(buzzers.map((b) => [b.accountId, b]));

  return (
    <div className="space-y-5">
      <RefreshError error={overview.error} onRetry={overview.reload} />
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      {/* KPI Ringkasan Buzzer */}
      <Panel
        title="Ringkasan Armada Buzzer"
        description={
          workspaces.length > 0
            ? `Sumber aktif: ${workspaces.map((w) => w.nama).join(", ")}`
            : "Workspace Buzzer terhubung"
        }
        action={
          <div className="flex items-center gap-2">
            {canManage && stats.queuedTasks > 0 && (
              <button
                type="button"
                disabled={queueBusy}
                onClick={handleRunQueueNow}
                className={cn(BTN_OUTLINE, "h-9 px-3 text-xs")}
              >
                {queueBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 text-accent" />}
                Proses Antrean ({formatInt(stats.queuedTasks)})
              </button>
            )}
            <RefreshButton busy={overview.refreshing} onClick={overview.reload} />
          </div>
        }
      >
        <StatStrip
          items={[
            {
              label: "Akun Buzzer Siap",
              value: `${formatInt(stats.readyBuzzers)} / ${formatInt(stats.totalBuzzers)}`,
              hint: `${formatInt(stats.profiledBuzzers)} akun sudah ber-niche`,
              tone: stats.readyBuzzers > 0 ? "success" : "warning",
            },
            {
              label: "Kampanye Pengerahan",
              value: formatInt(stats.totalCampaigns),
              hint: `${formatInt(stats.activeCampaigns)} kampanye sedang berjalan`,
              tone: stats.activeCampaigns > 0 ? "accent" : "neutral",
            },
            {
              label: "Interaksi Terkirim (24 Jam)",
              value: formatInt(stats.doneToday),
              hint: `Total sepanjang waktu: ${formatInt(stats.doneTotal)}`,
              tone: "success",
            },
            {
              label: "Antrean Terjadwal",
              value: formatInt(stats.queuedTasks),
              hint: "Menunggu jeda natural antar-buzzer",
              tone: stats.queuedTasks > 0 ? "warning" : "neutral",
            },
          ]}
        />
      </Panel>

      {/* Navigasi Sub-Tab */}
      <Toolbar>
        <FilterChips<SectionTab>
          ariaLabel="Menu pengerahan buzzer"
          value={section}
          onChange={setSection}
          options={SECTION_CHIPS}
        />
      </Toolbar>

      {/* ==================================================================== */}
      {/* TAB 1: KERAHKAN BUZZER (ON-DEMAND)                                   */}
      {/* ==================================================================== */}
      {section === "KERAHKAN" && (
        <div className="space-y-5">
          {/* LANGKAH 1: PILIH AKUN & POSTINGAN TARGET */}
          <Panel
            title="1. Pilih Akun & Postingan Target"
            description="Pilih akun Threads yang ingin diramaikan postingannya, lalu klik salah satu postingan terbarunya."
            action={
              <button
                type="button"
                onClick={() => {
                  setManualMode((v) => !v);
                  setDrafts([]);
                }}
                className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                {manualMode ? "Pilih dari Daftar Akun" : "Input ID Postingan Manual"}
              </button>
            }
          >
            {manualMode ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <TextField
                  label="ID Media Postingan Threads"
                  value={manualMediaId}
                  onChange={setManualMediaId}
                  placeholder="Contoh: 18054321987654321"
                  hint="ID numerik postingan Threads yang menjadi target."
                />
                <TextField
                  label="Username Akun Target"
                  value={manualUsername}
                  onChange={setManualUsername}
                  placeholder="Contoh: sukashawarmacibubur"
                />
                <TextField
                  label="Niche Akun Target (Opsional)"
                  value={manualNiche}
                  onChange={setManualNiche}
                  placeholder="Contoh: Kuliner Shawarma & Timur Tengah"
                />
                <div className="md:col-span-3">
                  <TextAreaField
                    label="Isi Teks Postingan Target"
                    value={manualText}
                    onChange={setManualText}
                    rows={3}
                    placeholder="Tempel isi teks postingan target di sini supaya AI buzzer dapat menyusun komentar lintas-niche yang nyambung..."
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Daftar Akun Target */}
                <div className="lg:col-span-5 space-y-3">
                  <SearchField
                    label="Cari akun target"
                    value={targetSearch}
                    onChange={setTargetSearch}
                    placeholder="Cari @username, cabang, atau workspace..."
                  />
                  <div
                    role="listbox"
                    aria-label="Daftar akun target"
                    className="max-h-80 overflow-y-auto rounded-xl border border-line divide-y divide-line bg-subtle/40"
                  >
                    {filteredTargets.length === 0 ? (
                      <div className="p-6 text-center text-xs text-muted">Tidak ada akun yang cocok dengan pencarian.</div>
                    ) : (
                      filteredTargets.map((acc) => {
                        const active = selectedTarget?.accountId === acc.accountId;
                        return (
                          <button
                            key={acc.accountId}
                            type="button"
                            role="option"
                            aria-selected={active}
                            onClick={() => {
                              setSelectedTarget(acc);
                              setSelectedPost(null);
                              setDrafts([]);
                            }}
                            className={cn(
                              "w-full px-3.5 py-2.5 text-left flex items-center justify-between gap-2.5 transition-colors cursor-pointer",
                              active ? "bg-accent-soft text-accent" : "hover:bg-subtle text-fg"
                            )}
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-semibold truncate">
                                @{acc.username ?? acc.displayName}
                                {acc.outletNama ? <span className="ml-1.5 font-normal opacity-80">· {acc.outletNama}</span> : null}
                              </p>
                              <p className={cn("text-[11px] truncate mt-0.5", active ? "text-accent" : "text-muted")}>
                                {acc.tenantNama}
                                {acc.brief ? ` · ${acc.brief}` : ""}
                              </p>
                            </div>
                            {active && <Check className="w-4 h-4 shrink-0" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Daftar Postingan Akun Target */}
                <div className="lg:col-span-7 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-fg">
                      {selectedTarget
                        ? `Postingan Terbaru @${selectedTarget.username ?? selectedTarget.displayName}`
                        : "Pilih akun di sebelah kiri untuk memuat daftar postingannya"}
                    </p>
                    {selectedTarget && (
                      <button
                        type="button"
                        onClick={targetPosts.reload}
                        disabled={targetPosts.loading || targetPosts.refreshing}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline cursor-pointer"
                      >
                        <RefreshCw className={cn("w-3.5 h-3.5", (targetPosts.loading || targetPosts.refreshing) && "animate-spin")} />
                        Muat Ulang Live
                      </button>
                    )}
                  </div>

                  {!selectedTarget ? (
                    <div className="h-72 rounded-xl border border-dashed border-line flex items-center justify-center p-6 text-center text-xs text-muted">
                      Pilih salah satu akun target di sebelah kiri untuk melihat postingan yang siap diramaikan.
                    </div>
                  ) : targetPosts.loading && !targetPosts.data ? (
                    <ListSkeleton label="Memuat postingan akun target" rows={3} />
                  ) : (targetPosts.data?.items.length ?? 0) === 0 ? (
                    <div className="h-72 rounded-xl border border-line bg-subtle/40 flex flex-col items-center justify-center p-6 text-center gap-2">
                      <p className="text-xs font-semibold text-fg">Belum ada postingan ditemukan untuk akun ini.</p>
                      <p className="text-xs text-muted max-w-sm">
                        Pastikan akun sudah menerbitkan postingan di Threads, atau gunakan tombol &ldquo;Input ID Postingan Manual&rdquo; di kanan atas.
                      </p>
                    </div>
                  ) : (
                    <div
                      role="listbox"
                      aria-label="Postingan akun target"
                      className="max-h-80 overflow-y-auto rounded-xl border border-line divide-y divide-line"
                    >
                      {targetPosts.data?.items.map((post) => {
                        const active = selectedPost?.mediaId === post.mediaId;
                        const totalBuzzer = post.buzzerKomen + post.buzzerRepost + post.buzzerQuote;
                        return (
                          <button
                            key={post.mediaId}
                            type="button"
                            role="option"
                            aria-selected={active}
                            onClick={() => {
                              setSelectedPost(post);
                              setDrafts([]);
                            }}
                            className={cn(
                              "w-full p-3.5 text-left transition-colors cursor-pointer space-y-2",
                              active ? "bg-accent-soft/70" : "hover:bg-subtle/60"
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-medium text-muted">
                                {formatDateWib(post.postedAt)} · ID: {post.mediaId}
                              </span>
                              <div className="flex items-center gap-1.5">
                                {totalBuzzer > 0 && (
                                  <Pill tone="success">{formatInt(totalBuzzer)} interaksi buzzer</Pill>
                                )}
                                {post.buzzerPending > 0 && (
                                  <Pill tone="warning">{formatInt(post.buzzerPending)} antrean</Pill>
                                )}
                                {active && <Pill tone="accent">Terpilih</Pill>}
                              </div>
                            </div>
                            <p className="text-xs text-fg leading-relaxed line-clamp-3">{post.text || "(Postingan tanpa teks)"}</p>
                            <div className="flex items-center gap-4 text-[11px] text-muted">
                              <span>{formatInt(post.views)} tayangan</span>
                              <span>{formatInt(post.likes)} suka</span>
                              <span>{formatInt(post.replies)} balasan</span>
                              <span>{formatInt(post.reposts)} repost</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Panel>

          {/* LANGKAH 2: KONFIGURASI AKSI, JEDA NATURAL, DAN PILIH AKUN BUZZER */}
          <Panel
            title="2. Pilih Aksi Interaksi & Akun Buzzer"
            description="Tentukan kombinasi aksi resmi API Threads, jeda waktu natural, dan akun buzzer yang akan dikerahkan."
          >
            <div className="space-y-5">
              {/* Pilihan Aksi & Jeda Waktu */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <p className="text-[13px] font-semibold text-fg">Aksi Buzzer (API Resmi Meta Threads)</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {BUZZER_ACTIONS.map((act) => {
                      const on = selectedActions.includes(act);
                      const Icon = ACTION_ICONS[act];
                      const meta = BUZZER_ACTION_LABELS[act];
                      return (
                        <button
                          key={act}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            toggleAction(act);
                            setDrafts([]);
                          }}
                          className={cn(
                            "p-3 rounded-xl border text-left transition-colors cursor-pointer flex flex-col justify-between gap-2",
                            on ? "bg-accent-soft border-accent text-accent" : "bg-subtle border-transparent text-fg hover:border-line"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <Icon className="w-4 h-4 shrink-0" />
                            {on && <Check className="w-4 h-4 shrink-0" />}
                          </div>
                          <div>
                            <p className="text-xs font-semibold">{meta.label}</p>
                            <p className={cn("text-[11px] mt-0.5 leading-snug", on ? "text-accent" : "text-muted")}>
                              {meta.desc}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[13px] font-semibold text-fg">Jeda Waktu Antar-Buzzer (Agar Terlihat Natural)</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Jeda waktu antar-buzzer">
                    {BUZZER_TIMING_PRESETS.map((preset) => {
                      const on = timingKey === preset.key;
                      return (
                        <button
                          key={preset.key}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setTimingKey(preset.key)}
                          className={cn(
                            "p-2.5 rounded-xl border text-left transition-colors cursor-pointer flex items-start justify-between gap-2",
                            on ? "bg-accent-soft border-accent text-accent" : "bg-subtle border-transparent text-fg hover:border-line"
                          )}
                        >
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 text-xs font-semibold">
                              <Clock className="w-3.5 h-3.5 shrink-0" />
                              {preset.label}
                            </span>
                            <span className={cn("block text-[11px] mt-0.5", on ? "text-accent" : "text-muted")}>
                              {preset.hint}
                            </span>
                          </span>
                          {on && <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Arahan Tambahan Opsional */}
              <TextField
                label="Arahan Sudut Obrolan (Opsional)"
                value={catatanAdmin}
                onChange={(v) => {
                  setCatatanAdmin(v);
                  setDrafts([]);
                }}
                maxLength={250}
                showCount
                placeholder="Kosongkan agar AI menyesuaikan 100% otomatis dengan niche tiap buzzer, atau beri arahan tipis (mis. 'fokus bahas porsi kenyang / cocok buat makan malam')"
                hint="Komentar tetap mengikuti aturan lintas-niche: Sejalur (nimbrung relate), Jembatan (bawa niche buzzer secara kasual), atau Jauh (nimbrung bertanya)."
              />

              {/* Pemilih Akun Buzzer */}
              <div className="space-y-3 pt-2 border-t border-line">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-semibold text-fg">
                      Pilih Akun Buzzer ({formatInt(selectedBuzzerIds.length)} dipilih dari {formatInt(readyBuzzers.length)} akun siap)
                    </p>
                    <p className="text-xs text-muted">
                      Tiap akun buzzer membawa niche dan gaya bahasanya sendiri saat berkomentar atau meng-quote.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => pickRandomBuzzers(5)}
                      className={cn(BTN_OUTLINE, "h-8 px-2.5 text-xs")}
                    >
                      <Shuffle className="w-3.5 h-3.5" />
                      Acak 5 Akun
                    </button>
                    <button
                      type="button"
                      onClick={() => pickRandomBuzzers(10)}
                      className={cn(BTN_OUTLINE, "h-8 px-2.5 text-xs")}
                    >
                      <Shuffle className="w-3.5 h-3.5" />
                      Acak 10 Akun
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedBuzzerIds(readyBuzzers.map((b) => b.accountId))}
                      className={cn(BTN_OUTLINE, "h-8 px-2.5 text-xs")}
                    >
                      Pilih Semua Siap ({formatInt(readyBuzzers.length)})
                    </button>
                    {selectedBuzzerIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedBuzzerIds([]);
                          setDrafts([]);
                        }}
                        className={cn(BTN_OUTLINE, "h-8 px-2.5 text-xs")}
                      >
                        Kosongkan
                      </button>
                    )}
                  </div>
                </div>

                <SearchField
                  label="Cari akun buzzer atau niche"
                  value={buzzerSearch}
                  onChange={setBuzzerSearch}
                  placeholder="Cari @username, nama cabang buzzer, atau niche (mis. anak kos, IT, ibu rumah tangga)..."
                />

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-96 overflow-y-auto p-1">
                  {filteredBuzzersForDeploy.map((b) => {
                    const checked = selectedBuzzerIds.includes(b.accountId);
                    return (
                      <button
                        key={b.accountId}
                        type="button"
                        disabled={!b.ready}
                        aria-pressed={checked}
                        onClick={() => {
                          toggleBuzzer(b.accountId);
                          setDrafts([]);
                        }}
                        className={cn(
                          "p-3 rounded-xl border text-left transition-colors flex items-start justify-between gap-2.5",
                          !b.ready ? "opacity-50 cursor-not-allowed bg-subtle border-transparent" : "cursor-pointer",
                          checked ? "bg-accent-soft border-accent" : "bg-surface border-line hover:bg-subtle/60"
                        )}
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-fg truncate">
                              @{b.username ?? b.displayName}
                            </span>
                            {b.outletNama && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-subtle text-muted shrink-0">
                                {b.outletNama}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] font-medium text-accent truncate">{b.niche}</p>
                          <p className="text-[11px] text-muted line-clamp-2 leading-snug">{b.persona}</p>
                        </div>
                        <span
                          className={cn(
                            "w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 border",
                            checked ? "bg-accent border-accent text-white" : "border-line bg-subtle"
                          )}
                        >
                          {checked && <Check className="w-3.5 h-3.5" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </Panel>

          {/* LANGKAH 3: PRATINJAU KOMENTAR LINTAS-NICHE & EKSEKUSI PENGERAHAN */}
          <Panel
            title="3. Pratinjau Lintas-Niche & Eksekusi Pengerahan"
            description="Tinjau bagaimana tiap buzzer menyesuaikan komentarnya (Sejalur, Jembatan Niche, atau Lintas Jauh Bertanya), sunting bila perlu, lalu kerahkan."
          >
            <div className="space-y-4">
              <FormError message={actionError} />

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-subtle p-4 border border-line">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold text-fg">
                    Siap Mengerahkan {formatInt(selectedBuzzerIds.length)} Akun Buzzer ({formatInt(selectedBuzzerIds.length * selectedActions.length)} Tugas)
                  </p>
                  <p className="text-xs text-muted">
                    Target: {activeTargetMediaId ? `@${activeTargetUsername} (ID: ${activeTargetMediaId})` : "Belum memilih postingan target"} · Aksi: {selectedActions.join(", ")} · Jeda: {timingPreset.label}
                  </p>
                </div>

                {canManage && (
                  <div className="flex flex-wrap items-center gap-2">
                    {(selectedActions.includes("KOMEN") || selectedActions.includes("QUOTE")) && (
                      <button
                        type="button"
                        disabled={previewBusy || deployBusy || selectedBuzzerIds.length === 0 || !activeTargetText}
                        onClick={handlePreviewDrafts}
                        className={BTN_OUTLINE}
                      >
                        {previewBusy ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4 text-accent" />
                        )}
                        {drafts.length > 0 ? "Susun Ulang Pratinjau AI" : "Pratinjau Komentar AI"}
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={deployBusy || previewBusy || selectedBuzzerIds.length === 0 || !activeTargetMediaId}
                      onClick={handleDeploy}
                      className={BTN_PRIMARY}
                    >
                      {deployBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Kerahkan Buzzer Sekarang
                    </button>
                  </div>
                )}
              </div>

              {/* Daftar Pratinjau Draf Lintas-Niche */}
              {drafts.length > 0 && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-fg">
                      Pratinjau Teks Lintas-Niche ({formatInt(drafts.length)} draf)
                      {detectedTargetNiche ? ` · Niche Postingan Target: ${detectedTargetNiche}` : ""}
                    </p>
                    <p className="text-xs text-muted">Anda dapat menyunting kalimat secara langsung sebelum dikerahkan.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {drafts.map((d, idx) => {
                      const bz = buzzerMap.get(d.buzzerAccountId);
                      const relMeta = NICHE_RELATION_META[d.nicheRelation];
                      return (
                        <div key={`${d.buzzerAccountId}:${d.action}`} className="rounded-xl border border-line bg-surface p-3.5 space-y-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-fg truncate">
                                @{bz?.username ?? bz?.displayName ?? d.buzzerAccountId}
                                <span className="ml-1.5 font-normal text-muted">· {d.action}</span>
                              </p>
                              <p className="text-[11px] text-accent truncate">Niche Buzzer: {bz?.niche}</p>
                            </div>
                            <Pill tone={relMeta.tone}>{relMeta.label}</Pill>
                          </div>

                          <textarea
                            rows={2}
                            value={d.text}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDrafts((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, text: val } : item))
                              );
                            }}
                            aria-label={`Teks ${d.action} untuk @${bz?.username ?? d.buzzerAccountId}`}
                            className="w-full rounded-lg bg-subtle border border-transparent focus:bg-surface focus:border-accent px-3 py-2 text-xs text-fg outline-none resize-y"
                          />

                          <p className="text-[11px] text-muted">{d.alasanRelasi || relMeta.hint}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </Panel>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: RIWAYAT & ANTREAN PENGERAHAN                                  */}
      {/* ==================================================================== */}
      {section === "RIWAYAT" && (
        <Panel
          title="Riwayat & Antrean Pengerahan Buzzer"
          description="Pantau status eksekusi Komentar, Repost, dan Quote Share di setiap gelombang pengerahan."
          action={
            <FilterChips<BuzzerCampaignStatus | "ALL">
              ariaLabel="Filter status kampanye"
              value={campaignStatusFilter}
              onChange={setCampaignStatusFilter}
              options={[
                { value: "ALL", label: "Semua" },
                { value: "BERJALAN", label: "Berjalan" },
                { value: "SELESAI", label: "Selesai" },
                { value: "SEBAGIAN_GAGAL", label: "Sebagian Gagal" },
              ]}
            />
          }
        >
          {campaignsRemote.loading && !campaignsRemote.data ? (
            <ListSkeleton label="Memuat riwayat pengerahan" rows={3} />
          ) : (campaignsRemote.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              icon={<Megaphone className="w-5 h-5" />}
              title="Belum ada pengerahan buzzer."
            >
              Pilih akun dan postingan target di tab Kerahkan Buzzer untuk mulai meramaikan postingan.
            </EmptyState>
          ) : (
            <div className="space-y-3">
              {campaignsRemote.data?.items.map((c) => {
                const statusTone =
                  c.status === "SELESAI"
                    ? "success"
                    : c.status === "BERJALAN"
                      ? "accent"
                      : c.status === "SEBAGIAN_GAGAL"
                        ? "warning"
                        : "neutral";
                return (
                  <div
                    key={c.id}
                    className="rounded-xl border border-line bg-surface p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="min-w-0 space-y-1.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-fg">@{c.targetUsername}</span>
                        <Pill tone={statusTone}>{c.status}</Pill>
                        {c.actions.map((a) => (
                          <Pill key={a} tone="neutral">
                            {a}
                          </Pill>
                        ))}
                        {c.targetNiche && (
                          <span className="text-xs text-muted">· Niche Target: {c.targetNiche}</span>
                        )}
                      </div>
                      <p className="text-xs text-fg line-clamp-2 leading-relaxed">
                        {c.targetText || `Media ID: ${c.targetMediaId}`}
                      </p>
                      <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
                        <span className="inline-flex items-center gap-1 text-success font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {formatInt(c.doneTasks)}/{formatInt(c.totalTasks)} Berhasil
                        </span>
                        {c.failedTasks > 0 && (
                          <span className="inline-flex items-center gap-1 text-danger font-medium">
                            <XCircle className="w-3.5 h-3.5" />
                            {formatInt(c.failedTasks)} Gagal
                          </span>
                        )}
                        <span>Jeda: {c.jedaMinDetik}-{c.jedaMaxDetik} dtk</span>
                        <span>{formatDateWib(c.createdAt)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setInspectCampaign(c)}
                        className={cn(BTN_OUTLINE, "h-9 px-3.5 text-xs")}
                      >
                        Lihat Rincian ({formatInt(c.tasks.length)})
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      )}

      {/* ==================================================================== */}
      {/* TAB 3: KELOLA NICHE & PERSONA BUZZER                                 */}
      {/* ==================================================================== */}
      {section === "NICHE" && (
        <Panel
          title={`Niche & Persona Akun Buzzer (${formatInt(buzzers.length)} Akun)`}
          description="Atur niche dan kepribadian masing-masing akun buzzer agar saat berkomentar lintas-niche tetap natural, kasual, dan terasa seperti manusia."
          action={
            canManage ? (
              <button
                type="button"
                disabled={aiBulkBusy}
                onClick={() => setConfirmAiBulk(true)}
                className={cn(BTN_PRIMARY, "h-9 px-3.5 text-xs")}
              >
                {aiBulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Susun Semua Niche Otomatis (AI)
              </button>
            ) : undefined
          }
        >
          <div className="space-y-4">
            <SearchField
              label="Cari akun buzzer"
              value={nicheSearch}
              onChange={setNicheSearch}
              placeholder="Cari @username, nama cabang buzzer, niche, atau persona..."
            />

            {filteredBuzzersForNiche.length === 0 ? (
              <EmptyState
                icon={<Users className="w-5 h-5" />}
                title="Tidak ada akun buzzer ditemukan."
              >
                Coba kata kunci pencarian lain.
              </EmptyState>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredBuzzersForNiche.map((b) => {
                  const voiceMeta = VOICE_STYLES[b.voiceStyle] ?? VOICE_STYLES.aku_kamu;
                  return (
                    <div
                      key={b.accountId}
                      className="rounded-xl border border-line bg-surface p-4 flex flex-col justify-between gap-3"
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-fg truncate">
                              @{b.username ?? b.displayName}
                              {b.outletNama ? <span className="ml-1.5 text-xs font-normal text-muted">· {b.outletNama}</span> : null}
                            </p>
                            <p className="text-xs font-semibold text-accent mt-0.5">{b.niche}</p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Pill tone={b.ready ? "success" : "warning"}>
                              {b.ready ? "Siap" : b.needsReconnect ? "Hubungkan Ulang" : "Nonaktif"}
                            </Pill>
                            <Pill tone="neutral">{voiceMeta.label}</Pill>
                          </div>
                        </div>

                        <p className="text-xs text-muted leading-relaxed">{b.persona}</p>

                        {b.samplePosts[0] && (
                          <p className="text-[11px] text-faint bg-subtle rounded-lg px-2.5 py-1.5 line-clamp-2">
                            Contoh post: &ldquo;{b.samplePosts[0]}&rdquo;
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-line">
                        <span className="text-[11px] text-muted">
                          Sumber: {b.inferredFrom} · {formatInt(b.tasksTotal)} interaksi terkirim
                        </span>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => setEditingBuzzer(b)}
                            className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Ubah Niche
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* Modal Edit Niche Satu Akun */}
      {editingBuzzer && (
        <EditBuzzerProfileModal
          buzzer={editingBuzzer}
          onClose={() => setEditingBuzzer(null)}
          onSaved={() => {
            overview.reload();
            setNotice({
              tone: "info",
              text: `Profil niche @${editingBuzzer.username ?? editingBuzzer.displayName} berhasil diperbarui.`,
            });
          }}
        />
      )}

      {/* Modal Rincian Kampanye */}
      {inspectCampaign && (
        <CampaignDetailModal
          campaign={inspectCampaign}
          canManage={canManage}
          onClose={() => setInspectCampaign(null)}
          onChanged={() => {
            setInspectCampaign(null);
            setCampaignRev((v) => v + 1);
            overview.reload();
          }}
        />
      )}

      {/* Konfirmasi Susun Massal Niche Buzzer dengan AI */}
      <ConfirmModal
        open={confirmAiBulk}
        onClose={() => setConfirmAiBulk(false)}
        onConfirm={handleBulkGenerateNiche}
        title="Susun Niche & Persona Otomatis dengan AI?"
        description={`AI akan menganalisis histori postingan dari ${formatInt(buzzers.length)} akun di Workspace Buzzer dan melengkapi niche serta persona warga net yang unik untuk setiap akun.`}
        confirmLabel="Ya, Susun Otomatis"
      />
    </div>
  );
}
