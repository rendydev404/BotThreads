"use client";

import React, { useEffect, useState } from "react";
import { Brain, Loader2, Plus, Save, Sparkles, Trash2, X } from "lucide-react";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { FormError, TextAreaField } from "@/components/settings/fields";
import {
  addStyleLesson,
  fetchAiProfile,
  removeStyleLesson,
  suggestAiProfile,
  type LessonDTO,
} from "@/lib/ai-client";
import { saveAutopilotSettings } from "@/lib/autopilot-client";
import { BRIEF_MAX_CHARS, VOICE_STYLES, type AutopilotPillar, type VoiceStyle } from "@/lib/autopilot-types";
import { ContentApiError } from "@/lib/content-client";
import { cn } from "@/lib/utils";
import { BriefExpandButton } from "./brief-editor";
import { AgentSteps, useStagedSteps } from "./agent-ui";

const MAX_PILLARS = 8;
const SOURCE_LABEL: Record<LessonDTO["source"], string> = {
  EDIT: "dari editan Anda",
  AI_EDIT: "dari ubahan versi AI",
  REVIEW: "dari tinjauan autopilot",
  MANUAL: "aturan Anda",
};
const SUGGEST_STEPS = [
  { key: "baca", label: "Membaca postingan terbaru akun" },
  { key: "pola", label: "Mencari pola topik dan gaya bahasa" },
  { key: "tulis", label: "Menyusun peran akun" },
];

const errMsg = (e: unknown, fallback: string) => (e instanceof ContentApiError ? e.message : fallback);

/**
 * Profil AI satu akun: SATU sumber untuk semua fitur AI (Studio AI, edit dengan AI, Autopilot, balas
 * komentar). Peran, gaya sapaan, dan kategori disimpan di pengaturan akun; memori gaya diisi AI sendiri
 * dari koreksi pemilik akun, dan bisa ditambah atau dihapus di sini.
 */
export function AiProfileModal({ account, onClose }: { account: { id: string; username: string } | null; onClose: () => void }) {
  if (!account) return null;
  return <ProfileForm key={account.id} account={account} onClose={onClose} />;
}

function ProfileForm({ account, onClose }: { account: { id: string; username: string }; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [brief, setBrief] = useState("");
  const [voice, setVoice] = useState<VoiceStyle | null>(null);
  const [pillars, setPillars] = useState<AutopilotPillar[]>([]);
  const [pillarInput, setPillarInput] = useState("");
  const [lessons, setLessons] = useState<LessonDTO[]>([]);
  const [lessonInput, setLessonInput] = useState("");
  const [initial, setInitial] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const steps = useStagedSteps(SUGGEST_STEPS, suggesting, 2200);

  useEffect(() => {
    let alive = true;
    fetchAiProfile(account.id)
      .then((res) => {
        if (!alive) return;
        setBrief(res.profile.brief ?? "");
        setVoice(res.profile.voiceStyle);
        setPillars(res.profile.pillars ?? []);
        setLessons(res.lessons);
        setInitial(JSON.stringify([res.profile.brief ?? "", res.profile.voiceStyle, res.profile.pillars ?? []]));
      })
      .catch((e) => alive && setError(errMsg(e, "Gagal memuat Profil AI.")))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [account.id]);

  const dirty = !loading && JSON.stringify([brief, voice, pillars]) !== initial;

  const addPillar = () => {
    const key = pillarInput.replace(/[#<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
    if (key.length < 2 || pillars.length >= MAX_PILLARS || pillars.some((p) => p.key.toLowerCase() === key.toLowerCase())) return;
    const avg = pillars.length ? Math.round(pillars.reduce((s, p) => s + p.bobot, 0) / pillars.length) : 25;
    setPillars([...pillars, { key, bobot: Math.min(100, Math.max(1, avg)) }]);
    setPillarInput("");
  };

  const suggest = async () => {
    setSuggesting(true);
    setError(null);
    setNotice(null);
    try {
      const { suggestion } = await suggestAiProfile(account.id);
      setBrief(suggestion.role);
      if (suggestion.voiceStyle) setVoice(suggestion.voiceStyle);
      if (suggestion.pillars.length) {
        const w = Math.max(1, Math.floor(100 / suggestion.pillars.length));
        setPillars(suggestion.pillars.map((key) => ({ key, bobot: w })));
      }
      setNotice("Disusun AI dari postingan akun. Periksa dan ubah bila perlu, lalu simpan.");
    } catch (e) {
      setError(errMsg(e, "AI belum bisa menyusun profil. Coba lagi."));
    } finally {
      setSuggesting(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveAutopilotSettings(account.id, { brief: brief.trim() || null, voiceStyle: voice, pillars });
      setInitial(JSON.stringify([brief, voice, pillars]));
      onClose();
    } catch (e) {
      setError(errMsg(e, "Gagal menyimpan Profil AI."));
    } finally {
      setBusy(false);
    }
  };

  const addLesson = async () => {
    const text = lessonInput.trim();
    if (text.length < 3) return;
    try {
      const { lesson } = await addStyleLesson(account.id, text);
      setLessons((prev) => [lesson, ...prev.filter((l) => l.id !== lesson.id)]);
      setLessonInput("");
    } catch (e) {
      setError(errMsg(e, "Gagal menambah aturan gaya."));
    }
  };

  const dropLesson = async (id: string) => {
    const prev = lessons;
    setLessons(lessons.filter((l) => l.id !== id));
    try {
      await removeStyleLesson(account.id, id);
    } catch (e) {
      setLessons(prev);
      setError(errMsg(e, "Gagal menghapus pelajaran."));
    }
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      busy={busy}
      size="lg"
      title="Profil AI"
      description={`@${account.username} · dipakai Studio AI, edit dengan AI, Autopilot, dan balas komentar`}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            Tutup
          </ModalButton>
          <ModalButton variant="primary" onClick={save} disabled={busy || !dirty}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Simpan profil
          </ModalButton>
        </>
      }
    >
      {loading ? (
        <div className="space-y-3" aria-busy="true">
          <div className="ai-shimmer h-24 rounded-xl" />
          <div className="ai-shimmer h-10 rounded-xl" />
          <div className="ai-shimmer h-16 rounded-xl" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className={cn("ai-aura rounded-2xl bg-surface p-3.5", !suggesting && "ai-aura-idle")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted">Belum yakin menulis apa? Biar AI membaca postingan akun lalu menyusun perannya.</p>
              <button
                type="button"
                onClick={() => void suggest()}
                disabled={suggesting || busy}
                className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-accent to-violet-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm shadow-accent/30 disabled:opacity-60 cursor-pointer"
              >
                {suggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Susun dengan AI
              </button>
            </div>
            {suggesting && (
              <div className="msg-in mt-3">
                <AgentSteps steps={steps} compact />
              </div>
            )}
            {notice && !suggesting && <p className="msg-in mt-2 text-[11px] font-medium text-success">{notice}</p>}
          </div>

          <TextAreaField
            label="Peran & tema akun"
            rows={8}
            value={brief}
            maxLength={BRIEF_MAX_CHARS}
            onChange={setBrief}
            disabled={busy || suggesting}
            placeholder="Contoh: Akun pribadi developer yang bahas AI dan coding sehari-hari, gaya santai agak sarkas, buat programmer muda. Tidak pernah bahas politik."
            hint="Tulis seperti menjelaskan ke penulis bayangan: akun ini siapa, bahas apa, untuk siapa, nadanya bagaimana."
          />
          <div className="-mt-2 flex justify-end">
            <BriefExpandButton value={brief} onChange={setBrief} maxLength={BRIEF_MAX_CHARS} disabled={busy || suggesting} />
          </div>

          <div>
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Gaya sapaan</p>
            <div className="flex flex-wrap gap-1.5">
              {([null, ...(Object.keys(VOICE_STYLES) as VoiceStyle[])] as (VoiceStyle | null)[]).map((v) => (
                <button
                  key={v ?? "auto"}
                  type="button"
                  onClick={() => setVoice(v)}
                  disabled={busy}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                    voice === v ? "bg-fg text-surface" : "bg-subtle text-muted hover:text-fg"
                  )}
                >
                  {v ? VOICE_STYLES[v].label : "Otomatis dari postingan"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Kategori topik</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {pillars.map((p) => (
                <span key={p.key} className="inline-flex items-center gap-1 rounded-full bg-accent-soft py-1 pl-3 pr-1.5 text-xs font-semibold text-accent">
                  {p.key}
                  <button
                    type="button"
                    aria-label={`Hapus kategori ${p.key}`}
                    onClick={() => setPillars(pillars.filter((x) => x.key !== p.key))}
                    className="rounded-full p-0.5 hover:bg-accent hover:text-on-accent cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {pillars.length < MAX_PILLARS && (
                <input
                  value={pillarInput}
                  onChange={(e) => setPillarInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addPillar();
                    }
                  }}
                  onBlur={addPillar}
                  disabled={busy}
                  placeholder="Tambah kategori lalu Enter"
                  className="h-8 w-44 rounded-full border border-dashed border-line-strong bg-transparent px-3 text-xs text-fg placeholder-faint focus:border-accent focus:outline-none"
                />
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-line p-3.5">
            <div className="mb-2 flex items-center gap-2">
              <Brain className="h-4 w-4 text-accent" />
              <p className="text-[13px] font-bold text-fg">Memori gaya</p>
              <span className="text-[11px] text-muted">AI belajar dari setiap koreksi Anda, makin lama makin mirip tulisan Anda</span>
            </div>
            {lessons.length === 0 ? (
              <p className="rounded-xl bg-subtle p-3 text-xs text-muted">
                Belum ada. Setiap kali Anda mengubah draf AI lalu menyimpannya, AI mencatat pelajarannya di sini.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {lessons.map((l, i) => (
                  <li key={l.id} className="msg-in group flex items-start gap-2 rounded-xl bg-subtle px-3 py-2" style={{ animationDelay: `${i * 40}ms` }}>
                    <p className="min-w-0 flex-1 text-xs text-fg">
                      {l.lesson}
                      <span className="ml-1.5 text-[10px] text-faint">
                        {SOURCE_LABEL[l.source]}
                        {l.hits > 1 ? ` · terbukti ${l.hits}x` : ""}
                      </span>
                    </p>
                    <button
                      type="button"
                      aria-label="Hapus pelajaran"
                      onClick={() => void dropLesson(l.id)}
                      className="rounded-md p-1 text-faint opacity-60 hover:bg-danger-soft hover:text-danger group-hover:opacity-100 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="mt-2.5 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void addLesson();
              }}
            >
              <input
                value={lessonInput}
                onChange={(e) => setLessonInput(e.target.value.slice(0, 200))}
                placeholder='Tambah aturan sendiri, mis. "jangan pakai kata banget"'
                className="h-9 min-w-0 flex-1 rounded-full border border-line bg-subtle px-3.5 text-xs text-fg placeholder-faint focus:border-accent focus:bg-surface focus:outline-none"
              />
              <button
                type="submit"
                aria-label="Tambah aturan gaya"
                disabled={lessonInput.trim().length < 3}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent disabled:opacity-40 cursor-pointer"
              >
                <Plus className="h-4 w-4" />
              </button>
            </form>
          </div>

          <FormError message={error} />
        </div>
      )}
    </ModalShell>
  );
}
