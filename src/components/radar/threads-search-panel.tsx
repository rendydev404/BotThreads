"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchThreads, type ThreadsSearchResponse } from "@/lib/radar-client";
import { ThreadsMark } from "@/components/landing/threads-mark";
import { useT } from "@/components/i18n/lang-provider";
import { Dropdown, type DropdownOption } from "@/components/autopilot/dropdown";
import { Banner, accountHandle } from "@/components/autopilot/shared";
import { FormError, TextField } from "@/components/settings/fields";
import { errorStatus, errorText } from "@/components/settings/format";
import type { PublishAccountDTO } from "@/lib/content-types";
import { BTN, BTN_PRIMARY } from "./shared";

const QUERY_MAX = 100;

interface Props {
  accounts: PublishAccountDTO[];
  onForbidden: () => void;
}

/**
 * Radar > Viral di Threads > "Cari di Threads": cari posting publik dengan kata kunci memakai akun Threads
 * milik workspace (threads_keyword_search). Hasil hanya ditampilkan untuk inspirasi, tidak disimpan dan
 * tidak dibalas.
 */
export function ThreadsSearchPanel({ accounts, onForbidden }: Props) {
  const t = useT();
  const usable = useMemo(() => accounts.filter((a) => a.username), [accounts]);
  const [picked, setAccountId] = useState("");
  // Belum memilih (atau akunnya hilang dari daftar): pakai akun pertama.
  const accountId = usable.some((a) => a.id === picked) ? picked : usable[0]?.id ?? "";
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"TOP" | "RECENT">("TOP");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(ThreadsSearchResponse & { q: string }) | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const accountOptions = useMemo<DropdownOption<string>[]>(
    () => usable.map((a) => ({ value: a.id, label: accountHandle(a), hint: a.outletNama ?? undefined })),
    [usable]
  );
  const typeOptions: DropdownOption<"TOP" | "RECENT">[] = [
    { value: "TOP", label: t("Teratas") },
    { value: "RECENT", label: t("Terbaru") },
  ];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!accountId) return setError("Pilih akun Threads dulu.");
    if (q.length < 2) return setError("Kata kunci minimal 2 karakter.");
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setError(null);
    try {
      const res = await searchThreads({ accountId, q, type }, ctrl.signal);
      setResult({ ...res, q });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      if (errorStatus(err) === 403) onForbidden();
      setError(errorText(err, "Gagal mencari di Threads. Coba lagi."));
    } finally {
      if (abortRef.current === ctrl) setBusy(false);
    }
  };

  return (
    <section aria-label={t("Cari di Threads")} className="card p-4 space-y-3">
      <div className="flex items-start gap-2.5">
        <ThreadsMark className="w-5 h-5 mt-0.5 shrink-0 text-fg" />
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-fg">{t("Cari di Threads")}</h3>
          <p className="text-[13px] text-muted leading-relaxed">
            {t("Cari posting publik dengan kata kunci untuk melihat apa yang sedang dibahas di niche Anda. Hasil hanya ditampilkan, tidak disimpan dan tidak dibalas.")}
          </p>
        </div>
      </div>

      {usable.length === 0 ? (
        <p className="text-[13px] text-muted">{t("Hubungkan akun Threads dulu di halaman Akun Threads.")}</p>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col lg:flex-row lg:items-end gap-2.5">
          <div className="lg:w-56 shrink-0">
            <p className="mb-1.5 text-[13px] font-semibold text-fg">{t("Cari sebagai")}</p>
            <Dropdown
              ariaLabel={t("Akun yang dipakai mencari")}
              value={accountId}
              options={accountOptions}
              onChange={setAccountId}
              disabled={busy}
              className="w-full"
              buttonClassName="w-full"
            />
          </div>
          <TextField
            label={t("Kata kunci")}
            value={query}
            onChange={setQuery}
            maxLength={QUERY_MAX}
            placeholder={t("mis. shawarma, kuliner malam")}
            className="flex-1 min-w-0"
          />
          <div className="lg:w-36 shrink-0">
            <p className="mb-1.5 text-[13px] font-semibold text-fg">{t("Urutkan")}</p>
            <Dropdown ariaLabel={t("Urutan hasil")} value={type} options={typeOptions} onChange={setType} disabled={busy} className="w-full" buttonClassName="w-full" />
          </div>
          <button type="submit" disabled={busy} className={cn(BTN, BTN_PRIMARY, "shrink-0")}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {t("Cari")}
          </button>
        </form>
      )}

      <FormError message={error} />

      {result && (
        <div className="space-y-2.5">
          {result.ownOnly && (
            <Banner tone="info">
              {t("Mode uji: sebelum izin pencarian Threads (threads_keyword_search) disetujui Meta, Threads hanya mengembalikan posting milik @{username}. Setelah disetujui, hasilnya posting publik.", { username: result.username })}
            </Banner>
          )}
          <p className="text-xs text-muted">
            {t("{n} hasil untuk \"{q}\"", { n: result.posts.length, q: result.q })}
          </p>
          {result.posts.length === 0 ? (
            <p className="text-[13px] text-muted">
              {t("Tidak ada posting yang cocok. Selama izin pencarian belum disetujui Meta, yang dicari hanya posting akun ini sendiri.")}
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {result.posts.map((p) => (
                <li key={p.id} className="p-3.5 space-y-1.5">
                  <p className="text-[13px] font-semibold text-fg">@{p.username}</p>
                  <p className="text-sm text-fg leading-relaxed whitespace-pre-wrap break-words line-clamp-5">{p.text || t("(tanpa teks)")}</p>
                  {p.permalink && (
                    <a
                      href={p.permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="-my-2 h-10 inline-flex items-center gap-1.5 text-xs font-semibold text-fg hover:underline"
                    >
                      <ThreadsMark className="w-3.5 h-3.5" />
                      {t("Lihat di Threads")}
                      <span className="sr-only"> ({t("tab baru")})</span>
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
