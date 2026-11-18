"use client";

import React, { useId, useState } from "react";
import { ChevronDown, ExternalLink, Info, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { listTrendPosts, listTrendingTopics } from "@/lib/radar-client";
import { wibParts } from "@/lib/scheduling";
import { ThreadsMark } from "@/components/landing/threads-mark";
import { useT } from "@/components/i18n/lang-provider";
import { Banner, ListSkeleton } from "@/components/autopilot/shared";
import { pad2 } from "@/components/settings/format";
import { useRemote } from "@/components/settings/use-remote";
import { EmptyState, LoadFailure, RefreshButton } from "./shared";

type Country = "ID" | "US";
type PostType = "top" | "recent";

const COUNTRIES: { value: Country; label: string }[] = [
  { value: "ID", label: "Indonesia" },
  { value: "US", label: "Amerika Serikat" },
];

const segment = (active: boolean) =>
  cn(
    "h-8 px-3.5 rounded-full text-[13px] font-semibold transition-colors cursor-pointer",
    active ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
  );

function wibTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const p = wibParts(d);
  return `${pad2(p.h)}.${pad2(p.min)} WIB`;
}

/** Cari topik di aplikasi Threads (tautan publik; tidak memakai data tren). */
const threadsSearchUrl = (title: string) => `https://www.threads.com/search?q=${encodeURIComponent(title)}&serp_type=default`;

function TrendPosts({ trendId, title }: { trendId: string; title: string }) {
  const t = useT();
  const [type, setType] = useState<PostType>("top");
  const posts = useRemote(`trend:${trendId}:${type}`, (signal) => listTrendPosts(trendId, type, signal), "Gagal memuat posting tren.");
  const data = posts.data;

  return (
    <div className="mt-3 space-y-2.5">
      <div role="group" aria-label={t("Urutan posting")} className="inline-flex p-1 rounded-full bg-subtle">
        <button type="button" aria-pressed={type === "top"} onClick={() => setType("top")} className={segment(type === "top")}>
          {t("Teratas")}
        </button>
        <button type="button" aria-pressed={type === "recent"} onClick={() => setType("recent")} className={segment(type === "recent")}>
          {t("Terbaru")}
        </button>
      </div>

      {posts.loading ? (
        <ListSkeleton label={t("Memuat posting tren")} />
      ) : !data ? (
        <LoadFailure status={posts.status} message={posts.error ?? "Gagal memuat posting tren."} onRetry={posts.reload} />
      ) : !data.approved ? (
        <Banner tone="info">
          {t("Posting untuk topik tren tampil di sini setelah Meta menyetujui fitur Threads Trending Topics untuk BotThreads. Sementara itu buka topiknya langsung di Threads.")}{" "}
          <a href={threadsSearchUrl(title)} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
            {t("Buka di Threads")}
            <span className="sr-only"> ({t("tab baru")})</span>
          </a>
        </Banner>
      ) : data.posts.length === 0 ? (
        <p className="text-[13px] text-muted">{t("Belum ada posting untuk topik ini.")}</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {data.posts.map((p) => (
            <li key={p.id} className="p-3.5 space-y-1.5">
              <p className="text-[13px] font-semibold text-fg">@{p.username || t("pengguna")}</p>
              <p className="text-sm text-fg leading-relaxed whitespace-pre-wrap break-words line-clamp-6">{p.text || t("(tanpa teks)")}</p>
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
  );
}

function TopicRow({ rank, topic }: { rank: number; topic: { trendId: string; title: string; description: string | null } }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <li className="p-3.5 sm:p-4">
      <div className="flex items-start gap-3">
        <span className="w-7 h-7 shrink-0 rounded-full bg-accent-soft text-accent text-xs font-bold inline-flex items-center justify-center tabular-nums">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-fg break-words">{topic.title}</p>
          {topic.description && <p className="mt-0.5 text-[13px] text-muted leading-relaxed break-words">{topic.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={open ? panelId : undefined}
              onClick={() => setOpen((v) => !v)}
              className="-my-2 h-10 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline cursor-pointer"
            >
              {open ? t("Sembunyikan posting") : t("Lihat posting tren")}
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
            </button>
            <a
              href={threadsSearchUrl(topic.title)}
              target="_blank"
              rel="noopener noreferrer"
              className="-my-2 h-10 inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-fg hover:underline"
            >
              {t("Buka di Threads")}
              <ExternalLink className="w-3 h-3" />
              <span className="sr-only"> ({t("tab baru")})</span>
            </a>
          </div>
          {open && (
            <div id={panelId}>
              <TrendPosts trendId={topic.trendId} title={topic.title} />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Radar > Tren Viral > "Trending di Threads": topik yang sedang tren di aplikasi Threads (fitur Meta Threads
 * Trending Topics). Hanya ditampilkan untuk inspirasi; datanya tidak disimpan dan tidak diubah.
 */
export function TrendingTopicsPanel() {
  const t = useT();
  const [country, setCountry] = useState<Country>("ID");
  const topics = useRemote(`trending:${country}`, (signal) => listTrendingTopics(country, signal), "Gagal memuat tren Threads.");
  const data = topics.data;

  return (
    <section aria-label={t("Trending di Threads")} className="space-y-3">
      <div className="card p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <ThreadsMark className="w-5 h-5 mt-0.5 shrink-0 text-fg" />
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-fg">{t("Trending di Threads")}</h3>
              <p className="text-[13px] text-muted leading-relaxed">
                {t("Topik yang sedang tren di aplikasi Threads saat ini. Ditampilkan apa adanya sebagai inspirasi; BotThreads tidak menyimpan atau mengubahnya.")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            <div role="group" aria-label={t("Negara tren")} className="inline-flex p-1 rounded-full bg-subtle">
              {COUNTRIES.map((c) => (
                <button key={c.value} type="button" aria-pressed={country === c.value} onClick={() => setCountry(c.value)} className={segment(country === c.value)}>
                  {t(c.label)}
                </button>
              ))}
            </div>
            <RefreshButton onClick={topics.reload} busy={topics.refreshing} disabled={topics.loading} />
          </div>
        </div>
        {data?.fallbackFrom && (
          <p className="flex items-start gap-2 rounded-xl bg-subtle p-3 text-[13px] text-muted leading-relaxed">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              {t("Threads belum menyediakan tren untuk Indonesia, jadi yang tampil tren Amerika Serikat. Tren Indonesia otomatis muncul di sini begitu Threads membukanya.")}
            </span>
          </p>
        )}
        {data && (
          <p className="text-xs text-muted">
            {t("{n} topik · diperbarui {time} · tren Threads berubah paling cepat sekali per jam", { n: data.topics.length, time: wibTime(data.fetchedAt) })}
          </p>
        )}
      </div>

      {topics.loading ? (
        <ListSkeleton label={t("Memuat tren Threads")} />
      ) : !data ? (
        <LoadFailure status={topics.status} message={topics.error ?? "Gagal memuat tren Threads."} onRetry={topics.reload} />
      ) : data.topics.length === 0 ? (
        <EmptyState icon={<TrendingUp className="w-6 h-6" />} title={t("Belum ada topik tren dari Threads.")}>
          <p>{t("Coba lagi nanti atau pilih negara lain.")}</p>
        </EmptyState>
      ) : (
        <>
          {topics.error && <Banner tone="danger">{t("Gagal menyegarkan: {error}", { error: topics.error })}</Banner>}
          <ol className="card divide-y divide-line">
            {data.topics.map((topic, i) => (
              <TopicRow key={topic.trendId} rank={i + 1} topic={topic} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
