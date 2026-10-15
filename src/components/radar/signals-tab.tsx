"use client";

import React, { memo, useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Plus, Radar, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { addRadarSignal, deleteRadarSignal, listRadarSignals } from "@/lib/radar-client";
import { MANUAL_SIGNAL_MAX, SIGNAL_SOURCE_LABEL, type SignalDTO, type SignalListResponse, type SignalSource } from "@/lib/radar-types";
import { formatWibFull } from "@/lib/scheduling";
import { ConfirmModal } from "@/components/autopilot/confirm-modal";
import { Banner, ListSkeleton, LoadMoreButton } from "@/components/autopilot/shared";
import { FormError, TextAreaField, TextField } from "@/components/settings/fields";
import { errorDetails, errorStatus, errorText, formatDateWib, toScore100 } from "@/components/settings/format";
import { usePaged } from "@/components/settings/use-remote";
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

/** Sumber yang sudah diisi server. WEB dan THREADS_SEARCH baru disiapkan, jadi belum ditawarkan sebagai saringan. */
type OfferedSource = Extract<SignalSource, "JARINGAN" | "GTRENDS" | "MOMEN" | "MANUAL">;
type SourceFilter = "ALL" | OfferedSource;

const FILTER_SOURCES: OfferedSource[] = ["JARINGAN", "GTRENDS", "MOMEN", "MANUAL"];
const FILTERS: { value: SourceFilter; label: string }[] = [
  { value: "ALL", label: "Semua" },
  ...FILTER_SOURCES.map((s) => ({ value: s, label: SIGNAL_SOURCE_LABEL[s] })),
];
/** Sumber yang dikumpulkan tick autopilot (inspirasi manual tidak dihitung "pengambilan"). */
const AUTO_SOURCES: OfferedSource[] = ["JARINGAN", "GTRENDS", "MOMEN"];

const URL_MAX = 500;
const TEXT_MIN = 10;
/** Judul sependek ini (kata kunci tren, nama momen) ditebalkan; teks posting panjang tidak. */
const SHORT_TITLE = 80;

const EMPTY_COPY: Record<SourceFilter, { title: string; body: string }> = {
  ALL: {
    title: "Radar belum menangkap sinyal.",
    body: "Setiap tick autopilot mengumpulkan pemenang jaringan, tren pencarian, dan momen kalender secara otomatis. Sinyal yang masih berlaku akan muncul di sini.",
  },
  JARINGAN: {
    title: "Belum ada pemenang jaringan.",
    body: "Tick autopilot menandai postingan akun Anda yang views-nya jauh di atas kebiasaan akunnya. Pemenang baru akan muncul di sini dengan sendirinya.",
  },
  GTRENDS: {
    title: "Belum ada tren pencarian.",
    body: "Tren pencarian Indonesia diambil otomatis saat tick autopilot berjalan, lalu disaring supaya aman untuk brand.",
  },
  MOMEN: {
    title: "Tidak ada momen yang sedang berlaku.",
    body: "Momen bawaan dan momen dari tab Momen menjadi sinyal saat sedang berjalan atau segera dimulai.",
  },
  MANUAL: {
    title: "Belum ada inspirasi manual.",
    body: "Tempel teks posting atau gagasan yang menarik. AI memakainya sebagai bahan ide sampai masa berlakunya habis.",
  },
};

function lastCaptureText(last: SignalListResponse["lastCapture"], source: SourceFilter): string | null {
  if (source === "MANUAL") return null;
  if (source === "ALL") {
    // ISO UTC berformat sama, jadi urutan teks = urutan waktu.
    const latest = AUTO_SOURCES.map((s) => last[s]).filter((v): v is string => !!v).sort().at(-1);
    return latest ? `Pengambilan otomatis terakhir ${formatWibFull(new Date(latest))}.` : "Radar belum pernah mengambil sinyal otomatis.";
  }
  const at = last[source];
  return at
    ? `${SIGNAL_SOURCE_LABEL[source]} terakhir diambil ${formatWibFull(new Date(at))}.`
    : `${SIGNAL_SOURCE_LABEL[source]} belum pernah diambil.`;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Buka tautan";
  }
};

/* ------------------------------------------------------------------ form tambah inspirasi */

function urlIssueOf(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.length > URL_MAX) return `Tautan maksimal ${URL_MAX} karakter.`;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? null : "Tautan harus diawali http:// atau https://.";
  } catch {
    return "Tautan tidak valid. Tulis lengkap dengan https://.";
  }
}

interface AddSignalFormProps {
  id: string;
  onAdded: () => void;
  onClose: () => void;
  onForbidden: () => void;
}

function AddSignalForm({ id, onAdded, onClose, onForbidden }: AddSignalFormProps) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);

  const clean = text.replace(/\s+/g, " ").trim();
  const textIssue = clean.length < TEXT_MIN ? `Teks inspirasi minimal ${TEXT_MIN} karakter.` : null;
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
    <form id={id} onSubmit={submit} noValidate aria-label="Tambah inspirasi" className="card p-4 space-y-3">
      <TextAreaField
        label="Teks inspirasi"
        value={text}
        onChange={(v) => {
          setText(v);
          setError(null);
        }}
        maxLength={MANUAL_SIGNAL_MAX}
        rows={3}
        placeholder="Tempel teks posting atau tulis gagasan yang ingin dijadikan bahan ide"
        hint="AI memakainya sebagai rujukan saat menyusun ide, bukan untuk disalin apa adanya."
        error={tried ? textIssue : null}
        disabled={busy}
        autoFocus
      />
      <TextField
        label="Tautan (opsional)"
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
      <FormError message={error?.message} details={error?.details} />
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy} className={cn(BTN, BTN_OUTLINE)}>
          Tutup
        </button>
        <button type="submit" disabled={busy} className={cn(BTN, BTN_PRIMARY)}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {busy ? "Menyimpan..." : "Simpan inspirasi"}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ baris sinyal */

interface SignalRowProps {
  signal: SignalDTO;
  canDelete: boolean;
  onDelete: (signal: SignalDTO) => void;
}

const SignalRow = memo(function SignalRow({ signal, canDelete, onDelete }: SignalRowProps) {
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
          {signal.rank !== null && <span className="text-xs font-semibold text-fg tabular-nums">Peringkat {signal.rank}</span>}
          <span className="text-xs font-semibold text-muted tabular-nums">
            Kekuatan {toScore100(signal.score)}
            <span className="sr-only"> dari 100</span>
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
              {open ? "Ringkas" : "Selengkapnya"}
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
              <span className="min-w-0 truncate">{signal.source === "JARINGAN" ? "Buka posting" : hostOf(href)}</span>
              <span className="sr-only"> (tab baru)</span>
            </a>
          </div>
        )}

        <p className="text-xs text-muted">
          Diambil {formatWibFull(new Date(signal.capturedAt))} · berlaku sampai {formatDateWib(signal.expiresAt)}
        </p>
      </div>

      {canDelete && (
        <button
          type="button"
          onClick={() => onDelete(signal)}
          aria-label="Hapus inspirasi ini"
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
    "Gagal memuat sinyal radar."
  );
  const { data, items, mutate, reload } = list;

  // Tab atau halaman yang disembunyikan tidak boleh kembali dengan dialog konfirmasi masih terbuka.
  useLayoutEffect(() => () => setDeleteTarget(null), []);

  // Tombol dan form tambah tetap terpasang selama daftar memuat (mis. saat saringan diganti), supaya
  // teks yang sedang diketik tidak hilang; hanya disembunyikan bila skema radar memang belum dipasang.
  const addable = canEdit && data?.installed !== false;
  const captured = data?.installed ? lastCaptureText(data.lastCapture, source) : null;

  const onAdded = () => {
    const listed = source === "ALL" || source === "MANUAL";
    showNotice("success", listed ? "Inspirasi tersimpan." : `Inspirasi tersimpan. Pilih saringan ${SIGNAL_SOURCE_LABEL.MANUAL} untuk melihatnya.`);
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
      showNotice("success", "Inspirasi dihapus.");
    } catch (e) {
      const status = errorStatus(e);
      if (status === 404) {
        remove();
        setDeleteTarget(null);
        showNotice("info", "Inspirasi itu sudah dihapus sebelumnya.");
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
          aria-label="Saring sumber sinyal"
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
                  "shrink-0 h-10 px-3.5 rounded-full border text-[13px] font-semibold whitespace-nowrap transition-colors cursor-pointer",
                  active ? "bg-accent text-on-accent border-accent" : "bg-surface text-fg border-line-strong hover:border-accent hover:text-accent"
                )}
              >
                {f.label}
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
              Tambah inspirasi
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

      {list.loading ? (
        <ListSkeleton label="Memuat sinyal radar" />
      ) : !data ? (
        <LoadFailure status={list.status} message={list.error ?? "Gagal memuat sinyal radar."} onRetry={reload} />
      ) : !data.installed ? (
        <NotInstalled />
      ) : (
        <>
          {list.error && <Banner tone="danger">Gagal menyegarkan: {list.error}</Banner>}
          {captured && <p className="text-xs text-muted">{captured}</p>}
          {items.length === 0 ? (
            <EmptyState icon={<Radar className="w-6 h-6" />} title={empty.title}>
              <p>{empty.body}</p>
              {source === "ALL" && canEdit && <p>Anda juga bisa menambah inspirasi sendiri lewat tombol Tambah inspirasi.</p>}
            </EmptyState>
          ) : (
            <ul className="card divide-y divide-line">
              {items.map((s) => (
                <SignalRow key={s.id} signal={s} canDelete={canEdit && s.removable} onDelete={askDelete} />
              ))}
            </ul>
          )}
          {list.moreError && <Banner tone="danger">{list.moreError}</Banner>}
          {list.nextCursor && <LoadMoreButton onClick={() => void list.loadMore()} loading={list.loadingMore} />}
        </>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
        busy={deleting}
        error={deleteError}
        variant="danger"
        title="Hapus inspirasi ini?"
        confirmLabel="Ya, hapus"
        confirmIcon={<Trash2 className="w-4 h-4" />}
      >
        {deleteTarget && (
          <>
            <p className="text-sm text-fg leading-relaxed">
              Inspirasi ini dihapus dari radar dan tidak lagi dipakai untuk ide baru. Ide yang sudah dibuat darinya tetap ada.
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
