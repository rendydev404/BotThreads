"use client";

import React from "react";
import { formatNumber } from "@/lib/utils";
import {
  Award,
  Eye,
  Heart,
  MessageSquare,
  ExternalLink,
  Layers,
  FileText,
  Video,
  Image as ImageIcon,
  BookOpen,
} from "lucide-react";

interface TopPerformingPostCardProps {
  topPost?: {
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
  } | null;
  contentFormats?: Array<{
    name: string;
    value: number;
    count: number;
    color: string;
  }>;
}

export function TopPerformingPostCard({
  topPost,
  contentFormats = [],
}: TopPerformingPostCardProps) {
  const getFormatIcon = (name: string) => {
    if (name.includes("Video")) return Video;
    if (name.includes("Foto")) return ImageIcon;
    if (name.includes("Carousel")) return BookOpen;
    return FileText;
  };

  return (
    <div className="space-y-6">
      {/* 1. Top Post Card */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-xs">
        <div className="flex items-center justify-between pb-3.5 border-b border-[#F1F5F9]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Award className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-[#1E293B]">
                Postingan Terpopuler
              </h4>
              <p className="text-[10px] text-[#64748B]">
                Penayangan tertinggi di jaringan
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 text-[#1814F3] text-[11px] font-bold">
            <Eye className="w-3 h-3" />
            {topPost ? formatNumber(topPost.views) : "3.0K"} Views
          </span>
        </div>

        {/* Post Text & Author */}
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-[#E2E8F0] overflow-hidden flex items-center justify-center text-[10px] font-bold text-[#475569]">
              {topPost?.threadsAccount?.avatarUrl ? (
                <img
                  src={topPost.threadsAccount.avatarUrl}
                  alt={topPost.threadsAccount.displayName || "Account"}
                  className="w-full h-full object-cover"
                />
              ) : (
                "@"
              )}
            </div>
            <span className="text-xs font-bold text-[#1E293B]">
              @{topPost?.threadsAccount?.username || "theakbaralatas"}
            </span>
          </div>

          <p className="text-xs leading-relaxed text-[#334155] bg-[#F8FAFC] border border-[#F1F5F9] rounded-xl p-3 italic line-clamp-3">
            "{topPost?.text || "Kebakaran di sebelah outlet Suka Shawarma..."}"
          </p>

          <div className="mt-3.5 flex items-center justify-between text-xs text-[#64748B]">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1 font-semibold text-[#1E293B]">
                <Heart className="w-3.5 h-3.5 text-rose-500" />
                {topPost?.likes || 18}
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-[#1E293B]">
                <MessageSquare className="w-3.5 h-3.5 text-[#1814F3]" />
                {topPost?.replies || 24}
              </span>
            </div>

            {topPost?.permalink && (
              <a
                href={topPost.permalink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-bold text-[#1814F3] hover:underline"
              >
                <span>Buka Threads</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* 2. Content Formats Breakdown */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-xs">
        <div className="flex items-center justify-between pb-3 border-b border-[#F1F5F9]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-[#1E293B]">
                Distribusi Format Konten
              </h4>
              <p className="text-[10px] text-[#64748B]">
                Komposisi tipe media dari seluruh post
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {contentFormats.map((format, idx) => {
            const Icon = getFormatIcon(format.name);
            return (
              <div key={idx} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 font-medium text-[#1E293B]">
                    <Icon className="w-3.5 h-3.5 text-[#64748B]" />
                    <span>{format.name}</span>
                  </div>
                  <span className="font-bold text-[#1E293B]">
                    {format.value}%{" "}
                    <span className="text-[11px] font-normal text-[#64748B]">
                      ({format.count} post)
                    </span>
                  </span>
                </div>
                <div className="w-full h-2 bg-[#F1F5F9] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${format.value}%`,
                      backgroundColor: format.color || "#1814F3",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
