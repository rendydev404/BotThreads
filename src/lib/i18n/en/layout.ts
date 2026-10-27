/** Terjemahan EN untuk kerangka aplikasi (sidebar, header, bilah bawah, panduan halaman, notifikasi, ganti password). */
const dict: Record<string, string> = {
  // Navigasi
  Ringkasan: "Overview",
  "Cara Kerja": "How It Works",
  "Akun Threads": "Threads Accounts",
  Jadwal: "Schedule",
  Postingan: "Posts",
  "Studio AI": "AI Studio",
  "Billing & Paket": "Billing & Plans",
  Pengaturan: "Settings",
  "Konsol Admin": "Admin Console",
  Trend: "Trends",
  "1 · Siapkan": "1 · Set up",
  "2 · Berjalan otomatis": "2 · Runs on autopilot",
  "3 · Lihat hasil": "3 · See results",
  "Views, interaksi, dan akun terbaik": "Views, engagement, and top accounts",
  "Peta alur BotThreads, langkah demi langkah": "The BotThreads workflow, step by step",
  "Hubungkan akun dan isi Profil AI": "Connect accounts and fill in the AI Profile",
  "Bank ide dari tren, momen, dan posting terbaik": "Idea bank from trends, moments, and top posts",
  "AI menulis, memeriksa, dan mengantre posting": "AI writes, checks, and queues posts",
  "Antrean posting yang akan terbit": "Queue of upcoming posts",
  "Semua posting beserta angkanya": "All posts with their numbers",
  "Tanya AI soal performa akun": "Ask AI about account performance",
  "Pengetahuan brand, tim, notifikasi": "Brand knowledge, team, notifications",
  "Profil belum termuat": "Profile not loaded",
  Terhubung: "Connected",
  "Periksa koneksi Anda": "Check your connection",
  "Memuat akun...": "Loading accounts...",
  "{n} akun Threads": "{n} Threads account||{n} Threads accounts",
  "Menu lainnya": "More menu",

  // Judul header
  "Ringkasan Performa": "Performance Overview",
  "Panduan Cara Kerja": "Workflow Guide",
  "Jadwal Konten": "Schedule",
  "Autopilot Konten": "Autopilot",
  "Radar dan Ide": "Radar & Ideas",
  "Billing & Paket Sewa": "Billing & Plans",
  Dashboard: "Dashboard",

  // Menu akun
  Akun: "Account",
  "Gagal pindah workspace.": "Couldn't switch workspace.",
  "Menu akun {name}": "Account menu for {name}",
  "Menu akun": "Account menu",
  "Ganti password": "Change password",
  "Tur pengenalan": "Product tour",
  Pemilik: "Owner",
  Admin: "Admin",
  Editor: "Editor",
  Pengamat: "Viewer",
  "Gagal memuat profil.": "Couldn't load your profile.",

  // Kerangka (app-shell)
  "Belum ada akses workspace": "No workspace access yet",
  "Akun Anda aktif, tetapi belum menjadi anggota workspace mana pun. Minta Pemilik atau Admin mengundang Anda dari menu Pengaturan, tab Tim.":
    "Your account is active but isn't a member of any workspace yet. Ask an Owner or Admin to invite you from Settings, Team tab.",
  "Workspace ini ditangguhkan": "This workspace is suspended",
  "Pengelola platform menangguhkan workspace ini, jadi datanya tidak bisa dibuka dan autopilotnya berhenti.":
    "The platform team suspended this workspace, so its data can't be opened and its autopilot has stopped.",
  "Alasan:": "Reason:",
  "Anda masih bisa pindah ke workspace lain lewat menu akun di pojok kanan atas.":
    "You can still switch to another workspace from the account menu in the top-right corner.",
  "Hubungi pengelola platform bila ini keliru.": "Contact the platform team if this is a mistake.",
  "Paket {nama} Anda sudah habis": "Your {nama} plan has expired",
  langganan: "subscription",
  "sejak {tanggal}": "since {tanggal}",
  "Autopilot semua akun dihentikan dan akun Threads baru tidak bisa ditambahkan.":
    "Autopilot is stopped for all accounts and new Threads accounts can't be added.",
  "Perpanjang paket supaya semuanya berjalan lagi.": "Renew your plan to get everything running again.",
  "Minta Pemilik atau Admin workspace memperpanjang paket.": "Ask a workspace Owner or Admin to renew the plan.",
  "Perpanjang Paket Sekarang": "Renew Plan Now",
  "Belum ada akun Threads yang terhubung ke workspace ini.": "No Threads account is connected to this workspace yet.",
  "Hubungkan akun Threads Anda secara mandiri untuk mengaktifkan analitik, penjadwalan, dan autopilot AI.":
    "Connect your Threads account yourself to turn on analytics, scheduling, and the AI autopilot.",
  "Pilih Paket Sewa": "Choose a Plan",
  "Minta Pemilik atau Admin workspace menghubungkannya.": "Ask a workspace Owner or Admin to connect one.",

  // Panduan halaman
  "Langkah {no} dari {total}": "Step {no} of {total}",
  Otomatis: "Automatic",
  "Tugas Anda": "Your task",
  "Lihat alur": "View workflow",
  "Berikutnya: {title}": "Next: {title}",
  "Tutup panduan halaman ini": "Close this page guide",
  "Tutup panduan ini (bisa dibuka lagi di Panduan Cara Kerja)": "Close this guide (you can reopen it in the Workflow Guide)",

  // Notifikasi
  Notifikasi: "Notifications",
  "Notifikasi, {n} belum dibaca": "Notifications, {n} unread",
  Memuat: "Loading",
  "Tandai semua dibaca": "Mark all as read",
  "Memuat notifikasi": "Loading notifications",
  "Notifikasi belum dipasang.": "Notifications aren't set up yet.",
  "Pemilik dashboard perlu menjalankan": "The dashboard owner needs to run",
  "di Supabase.": "in Supabase.",
  "Belum ada notifikasi.": "No notifications yet.",
  "Posting viral, akun yang dijeda, dan masalah penjadwal akan muncul di sini.":
    "Viral posts, paused accounts, and scheduler issues will show up here.",
  "Membuka tab baru": "Opens in a new tab",
  "Belum dibaca": "Unread",
  "Muat lagi": "Load more",
  "Gagal memuat notifikasi.": "Couldn't load notifications.",
  "Gagal menandai notifikasi.": "Couldn't mark the notification as read.",
  "Gagal memuat notifikasi berikutnya.": "Couldn't load more notifications.",

  // Ganti password
  "Password minimal {n} karakter.": "Password must be at least {n} characters.",
  "Password minimal 10 karakter.": "Password must be at least 10 characters.",
  "Konfirmasi tidak sama dengan password baru.": "The confirmation doesn't match the new password.",
  "Password baru harus berbeda dari password saat ini.": "The new password must be different from the current one.",
  "Gagal mengganti password. Coba lagi.": "Couldn't change the password. Please try again.",
  "Lupa password saat ini? Minta admin membuat tautan reset password untuk Anda.":
    "Forgot your current password? Ask an admin to create a password reset link for you.",
  Selesai: "Done",
  "Simpan password": "Save password",
  "Password berhasil diganti. Perangkat lain yang masih masuk perlu masuk lagi dengan password baru.":
    "Password changed. Other devices that are still logged in will need to log in again with the new password.",
  "Password saat ini": "Current password",
  "Password saat ini wajib diisi.": "Current password is required.",
  "Password saat ini salah.": "Current password is incorrect.",
  "Password baru": "New password",
  "Minimal {n} karakter.": "At least {n} characters.",
  "Ulangi password baru": "Repeat new password",
  "Terlalu banyak percobaan. Coba lagi nanti.": "Too many attempts. Please try again later.",
  "Tindakan tidak valid.": "Invalid action.",
  "Akun@@jumlah": "Accounts",

  // Tur pengenalan (komponen tour + isi tour-steps)
  "Tutup tur": "Close tour",
  "Bangunkan maskot": "Wake the mascot",
  "Ssst... robotnya lagi tidur": "Shh... the robot is asleep",
  "Wajar, dia kerja semalaman memposting untuk akunmu. Klik robotnya untuk membangunkan dan mulai tur singkat.":
    "Fair enough, it worked all night posting for your accounts. Click the robot to wake it up and start a quick tour.",
  "Nanti saja": "Maybe later",
  Bangunkan: "Wake up",
  "Colek maskot": "Poke the mascot",
  "Tur singkat": "Quick tour",
  "Di HP, menu ini ada di tombol Lainnya pada bilah bawah.": "On mobile, this menu is under More in the bottom bar.",
  "Langkah tur": "Tour steps",
  Lewati: "Skip",
  "Langkah sebelumnya": "Previous step",
  "Buka Autopilot": "Open Autopilot",
  "Hubungkan akun": "Connect account",
  Mulai: "Start",
  "Tombol panah ← → untuk pindah, Esc untuk keluar": "Use ← → to move, Esc to exit",
  "Hehe, geli!": "Hehe, that tickles!",
  "Aku bangun kok, beneran.": "I'm awake, really.",
  "Klik Lanjut ya, masih banyak yang mau kutunjukkan.": "Click Next, there's lots more to show you.",
  "Aku jalan 24 jam, tapi kopi tetap boleh.": "I run 24/7, but coffee is still welcome.",
  "Psst... jam ramai akunmu sudah kucatat.": "Psst... I've already noted your account's peak hours.",
  Halo: "Hi",
  "Hai! Aku robot BotThreads": "Hi! I'm the BotThreads robot",
  "Tugasku menulis, menjadwalkan, dan memposting konten Threads akunmu selagi kamu tidur. Ayo keliling sebentar, cuma 2 menit.":
    "My job is to write, schedule, and publish Threads content for your accounts while you sleep. Let's take a quick look around, it only takes 2 minutes.",
  "1. Hubungkan akun Threads": "1. Connect your Threads account",
  "Semua dimulai di sini. Begitu akun terhubung, aku langsung membaca postinganmu, mengenali gayamu, riset tren di niche-mu, lalu menyusun ide pertama.":
    "Everything starts here. Once an account is connected, I read your posts, learn your style, research trends in your niche, and draft the first ideas.",
  "Hubungkan satu atau beberapa akun": "Connect one or more accounts",
  "Isi Profil AI: siapa akunnya, bahas apa, untuk siapa": "Fill in the AI Profile: who the account is, what it covers, and who it's for",
  "Profil AI": "AI Profile",
  "2. Profil AI = otak akunmu": "2. The AI Profile is your account's brain",
  "Peran & tema, kategori topik, dan gaya sapaan (gue/lo, aku/kamu...). Semua fitur AI menulis mengikuti profil ini. Kalau kamu mengubahnya, aku otomatis riset ulang dan mengganti ide lama.":
    "Role & themes, topic categories, and voice. Every AI writing feature follows this profile. If you change it, I automatically re-research and replace old ideas.",
  "Bisa minta Studio AI membuatkan prompt peran lengkap": "You can ask AI Studio to write a full role prompt",
  "Klik Perbesar untuk menulis profil yang panjang": "Click Expand to write a long profile",
  "3. Autopilot: aku yang posting": "3. Autopilot: I do the posting",
  "Pilih mode tiap akun. Tinjau dulu: aku menulis, kamu menyetujui. Otomatis: aku menulis dan memposting sendiri di jam ramai akunmu.":
    "Pick a mode for each account. Review first: I write, you approve. Automatic: I write and publish on my own at your account's peak hours.",
  "Atur jumlah posting per hari dan jamnya": "Set how many posts per day and at what times",
  "Draf yang tidak lolos pemeriksaan kutulis ulang, jam tayang tidak dibiarkan kosong":
    "Drafts that fail the checks get rewritten, so no time slot is left empty",
  "Kerja AI": "AI at work",
  "Lihat aku bekerja": "Watch me work",
  "Kartu ini menampilkan yang sedang kukerjakan: mencari ide, menyusun konten, review, sampai siap posting. Isinya data asli, bukan contoh.":
    "This card shows what I'm working on: finding ideas, drafting content, reviewing, all the way to ready-to-post. It's real data, not a demo.",
  Tab: "Tabs",
  "Rencana, Tinjau, Komentar, Riwayat": "Plan, Review, Comments, History",
  "Rencana: isi tiap jam tayang. Tinjau: setujui atau minta tulis ulang. Komentar: balasan otomatis. Riwayat: yang sudah terbit. Affiliate: rekomendasi produk Shopee dengan link di balasan pertama.":
    "Plan: what goes in each time slot. Review: approve or ask for a rewrite. Comments: automatic replies. History: what's been published. Affiliate: Shopee product picks with a link in the first reply.",
  "4. Radar (di HP: Trend): bahan bakar tulisanku": "4. Radar (Trends on mobile): fuel for my writing",
  "Di sini ada bank ide lengkap dengan skor dan preview postingannya, tren yang lagi viral di niche-mu, dan kalender momen penting.":
    "Here you'll find an idea bank with scores and post previews, trends going viral in your niche, and a calendar of key moments.",
  'Klik "Posting ide ini duluan" supaya ide favoritmu dipakai lebih dulu': 'Click "Post this idea first" to use your favorite ideas sooner',
  "Preview ide = teks yang nanti diposting (bila lolos pemeriksaan)": "The idea preview is the text that will be posted (if it passes the checks)",
  "5. Studio AI: tanya apa saja": "5. AI Studio: ask anything",
  "Ngobrol denganku soal performa akun: kenapa interaksi turun, pola postingan terbaik, sampai minta 3 draf siap jadwal atau prompt peran akun yang lengkap.":
    "Chat with me about account performance: why engagement dropped, your best post patterns, or ask for 3 ready-to-schedule drafts or a full account role prompt.",
  "6. Jadwal: semua antrean posting": "6. Schedule: the whole posting queue",
  "Semua postingan terjadwal dan riwayatnya ada di sini. Buka satu postingan untuk mengedit, memperbaiki dengan AI (lebih manusiawi, hook lebih kuat), atau posting sekarang.":
    "All scheduled posts and their history live here. Open a post to edit it, improve it with AI (more human, stronger hook), or publish it now.",
  Pantau: "Monitor",
  "7. Pantau hasilnya": "7. Track the results",
  "Ringkasan menunjukkan views, interaksi, dan akun terbaik. Postingan berisi semua postingan beserta metriknya, bisa disaring per format.":
    "Overview shows views, engagement, and top accounts. Posts lists every post with its metrics, filterable by format.",
  "8. Pengetahuan brand": "8. Brand knowledge",
  "Isi fakta brand, produk & harga, promo, dan kata terlarang di Pengaturan > Pengetahuan. Hanya fakta dari sini yang boleh kusebut, jadi aku tidak pernah mengarang harga atau promo.":
    "Add brand facts, products & prices, promos, and banned words in Settings > Knowledge. I only mention facts from there, so I never make up prices or promos.",
  "Siap! Sisanya serahkan padaku": "All set! Leave the rest to me",
  "Hubungkan akun, isi Profil AI, lalu nyalakan Autopilot. Tur ini bisa diputar lagi kapan saja dari menu profil di kanan atas.":
    "Connect an account, fill in the AI Profile, then turn on Autopilot. You can replay this tour anytime from the profile menu in the top right.",
};

export default dict;
