"use client";

import React, { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Loader2, Plus, Radar, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { addRadarSignal, deleteRadarSignal, listRadarSignals } from "@/lib/radar-client";
import {
  MANUAL_SIGNAL_MAX,
  SIGNAL_SOURCE_LABEL,
  threadsAuthorFromUrl,
  type SignalDTO,
  type SignalListResponse,
  type SignalSource,
} from "@/lib/radar-types";
import { ThreadsMark } from "@/components/landing/threads-mark";
import { wibParts } from "@/lib/scheduling";
import { useT } from "@/components/i18n/lang-provider";
import { tr } from "@/lib/i18n/core";
import { ConfirmModal } from "@/components/autopilot/confirm-modal";
import { Banner, ListSkeleton, LoadMoreButton, accountHandle } from "@/components/autopilot/shared";
import { usePublishAccounts } from "@/components/content/use-publish-accounts";
import { FormError, TextAreaField, TextField } from "@/components/settings/fields";
import { MONTH_SHORT, errorDetails, errorStatus, errorText, formatDateWib, pad2, toScore100 } from "@/components/settings/format";
import { usePaged } from "@/components/settings/use-remote";
import { ThreadsSearchPanel } from "./threads-search-panel";
import {
  BTN,
  BTN_OUTLINE,
  BTN_PRIMARY,
  EmptyState,
  ICON_BTN,
  LoadFailure,
  NotInstalled,
  RefreshButton,
  SourceChip,
  useNotice,
} from "./shared";

/** Sumber yang diisi server dan ditawarkan sebagai saringan. Urutan = urutan tampil. */
type OfferedSource = Extract<SignalSource, "NICHE" | "THREADS_SEARCH" | "WEB" | "GTRENDS" | "JARINGAN" | "MOMEN" | "MANUAL">;
type SourceFilter = "ALL" | OfferedSource;

const FILTER_SOURCES: OfferedSource[] = ["NICHE", "THREADS_SEARCH", "WEB", "GTRENDS", "JARINGAN", "MOMEN", "MANUAL"];
const FILTERS: { value: SourceFilter; label: string }[] = [
  { value: "ALL", label: "Semua" },
  ...FILTER_SOURCES.map((s) => ({ value: s, label: SIGNAL_SOURCE_LABEL[s] })),
];
/** Sumber yang dikumpulkan tick autopilot (inspirasi manual tidak dihitung "pengambilan"). */
const AUTO_SOURCES: OfferedSource[] = ["NICHE", "THREADS_SEARCH", "WEB", "GTRENDS", "JARINGAN", "MOMEN"];

const URL_MAX = 500;
const TEXT_MIN = 10;
/** Judul sependek ini (kata kunci tren, nama momen) ditebalkan; teks posting panjang tidak. */
const SHORT_TITLE = 80;

const EMPTY_COPY: Record<SourceFilter, { title: string; body: string }> = {
  ALL: {
    title: "Belum ada tren yang tertangkap.",
    body: "Tren diperbarui otomatis tiap beberapa jam: yang lagi naik di niche tiap akun, yang viral di Threads, yang lagi ramai di Indonesia, dan posting akun Anda yang sedang meledak.",
  },
  NICHE: {
    title: "Belum ada tren di niche akun.",
    body: "AI mencari berita dan perkembangan terbaru yang relevan dengan Tema serta kategori topik akun, termasuk rilis dan advisory keamanan untuk niche teknologi. Akun tanpa Tema/Pilar memakai contoh postingan jika Autopilot aktif. Riset diperbarui tiap 8 jam pada jam aktif.",
  },
  THREADS_SEARCH: {
    title: "Belum ada posting viral dari Threads.",
    body: "Bagian ini mengambil posting Threads paling populer untuk topik yang sedang naik. Aktif setelah izin pencarian Threads (threads_keyword_search) untuk aplikasi kami disetujui Meta.",
  },
  WEB: {
    title: "Belum ada obrolan viral dari medsos.",
    body: "AI mencari obrolan, meme, dan istilah yang sedang ramai di Threads dan medsos Indonesia lewat Google Search, atau dari berita viral Google News bila pencarian tidak tersedia, tiap 3 jam pada jam aktif. Butuh kunci Gemini di server.",
  },
  JARINGAN: {
    title: "Belum ada posting Anda yang viral.",
    body: "Posting akun Anda yang views-nya jauh di atas biasanya akan muncul di sini dengan sendirinya.",
  },
  GTRENDS: {
    title: "Belum ada topik yang lagi ramai.",
    body: "Topik yang sedang naik di Indonesia diperbarui otomatis, lalu disaring supaya aman untuk brand.",
  },
  MOMEN: {
    title: "Tidak ada momen yang sedang berlaku.",
    body: "Momen bawaan dan momen dari tab Momen tampil di sini saat sedang berjalan atau segera dimulai.",
  },
  MANUAL: {
    title: "Belum ada inspirasi manual.",
    body: "Tempel teks posting atau gagasan yang menarik. AI memakainya sebagai bahan ide sampai masa berlakunya habis.",
  },
};

/** "14 Okt 2026, 09.30 WIB" dengan nama bulan sesuai bahasa (formatWibFull di scheduling selalu bahasa Indonesia). */
function formatWibFull(date: Date): string {
  const p = wibParts(date);
  return `${p.d} ${tr(MONTH_SHORT[p.m])} ${p.y}, ${pad2(p.h)}.${pad2(p.min)} WIB`;
}

function lastCaptureText(last: SignalListResponse["lastCapture"], source: SourceFilter): string | null {
  if (source === "MANUAL") return null;
  if (source === "ALL") {
    // ISO UTC berformat sama, jadi urutan teks = urutan waktu.
    const latest = AUTO_SOURCES.map((s) => last[s]).filter((v): v is string => !!v).sort().at(-1);
    return latest
      ? tr("Diperbarui otomatis {date}.", { date: formatWibFull(new Date(latest)) })
      : tr("Tren belum pernah diperbarui.");
  }
  const at = last[source];
  const label = tr(SIGNAL_SOURCE_LABEL[source]);
  return at
    ? tr("{source} diperbarui {date}.", { source: label, date: formatWibFull(new Date(at)) })
    : tr("{source} belum pernah diperbarui.", { source: label });
}

/** Halaman pencarian Threads untuk satu topik (dibuka di peramban pengguna, tidak lewat API). */
const threadsSearchUrl = (topic: string): string => `https://www.threads.com/search?q=${encodeURIComponent(topic)}&serp_type=default`;

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return tr("Buka tautan");
  }
};

/* ------------------------------------------------------------------ form tambah inspirasi */

function urlIssueOf(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.length > URL_MAX) return tr("Tautan maksimal {n} karakter.", { n: URL_MAX });
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? null : tr("Tautan harus diawali http:// atau https://.");
  } catch {
    return tr("Tautan tidak valid. Tulis lengkap dengan https://.");
  }
}

interface AddSignalFormProps {
  id: string;
  onAdded: () => void;
  onClose: () => void;
  onForbidden: () => void;
}

function AddSignalForm({ id, onAdded, onClose, onForbidden }: AddSignalFormProps) {
  const t = useT();
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);

  const clean = text.replace(/\s+/g, " ").trim();
  const textIssue = clean.length < TEXT_MIN ? t("Teks inspirasi minimal {n} karakter.", { n: TEXT_MIN }) : null;
  const urlIssue = urlIssueOf(url);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (textIssue || urlIssue) {
      setTried(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addRadarSignal(text.trim(), url.trim() || null);
      setText("");
      setUrl("");
      setTried(false);
      onAdded();
    } catch (err) {
      if (errorStatus(err) === 403) onForbidden();
      setError({ message: errorText(err, "Gagal menyimpan inspirasi. Coba lagi."), details: errorDetails(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form id={id} onSubmit={submit} noValidate aria-label={t("Tambah inspirasi")} className="card p-4 space-y-3">
      <TextAreaField
        label={t("Teks inspirasi")}
        value={text}
        onChange={(v) => {
          setText(v);
          setError(null);
        }}
        maxLength={MANUAL_SIGNAL_MAX}
        rows={3}
        placeholder={t("Tempel teks posting atau tulis gagasan yang ingin dijadikan bahan ide")}
        hint={t("AI memakainya sebagai rujukan saat menyusun ide, bukan untuk disalin apa adanya.")}
        error={tried ? textIssue : null}
        disabled={busy}
        autoFocus
      />
      <TextField
        label={t("Tautan (opsional)")}
        type="url"
        inputMode="url"
        value={url}
        onChange={(v) => {
          setUrl(v);
          setError(null);
        }}
        maxLength={URL_MAX}
        placeholder="https://"
        autoComplete="off"
        error={tried ? urlIssue : null}
        disabled={busy}
      />
      <FormError message={error?.message ? t(error.message) : error?.message} details={error?.details} />
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy} className={cn(BTN, BTN_OUTLINE)}>
          {t("Tutup")}
        </button>
        <button type="submit" disabled={busy} className={cn(BTN, BTN_PRIMARY)}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {busy ? t("Menyimpan...") : t("Simpan inspirasi")}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ kartu posting viral Threads */

const ThreadsViralRow = memo(function ThreadsViralRow({ signal }: { signal: SignalDTO }) {
  const t = useT();
  const author = threadsAuthorFromUrl(signal.url);
  return (
    <li className="p-4 space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <SourceChip source="THREADS_SEARCH" />
        <span className="text-xs font-semibold text-fg">{t("Topik: {topic}", { topic: signal.title })}</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-full bg-fg text-canvas flex items-center justify-center text-sm font-bold uppercase shrink-0" aria-hidden>
          {(author ?? "?").charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          {author && <p className="text-[13px] font-semibold text-fg">@{author}</p>}
          <p className="mt-0.5 text-sm text-fg leading-relaxed whitespace-pre-wrap break-words line-clamp-6">{signal.summary}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-12 text-xs text-muted">
        {signal.url && (
          <a
            href={signal.url}
            target="_blank"
            rel="noopener noreferrer"
            className="-my-2 h-10 inline-flex items-center gap-1.5 font-semibold text-fg hover:underline"
          >
            <ThreadsMark className="w-3.5 h-3.5" />
            {t("Lihat di Threads")}
            <span className="sr-only"> ({t("tab baru")})</span>
          </a>
        )}
        <span>{t("Diperbarui {date}", { date: formatWibFull(new Date(signal.capturedAt)) })}</span>
      </div>
    </li>
  );
});

/* ------------------------------------------------------------------ baris tren */

interface SignalRowProps {
  signal: SignalDTO;
  /** Tren niche: akun tujuan (mis. "@nama"), bila dikenal. */
  forAccount: string | null;
  canDelete: boolean;
  onDelete: (signal: SignalDTO) => void;
}

const SignalRow = memo(function SignalRow({ signal, forAccount, canDelete, onDelete }: SignalRowProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // Inspirasi manual yang panjang: `title` hanya potongan awal, teks lengkapnya ada di `summary`.
  const full =
    signal.summary && signal.summary.length > signal.title.length && signal.summary.startsWith(signal.title) ? signal.summary : null;
  // Hanya tautan http(s) yang dijadikan link.
  const href = signal.url && /^https?:\/\//i.test(signal.url) ? signal.url : null;

  return (
    <li className="p-4 flex items-start gap-2">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <SourceChip source={signal.source} />
          {signal.rank !== null && (
            <span className="text-xs font-semibold text-fg tabular-nums">
              {signal.source === "GTRENDS" ? t("#{n} di Indonesia", { n: signal.rank }) : t("Peringkat {n}", { n: signal.rank })}
            </span>
          )}
          {forAccount && <span className="min-w-0 truncate text-xs font-semibold text-fg">{t("untuk {handle}", { handle: forAccount })}</span>}
          <span className="text-xs font-semibold text-muted tabular-nums">
            {t("Skor viral {score}", { score: toScore100(signal.score) })}
            <span className="sr-only"> {t("dari 100")}</span>
          </span>
        </div>

        <div>
          <p
            className={cn(
              "text-sm text-fg leading-relaxed whitespace-pre-wrap break-words",
              !full && signal.title.length <= SHORT_TITLE && "font-semibold"
            )}
          >
            {full ? (open ? full : `${signal.title.trimEnd()}...`) : signal.title}
          </p>
          {full && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="-mb-2 h-10 inline-flex items-center text-[13px] font-semibold text-accent hover:underline cursor-pointer"
            >
              {open ? t("Ringkas") : t("Selengkapnya")}
            </button>
          )}
        </div>

        {!full && signal.summary && <p className="text-[13px] text-muted leading-relaxed break-words">{signal.summary}</p>}

        {href && (
          // Pembungkus menjaga jarak antarbaris; tautannya sendiri tetap setinggi 40px untuk disentuh.
          <div className="min-w-0">
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="-my-2 h-10 max-w-full inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:underline"
            >
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              <span className="min-w-0 truncate">{signal.source === "JARINGAN" ? t("Lihat posting") : hostOf(href)}</span>
              <span className="sr-only"> ({t("tab baru")})</span>
            </a>
          </div>
        )}

        {/* Topik yang lagi ramai: buka pencarian Threads untuk melihat apa yang sedang dibahas orang (tanpa izin API). */}
        {signal.source === "GTRENDS" && (
          <div className="min-w-0">
            <a
              href={threadsSearchUrl(signal.title)}
              target="_blank"
              rel="noopener noreferrer"
              className="-my-2 h-10 inline-flex items-center gap-1.5 text-[13px] font-semibold text-fg hover:underline"
            >
              <ThreadsMark className="w-3.5 h-3.5 shrink-0" />
              {t("Lihat di Threads")}
              <span className="sr-only"> ({t("pencarian \"{topic}\" di Threads, tab baru", { topic: signal.title })})</span>
            </a>
          </div>
        )}

        <p className="text-xs text-muted">
          {t("Diperbarui {date}", { date: formatWibFull(new Date(signal.capturedAt)) })} ·{" "}
          {t("berlaku sampai {date}", { date: formatDateWib(signal.expiresAt) })}
        </p>
      </div>

      {canDelete && (
        <button
          type="button"
          onClick={() => onDelete(signal)}
          aria-label={t("Hapus inspirasi ini")}
          className={cn(ICON_BTN, "-mr-2 -mt-1.5 hover:text-danger hover:bg-danger-soft")}
        >
          <Trash2 className="w-[18px] h-[18px]" />
        </button>
      )}
    </li>
  );
});

/* ------------------------------------------------------------------ tab */

interface SignalsTabProps {
  /** Editor ke atas (peran minimal route tambah dan hapus inspirasi). */
  canEdit: boolean;
  onForbidden: () => void;
}

export function SignalsTab({ canEdit, onForbidden }: SignalsTabProps) {
  const t = useT();
  const [source, setSource] = useState<SourceFilter>("ALL");
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SignalDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { notice, show: showNotice, clear: clearNotice } = useNotice();
  const formId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);

  const list = usePaged<SignalDTO, SignalListResponse>(
    `signals:${source}`,
    (cursor, signal) => listRadarSignals({ source: source === "ALL" ? null : source, cursor }, signal),
    (s) => s.id,
    "Gagal memuat tren viral."
  );
  const { data, items, mutate, reload } = list;
  // Cache modul 30 detik yang juga dipakai halaman lain; gagal memuatnya hanya menyembunyikan nama akun.
  const { accounts } = usePublishAccounts();
  const handleById = useMemo(() => new Map(accounts.map((a) => [a.id, accountHandle(a)])), [accounts]);

  // Tab atau halaman yang disembunyikan tidak boleh kembali dengan dialog konfirmasi masih terbuka.
  useLayoutEffect(() => () => setDeleteTarget(null), []);

  // Tombol dan form tambah tetap terpasang selama daftar memuat (mis. saat saringan diganti), supaya
  // teks yang sedang diketik tidak hilang; hanya disembunyikan bila skema radar memang belum dipasang.
  const addable = canEdit && data?.installed !== false;
  const captured = data?.installed ? lastCaptureText(data.lastCapture, source) : null;

  const onAdded = () => {
    const listed = source === "ALL" || source === "MANUAL";
    showNotice(
      "success",
      listed
        ? t("Inspirasi tersimpan.")
        : t("Inspirasi tersimpan. Pilih saringan {filter} untuk melihatnya.", { filter: t(SIGNAL_SOURCE_LABEL.MANUAL) })
    );
    // Server tidak mengembalikan baris yang baru dibuat (id, waktu, masa berlaku), jadi halaman pertama
    // daftar ini saja yang diambil ulang, dan hanya bila baris barunya memang tampil di saringan ini.
    if (listed) reload();
  };

  const closeForm = () => {
    setFormOpen(false);
    toggleRef.current?.focus();
  };

  const askDelete = useCallback((signal: SignalDTO) => {
    setDeleteError(null);
    setDeleteTarget(signal);
  }, []);

  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target || deleting) return;
    const remove = () => mutate((d) => ({ ...d, items: d.items.filter((s) => s.id !== target.id) }));
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteRadarSignal(target.id);
      remove();
      setDeleteTarget(null);
      showNotice("success", t("Inspirasi dihapus."));
    } catch (e) {
      const status = errorStatus(e);
      if (status === 404) {
        remove();
        setDeleteTarget(null);
        showNotice("info", t("Inspirasi itu sudah dihapus sebelumnya."));
      } else {
        if (status === 403) onForbidden();
        setDeleteError(errorText(e, "Gagal menghapus inspirasi. Coba lagi."));
      }
    } finally {
      setDeleting(false);
    }
  };

  const empty = EMPTY_COPY[source];

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-2.5">
        {/*
          Di layar sempit chip digulir mendatar (halaman tidak ikut bergeser); mulai sm dibungkus ke baris
          berikutnya. Padding tegak memberi ruang bagi garis fokus yang kalau tidak terpotong area gulir.
        */}
        <div
          role="group"
          aria-label={t("Saring sumber tren")}
          className="min-w-0 flex gap-2 max-sm:-mx-4 max-sm:px-4 max-sm:-my-1.5 max-sm:py-1.5 max-sm:overflow-x-auto sm:flex-wrap"
        >
          {FILTERS.map((f) => {
            const active = f.value === source;
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={active}
                onClick={() => setSource(f.value)}
                className={cn(
                  "shrink-0 h-9 px-3.5 rounded-full border text-[13px] font-semibold whitespace-nowrap transition-colors cursor-pointer",
                  active ? "bg-fg text-canvas border-fg" : "bg-surface text-muted border-line hover:text-fg hover:border-line-strong"
                )}
              >
                {t(f.label)}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 self-end lg:self-auto shrink-0">
          <RefreshButton onClick={reload} busy={list.refreshing} disabled={list.loading} />
          {addable && (
            <button
              ref={toggleRef}
              type="button"
              aria-expanded={formOpen}
              aria-controls={formOpen ? formId : undefined}
              onClick={() => setFormOpen((v) => !v)}
              className={cn(BTN, formOpen ? BTN_OUTLINE : BTN_PRIMARY)}
            >
              <Plus className={cn("w-4 h-4 transition-transform", formOpen && "rotate-45")} />
              {t("Tambah inspirasi")}
            </button>
          )}
        </div>
      </div>

      {addable && formOpen && <AddSignalForm id={formId} onAdded={onAdded} onClose={closeForm} onForbidden={onForbidden} />}

      {notice && (
        <Banner tone={notice.tone} onClose={clearNotice}>
          {notice.text}
        </Banner>
      )}

      {source === "THREADS_SEARCH" && canEdit && <ThreadsSearchPanel accounts={accounts} onForbidden={onForbidden} />}

      {list.loading ? (
        <ListSkeleton label={t("Memuat tren viral")} />
      ) : !data ? (
        <LoadFailure status={list.status} message={list.error ?? "Gagal memuat tren viral."} onRetry={reload} />
      ) : !data.installed ? (
        <NotInstalled />
      ) : (
        <>
          {list.error && <Banner tone="danger">{t("Gagal menyegarkan: {error}", { error: t(list.error) })}</Banner>}
          {captured && <p className="text-xs text-muted">{captured}</p>}
          {source === "ALL" && !data.lastCapture.THREADS_SEARCH && (
            <p className="flex items-start gap-2 rounded-xl bg-subtle p-3 text-[13px] text-muted leading-relaxed">
              <ThreadsMark className="w-4 h-4 mt-0.5 shrink-0 text-fg" />
              <span>
                <span className="font-semibold text-fg">{t("Viral di Threads")}</span>{" "}
                {t("akan muncul di sini setelah izin pencarian Threads untuk aplikasi kami disetujui Meta. Sementara itu tampil topik yang lagi ramai di Indonesia dan posting akun Anda yang sedang viral.")}
              </span>
            </p>
          )}
          {items.length === 0 ? (
            <EmptyState icon={<Radar className="w-6 h-6" />} title={t(empty.title)}>
              <p>{t(empty.body)}</p>
              {source === "ALL" && canEdit && <p>{t("Anda juga bisa menambah inspirasi sendiri lewat tombol Tambah inspirasi.")}</p>}
            </EmptyState>
          ) : (
            <ul className="card divide-y divide-line">
              {items.map((s) =>
                s.source === "THREADS_SEARCH" ? (
                  <ThreadsViralRow key={s.id} signal={s} />
                ) : (
                  <SignalRow
                    key={s.id}
                    signal={s}
                    forAccount={s.source === "NICHE" && s.accountId ? handleById.get(s.accountId) ?? null : null}
                    canDelete={canEdit && s.removable}
                    onDelete={askDelete}
                  />
                )
              )}
            </ul>
          )}
          {list.moreError && <Banner tone="danger">{t(list.moreError)}</Banner>}
          {list.nextCursor && <LoadMoreButton onClick={() => void list.loadMore()} loading={list.loadingMore} />}
        </>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
        busy={deleting}
        error={deleteError ? t(deleteError) : null}
        variant="danger"
        title={t("Hapus inspirasi ini?")}
        confirmLabel={t("Ya, hapus")}
        confirmIcon={<Trash2 className="w-4 h-4" />}
      >
        {deleteTarget && (
          <>
            <p className="text-sm text-fg leading-relaxed">
              {t("Inspirasi ini dihapus dari radar dan tidak lagi dipakai untuk ide baru. Ide yang sudah dibuat darinya tetap ada.")}
            </p>
            <p className="mt-2.5 rounded-xl bg-subtle p-3 text-[13px] text-muted leading-relaxed break-words line-clamp-3">
              {deleteTarget.title}
            </p>
          </>
        )}
      </ConfirmModal>
    </div>
  );
}
