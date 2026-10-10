"use client";

import React from "react";
import { formatNumber } from "@/lib/utils";
import {
  Eye,
  Heart,
  MessageSquare,
  ExternalLink,
  FileText,
  Video,
  Image as ImageIcon,
  LayoutGrid,
  type LucideIcon,
} from "lucide-react";

interface TopPost {
  id?: string;
  text: string;
  mediaType?: string;
  views: number;
  likes: number;
  replies: number;
  permalink?: string | null;
  postedAt?: string;
  threadsAccount?: {
    username?: string | null;
    displayName?: string;
    avatarUrl?: string | null;
  } | null;
}

interface ContentFormat {
  name: string;
  value: number;
  count: number;
  color: string;
}

interface TopPerformingPostCardProps {
  topPost?: TopPost | null;
  contentFormats?: ContentFormat[];
  loading?: boolean;
}

function formatIcon(name: string): LucideIcon {
  if (name.includes("Video")) return Video;
  if (name.includes("Foto")) return ImageIcon;
  if (name.includes("Carousel")) return LayoutGrid;
  return FileText;
}

export function TopPerformingPostCard({
  topPost,
  contentFormats = [],
  loading = false,
}: TopPerformingPostCardProps) {
  return (
    <div className="space-y-4">
      {/* Postingan terpopuler */}
      <section className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-fg">Postingan terpopuler</h3>
          {topPost && (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
              <Eye className="w-4 h-4" />
              {formatNumber(topPost.views)}
            </span>
          )}
        </div>

        {loading ? (
          <div className="mt-4 space-y-3 animate-pulse">
            <div className="h-4 w-32 rounded bg-subtle" />
            <div className="h-20 rounded-xl bg-subtle" />
          </div>
        ) : !topPost ? (
          <p className="mt-4 text-sm text-muted">Belum ada postingan.</p>
        ) : (
          <>
            <div className="mt-4 flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-subtle overflow-hidden flex items-center justify-center text-xs font-semibold text-muted shrink-0">
                {topPost.threadsAccount?.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={topPost.threadsAccount.avatarUrl}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  "@"
                )}
              </div>
              <span className="text-sm font-medium text-fg truncate">
                @{topPost.threadsAccount?.username || "akun"}
              </span>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-fg bg-subtle rounded-xl p-3.5 line-clamp-4">
              {topPost.text}
            </p>

            <div className="mt-3 flex items-center justify-between text-sm text-muted">
              <div className="flex items-center gap-4">
                <span className="inline-flex items-center gap-1.5">
                  <Heart className="w-4 h-4 text-danger" />
                  {formatNumber(topPost.likes)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4" />
                  {formatNumber(topPost.replies)}
                </span>
              </div>

              {topPost.permalink && (
                <a
                  href={topPost.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                >
                  Buka di Threads
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </>
        )}
      </section>

      {/* Jenis konten */}
      <section className="card p-5">
        <h3 className="text-base font-semibold text-fg">Jenis konten</h3>
        <p className="text-[13px] text-muted mt-0.5">
          Proporsi tiap format dari seluruh postingan
        </p>

        <ul className="mt-4 space-y-4">
          {loading
            ? [0, 1, 2].map((i) => (
                <li key={i} className="h-8 rounded-md bg-subtle animate-pulse" />
              ))
            : contentFormats.map((format) => {
                const Icon = formatIcon(format.name);
                return (
                  <li key={format.name}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="inline-flex items-center gap-2 text-fg">
                        <Icon className="w-4 h-4 text-muted" />
                        {format.name}
                      </span>
                      <span className="text-muted">
                        <span className="font-semibold text-fg">
                          {format.value}%
                        </span>{" "}
                        · {formatNumber(format.count)}
                      </span>
                    </div>
                    <div
                      className="mt-2 h-1.5 bg-subtle rounded-full overflow-hidden"
                      role="progressbar"
                      aria-label={format.name}
                      aria-valuenow={format.value}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${Math.max(format.value, 2)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
        </ul>
      </section>
    </div>
  );
}
