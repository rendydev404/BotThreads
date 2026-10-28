/**
 * Terjemahan EN untuk halaman publik: halaman perkenalan (/selamat-datang), footer, label halaman legal,
 * dan daftar paket. Isi dokumen legal ada di ../../legal-content-en.ts (dimuat terpisah).
 * Teks animasi/film ada di ./landing-film.ts.
 */
const dict: Record<string, string> = {
  // Judul tab
  "BotThreads: Threads Anda posting sendiri, setiap hari": "BotThreads: your Threads posts on its own, every day",

  // Header & navigasi
  "Beralih ke mode terang": "Switch to light mode",
  "Beralih ke mode gelap": "Switch to dark mode",
  "Cara kerja": "How it works",
  "Cara mulai": "Getting started",
  "Harga & Paket": "Pricing & Plans",
  "Tanya jawab": "FAQ",
  Daftar: "Sign up",
  "Gulir halaman untuk menjalani satu hari autopilot": "Scroll the page to live through one autopilot day",

  // Pembuka
  "AUTOPILOT UNTUK THREADS": "AUTOPILOT FOR THREADS",
  "Threads Anda": "Your Threads",
  "posting sendiri,": "posts on its own,",
  "setiap hari.": "every day.",
  "AI mencari ide dari ": "AI finds ideas from ",
  "posting terbaik Anda": "your best posts",
  " dan ": " and ",
  "tren hari ini": "today's trends",
  ", menulis dengan ": ", writes in your ",
  "suara brand": "brand voice",
  ", memeriksa hasilnya, lalu menerbitkannya ke Threads di ": ", checks the result, then publishes it to Threads at ",
  "jam akun Anda paling ramai": "your account's busiest hours",
  "Berapa kali sehari? ": "How many times a day? ",
  "Anda yang atur per akun.": "You set it per account.",
  "Mulai Sekarang": "Start Now",
  "Tonton demo 23 detik": "Watch the 23-second demo",
  "Terbit langsung ke akun Threads Anda lewat API resmi.": "Publishes straight to your Threads account through the official API.",
  "jeda antarposting 2,5 jam": "2.5-hour gap between posts",

  // Kolom "coba untuk bisnis Anda" dan cap status
  "COBA UNTUK BISNIS ANDA": "TRY IT FOR YOUR BUSINESS",
  "mis. {contoh}": "e.g. {contoh}",
  "kopi susu": "iced latte",
  "bengkel motor": "motorbike repair",
  "laundry kiloan": "laundry service",
  seblak: "street food",
  kopi: "coffee",
  laundry: "laundry",
  "Susun jadwal": "Build schedule",
  Susun: "Build",
  "menghitung {n} jam tayang terbaik": "finding the {n} best posting times",
  "AI menulis draf {time}": "AI writing the {time} draft",
  "memeriksa draf {time} · skor 0,87": "checking the {time} draft · score 0.87",
  "draf {time} lolos · antre": "{time} draft passed · queued",
  "terbit {time} · suka mulai masuk": "published {time} · likes coming in",
  "{n} posting siap terbit hari ini": "{n} post ready to publish today||{n} posts ready to publish today",

  // Pita alur kerja (juga dipakai film demo)
  "Tren@@pipeline": "Trends",
  "Ide@@pipeline": "Ideas",
  "Tulis@@pipeline": "Write",
  "Periksa@@pipeline": "Check",
  "Antre@@pipeline": "Queue",
  "Terbit@@pipeline": "Publish",

  // Cara kerja
  "CARA KERJA": "HOW IT WORKS",
  "Anda kerjakan 2 langkah,": "You do 2 steps,",
  "sisanya jalan sendiri.": "the rest runs itself.",
  "Hubungkan akun Threads dan kenalkan brand Anda ke AI, cukup sekali. Setelah itu BotThreads mencari ide, menulis, memeriksa, memposting, dan belajar dari hasilnya setiap hari. Klik tiap langkah untuk melihat apa yang terjadi dan menu mana yang dipakai di aplikasi.":
    "Connect your Threads account and introduce your brand to the AI, just once. After that, BotThreads finds ideas, writes, checks, posts, and learns from the results every day. Click each step to see what happens and which menu is used in the app.",

  // Demo film
  "DEMO · 23 DETIK": "DEMO · 23 SECONDS",
  "Satu hari autopilot,": "One autopilot day,",
  "tanpa Anda sentuh.": "without you lifting a finger.",
  "Dari tren pagi sampai views malam: inilah yang dikerjakan BotThreads untuk tiap akun, setiap hari.":
    "From morning trends to evening views: this is what BotThreads does for every account, every day.",
  "6 tahap": "6 stages",
  "dari tren sampai terbit, berjalan sendiri": "from trend to published, running on its own",
  "4 cek": "4 checks",
  "plus skor editor AI sebelum antre": "plus an AI editor score before queueing",
  "2,5 jam": "2.5 hours",
  "jeda bawaan antarposting, di jam ramai akun": "default gap between posts, at the account's peak hours",
  "API resmi": "Official API",
  "terbit dan statistik lewat Threads": "publishing and stats through Threads",

  // Kepala bagian
  "TREN DIPANTAU": "TRENDS MONITORED",
  "Setiap posting punya asal-usul": "Every post has an origin",
  "Tidak ada ide yang muncul dari udara. Pilih satu sumber di bawah untuk melihat bagaimana sebuah tren berubah menjadi bahan tulisan.":
    "No idea comes out of thin air. Pick a source below to see how a trend turns into writing material.",
  "JADWAL HARI INI DISUSUN": "TODAY'S SCHEDULE BUILT",
  "Jam tayang dihitung, bukan ditebak": "Posting times are calculated, not guessed",
  "Tiap akun punya jam ramainya sendiri. Ganti contoh brand dan jumlah posting per hari, lalu lihat jam mana yang dipilih.":
    "Every account has its own peak hours. Change the sample brand and the number of posts per day, then see which hours get picked.",
  "DRAF DITULIS DAN DIPERIKSA": "DRAFT WRITTEN AND CHECKED",
  "Tidak semua draf boleh terbit": "Not every draft gets to go live",
  "Sembilan puluh menit sebelum jam tayang, draf ditulis lalu diperiksa empat hal dan dinilai editor AI. Buka ketiga contoh ini: satu lolos, dua ditolak, masing-masing dengan alasannya.":
    "Ninety minutes before posting time, the draft is written, checked on four points, and scored by the AI editor. Open these three examples: one passes, two are rejected, each with its reason.",
  "TERBIT DI THREADS": "PUBLISHED ON THREADS",
  "Anda yang menentukan seberapa lepas tangan": "You decide how hands-off it is",
  "Tepat di jamnya, posting muncul di akun Threads Anda seperti posting biasa. Seberapa banyak Anda ikut campur sebelum itu, diatur per akun dan bisa diganti kapan saja.":
    "Right on time, the post appears on your Threads account like any normal post. How much you step in before that is set per account and can be changed at any time.",
  "CONTOH TAMPILAN DI THREADS": "EXAMPLE OF HOW IT LOOKS ON THREADS",
  "Contoh tampilan posting di Threads": "Example of a post on Threads",
  "AI menulis beberapa jam sebelum tayang dan menunggu. Anda menyetujui, mengedit, meminta tulis ulang, atau menolak. Yang tidak disetujui sampai 15 menit sebelum jamnya dilewati, bukan diterbitkan.":
    "The AI writes a few hours before posting time and waits. You approve, edit, ask for a rewrite, or reject. Anything not approved by 15 minutes before its time is skipped, not published.",
  "UNTUK MINGGU PERTAMA DAN AKUN UTAMA": "FOR THE FIRST WEEK AND MAIN ACCOUNTS",
  "Draf yang lolos pemeriksaan langsung masuk antrean dan terbit di jamnya. Anda menerima notifikasi bila ada posting yang viral, akun yang dijeda, atau kinerja yang turun.":
    "Drafts that pass the checks go straight into the queue and publish on time. You get notified when a post goes viral, an account is paused, or performance drops.",
  "SETELAH GAYA TULISNYA TERASA PAS": "ONCE THE WRITING STYLE FEELS RIGHT",
  "BELAJAR DARI HASIL": "LEARNING FROM RESULTS",
  "Besok lebih tajam dari hari ini": "Tomorrow sharper than today",
  "Setelah angka views masuk, tiap posting dibandingkan dengan kebiasaan akunnya sendiri, bukan dengan akun lain.":
    "Once the view counts come in, each post is compared with its own account's usual numbers, not with other accounts.",
  "Pola yang terbukti dipakai lagi": "Proven patterns get reused",
  "Pembuka, tema, dan jam yang menaikkan views di akun itu masuk ke bahan tulisan berikutnya dan menaikkan skor ide yang serupa.":
    "Openers, themes, and hours that raised views on that account feed into the next posts and boost the score of similar ideas.",
  "Yang viral langsung dilanjutkan": "Viral posts get an immediate follow-up",
  "Posting yang views-nya melonjak jauh di atas kebiasaan akun memicu notifikasi dan ide lanjutan, selagi topiknya masih hangat.":
    "A post whose views jump far above the account's usual numbers triggers a notification and follow-up ideas while the topic is still hot.",
  "Kalau turun, remnya ditarik": "If it drops, the brakes go on",
  "Views seminggu anjlok lebih dari separuh? Akun itu turun sendiri ke mode Tinjau dulu dan Anda diberi tahu.":
    "Weekly views fell by more than half? That account switches itself to Review first mode and you are notified.",

  // Cara mulai
  "CARA MULAI": "GETTING STARTED",
  "Dari daftar sampai autopilot, empat langkah": "From sign-up to autopilot in four steps",
  "Klik tiap langkah dan coba layarnya. Tidak perlu memasang apa pun, dan Anda yang memutuskan kapan AI boleh berjalan sendiri.":
    "Click each step and try the screen. Nothing to install, and you decide when the AI may run on its own.",
  "Mulai langkah pertama": "Take the first step",

  // Tanya jawab
  "TANYA JAWAB": "FAQ",
  "Yang biasanya ditanyakan lebih dulu": "What people usually ask first",
  "Jawaban apa adanya, termasuk batasannya.": "Straight answers, limitations included.",
  "BotThreads itu sebenarnya apa?": "What exactly is BotThreads?",
  "Asisten AI untuk akun Threads. Setiap hari ia mencari ide, menulis posting dengan gaya akun Anda, memeriksanya, lalu memposting di jam ketika pengikut akun itu paling aktif. Anda cukup menghubungkan akun dan mengisi profil brand sekali di awal. Setelah itu Anda tinggal memantau hasilnya, atau ikut menyetujui setiap posting bila mau.":
    "An AI assistant for Threads accounts. Every day it finds ideas, writes posts in your account's style, checks them, then posts at the hours when that account's followers are most active. You only need to connect the account and fill in the brand profile once at the start. After that you just monitor the results, or approve each post yourself if you prefer.",
  "Apakah saya harus memberikan kata sandi Threads?": "Do I have to give you my Threads password?",
  "Tidak. Akun dihubungkan lewat halaman login resmi Threads, jadi kata sandi Anda tidak pernah kami terima. Memposting, membaca statistik, dan mencari posting populer semuanya memakai API resmi Threads. Permintaan penghapusan data bisa diajukan kapan saja lewat halaman Penghapusan Data di bagian bawah situs ini.":
    "No. Accounts are connected through the official Threads login page, so we never receive your password. Posting, reading statistics, and searching for popular posts all use the official Threads API. A data deletion request can be submitted at any time through the Data Deletion page at the bottom of this site.",
  "Apakah setiap posting harus saya setujui dulu?": "Do I have to approve every post first?",
  "Anda yang memilih, per akun. Mode Tinjau dulu: AI menulis sekitar 6 jam sebelum jam tayang, lalu Anda menyetujui, mengedit, atau menolak. Draf yang belum disetujui sampai 15 menit sebelum jamnya dilewati, tidak diterbitkan. Mode Otomatis: AI menulis sekitar 90 menit sebelum jam tayang, dan draf yang lolos pemeriksaan terbit sendiri. Beberapa paket hanya menyediakan mode Tinjau dulu.":
    "You choose, per account. Review first mode: the AI writes about 6 hours before posting time, then you approve, edit, or reject. A draft not approved by 15 minutes before its time is skipped, not published. Automatic mode: the AI writes about 90 minutes before posting time, and drafts that pass the checks publish on their own. Some plans only offer Review first mode.",
  "Apakah AI bisa memposting sesuatu yang memalukan brand saya?": "Could the AI post something that embarrasses my brand?",
  "Setiap draf diperiksa dulu: harga, persen, dan kata promo hanya boleh muncul bila ada di data brand Anda. Topik sensitif dan kata terlarang diblokir, draf tidak boleh mirip posting akun lain Anda di hari yang sama, dan panjangnya dicek. Setelah itu draf dinilai editor AI dan harus mendapat skor minimal 0,7 dari 1. Draf yang gagal ditulis ulang. Kalau tetap gagal, jadwal itu dilewati, bukan dipaksa terbit.":
    "Every draft is checked first: prices, percentages, and promo words may only appear if they are in your brand data. Sensitive topics and banned words are blocked, a draft may not resemble a post from your other accounts on the same day, and its length is checked. Then the draft is scored by the AI editor and must score at least 0.7 out of 1. Drafts that fail are rewritten. If they still fail, that slot is skipped, not forced to publish.",
  "Dari mana AI tahu harga, menu, dan promo saya?": "How does the AI know my prices, menu, and promos?",
  "Dari menu Pengetahuan yang Anda isi sendiri, dengan empat jenis isian: fakta brand, produk dan harga, promo beserta tanggal berakhirnya, serta larangan. Draf yang menyebut harga atau promo yang tidak tertulis di sana tidak lolos pemeriksaan.":
    "From the Knowledge menu that you fill in yourself, with four kinds of entries: brand facts, products and prices, promos with their end dates, and restrictions. A draft that mentions a price or promo not written there does not pass the checks.",
  "Dari mana ide postingannya?": "Where do the post ideas come from?",
  "Dari posting akun Anda yang paling ramai, tren pencarian Google di Indonesia, berita terbaru seputar niche akun Anda, posting Threads paling populer untuk topik yang sedang naik, momen kalender seperti gajian, tanggal tua, akhir pekan, dan momen yang Anda tambahkan sendiri, serta catatan inspirasi yang Anda tulis sendiri. Semua ide masuk ke menu Radar lengkap dengan skor dan contoh tulisannya. Sumbernya hanya dijadikan bahan, teksnya tidak disalin.":
    "From your account's best-performing posts, Google search trends in Indonesia, the latest news around your account's niche, the most popular Threads posts for rising topics, calendar moments such as payday, the lean days before payday, weekends, and moments you add yourself, plus inspiration notes you write yourself. Every idea goes into the Radar menu with a score and a sample post. Sources are only used as material; their text is not copied.",
  "Berapa kali sehari akun saya posting, dan jam berapa?": "How many times a day does my account post, and at what times?",
  "Bawaannya 3 kali sehari per akun. Jumlahnya bisa Anda ubah sampai batas paket. Jamnya dipilih dari jam ketika pengikut akun itu paling aktif, dengan jeda antarposting bawaan 2,5 jam (bisa diatur 2 sampai 8 jam), jadi akun tidak terlihat seperti spam.":
    "The default is 3 times a day per account. You can change the number up to your plan's limit. The times are picked from the hours when that account's followers are most active, with a default gap of 2.5 hours between posts (adjustable from 2 to 8 hours), so the account doesn't look like spam.",
  "Kalau hasilnya tidak cocok, bagaimana menghentikannya?": "If I don't like the results, how do I stop it?",
  "Satu tombol di menu Autopilot menjeda semua akun sekaligus, dan autopilot tiap akun juga bisa dimatikan satu per satu. Posting yang sudah terjadwal tetap bisa diubah atau dibatalkan dari menu Jadwal. Sistem juga punya rem sendiri: akun yang gagal terbit tiga kali berturut-turut dijeda otomatis. Kalau views seminggu turun lebih dari separuh, akun itu pindah ke mode Tinjau dulu dan Anda diberi tahu.":
    "One button in the Autopilot menu pauses all accounts at once, and each account's autopilot can also be turned off individually. Posts that are already scheduled can still be changed or cancelled from the Schedule menu. The system also has its own brakes: an account that fails to publish three times in a row is paused automatically. If weekly views drop by more than half, that account moves to Review first mode and you are notified.",
  "Bagaimana cara bayar, dan kapan paket aktif?": "How do I pay, and when does my plan become active?",
  "Pembayaran dalam Rupiah lewat Midtrans: QRIS, GoPay, ShopeePay, Virtual Account (BCA, BNI, BRI, Permata, CIMB Niaga), atau Mandiri Bill. Paket aktif otomatis begitu pembayaran lunas. Tidak ada potongan otomatis tiap bulan, jadi Anda memperpanjang sendiri bila ingin lanjut, dan sisa hari tidak hangus. Kalau paket habis, autopilot berhenti, tetapi data dan statistik Anda tetap bisa dibuka.":
    "Payment is in Rupiah through Midtrans: QRIS, GoPay, ShopeePay, Virtual Account (BCA, BNI, BRI, Permata, CIMB Niaga), or Mandiri Bill. The plan activates automatically as soon as payment is complete. There is no automatic monthly charge, so you renew yourself if you want to continue, and remaining days are not forfeited. If the plan expires, autopilot stops, but your data and statistics remain accessible.",
  "Bisakah uang saya dikembalikan (refund)?": "Can I get my money back (refund)?",
  "Hanya bila ada kendala teknis yang bisa dibuktikan: pembayaran sudah lunas tetapi paket tidak aktif lebih dari 24 jam karena kesalahan sistem kami, atau saldo terpotong dua kali untuk tagihan yang sama. Pengajuan wajib menyertakan Order ID dan bukti pembayaran, lalu kami cocokkan dengan data Midtrans. Berubah pikiran atau tidak memakai layanan bukan alasan refund. Rinciannya ada di halaman Kebijakan Pengembalian.":
    "Only if there is a technical issue that can be proven: the payment is complete but the plan has not activated for more than 24 hours because of an error in our system, or your balance was charged twice for the same invoice. The request must include the Order ID and proof of payment, which we then match against Midtrans data. Changing your mind or not using the service is not a reason for a refund. Details are on the Refund Policy page.",

  // Penutup
  "Mulai dari satu akun, mode Tinjau dulu.": "Start with one account in Review first mode.",
  "Lihat gaya tulisnya selama dua hari. Kalau cocok, biarkan berjalan sendiri.": "Watch its writing style for two days. If it fits, let it run on its own.",
  "Buat workspace": "Create a workspace",

  // Peraga: jam ramai
  Kuliner: "Food",
  "Kedai kopi": "Coffee shop",
  "Contoh brand untuk jam ramai": "Sample brands for peak hours",
  "Posting per hari": "Posts per day",
  "Tayang pukul": "Posting at",
  dan: "and",
  "Dipilih dari jam dengan views tertinggi, dijaga berjarak 2,5 jam (bisa diatur), dan menitnya digeser sedikit tiap hari supaya tidak terasa seperti mesin.":
    "Picked from the hours with the most views, kept 2.5 hours apart (adjustable), and the minutes are shifted slightly each day so it doesn't feel machine-made.",

  // Peraga: pemeriksaan draf
  "Contoh draf": "Sample drafts",
  "Draf A": "Draft A",
  "Draf B": "Draft B",
  "Draf C": "Draft C",
  "DISKON 50% semua menu cuma hari ini!! buruan sebelum kehabisan, mulai Rp9.000 aja 🔥":
    "50% OFF the whole menu today only!! hurry before it's gone, starting from just Rp9.000 🔥",
  "tim saus dipisah atau tim disiram langsung? jawab yang jujur ya, ini nentuin pertemanan kita":
    "team sauce on the side or team poured right on? be honest, this decides our friendship",
  "Bentuk@@cek": "Form",
  "Klaim@@cek": "Claims",
  "Topik@@cek": "Topic",
  "Kembar@@cek": "Duplicate",
  "Panjang pas, kalimat utuh, ada ajakan menjawab.": "Right length, complete sentences, invites a reply.",
  "Tidak menyebut harga, promo, atau angka yang perlu dibuktikan.": "Doesn't mention prices, promos, or numbers that need proof.",
  "Tidak menyentuh daftar topik terlarang.": "Doesn't touch the list of banned topics.",
  "Tidak mirip dengan posting akun lain hari ini.": "Not similar to today's posts from other accounts.",
  "Panjang pas dan kalimat utuh.": "Right length and complete sentences.",
  "Diskon 50% dan Rp9.000 tidak ada di data promo brand ini. AI tidak boleh mengarang harga.":
    "The 50% discount and Rp9.000 are not in this brand's promo data. The AI may not make up prices.",
  "Tidak ada klaim yang perlu dibuktikan.": "No claims that need proof.",
  "Hampir sama dengan posting akun cabang lain pagi ini. Pembaca yang mengikuti keduanya akan melihat salinan.":
    "Almost the same as another branch account's post this morning. Readers who follow both would see a copy.",
  "Lolos, nilai editor {skor}. Masuk antrean terbit.": "Passed, editor score {skor}. Added to the publishing queue.",
  "Ditolak sebelum sampai ke antrean. AI menulis ulang dengan catatan ini.": "Rejected before reaching the queue. The AI rewrites it with this note.",

  // Peraga: sumber ide
  "Sumber ide": "Idea sources",
  "Momen kalender": "Calendar moments",
  "Inspirasi Anda": "Your inspiration",
  'Posting "tim saus dipisah" minggu lalu dapat views 4 kali lipat dari biasanya.':
    'Last week\'s "team sauce on the side" post got 4 times its usual views.',
  'Seri "tim ini atau tim itu" dengan pilihan lain: pedas atau original, makan di tempat atau bungkus.':
    'A "team this or team that" series with other choices: spicy or original, dine in or takeaway.',
  '"Bekal kantor hemat" sedang ramai dicari di Indonesia hari ini.': '"Budget office lunch" is trending in searches in Indonesia today.',
  "Cerita singkat soal bekal yang niatnya hemat tapi jam 12 tetap pesan antar.":
    "A short story about a packed lunch meant to save money, but by 12 you still order delivery.",
  "Tanggal 25 sampai 2: orang baru gajian.": "The 25th to the 2nd: people just got paid.",
  "Pertanyaan ringan: gajian pertama bulan ini dipakai traktir siapa?": "A light question: who are you treating with this month's first paycheck?",
  'Anda menempel catatan: "pelanggan sering tanya kenapa antre panjang tiap Jumat".':
    'You pinned a note: "customers often ask why the line is so long every Friday".',
  "Jawaban jujur dari dapur soal Jumat, dengan ajakan cerita antrean terpanjang pembaca.":
    "An honest answer from the kitchen about Fridays, inviting readers to share their longest wait in line.",
  "Tren@@sinyal": "Trend",
  "menjadi ide": "becomes an idea",
  "Tiap ide diberi skor dari seberapa viral trennya, kebaruan, kecocokan dengan akun, dan kinerja pola serupa. Yang mirip posting lama dibuang.":
    "Each idea is scored on how viral the trend is, freshness, fit with the account, and how similar patterns performed. Ideas too similar to old posts are dropped.",

  // Cara mulai: langkah & peraga
  "Langkah memulai": "Getting-started steps",
  "Daftar & hubungkan": "Sign up & connect",
  "Buat akun, lalu sambungkan akun Threads lewat login resmi Threads.": "Create an account, then connect your Threads account through the official Threads login.",
  "Atur profil brand": "Set up the brand profile",
  "Isi niche, gaya bahasa, serta harga dan promo sebagai acuan AI.": "Fill in your niche, writing style, and prices and promos as a reference for the AI.",
  "Pilih mode": "Choose a mode",
  "Tinjau dulu: Anda menyetujui tiap draf. Otomatis: editor AI yang menilai, lalu terbit di jam ramai.":
    "Review first: you approve each draft. Automatic: the AI editor scores it, then it publishes at peak hours.",
  "Pantau hasil": "Monitor results",
  "Lihat views dan jam terbaik tiap akun. AI belajar dari hasilnya setiap hari.": "See views and best hours for each account. The AI learns from the results every day.",
  "AKUN THREADS": "THREADS ACCOUNTS",
  "Sambungkan akun brand Anda": "Connect your brand accounts",
  "Login lewat halaman resmi Threads. Kata sandi tidak pernah kami simpan.": "Log in through the official Threads page. We never store your password.",
  Terhubung: "Connected",
  "Menghubungkan…": "Connecting…",
  "Akun belum terhubung": "Account not connected yet",
  Siap: "Ready",
  "NICHE AKUN": "ACCOUNT NICHE",
  "Kuliner@@niche": "Food",
  "Kopi@@niche": "Coffee",
  "Fashion@@niche": "Fashion",
  "Skincare@@niche": "Skincare",
  "GAYA BAHASA": "WRITING STYLE",
  "aku/kamu@@gaya": "aku/kamu · casual",
  "gue/lo@@gaya": "gue/lo · slangy",
  "saya/Anda@@gaya": "saya/Anda · formal",
  "kita@@gaya": "kita · inclusive “we”",
  "CONTOH TULISAN AI": "SAMPLE AI WRITING",
  "kamu tim saus dipisah atau langsung disiram? jawab jujur ya": "are you team sauce on the side or poured on? be honest",
  "lo tim saus dipisah apa disiram? jawab jujur, ini penting": "u team sauce on the side or poured on? be honest, this matters",
  "Anda lebih suka saus dipisah atau langsung disiram?": "Do you prefer your sauce on the side or poured over?",
  "kita tim saus dipisah atau disiram nih? ayo jujur bareng": "are we team sauce on the side or poured on? let's be honest together",
  "jam 3 sore, kamu udah gelas kedua belum?": "3pm, are you on your second cup yet?",
  "jam 3 sore, lo udah gelas kedua belum?": "3pm, u on ur second cup yet?",
  "Pukul 3 sore, sudah gelas kedua untuk Anda?": "It is 3 p.m. Have you had your second cup?",
  "jam 3 sore, kita udah gelas kedua belum ya?": "3pm, are we on our second cup yet?",
  "baju favorit kamu pasti yang nggak perlu disetrika, kan?": "your favorite clothes are the ones that don't need ironing, right?",
  "baju favorit lo pasti yang gak perlu disetrika, ngaku": "ur fave clothes are the ones that don't need ironing, admit it",
  "Pakaian favorit Anda mungkin yang tidak perlu disetrika.": "Your favorite clothing is probably the kind that does not need ironing.",
  "baju favorit kita tuh yang gak perlu disetrika, setuju?": "our fave clothes are the ones that don't need ironing, agreed?",
  "sunscreen kamu udah di-reapply siang ini?": "have you reapplied your sunscreen this afternoon?",
  "sunscreen lo udah di-reapply belum siang ini?": "u reapplied ur sunscreen yet this afternoon?",
  "Sudahkah Anda mengoleskan ulang sunscreen siang ini?": "Have you reapplied your sunscreen this afternoon?",
  "siang ini kita udah reapply sunscreen belum?": "have we reapplied our sunscreen this afternoon?",
  "Harga dan promo diambil dari halaman Pengetahuan. Yang tidak tercatat di sana tidak akan ditulis AI.":
    "Prices and promos come from the Knowledge page. Anything not recorded there will not be written by the AI.",
  "Mode autopilot": "Autopilot mode",
  "Otomatis (autopilot)": "Automatic (autopilot)",
  "Tidak ada yang terbit tanpa persetujuan Anda.": "Nothing is published without your approval.",
  "Tanpa klik, tapi tidak tanpa pemeriksaan: draf dicek aturan lalu dinilai editor AI. Yang tidak lolos ditulis ulang atau dilewati.":
    "No clicks, but not without checks: drafts are checked against the rules, then scored by the AI editor. Those that fail are rewritten or skipped.",
  "Draf ditulis dengan suara brand": "Draft written in the brand voice",
  "Lolos 4 cek aturan: fakta, panjang, topik, kemiripan": "Passed 4 rule checks: facts, length, topic, similarity",
  "Editor AI menilai: skor 0,86 (minimal 0,7)": "AI editor scores it: 0.86 (minimum 0.7)",
  "Masuk antrean terbit": "Added to the publishing queue",
  "Terbit di Threads, tanpa klik": "Published on Threads, no clicks",
  "Putar ulang": "Replay",
  "Posting tetap bisa dibatalkan dari halaman Jadwal sebelum jam tayangnya.": "Posts can still be cancelled from the Schedule page before their posting time.",
  "jam 11 tuh jam paling rawan. belum laper-laper amat, tapi udah buka aplikasi pesen makan tiap 5 menit":
    "11am is the danger zone. not really hungry yet, but somehow opening the food delivery app every 5 minutes",
  "pesanan paling sering jam segini: nasi + sambal matah. kamu biasanya pilih level berapa?":
    "most ordered at this hour: rice + sambal matah. what spice level do you usually go for?",
  "JADWAL HARI INI": "TODAY'S SCHEDULE",
  "Dijadwalkan {jam}": "Scheduled {jam}",
  "Menunggu tinjauan": "Awaiting review",
  "tayang {jam} WIB": "posting {jam} WIB",
  "Lolos 4 cek": "Passed 4 checks",
  "Skor editor {skor}": "Editor score {skor}",
  Setujui: "Approve",
  "Tulis ulang": "Rewrite",
  "VIEWS 7 HARI · CONTOH": "7-DAY VIEWS · SAMPLE",
  "Jam terbaik: 12.00 dan 19.00": "Best hours: 12.00 and 19.00",
  "Dipakai otomatis untuk jadwal besok.": "Used automatically for tomorrow's schedule.",
  "Posting Jumat views 3x biasanya": "Friday post got 3x its usual views",
  "Notifikasi dikirim dan ide lanjutannya disiapkan.": "A notification is sent and follow-up ideas are prepared.",

  // Paket
  "HARGA & PAKET LANGGANAN": "PRICING & SUBSCRIPTION PLANS",
  "Pilih paket sesuai skala akun Threads Anda": "Choose a plan that fits the scale of your Threads accounts",
  "Mulai dari uji coba gratis hingga skala agensi. Jumlah posting per hari diatur per akun sampai batas paketnya, dan paket bisa dinaikkan kapan saja.":
    "From a free trial up to agency scale. The number of posts per day is set per account up to the plan's limit, and you can upgrade at any time.",
  "Hemat 10% (3 Bulan) · Hemat 20% (Tahunan)": "Save 10% (3 months) · Save 20% (yearly)",
  Rekomendasi: "Recommended",
  Terlaris: "Best seller",
  Populer: "Popular",
  Gratis: "Free",
  "/ bulan": "/ month",
  "Uji coba fitur dasar tanpa biaya": "Try the basic features at no cost",
  "Bisa dibayar bulanan, 3 bulan, atau tahunan": "Pay monthly, every 3 months, or yearly",
  "Autopilot untuk {n} akun Threads": "Autopilot for {n} Threads account||Autopilot for {n} Threads accounts",
  "Sampai {n} posting / akun / hari": "Up to {n} post / account / day||Up to {n} posts / account / day",
  "Mode Tinjau Dulu & Full Otomatis": "Review First & Fully Automatic modes",
  "Mode Tinjau Dulu (persetujuan manual)": "Review First mode (manual approval)",
  "Coba Gratis": "Try for Free",
  "Pilih {nama}": "Choose {nama}",
  // Paket dari database (nama & deskripsi yang diisi super admin); yang belum ada di sini tampil apa adanya.
  "Trial Gratis": "Free Trial",
  "Coba otomatis 1 akun Threads dengan mode Tinjau dulu sebelum berlangganan.": "Try automation on 1 Threads account in Review first mode before subscribing.",
  "Untuk kreator dan UMKM yang mulai mengotomatiskan akun Threads utama setiap hari.": "For creators and small businesses starting to automate their main Threads account every day.",
  "Pilihan terbaik untuk brand berkembang dengan multi-akun dan jadwal posting padat.": "The best choice for growing brands with multiple accounts and a busy posting schedule.",
  "Kapasitas penuh untuk agensi, jaringan multi-cabang, dan tim besar dengan otomatisasi maksimal.": "Full capacity for agencies, multi-branch networks, and large teams with maximum automation.",
  "Untuk pemilik satu brand atau UMKM yang ingin mulai rutin posting setiap hari dengan pengawasan.":
    "For single-brand owners or small businesses that want to start posting every day, with oversight.",
  "Untuk brand berkembang dan tim konten yang membutuhkan autopilot penuh di beberapa akun sekaligus.":
    "For growing brands and content teams that need full autopilot across several accounts at once.",
  "Untuk agensi kreatif dan jaringan multi-cabang yang mengelola banyak akun Threads dalam satu ruang kerja.":
    "For creative agencies and multi-branch networks managing many Threads accounts in one workspace.",

  // Footer
  "Autopilot konten, penjadwalan, dan analitik akun Meta Threads berbasis AI.": "AI-powered content autopilot, scheduling, and analytics for Meta Threads accounts.",
  "Daftar akun@@daftar": "Create an account",
  "Legal & Kebijakan": "Legal & Policies",
  "Pengiriman Layanan": "Service Delivery",
  "Penghapusan Data": "Data Deletion",
  "Kontak & Identitas": "Contact & Identity",
  "Kontak & Bantuan": "Contact & Support",
  "Metode pembayaran resmi": "Official payment methods",
  "Identitas & Kontak Resmi": "Official Identity & Contact",
  "Senin – Sabtu, 09.00 – 18.00 WIB": "Monday – Saturday, 09.00 – 18.00 WIB",
  "Transaksi resmi dalam Rupiah (IDR) melalui Midtrans.": "Official transactions in Rupiah (IDR) through Midtrans.",
  "Jam dan contoh di halaman ini adalah ilustrasi. Threads adalah merek dagang Meta; layanan ini tidak berafiliasi dengan Meta.":
    "Times and examples on this page are illustrations. Threads is a trademark of Meta; this service is not affiliated with Meta.",

  // Halaman legal: label tata letak (isi dokumen ada di legal-content-en.ts)
  Salin: "Copy",
  "Dokumen Legal": "Legal documents",
  "Kode Dokumen": "Document code",
  "Berlaku Efektif": "Effective date",
  "Lingkup Kepatuhan": "Compliance scope",
  "Pada Halaman Ini": "On this page",
  "Dokumen Resmi": "Official documents",
  "Identitas Penyelenggara & Saluran Langsung": "Operator Identity & Direct Channels",
  "Informasi di bawah ini merupakan identitas operasional resmi penyelenggara layanan {brand} di Indonesia untuk keperluan layanan pelanggan, administrasi penagihan, dan korespondensi resmi.":
    "The information below is the official operational identity of the {brand} service operator in Indonesia, for customer service, billing administration, and official correspondence.",
  "Nama Platform": "Platform name",
  "Entitas Penyelenggara": "Operating entity",
  "Email Resmi": "Official email",
  "WhatsApp Pelanggan": "Customer WhatsApp",
  "Jam Operasional": "Operating hours",
  "Mata Uang & Pembayaran": "Currency & payment",
  "Alamat Operasional": "Operational address",
  "PASAL {n}": "ARTICLE {n}",
  "Navigasi dokumen legal": "Legal document navigation",
  "Sebelumnya ({n})": "Previous ({n})",
  "Selanjutnya ({n})": "Next ({n})",
};

export default dict;
