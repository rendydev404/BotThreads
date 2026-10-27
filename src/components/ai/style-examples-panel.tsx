"use client";

import React, { useEffect, useState } from "react";
import { BookOpenText, Loader2, Plus, Trash2, TrendingUp } from "lucide-react";
import { ContentApiError } from "@/lib/content-client";
import {
  STYLE_TEXT_MAX,
  STYLE_TEXT_MIN,
  addStyleExample,
  fetchStyleExamples,
  removeStyleExample,
  type StyleExampleDTO,
} from "@/lib/style-client";
import { POST_FORMATS, POST_FORMAT_LABEL, layoutFeatures, type LayoutProfile, type PostFormat } from "@/lib/style-types";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n/lang-provider";

const errMsg = (e: unknown, fallback: string) => (e instanceof ContentApiError ? e.message : fallback);
const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * "Contoh gaya": postingan Threads yang disukai pemilik akun, ditempel apa adanya (baris barunya dijaga),
 * supaya AI meniru ritme dan tata letaknya (bukan kalimatnya). Ditambah ringkasan "Gaya yang terbukti"
 * dari postingan workspace yang ramai (layoutProfile). Bagian dari Profil AI satu akun.
 */
export function StyleExamplesPanel({ account }: { account: { id: string; username: string } }) {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(true);
  const [examples, setExamples] = useState<StyleExampleDTO[]>([]);
  const [profile, setProfile] = useState<LayoutProfile | null>(null);
  const [text, setText] = useState("");
  const [format, setFormat] = useState<PostFormat | "AUTO">("AUTO");
  const [allAccounts, setAllAccounts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchStyleExamples(account.id, { profile: true, signal: ctrl.signal })
      .then((res) => {
        setReady(res.ready);
        setExamples(res.examples);
        setProfile(res.profile);
      })
      .catch((e) => !ctrl.signal.aborted && setError(errMsg(e, "Gagal memuat contoh gaya.")))
      .finally(() => !ctrl.signal.aborted && setLoading(false));
    return () => ctrl.abort();
  }, [account.id]);

  const len = [...text.trim()].length;
  const canAdd = !busy && len >= STYLE_TEXT_MIN && [...text].length <= STYLE_TEXT_MAX;

  const add = async () => {
    if (!canAdd) return;
    setBusy(true);
    setError(null);
    try {
      const { example } = await addStyleExample({ accountId: allAccounts ? null : account.id, text, format });
      setExamples((prev) => [example, ...prev.filter((x) => x.id !== example.id)]);
      setText("");
      setFormat("AUTO");
    } catch (e) {
      setError(errMsg(e, "Gagal menyimpan contoh gaya."));
    } finally {
      setBusy(false);
    }
  };

  const drop = async (id: string) => {
    const prev = examples;
    setExamples(examples.filter((x) => x.id !== id));
    try {
      await removeStyleExample(id);
    } catch (e) {
      setExamples(prev);
      setError(errMsg(e, "Gagal menghapus contoh gaya."));
    }
  };

  return (
    <div className="rounded-2xl border border-line p-3.5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <BookOpenText className="h-4 w-4 text-accent" />
        <p className="text-[13px] font-bold text-fg">{t("Contoh gaya")}</p>
        <span className="text-[11px] text-muted">{t("Tempel postingan Threads yang Anda suka; AI meniru ritme dan tata letaknya, bukan kalimatnya")}</span>
      </div>

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          <div className="ai-shimmer h-14 rounded-xl" />
          <div className="ai-shimmer h-20 rounded-xl" />
        </div>
      ) : !ready ? (
        <p className="rounded-xl bg-subtle p-3 text-xs text-muted">{t("Fitur contoh gaya belum aktif di database. Hubungi pemilik dashboard.")}</p>
      ) : (
        <div className="space-y-3">
          <ProvenStyle profile={profile} />

          <div className="space-y-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, STYLE_TEXT_MAX + 50))}
              rows={5}
              disabled={busy}
              aria-label={t("Teks contoh gaya")}
              placeholder={t("Tempel satu postingan Threads di sini, lengkap dengan baris barunya.\n\nContoh:\njujur ya\nkerja dari kafe itu cuma enak 2 jam pertama\nsisanya mikirin colokan")}
              className="w-full resize-y rounded-xl border border-transparent bg-subtle px-3.5 py-2.5 text-xs leading-relaxed text-fg placeholder:text-faint outline-none focus:border-accent focus:bg-surface whitespace-pre-wrap"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {(["AUTO", ...POST_FORMATS] as (PostFormat | "AUTO")[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  disabled={busy}
                  title={f === "AUTO" ? t("Format ditebak otomatis dari teks") : t(POST_FORMAT_LABEL[f])}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer",
                    format === f ? "bg-fg text-surface" : "bg-subtle text-muted hover:text-fg"
                  )}
                >
                  {f === "AUTO" ? t("Format otomatis") : t(POST_FORMAT_LABEL[f])}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-[11px] text-muted cursor-pointer">
                <input type="checkbox" checked={allAccounts} onChange={(e) => setAllAccounts(e.target.checked)} disabled={busy} className="accent-accent" />
                {t("Berlaku untuk semua akun di workspace")}
              </label>
              <div className="flex items-center gap-2">
                <span className={cn("text-[11px] tabular-nums", len > 0 && len < STYLE_TEXT_MIN ? "text-danger" : "text-faint")}>
                  {len}/{STYLE_TEXT_MAX}
                </span>
                <button
                  type="button"
                  onClick={() => void add()}
                  disabled={!canAdd}
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-40 cursor-pointer"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  {t("Simpan contoh")}
                </button>
              </div>
            </div>
          </div>

          {examples.length === 0 ? (
            <p className="rounded-xl bg-subtle p-3 text-xs text-muted">
              {t("Belum ada contoh. Tanpa contoh, AI tetap belajar dari postingan akun Anda dan akun lain di workspace yang paling ramai.")}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {examples.map((x) => (
                <ExampleItem key={x.id} example={x} onDelete={() => void drop(x.id)} />
              ))}
            </ul>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-danger">
          {t(error)}
        </p>
      )}
    </div>
  );
}

function ExampleItem({ example, onDelete }: { example: StyleExampleDTO; onDelete: () => void }) {
  const t = useT();
  const f = layoutFeatures(example.text);
  return (
    <li className="group rounded-xl bg-subtle px-3 py-2">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">{t(POST_FORMAT_LABEL[example.format])}</span>
        <span className="text-[10px] text-faint">
          {t("{lines} baris · {chars} karakter", { lines: f.lines, chars: f.chars })}{example.accountId ? "" : ` · ${t("semua akun")}`}
        </span>
        <button
          type="button"
          aria-label={t("Hapus contoh gaya")}
          onClick={onDelete}
          className="ml-auto rounded-md p-1 text-faint opacity-60 hover:bg-danger-soft hover:text-danger group-hover:opacity-100 cursor-pointer"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-fg">{example.text}</p>
    </li>
  );
}

/** Ringkasan layout postingan yang terbukti ramai (read-only). */
function ProvenStyle({ profile }: { profile: LayoutProfile | null }) {
  const t = useT();
  if (!profile) {
    return (
      <p className="rounded-xl bg-subtle p-3 text-[11px] text-muted">
        {t("Gaya yang terbukti akan muncul setelah ada minimal 5 postingan yang ramai di akun atau workspace ini.")}
      </p>
    );
  }
  const top = profile.topFormats.slice(0, 3);
  return (
    <div className="rounded-xl bg-subtle p-3">
      <div className="mb-1.5 flex items-center gap-1.5">
        <TrendingUp className="h-3.5 w-3.5 text-success" />
        <p className="text-[12px] font-bold text-fg">{t("Gaya yang terbukti")}</p>
        <span className="text-[10px] text-faint">{t("dari {n} postingan ramai", { n: profile.sample })}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-4">
        <Stat label={t("Median panjang")} value={t("{n} karakter", { n: profile.medianChars })} />
        <Stat label={t("Median baris")} value={t("{n} baris", { n: profile.medianLines })} />
        <Stat label={t("Berbentuk daftar")} value={pct(profile.listShare)} />
        <Stat label={t("Diakhiri tanya")} value={pct(profile.questionShare)} />
      </dl>
      {top.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-muted">{t("Format teratas:")}</span>
          {top.map((fmt) => (
            <span key={fmt.format} className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-fg">
              {t(POST_FORMAT_LABEL[fmt.format])} {pct(fmt.share)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-faint">{label}</dt>
      <dd className="font-semibold text-fg tabular-nums">{value}</dd>
    </div>
  );
}
