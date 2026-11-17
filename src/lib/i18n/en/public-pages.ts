/**
 * Terjemahan EN untuk halaman informasi publik: /fitur, /cara-kerja-botthreads, /harga, /faq, serta header, menu,
 * dan tautan antarhalaman. Teks yang sama dengan halaman perkenalan sudah ada di ./landing.ts.
 */
const dict: Record<string, string> = {
  // Menu, remah roti, kerangka halaman
  "Fitur@@menu": "Features",
  "Harga@@menu": "Pricing",
  "Menu utama": "Main menu",
  "Remah roti": "Breadcrumb",
  Fitur: "Features",
  Harga: "Pricing",
  "JELAJAHI BOTTHREADS": "EXPLORE BOTTHREADS",
  "Sepuluh hal yang dikerjakan BotThreads untuk akun Threads Anda.": "Ten things BotThreads does for your Threads account.",
  "Satu hari autopilot dari tren pagi sampai belajar dari views malam.": "One autopilot day, from morning trends to learning from evening views.",
  "Paket bulanan dalam Rupiah, dibayar lewat Midtrans.": "Monthly plans in Rupiah, paid through Midtrans.",
  "Lihat semua fitur": "See all features",
  "Baca cara kerja selengkapnya": "Read the full walkthrough",
  "Buka halaman tanya jawab": "Open the FAQ page",
  "Lihat semua tanya jawab": "See all FAQs",
  "Lihat cara kerjanya dari tren sampai terbit": "See how it works, from trend to published post",

  // Judul tab
  "Fitur BotThreads: Autopilot AI untuk Akun Threads": "BotThreads Features: AI Autopilot for Threads Accounts",
  "Cara Kerja BotThreads: Dari Tren sampai Terbit di Threads": "How BotThreads Works: From Trend to Published on Threads",
  "Harga BotThreads: Paket Langganan dalam Rupiah": "BotThreads Pricing: Subscription Plans in Rupiah",
  "Tanya Jawab (FAQ) BotThreads": "BotThreads FAQ",

  // /fitur
  FITUR: "FEATURES",
  "Semua yang dikerjakan BotThreads untuk akun Threads Anda": "Everything BotThreads does for your Threads account",
  "Dari mencari ide sampai belajar dari views, setiap langkah berjalan sendiri dan tetap bisa Anda awasi. Berikut fitur utamanya, lengkap dengan aturan yang benar-benar dipakai sistem.":
    "From finding ideas to learning from views, every step runs on its own and stays under your watch. Here are the main features, with the rules the system actually uses.",
  "Daftar fitur": "Feature list",
  "Ide posting otomatis setiap hari": "Automatic post ideas every day",
  "BotThreads mencari bahan tulisan dari enam sumber, lalu mengumpulkan semua ide di menu Radar lengkap dengan skor dan contoh tulisannya. Sumbernya hanya dijadikan bahan, teksnya tidak disalin.":
    "BotThreads gathers material from six sources and collects every idea in the Radar menu with a score and a sample post. Sources are only used as material; their text is never copied.",
  "Posting akun Anda yang paling ramai": "Your account's best-performing posts",
  "Tren pencarian Google di Indonesia": "Google search trends in Indonesia",
  "Berita terbaru seputar niche akun": "The latest news in the account's niche",
  "Posting Threads paling populer untuk topik yang sedang naik": "The most popular Threads posts on rising topics",
  "Momen kalender: gajian, tanggal tua, akhir pekan, dan momen Anda sendiri": "Calendar moments: payday, end of the month, weekends, and your own dates",
  "Catatan inspirasi yang Anda tulis sendiri": "Inspiration notes you write yourself",
  "Ditulis dengan suara brand Anda": "Written in your brand voice",
  "Profil brand diisi sekali di awal. Fakta yang boleh disebut AI diambil dari menu Pengetahuan yang Anda isi sendiri, jadi tulisan terdengar seperti akun Anda dan tidak mengarang data.":
    "You fill in the brand profile once. The facts the AI may mention come from the Knowledge menu you fill in yourself, so posts sound like your account and never make up data.",
  "Fakta brand": "Brand facts",
  "Produk dan harga": "Products and prices",
  "Promo beserta tanggal berakhirnya": "Promos with their end dates",
  "Larangan dan kata yang tidak boleh dipakai": "Restrictions and words that must not be used",
  "Diperiksa sebelum boleh terbit": "Checked before it may publish",
  "Setiap draf melewati empat pemeriksaan lalu dinilai editor AI. Draf yang gagal ditulis ulang. Kalau tetap gagal, jadwal itu dilewati, bukan dipaksa terbit.":
    "Every draft passes four checks and is then scored by an AI editor. Failed drafts are rewritten. If one still fails, that slot is skipped, never forced out.",
  "Harga, persen, dan kata promo hanya boleh muncul bila ada di data brand": "Prices, percentages, and promo words may appear only if they are in your brand data",
  "Topik sensitif dan kata terlarang diblokir": "Sensitive topics and banned words are blocked",
  "Tidak boleh mirip posting akun lain Anda di hari yang sama": "Must not resemble another of your accounts' posts on the same day",
  "Panjang tulisan dicek": "Length is checked",
  "Skor editor AI minimal 0,7 dari 1": "AI editor score of at least 0.7 out of 1",
  "Terbit di jam ramai tiap akun": "Published at each account's busy hours",
  "Jam tayang dipilih dari jam ketika pengikut akun itu paling aktif, bukan jam yang sama untuk semua akun. Jeda antarposting membuat akun tidak terlihat seperti spam.":
    "Posting times are picked from when that account's followers are most active, not the same hours for every account. Gaps between posts keep the account from looking like spam.",
  "Bawaan 3 posting sehari per akun, bisa diubah sampai batas paket": "3 posts a day per account by default, adjustable up to your plan's limit",
  "Jeda antarposting bawaan 2,5 jam, bisa diatur 2 sampai 8 jam": "2.5-hour default gap between posts, adjustable from 2 to 8 hours",
  "Posting terjadwal bisa diubah atau dibatalkan dari menu Jadwal": "Scheduled posts can be edited or cancelled from the Schedule menu",
  "Mode Tinjau dulu atau Otomatis": "Review first or Automatic mode",
  "Anda yang menentukan seberapa lepas tangan, per akun, dan bisa diganti kapan saja.": "You decide how hands-off to be, per account, and can change it anytime.",
  "Tinjau dulu: AI menulis sekitar 6 jam sebelum jam tayang dan menunggu persetujuan Anda": "Review first: the AI writes about 6 hours before the slot and waits for your approval",
  "Draf yang belum disetujui sampai 15 menit sebelum jamnya dilewati, tidak diterbitkan": "Drafts not approved 15 minutes before their slot are skipped, not published",
  "Otomatis: AI menulis sekitar 90 menit sebelum jam tayang, draf yang lolos pemeriksaan terbit sendiri": "Automatic: the AI writes about 90 minutes before the slot, and drafts that pass the checks publish on their own",
  "Beberapa paket hanya menyediakan mode Tinjau dulu": "Some plans offer Review first mode only",
  "Analitik yang dipakai untuk menulis lagi": "Analytics that feed the next posts",
  "Setelah angka views masuk, tiap posting dibandingkan dengan kebiasaan akunnya sendiri, bukan dengan akun lain.":
    "Once views come in, each post is compared with its own account's usual numbers, not with other accounts.",
  "Pembuka, tema, dan jam yang menaikkan views dipakai lagi untuk tulisan berikutnya": "Openers, themes, and hours that lift views are reused in the next posts",
  "Posting yang views-nya melonjak memicu notifikasi dan ide lanjutan": "Posts whose views spike trigger a notification and follow-up ideas",
  "Statistik dibaca lewat API resmi Threads": "Stats are read through the official Threads API",
  "Rem pengaman otomatis": "Automatic safety brakes",
  "Autopilot bisa dihentikan kapan saja, dan sistem juga menarik remnya sendiri bila ada yang tidak beres.": "You can stop autopilot anytime, and the system pulls the brakes itself when something is off.",
  "Satu tombol menjeda semua akun sekaligus": "One button pauses every account at once",
  "Akun yang gagal terbit tiga kali berturut-turut dijeda otomatis": "An account that fails to publish three times in a row is paused automatically",
  "Views seminggu turun lebih dari separuh: akun pindah ke mode Tinjau dulu dan Anda diberi tahu": "Weekly views drop by more than half: the account switches to Review first and you are notified",
  "Moderasi balasan di Threads": "Reply moderation on Threads",
  "Balasan untuk posting Anda bisa dikelola dari dalam BotThreads tanpa membuka aplikasi Threads.": "Manage replies to your posts from inside BotThreads without opening the Threads app.",
  "Membaca dan membalas balasan": "Read and answer replies",
  "Menyembunyikan dan menampilkan lagi balasan": "Hide and unhide replies",
  "Mengatur siapa yang boleh membalas posting": "Control who can reply to a post",
  "Beberapa akun dan anggota tim": "Multiple accounts and team members",
  "Satu workspace menampung beberapa akun Threads dan anggota tim. Jumlah akun, posting per hari, dan anggota mengikuti paket yang dipilih.":
    "One workspace holds several Threads accounts and team members. The number of accounts, posts per day, and members follows your plan.",
  "Autopilot diatur per akun": "Autopilot is set per account",
  "Anggota tim diundang ke workspace yang sama": "Team members are invited to the same workspace",
  "Paket bisa dinaikkan kapan saja": "Plans can be upgraded anytime",
  "Lewat API resmi, tanpa kata sandi": "Through the official API, no password",
  "Akun dihubungkan lewat halaman login resmi Threads, jadi kata sandi Anda tidak pernah kami terima. Memposting, membaca statistik, dan mencari posting populer semuanya memakai API resmi Threads.":
    "Accounts are connected through the official Threads login page, so we never receive your password. Posting, reading stats, and finding popular posts all use the official Threads API.",
  "Login resmi Threads (OAuth)": "Official Threads login (OAuth)",
  "Penghapusan data bisa diajukan kapan saja": "Data deletion can be requested anytime",
  "Pembayaran dalam Rupiah lewat Midtrans": "Payment in Rupiah through Midtrans",
  "COBA LANGSUNG": "TRY IT",
  "Lihat fiturnya bekerja": "See the features at work",
  "Dari mana ide datang": "Where ideas come from",
  PERBANDINGAN: "COMPARISON",

  // /cara-kerja-botthreads
  "Anda kerjakan 2 langkah, sisanya jalan sendiri": "You do 2 steps, the rest runs on its own",
  "Hubungkan akun Threads dan kenalkan brand Anda ke AI, cukup sekali. Setelah itu BotThreads mencari ide, menulis, memeriksa, memposting, dan belajar dari hasilnya setiap hari.":
    "Connect your Threads account and introduce your brand to the AI, just once. After that BotThreads finds ideas, writes, checks, posts, and learns from the results every day.",
  "Alur kerja BotThreads": "BotThreads workflow",
  "Klik tiap langkah untuk melihat apa yang terjadi dan menu mana yang dipakai di aplikasi.": "Click each step to see what happens and which menu the app uses.",
  "SATU HARI AUTOPILOT": "ONE AUTOPILOT DAY",
  "Yang terjadi pada akun Anda setiap hari": "What happens to your account every day",
  "Jam di bawah adalah contoh untuk satu akun dengan pengaturan bawaan.": "The times below are an example for one account on default settings.",
  "Tren dipantau": "Trends monitored",
  "Ide dikumpulkan dari posting terbaik akun, tren Google Indonesia, berita niche, posting Threads populer, dan momen kalender, lalu diberi skor di menu Radar.":
    "Ideas are gathered from the account's best posts, Google Indonesia trends, niche news, popular Threads posts, and calendar moments, then scored in the Radar menu.",
  "Jadwal hari ini disusun": "Today's schedule is planned",
  "Jam tayang dipilih dari jam ramai pengikut akun itu, bawaannya 3 posting sehari dengan jeda 2,5 jam.": "Posting times are picked from the account's busy follower hours: 3 posts a day with 2.5-hour gaps by default.",
  "Draf ditulis dan diperiksa": "Drafts written and checked",
  "Sembilan puluh menit sebelum jam tayang (mode Otomatis), draf ditulis dengan gaya brand, diperiksa empat hal, dan dinilai editor AI minimal 0,7 dari 1.":
    "Ninety minutes before the slot (Automatic mode), the draft is written in the brand voice, checked four ways, and must score at least 0.7 out of 1 from the AI editor.",
  "Terbit di Threads": "Published on Threads",
  "Tepat di jamnya, posting terbit lewat API resmi dan muncul di akun Anda seperti posting biasa.": "Right on time, the post publishes through the official API and appears on your account like any other post.",
  "Belajar dari hasil": "Learning from results",
  "Views tiap posting dibandingkan dengan kebiasaan akunnya. Pola yang berhasil dipakai lagi besok, dan akun dijeda bila kinerjanya turun tajam.":
    "Each post's views are compared with its account's usual numbers. Winning patterns are reused tomorrow, and the account is paused if performance drops sharply.",
  "DUA MODE": "TWO MODES",
  "Daftar dan pilih paket": "Sign up and pick a plan",
  "Buat workspace dengan akun Google atau email, lalu pilih paket. Pembayaran dalam Rupiah lewat Midtrans dan paket aktif otomatis begitu lunas.":
    "Create a workspace with Google or email, then pick a plan. Payment is in Rupiah through Midtrans, and the plan activates as soon as it is paid.",
  "Hubungkan akun Threads": "Connect your Threads account",
  "Login lewat halaman resmi Threads. BotThreads tidak pernah menerima kata sandi Anda.": "Log in through the official Threads page. BotThreads never receives your password.",
  "Kenalkan brand ke AI": "Introduce your brand to the AI",
  "Isi profil brand dan menu Pengetahuan: fakta brand, produk dan harga, promo, serta larangan.": "Fill in the brand profile and the Knowledge menu: brand facts, products and prices, promos, and restrictions.",
  "Nyalakan autopilot": "Turn on autopilot",
  "Mulai dengan mode Tinjau dulu selama beberapa hari. Kalau gaya tulisnya sudah pas, ganti ke mode Otomatis.": "Start in Review first mode for a few days. Once the writing style feels right, switch to Automatic.",

  // /harga
  HARGA: "PRICING",
  "Harga BotThreads, dalam Rupiah": "BotThreads pricing, in Rupiah",
  "Pilih paket sesuai jumlah akun Threads yang Anda kelola. Semua paket memakai mesin autopilot yang sama; bedanya ada di jumlah akun, posting per hari, anggota tim, dan mode yang tersedia.":
    "Pick a plan by how many Threads accounts you manage. Every plan runs the same autopilot engine; the differences are the number of accounts, posts per day, team members, and available modes.",
  "Berlaku untuk semua paket": "Applies to every plan",
  "Aktif begitu lunas": "Active once paid",
  "Paket aktif otomatis setelah pembayaran lunas, tanpa menunggu konfirmasi manual.": "Your plan activates automatically once payment clears, with no manual confirmation.",
  "Tanpa potongan otomatis": "No auto-debit",
  "Tidak ada tagihan berulang. Anda memperpanjang sendiri bila ingin lanjut, dan sisa hari tidak hangus.": "No recurring charges. You renew yourself if you want to continue, and remaining days carry over.",
  "Lebih hemat jangka panjang": "Save on longer terms",
  "Hemat 10% untuk pembayaran 3 bulan dan 20% untuk pembayaran tahunan.": "Save 10% when paying for 3 months and 20% when paying yearly.",
  "Data tetap aman": "Your data stays",
  "Kalau paket habis, autopilot berhenti, tetapi data dan statistik Anda tetap bisa dibuka.": "When a plan expires, autopilot stops, but your data and stats remain accessible.",
  "Pertanyaan seputar biaya": "Questions about cost",

  // /faq
  "Daftar pertanyaan": "Question list",
  "Jawaban apa adanya, termasuk batasannya. Setiap jawaban mengikuti aturan yang benar-benar dipakai sistem.": "Straight answers, limits included. Every answer follows the rules the system actually uses.",
  "Pertanyaan Anda belum terjawab?": "Didn't find your answer?",
  "Hubungi kami": "Contact us",
};

export default dict;
