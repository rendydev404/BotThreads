/** Terjemahan EN: kunci = teks Indonesia persis seperti di kode. */
const dict: Record<string, string> = {
  // Halaman Ringkasan (src/app/page.tsx)
  "Performa Threads": "Threads performance",
  "Gabungan dari {n} akun yang Anda kelola.": "Combined across the {n} account you manage.||Combined across the {n} accounts you manage.",
  "Menampilkan satu akun: @{username}.": "Showing one account: @{username}.",
  "Perbarui data": "Refresh data",
  Perbarui: "Refresh",
  "Analisis AI": "AI analysis",
  Langsung: "Live",
  "diperbarui {time} WIB": "updated {time} WIB",
  "{n} akun belum bisa diambil": "{n} account couldn't be fetched yet||{n} accounts couldn't be fetched yet",
  "dibanding sehari sebelumnya": "vs. the previous day",
  "dibanding {n} hari sebelumnya": "vs. the previous {n} day||vs. the previous {n} days",
  "belum ada data pembanding": "no comparison data yet",
  Aktivitas: "Activity",
  "Aktivitas {label}": "Activity: {label}",
  "Aktivitas {label} & 6 hari sebelumnya": "Activity: {label} & the previous 6 days",
  "Penayangan dan interaksi per hari": "Views and interactions per day",
  Penayangan: "Views",
  Interaksi: "Interactions",
  "Semua akun ({n})": "All accounts ({n})",

  // Filter periode + label periode dari server
  "Pilih periode": "Select period",
  "Hari ini": "Today",
  Kemarin: "Yesterday",
  "7 hari": "7 days",
  "14 hari": "14 days",
  "30 hari": "30 days",
  "{n} hari terakhir": "Last {n} day||Last {n} days",
  Kustom: "Custom",
  "Rentang tanggal": "Date range",
  Dari: "From",
  Sampai: "To",
  Batal: "Cancel",
  Terapkan: "Apply",
  "Isi tanggal awal dan akhir.": "Enter a start and end date.",
  "Tanggal awal tidak boleh setelah tanggal akhir.": "The start date can't be after the end date.",
  "Maksimal {n} hari.": "Maximum {n} day.||Maximum {n} days.",

  // Filter akun
  "Filter per akun": "Filter by account",
  "Akun terpilih": "Selected account",
  "Pilih akun cabang": "Select branch account",
  "Lihat data satu akun saja, atau gabungan semuanya": "View data for one account, or all of them combined",
  Tutup: "Close",
  "Cari nama cabang atau @username": "Search branch name or @username",
  "Cari akun": "Search accounts",
  "Daftar akun": "Account list",
  "Gabungan performa seluruh jaringan": "Combined performance across the network",
  "{n} post": "{n} post||{n} posts",
  "Tidak ada akun yang cocok dengan “{query}”.": "No accounts match “{query}”.",

  // Kartu ringkasan angka
  Akun: "Accounts",
  "Akun dipilih": "Selected account",
  "Semua akun terhubung": "All connected accounts",
  "Total pengikut": "Total followers",
  "Pengikut akun": "Account followers",
  "Gabungan dari {n} cabang": "Combined across {n} branch||Combined across {n} branches",
  "Total penayangan": "Total views",
  "Berapa kali postingan dilihat": "How many times posts were viewed",
  "Postingan terbit": "Published posts",
  "Postingan baru pada periode ini": "New posts in this period",
  "Tingkat interaksi": "Engagement rate",
  "{interactions} interaksi: {likes} suka, {replies} komentar": "{interactions} interactions: {likes} likes, {replies} comments",
  poin: "pts",
  baru: "new",

  // Peringkat cabang
  "Peringkat cabang": "Branch ranking",
  "Diurutkan dari penayangan terbanyak pada periode terpilih. Klik baris untuk melihat satu cabang.":
    "Sorted by most views in the selected period. Click a row to view one branch.",
  "Semua akun": "All accounts",
  "Cari cabang…": "Search branches…",
  "Cari cabang": "Search branches",
  Cabang: "Branch",
  Pengikut: "Followers",
  Postingan: "Posts",
  "Tidak ada cabang yang cocok dengan “{query}”.": "No branches match “{query}”.",
  "{shown} dari {total} cabang": "{shown} of {total} branches",
  "Tampilkan lebih sedikit": "Show less",
  "Lihat semua": "View all",

  // Postingan terpopuler & jenis konten
  "Postingan terpopuler": "Top post",
  "Belum ada postingan.": "No posts yet.",
  akun: "account",
  "Buka di Threads": "Open in Threads",
  "Jenis konten": "Content types",
  "Proporsi tiap format dari seluruh postingan": "Share of each format across all posts",
  "Teks Singkat": "Short text",
  "Video / Reels": "Video / Reels",
  "Foto / Promo": "Photo / Promo",
  "Carousel Edukasi": "Educational carousel",

  // Aktivitas bot
  "Aktivitas bot": "Bot activity",
  "Laporan dan sinkronisasi terbaru": "Latest reports and syncs",
  "Belum ada aktivitas.": "No activity yet.",
  "Laporan Harian Telegram": "Telegram daily report",
  "Laporan Sosmed Telegram": "Telegram social media report",
  "Periode: {period} terkirim sukses": "Period: {period} sent successfully",

  // Panel analisis AI
  "periode ini": "this period",
  "Analisis belum bisa dibuat. Periksa koneksi lalu coba lagi.": "The analysis couldn't be created. Check your connection and try again.",
  "Lanjutkan analisis {label} untuk {scope}: dalami saran yang paling berdampak dan buatkan 3 draf postingan Threads-nya.":
    "Continue the {label} analysis for {scope}: dig deeper into the most impactful suggestion and write 3 Threads post drafts for it.",
  "Analisis & saran dari AI": "AI analysis & suggestions",
  "Temuan penting, langkah yang bisa dikerjakan, dan ide konten berdasarkan data {label} · {scope}.":
    "Key findings, actionable steps, and content ideas based on {label} data · {scope}.",
  "Filter berubah, analisis sebelumnya tidak ditampilkan.": "Filters changed, so the previous analysis is hidden.",
  "Analisis & beri saran": "Analyze & suggest",
  "AI sedang menganalisis data {label}…": "AI is analyzing {label} data…",
  "Biasanya 10 sampai 25 detik.": "Usually 10 to 25 seconds.",
  "Analisis & saran AI": "AI analysis & suggestions",
  "Salin analisis": "Copy analysis",
  "Buat ulang analisis": "Regenerate analysis",
  "Tanya lanjutan di chat": "Ask a follow-up in chat",
  "AI sedang sibuk, ini analisis otomatis.": "AI is busy, so this is an automatic analysis.",

  // Galat API yang terkait dasbor
  "Gagal memuat data dasbor.": "Failed to load dashboard data.",
  "Analisis belum bisa dibuat. Coba lagi sebentar.": "The analysis couldn't be created. Please try again shortly.",
};

export default dict;
