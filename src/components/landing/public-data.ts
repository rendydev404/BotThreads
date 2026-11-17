/**
 * Isi halaman publik (perkenalan, /fitur, /cara-kerja-botthreads). Setiap klaim mengikuti perilaku sistem yang
 * sebenarnya, sama dengan faq-data.ts (autopilot-config, autopilot-gate, radar, midtrans). Ubah bersama kodenya bila
 * aturannya berubah.
 */

/** Perbandingan untuk bagian "Apa itu BotThreads?" dan halaman Fitur. */
export const COMPARISON: { row: string; manual: string; scheduler: string; bot: string }[] = [
  { row: "Mencari ide", manual: "Anda cari sendiri", scheduler: "Anda cari sendiri", bot: "Otomatis dari tren Google Indonesia, berita niche, dan posting Threads populer" },
  { row: "Menulis posting", manual: "Anda tulis sendiri", scheduler: "Anda tulis sendiri", bot: "AI menulis dengan gaya bahasa brand Anda" },
  { row: "Pemeriksaan sebelum terbit", manual: "Tidak ada", scheduler: "Tidak ada", bot: "4 cek plus skor editor AI minimal 0,7 dari 1" },
  { row: "Jam tayang", manual: "Kira-kira", scheduler: "Anda pilih sendiri", bot: "Dihitung dari jam ramai pengikut tiap akun" },
  { row: "Belajar dari hasil", manual: "Lihat statistik sendiri", scheduler: "Laporan saja", bot: "Pola yang berhasil dipakai lagi, akun dijeda bila kinerja turun" },
];

export type FeatureIcon = "radar" | "pen" | "shield" | "clock" | "eye" | "chart" | "brake" | "reply" | "users" | "lock";

/** Fitur utama untuk halaman /fitur. `id` dipakai sebagai jangkar (#id) dan tidak boleh diubah sembarangan. */
export const FEATURES: { id: string; icon: FeatureIcon; title: string; body: string; points: string[] }[] = [
  {
    id: "ide-otomatis",
    icon: "radar",
    title: "Ide posting otomatis setiap hari",
    body: "BotThreads mencari bahan tulisan dari enam sumber, lalu mengumpulkan semua ide di menu Radar lengkap dengan skor dan contoh tulisannya. Sumbernya hanya dijadikan bahan, teksnya tidak disalin.",
    points: [
      "Posting akun Anda yang paling ramai",
      "Tren pencarian Google di Indonesia",
      "Berita terbaru seputar niche akun",
      "Posting Threads paling populer untuk topik yang sedang naik",
      "Momen kalender: gajian, tanggal tua, akhir pekan, dan momen Anda sendiri",
      "Catatan inspirasi yang Anda tulis sendiri",
    ],
  },
  {
    id: "gaya-brand",
    icon: "pen",
    title: "Ditulis dengan suara brand Anda",
    body: "Profil brand diisi sekali di awal. Fakta yang boleh disebut AI diambil dari menu Pengetahuan yang Anda isi sendiri, jadi tulisan terdengar seperti akun Anda dan tidak mengarang data.",
    points: ["Fakta brand", "Produk dan harga", "Promo beserta tanggal berakhirnya", "Larangan dan kata yang tidak boleh dipakai"],
  },
  {
    id: "pemeriksaan",
    icon: "shield",
    title: "Diperiksa sebelum boleh terbit",
    body: "Setiap draf melewati empat pemeriksaan lalu dinilai editor AI. Draf yang gagal ditulis ulang. Kalau tetap gagal, jadwal itu dilewati, bukan dipaksa terbit.",
    points: [
      "Harga, persen, dan kata promo hanya boleh muncul bila ada di data brand",
      "Topik sensitif dan kata terlarang diblokir",
      "Tidak boleh mirip posting akun lain Anda di hari yang sama",
      "Panjang tulisan dicek",
      "Skor editor AI minimal 0,7 dari 1",
    ],
  },
  {
    id: "jadwal-jam-ramai",
    icon: "clock",
    title: "Terbit di jam ramai tiap akun",
    body: "Jam tayang dipilih dari jam ketika pengikut akun itu paling aktif, bukan jam yang sama untuk semua akun. Jeda antarposting membuat akun tidak terlihat seperti spam.",
    points: ["Bawaan 3 posting sehari per akun, bisa diubah sampai batas paket", "Jeda antarposting bawaan 2,5 jam, bisa diatur 2 sampai 8 jam", "Posting terjadwal bisa diubah atau dibatalkan dari menu Jadwal"],
  },
  {
    id: "tinjau-atau-otomatis",
    icon: "eye",
    title: "Mode Tinjau dulu atau Otomatis",
    body: "Anda yang menentukan seberapa lepas tangan, per akun, dan bisa diganti kapan saja.",
    points: [
      "Tinjau dulu: AI menulis sekitar 6 jam sebelum jam tayang dan menunggu persetujuan Anda",
      "Draf yang belum disetujui sampai 15 menit sebelum jamnya dilewati, tidak diterbitkan",
      "Otomatis: AI menulis sekitar 90 menit sebelum jam tayang, draf yang lolos pemeriksaan terbit sendiri",
      "Beberapa paket hanya menyediakan mode Tinjau dulu",
    ],
  },
  {
    id: "belajar-dari-hasil",
    icon: "chart",
    title: "Analitik yang dipakai untuk menulis lagi",
    body: "Setelah angka views masuk, tiap posting dibandingkan dengan kebiasaan akunnya sendiri, bukan dengan akun lain.",
    points: [
      "Pembuka, tema, dan jam yang menaikkan views dipakai lagi untuk tulisan berikutnya",
      "Posting yang views-nya melonjak memicu notifikasi dan ide lanjutan",
      "Statistik dibaca lewat API resmi Threads",
    ],
  },
  {
    id: "rem-pengaman",
    icon: "brake",
    title: "Rem pengaman otomatis",
    body: "Autopilot bisa dihentikan kapan saja, dan sistem juga menarik remnya sendiri bila ada yang tidak beres.",
    points: [
      "Satu tombol menjeda semua akun sekaligus",
      "Akun yang gagal terbit tiga kali berturut-turut dijeda otomatis",
      "Views seminggu turun lebih dari separuh: akun pindah ke mode Tinjau dulu dan Anda diberi tahu",
    ],
  },
  {
    id: "moderasi-balasan",
    icon: "reply",
    title: "Moderasi balasan di Threads",
    body: "Balasan untuk posting Anda bisa dikelola dari dalam BotThreads tanpa membuka aplikasi Threads.",
    points: ["Membaca dan membalas balasan", "Menyembunyikan dan menampilkan lagi balasan", "Mengatur siapa yang boleh membalas posting"],
  },
  {
    id: "multi-akun",
    icon: "users",
    title: "Beberapa akun dan anggota tim",
    body: "Satu workspace menampung beberapa akun Threads dan anggota tim. Jumlah akun, posting per hari, dan anggota mengikuti paket yang dipilih.",
    points: ["Autopilot diatur per akun", "Anggota tim diundang ke workspace yang sama", "Paket bisa dinaikkan kapan saja"],
  },
  {
    id: "api-resmi",
    icon: "lock",
    title: "Lewat API resmi, tanpa kata sandi",
    body: "Akun dihubungkan lewat halaman login resmi Threads, jadi kata sandi Anda tidak pernah kami terima. Memposting, membaca statistik, dan mencari posting populer semuanya memakai API resmi Threads.",
    points: ["Login resmi Threads (OAuth)", "Penghapusan data bisa diajukan kapan saja", "Pembayaran dalam Rupiah lewat Midtrans"],
  },
];

/** Satu hari autopilot untuk halaman Cara kerja. Jam adalah ilustrasi untuk satu akun dengan pengaturan bawaan. */
export const DAY_TIMELINE: { time: string; title: string; body: string }[] = [
  {
    time: "06.00",
    title: "Tren dipantau",
    body: "Ide dikumpulkan dari posting terbaik akun, tren Google Indonesia, berita niche, posting Threads populer, dan momen kalender, lalu diberi skor di menu Radar.",
  },
  {
    time: "06.05",
    title: "Jadwal hari ini disusun",
    body: "Jam tayang dipilih dari jam ramai pengikut akun itu, bawaannya 3 posting sehari dengan jeda 2,5 jam.",
  },
  {
    time: "10.42",
    title: "Draf ditulis dan diperiksa",
    body: "Sembilan puluh menit sebelum jam tayang (mode Otomatis), draf ditulis dengan gaya brand, diperiksa empat hal, dan dinilai editor AI minimal 0,7 dari 1.",
  },
  {
    time: "12.12",
    title: "Terbit di Threads",
    body: "Tepat di jamnya, posting terbit lewat API resmi dan muncul di akun Anda seperti posting biasa.",
  },
  {
    time: "22.00",
    title: "Belajar dari hasil",
    body: "Views tiap posting dibandingkan dengan kebiasaan akunnya. Pola yang berhasil dipakai lagi besok, dan akun dijeda bila kinerjanya turun tajam.",
  },
];

/** Dua hal yang Anda kerjakan sekali di awal (halaman Cara kerja). */
export const SETUP_STEPS: { title: string; body: string }[] = [
  { title: "Daftar dan pilih paket", body: "Buat workspace dengan akun Google atau email, lalu pilih paket. Pembayaran dalam Rupiah lewat Midtrans dan paket aktif otomatis begitu lunas." },
  { title: "Hubungkan akun Threads", body: "Login lewat halaman resmi Threads. BotThreads tidak pernah menerima kata sandi Anda." },
  { title: "Kenalkan brand ke AI", body: "Isi profil brand dan menu Pengetahuan: fakta brand, produk dan harga, promo, serta larangan." },
  { title: "Nyalakan autopilot", body: "Mulai dengan mode Tinjau dulu selama beberapa hari. Kalau gaya tulisnya sudah pas, ganti ke mode Otomatis." },
];
