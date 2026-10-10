"use client";

import React, { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Sparkles,
  Trash2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Video,
  FileText,
  Image as ImageIcon,
  Layers,
  Eye,
  Heart,
  MessageCircle,
  X,
  TrendingUp,
  BarChart2,
  Users,
  Check,
} from "lucide-react";
import { cn, formatNumber, formatDateWIB, formatRelativeTime } from "@/lib/utils";
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal";

interface PostItem {
  id: string;
  mediaId: string;
  mediaType: string;
  formatLabel: string;
  formatKey: string;
  text: string;
  permalink?: string;
  postedAt: string;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  er: number;
  isPositive: boolean;
  account: string;
  accountName: string;
  accountAvatar?: string;
}

interface AccountOption {
  username: string;
  displayName: string;
  count: number;
}

export default function PostsPage() {
  const router = useRouter();
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [stats, setStats] = useState({
    totalPosts: 0,
    totalViews: 0,
    totalLikes: 0,
    totalReplies: 0,
  });
  const [loading, setLoading] = useState(true);

  // Filters
  const [activeTab, setActiveTab] = useState<"all" | "top" | "flop">("all");
  const [selectedAccount, setSelectedAccount] = useState<string>("all");
  const [selectedFormat, setSelectedFormat] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [limitPerPage, setLimitPerPage] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Custom Account Dropdown state (No native select!)
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const [accountSearchText, setAccountSearchText] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Destructive delete modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedPostToDelete, setSelectedPostToDelete] = useState<PostItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsAccountDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchPosts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        tab: activeTab,
        page: currentPage.toString(),
        limit: limitPerPage.toString(),
        account: selectedAccount,
        format: selectedFormat,
      });
      if (debouncedSearch) params.set("search", debouncedSearch);

      const res = await fetch(`/api/posts?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setPosts(data.posts || []);
        if (data.accounts) setAccounts(data.accounts);
        if (data.stats) setStats(data.stats);
        setTotalCount(data.pagination?.total || 0);
        setTotalPages(data.pagination?.totalPages || 1);
      }
    } catch (err) {
      console.error("Failed to load posts:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, [activeTab, selectedAccount, selectedFormat, debouncedSearch, currentPage, limitPerPage]);

  const openDeleteModal = (post: PostItem) => {
    setSelectedPostToDelete(post);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!selectedPostToDelete) return;
    setIsDeleting(true);
    try {
      const res = await fetch("/api/posts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedPostToDelete.id }),
      });
      const data = await res.json();
      if (data.success) {
        setIsDeleteModalOpen(false);
        setSelectedPostToDelete(null);
        fetchPosts();
      }
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setIsDeleting(false);
    }
  };

  const getFormatBadge = (formatLabel: string) => {
    if (formatLabel === "Video") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#16DBCC]/10 text-[#0f8b81] font-semibold text-[11px]">
          <Video className="w-3.5 h-3.5 text-[#16DBCC]" />
          Video
        </span>
      );
    }
    if (formatLabel === "Carousel") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FFBB38]/15 text-[#a87405] font-semibold text-[11px]">
          <Layers className="w-3.5 h-3.5 text-[#FFBB38]" />
          Carousel
        </span>
      );
    }
    if (formatLabel === "Foto") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FF4B4A]/10 text-[#c22e2e] font-semibold text-[11px]">
          <ImageIcon className="w-3.5 h-3.5 text-[#FF4B4A]" />
          Foto
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#1814F3]/10 text-[#1814F3] font-semibold text-[11px]">
        <FileText className="w-3.5 h-3.5 text-[#1814F3]" />
        Teks
      </span>
    );
  };

  const filteredAccounts = accounts.filter(
    (a) =>
      a.username.toLowerCase().includes(accountSearchText.toLowerCase()) ||
      a.displayName.toLowerCase().includes(accountSearchText.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Page Title & Context */}
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-[#343C6A] tracking-tight">
          Content & Posts Hub
        </h2>
        <p className="text-xs md:text-sm text-[#718EBF] mt-0.5">
          Eksplorasi seluruh postingan Threads terpublikasi, tinjau impresi audiens, dan analisis via AI
        </p>
      </div>

      {/* Top Metric Strip (Real Aggregates) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="neo-card p-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-[#1814F3]/10 text-[#1814F3] flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-semibold text-[#718EBF] uppercase">
              Total Postingan
            </span>
            <h4 className="text-xl font-bold text-[#343C6A]">
              {formatNumber(stats.totalPosts)}
            </h4>
          </div>
        </div>

        <div className="neo-card p-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-[#16DBCC]/15 text-[#16DBCC] flex items-center justify-center shrink-0">
            <Eye className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-semibold text-[#718EBF] uppercase">
              Total Penayangan
            </span>
            <h4 className="text-xl font-bold text-[#343C6A]">
              {formatNumber(stats.totalViews)}
            </h4>
          </div>
        </div>

        <div className="neo-card p-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-[#FF4B4A]/10 text-[#FF4B4A] flex items-center justify-center shrink-0">
            <Heart className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-semibold text-[#718EBF] uppercase">
              Total Likes
            </span>
            <h4 className="text-xl font-bold text-[#343C6A]">
              {formatNumber(stats.totalLikes)}
            </h4>
          </div>
        </div>

        <div className="neo-card p-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-[#FFBB38]/15 text-[#FFBB38] flex items-center justify-center shrink-0">
            <MessageCircle className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-semibold text-[#718EBF] uppercase">
              Total Replies
            </span>
            <h4 className="text-xl font-bold text-[#343C6A]">
              {formatNumber(stats.totalReplies)}
            </h4>
          </div>
        </div>
      </div>

      {/* Main Content Card */}
      <div className="neo-card p-5 md:p-7 space-y-5">
        {/* Row 1: Tabs & Search Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#EDF2F7]">
          {/* Custom Tabs */}
          <div className="flex items-center gap-6">
            <button
              onClick={() => {
                setActiveTab("all");
                setCurrentPage(1);
              }}
              className={cn(
                "relative pb-3 text-sm font-semibold transition-colors cursor-pointer",
                activeTab === "all"
                  ? "text-[#1814F3]"
                  : "text-[#718EBF] hover:text-[#343C6A]"
              )}
            >
              Semua Postingan
              {activeTab === "all" && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1814F3] rounded-full" />
              )}
            </button>
            <button
              onClick={() => {
                setActiveTab("top");
                setCurrentPage(1);
              }}
              className={cn(
                "relative pb-3 text-sm font-semibold transition-colors cursor-pointer",
                activeTab === "top"
                  ? "text-[#1814F3]"
                  : "text-[#718EBF] hover:text-[#343C6A]"
              )}
            >
              Top Performer
              {activeTab === "top" && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1814F3] rounded-full" />
              )}
            </button>
            <button
              onClick={() => {
                setActiveTab("flop");
                setCurrentPage(1);
              }}
              className={cn(
                "relative pb-3 text-sm font-semibold transition-colors cursor-pointer",
                activeTab === "flop"
                  ? "text-[#1814F3]"
                  : "text-[#718EBF] hover:text-[#343C6A]"
              )}
            >
              Perlu Evaluasi
              {activeTab === "flop" && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1814F3] rounded-full" />
              )}
            </button>
          </div>

          {/* Search Box */}
          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 text-[#718EBF] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari caption postingan..."
              className="w-full h-10 pl-10 pr-8 bg-[#F5F7FA] text-xs text-[#343C6A] placeholder-[#8BA3CB] rounded-full border border-transparent focus:border-[#1814F3]/30 focus:bg-white focus:outline-none transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#718EBF] hover:text-[#343C6A] p-0.5 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Secondary Filters (Custom Account Dropdown & Format Filter Chips) */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {/* Custom Account Selector (No Native Browser Control!) */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
              className="h-9 px-4 rounded-xl bg-[#F5F7FA] hover:bg-[#EDF2F7] text-xs font-semibold text-[#343C6A] border border-[#EDF2F7] flex items-center gap-2 transition-all cursor-pointer"
            >
              <Users className="w-3.5 h-3.5 text-[#1814F3]" />
              <span>
                {selectedAccount === "all"
                  ? "Semua Akun Threads"
                  : `@${selectedAccount}`}
              </span>
              <ChevronDown
                className={cn(
                  "w-3.5 h-3.5 text-[#718EBF] transition-transform",
                  isAccountDropdownOpen && "rotate-180"
                )}
              />
            </button>

            {/* Custom Dropdown Menu */}
            {isAccountDropdownOpen && (
              <div className="absolute left-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-[#EDF2F7] p-2 z-40 animate-in fade-in zoom-in-95 duration-150">
                <div className="p-2 border-b border-[#EDF2F7]">
                  <input
                    type="text"
                    value={accountSearchText}
                    onChange={(e) => setAccountSearchText(e.target.value)}
                    placeholder="Cari akun..."
                    className="w-full h-8 px-3 text-xs bg-[#F5F7FA] rounded-lg border-none focus:outline-none text-[#343C6A]"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto py-1 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAccount("all");
                      setCurrentPage(1);
                      setIsAccountDropdownOpen(false);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between transition-colors cursor-pointer",
                      selectedAccount === "all"
                        ? "bg-[#1814F3]/10 text-[#1814F3] font-bold"
                        : "text-[#343C6A] hover:bg-[#F4F7FE]"
                    )}
                  >
                    <span>Semua Akun (32)</span>
                    {selectedAccount === "all" && <Check className="w-3.5 h-3.5" />}
                  </button>
                  {filteredAccounts.map((acc) => (
                    <button
                      key={acc.username}
                      type="button"
                      onClick={() => {
                        setSelectedAccount(acc.username);
                        setCurrentPage(1);
                        setIsAccountDropdownOpen(false);
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between transition-colors cursor-pointer",
                        selectedAccount === acc.username
                          ? "bg-[#1814F3]/10 text-[#1814F3] font-bold"
                          : "text-[#343C6A] hover:bg-[#F4F7FE]"
                      )}
                    >
                      <div className="truncate pr-2">
                        <span className="font-semibold block truncate">
                          @{acc.username}
                        </span>
                        <span className="text-[10px] text-[#718EBF] truncate">
                          {acc.displayName}
                        </span>
                      </div>
                      <span className="text-[10px] text-[#718EBF] font-mono bg-[#F5F7FA] px-1.5 py-0.5 rounded">
                        {acc.count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Format Filter Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-1">
            {[
              { id: "all", label: "Semua Format" },
              { id: "TEXT", label: "Teks (1.4K)" },
              { id: "VIDEO", label: "Video (197)" },
              { id: "CAROUSEL", label: "Carousel (18)" },
              { id: "IMAGE", label: "Foto (40)" },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  setSelectedFormat(f.id);
                  setCurrentPage(1);
                }}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer whitespace-nowrap",
                  selectedFormat === f.id
                    ? "bg-[#343C6A] text-white shadow-xs"
                    : "bg-[#F5F7FA] text-[#718EBF] hover:text-[#343C6A] hover:bg-[#EDF2F7]"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Clean Natural Data Table */}
        <div className="overflow-x-auto rounded-2xl border border-[#EDF2F7]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F8FAFC] border-b border-[#EDF2F7] text-[11px] uppercase tracking-wider text-[#718EBF] font-bold">
                <th className="py-3.5 px-4 min-w-[340px]">Konten Threads</th>
                <th className="py-3.5 px-3">Format</th>
                <th className="py-3.5 px-4">Metrik Impresi</th>
                <th className="py-3.5 px-3 text-right">Engagement (ER)</th>
                <th className="py-3.5 px-3 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EDF2F7] text-xs">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center text-[#718EBF]">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div className="w-6 h-6 border-2 border-[#1814F3] border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs font-medium">
                        Memuat data postingan Threads...
                      </span>
                    </div>
                  </td>
                </tr>
              ) : posts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center text-[#718EBF]">
                    <p className="font-semibold text-sm text-[#343C6A]">
                      Tidak ada postingan ditemukan
                    </p>
                    <p className="text-xs text-[#718EBF] mt-1">
                      Coba ganti filter akun atau kata kunci pencarian Anda
                    </p>
                  </td>
                </tr>
              ) : (
                posts.map((post) => (
                  <tr
                    key={post.id}
                    className="hover:bg-[#F9FBFE] transition-colors group"
                  >
                    {/* Column 1: Content Caption & Account */}
                    <td className="py-4 px-4 align-top">
                      <div className="space-y-1.5 max-w-lg">
                        {/* Poster Header */}
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-[#1814F3]/10 text-[#1814F3] font-bold text-[10px] flex items-center justify-center shrink-0">
                            {post.account.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-bold text-[#343C6A] hover:underline cursor-pointer">
                            @{post.account}
                          </span>
                          <span className="text-[#CBD5E1]">&bull;</span>
                          <span className="text-[11px] text-[#718EBF]">
                            {formatRelativeTime(post.postedAt)}
                          </span>
                        </div>

                        {/* Caption text */}
                        <p className="text-xs text-[#343C6A] font-medium leading-relaxed line-clamp-3">
                          {post.text}
                        </p>

                        {/* Permalink direct link */}
                        {post.permalink && (
                          <div className="pt-0.5">
                            <a
                              href={post.permalink}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] font-semibold text-[#1814F3] hover:underline inline-flex items-center gap-1"
                            >
                              <span>Lihat di Threads</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Column 2: Format Badge */}
                    <td className="py-4 px-3 align-top whitespace-nowrap">
                      {getFormatBadge(post.formatLabel)}
                    </td>

                    {/* Column 3: Real Metrics (Views, Likes, Replies) */}
                    <td className="py-4 px-4 align-top whitespace-nowrap">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5 text-[#343C6A]" title="Views">
                          <Eye className="w-3.5 h-3.5 text-[#718EBF]" />
                          <span className="font-bold">{formatNumber(post.views)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[#343C6A]" title="Likes">
                          <Heart className="w-3.5 h-3.5 text-[#FF4B4A]" />
                          <span className="font-semibold">{formatNumber(post.likes)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[#343C6A]" title="Replies">
                          <MessageCircle className="w-3.5 h-3.5 text-[#16DBCC]" />
                          <span className="font-semibold">{formatNumber(post.replies)}</span>
                        </div>
                      </div>
                    </td>

                    {/* Column 4: Engagement Rate */}
                    <td className="py-4 px-3 align-top text-right whitespace-nowrap">
                      <div className="inline-flex flex-col items-end">
                        <span
                          className={cn(
                            "font-bold text-xs px-2.5 py-0.5 rounded-full inline-block",
                            post.er >= 4.0
                              ? "text-[#16DBCC] bg-[#16DBCC]/10"
                              : "text-[#343C6A] bg-[#EDF2F7]"
                          )}
                        >
                          {post.er}%
                        </span>
                        <span className="text-[10px] text-[#718EBF] mt-0.5">
                          {post.er >= 4.0 ? "High ER" : "Standard"}
                        </span>
                      </div>
                    </td>

                    {/* Column 5: Actions */}
                    <td className="py-4 px-3 align-top text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-2">
                        {/* Button Prompt AI */}
                        <button
                          onClick={() =>
                            router.push(
                              `/prompt-studio?prompt=${encodeURIComponent(
                                `Analisis postingan Threads dari @${post.account}: "${post.text.slice(0, 100)}" (Views: ${post.views}, Likes: ${post.likes}, Replies: ${post.replies}, ER: ${post.er}%). Berikan evaluasi hook dan rekomendasi konten perbaikannya.`
                              )}`
                            )
                          }
                          title="Analisis postingan ini dengan Hermes AI"
                          className="h-8 px-3 rounded-lg bg-[#1814F3]/10 hover:bg-[#1814F3] text-[#1814F3] hover:text-white font-semibold text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Tanya AI</span>
                        </button>

                        {/* Delete Button (Protected with Mandatory Modal) */}
                        <button
                          onClick={() => openDeleteModal(post)}
                          aria-label="Hapus post"
                          title="Hapus data post"
                          className="w-8 h-8 rounded-lg text-[#718EBF] hover:text-[#FF4B4A] hover:bg-[#FF4B4A]/10 flex items-center justify-center transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer: Pagination & Records Info */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
          {/* Records Counter */}
          <div className="text-xs text-[#718EBF]">
            Menampilkan{" "}
            <strong className="text-[#343C6A]">
              {totalCount > 0 ? (currentPage - 1) * limitPerPage + 1 : 0}–
              {Math.min(currentPage * limitPerPage, totalCount)}
            </strong>{" "}
            dari <strong className="text-[#343C6A]">{formatNumber(totalCount)}</strong> postingan
          </div>

          {/* Pagination Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="flex items-center gap-1 px-3.5 py-1.5 rounded-xl border border-[#EDF2F7] text-xs font-semibold text-[#718EBF] hover:text-[#343C6A] hover:bg-[#F4F7FE] disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Sebelumnya</span>
            </button>

            <span className="text-xs font-bold text-[#343C6A] px-2">
              Halaman {currentPage} dari {totalPages}
            </span>

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="flex items-center gap-1 px-3.5 py-1.5 rounded-xl border border-[#EDF2F7] text-xs font-semibold text-[#718EBF] hover:text-[#343C6A] hover:bg-[#F4F7FE] disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              <span>Berikutnya</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Mandatory Destructive Action Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleConfirmDelete}
        tableName="ThreadsPostStat"
        recordIdentifier={`Media ID: #${selectedPostToDelete?.mediaId}`}
        description={
          selectedPostToDelete
            ? `Post milik @${selectedPostToDelete.account}: "${selectedPostToDelete.text.slice(0, 80)}..."`
            : undefined
        }
        isDeleting={isDeleting}
      />
    </div>
  );
}
