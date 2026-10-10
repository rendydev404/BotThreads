"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  ArrowDownRight,
  Search,
  Sparkles,
  Trash2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Video,
  FileText,
  Image as ImageIcon,
  Layers,
  Filter,
} from "lucide-react";
import { cn, formatNumber, formatDateWIB } from "@/lib/utils";
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal";

interface PostItem {
  id: string;
  mediaId: string;
  mediaType: string;
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
}

export default function PostsPage() {
  const router = useRouter();
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"all" | "top" | "flop">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Destructive delete modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedPostToDelete, setSelectedPostToDelete] = useState<PostItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchPosts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        tab: activeTab,
        page: currentPage.toString(),
        limit: "8",
      });
      if (searchQuery) params.set("search", searchQuery);

      const res = await fetch(`/api/posts?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setPosts(data.posts);
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
  }, [activeTab, currentPage]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(1);
    fetchPosts();
  };

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

  const getTypeIcon = (type: string) => {
    const t = type.toUpperCase();
    if (t === "VIDEO") return <Video className="w-3.5 h-3.5 text-[#16DBCC]" />;
    if (t === "CAROUSEL") return <Layers className="w-3.5 h-3.5 text-[#FFBB38]" />;
    if (t === "IMAGE") return <ImageIcon className="w-3.5 h-3.5 text-[#FF4B4A]" />;
    return <FileText className="w-3.5 h-3.5 text-[#1814F3]" />;
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-[#343C6A] tracking-tight">
          Threads Content & Posts Hub
        </h2>
        <p className="text-xs md:text-sm text-[#718EBF] mt-0.5">
          Analisis granular setiap postingan Threads dan rekomendasi optimasi bot AI
        </p>
      </div>

      {/* Main Table Card */}
      <div className="neo-card p-6 md:p-8">
        {/* Table Controls: Tabs (Left) & Search (Right) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#EDF2F7]">
          {/* Custom Tabs with Solid Blue Underline */}
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
              All Posts
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
              Flop / Evaluasi
              {activeTab === "flop" && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1814F3] rounded-full" />
              )}
            </button>
          </div>

          {/* Custom Search Bar */}
          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="w-4 h-4 text-[#718EBF] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari caption postingan..."
              className="w-full sm:w-64 h-10 pl-10 pr-4 bg-[#F5F7FA] text-xs text-[#343C6A] placeholder-[#8BA3CB] rounded-full border border-transparent focus:border-[#1814F3]/30 focus:bg-white focus:outline-none transition-all"
            />
          </form>
        </div>

        {/* Responsive Table */}
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#EDF2F7] text-[11px] uppercase tracking-wider text-[#718EBF] font-bold">
                <th className="py-4 px-3 w-12 text-center">Status</th>
                <th className="py-4 px-4 min-w-[260px]">Cuplikan Konten</th>
                <th className="py-4 px-3">Post ID</th>
                <th className="py-4 px-3">Format</th>
                <th className="py-4 px-3">Akun</th>
                <th className="py-4 px-3">Tanggal & Jam</th>
                <th className="py-4 px-3 text-right">ER (%)</th>
                <th className="py-4 px-3 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EDF2F7] text-xs">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#718EBF]">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div className="w-6 h-6 border-2 border-[#1814F3] border-t-transparent rounded-full animate-spin" />
                      <span>Memuat data postingan Threads...</span>
                    </div>
                  </td>
                </tr>
              ) : posts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#718EBF]">
                    Tidak ada postingan yang sesuai dengan filter.
                  </td>
                </tr>
              ) : (
                posts.map((post) => (
                  <tr
                    key={post.id}
                    className="hover:bg-[#F4F7FE]/60 transition-colors group"
                  >
                    {/* Performance Direction Indicator */}
                    <td className="py-4 px-3 text-center">
                      <div
                        className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center mx-auto",
                          post.isPositive
                            ? "bg-[#16DBCC]/15 text-[#16DBCC]"
                            : "bg-[#FF4B4A]/15 text-[#FF4B4A]"
                        )}
                      >
                        {post.isPositive ? (
                          <ArrowUpRight className="w-4 h-4" strokeWidth={2.5} />
                        ) : (
                          <ArrowDownRight className="w-4 h-4" strokeWidth={2.5} />
                        )}
                      </div>
                    </td>

                    {/* Content Preview */}
                    <td className="py-4 px-4">
                      <div className="max-w-md">
                        <p className="font-semibold text-[#343C6A] line-clamp-2 leading-relaxed">
                          {post.text}
                        </p>
                        {post.permalink && (
                          <a
                            href={post.permalink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-[#1814F3] inline-flex items-center gap-1 mt-1 hover:underline"
                          >
                            <span>Buka di Threads</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </td>

                    {/* Post ID */}
                    <td className="py-4 px-3 font-mono font-medium text-[#718EBF]">
                      #{post.mediaId.slice(-8)}
                    </td>

                    {/* Type Badge */}
                    <td className="py-4 px-3">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F5F7FA] font-medium text-[#343C6A] text-[11px]">
                        {getTypeIcon(post.mediaType)}
                        <span>{post.mediaType}</span>
                      </span>
                    </td>

                    {/* Account */}
                    <td className="py-4 px-3 font-medium text-[#343C6A]">
                      @{post.account}
                    </td>

                    {/* Date */}
                    <td className="py-4 px-3 text-[#718EBF] whitespace-nowrap">
                      {formatDateWIB(post.postedAt)}
                    </td>

                    {/* ER (%) */}
                    <td className="py-4 px-3 text-right">
                      <span
                        className={cn(
                          "font-bold text-sm px-2.5 py-0.5 rounded-full inline-block",
                          post.isPositive
                            ? "text-[#16DBCC] bg-[#16DBCC]/10"
                            : "text-[#FF4B4A] bg-[#FF4B4A]/10"
                        )}
                      >
                        {post.er}%
                      </span>
                      <span className="block text-[10px] text-[#718EBF] mt-0.5">
                        {formatNumber(post.views)} views
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-4 px-3 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-2">
                        {/* Custom Pill Analyze AI */}
                        <button
                          onClick={() =>
                            router.push(
                              `/prompt-studio?prompt=${encodeURIComponent(
                                `Analisis postingan Threads #${post.mediaId}: "${post.text.slice(0, 100)}" dengan ER ${post.er}%`
                              )}`
                            )
                          }
                          className="px-3 py-1.5 rounded-full bg-[#1814F3]/10 hover:bg-[#1814F3] text-[#1814F3] hover:text-white font-semibold text-[11px] transition-all flex items-center gap-1 cursor-pointer"
                        >
                          <Sparkles className="w-3 h-3" />
                          <span>Analyze AI</span>
                        </button>

                        {/* Custom Delete Action (Guarded by Mandatory Confirmation) */}
                        <button
                          onClick={() => openDeleteModal(post)}
                          aria-label="Hapus post"
                          className="w-7 h-7 rounded-full text-[#718EBF] hover:text-[#FF4B4A] hover:bg-[#FF4B4A]/10 flex items-center justify-center transition-colors cursor-pointer"
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

        {/* Custom Pagination */}
        <div className="flex items-center justify-between pt-6 mt-4 border-t border-[#EDF2F7]">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="flex items-center gap-1 px-4 py-2 rounded-full border border-[#EDF2F7] text-xs font-semibold text-[#718EBF] hover:text-[#343C6A] hover:bg-[#F4F7FE] disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Previous</span>
          </button>

          <div className="flex items-center gap-2">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
              <button
                key={pageNum}
                onClick={() => setCurrentPage(pageNum)}
                className={cn(
                  "w-8 h-8 rounded-full text-xs font-bold transition-all",
                  currentPage === pageNum
                    ? "bg-[#1814F3] text-white shadow-sm shadow-[#1814F3]/30"
                    : "text-[#718EBF] hover:text-[#343C6A] hover:bg-[#F4F7FE]"
                )}
              >
                {pageNum}
              </button>
            ))}
          </div>

          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="flex items-center gap-1 px-4 py-2 rounded-full border border-[#EDF2F7] text-xs font-semibold text-[#718EBF] hover:text-[#343C6A] hover:bg-[#F4F7FE] disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <span>Next</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mandatory Destructive Action Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleConfirmDelete}
        tableName="ThreadsPostStat"
        recordIdentifier={`Media ID: #${selectedPostToDelete?.mediaId}`}
        description={selectedPostToDelete ? `Caption: "${selectedPostToDelete.text.slice(0, 80)}..."` : undefined}
        isDeleting={isDeleting}
      />
    </div>
  );
}
