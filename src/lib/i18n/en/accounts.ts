/** Terjemahan EN: kunci = teks Indonesia persis seperti di kode. */
const dict: Record<string, string> = {
  // Halaman /akun
  "Memuat akun Threads": "Loading Threads accounts",
  "Gagal memuat profil.": "Failed to load profile.",
  "Akun Threads": "Threads Accounts",
  "Tambah, hubungkan ulang, perbarui, dan hapus akun Threads yang dipakai workspace ini.":
    "Add, reconnect, update, and remove the Threads accounts used by this workspace.",
  "Hanya Pemilik atau Admin yang bisa menambah, mengubah, atau menghapus akun.":
    "Only an Owner or Admin can add, change, or remove accounts.",
  // Label peran (roleLabel dari server)
  Pemilik: "Owner",
  Admin: "Admin",
  Editor: "Editor",
  Pengamat: "Viewer",

  // Baris akun
  "Perlu Hubungkan Ulang": "Needs reconnect",
  "Terhubung & Siap": "Connected & ready",
  "Di luar kuota paket": "Over plan quota",
  MATI: "Off",
  TINJAU: "Review first",
  OTOMATIS: "Auto",
  "Terhubung {date}": "Connected {date}",
  "Token berlaku s/d {date}": "Token valid until {date}",
  "Target {n} posting/hari": "Target {n} post/day||Target {n} posts/day",
  "Peran, gaya, dan memori gaya akun untuk semua fitur AI": "Account role, style, and style memory for all AI features",
  "Profil AI": "AI Profile",
  "Atur Autopilot": "Set up Autopilot",
  "Hubungkan ulang": "Reconnect",
  "Ambil ulang nama, username, dan foto dari Threads": "Re-fetch name, username, and photo from Threads",
  Sinkronkan: "Sync",
  "Hapus akun @{username}": "Delete account @{username}",

  // Notifikasi
  "Akun Threads @{username} berhasil dihubungkan. Agen AI langsung mempelajarinya.":
    "Threads account @{username} connected. The AI agent is learning it now.",
  "Profil @{username} diperbarui dari Threads.": "Profile @{username} updated from Threads.",
  "Akun @{username} dihapus dari workspace. Slot kuotanya bisa dipakai untuk akun lain.":
    "Account @{username} removed from the workspace. Its quota slot is free for another account.",
  "Gagal memuat daftar akun Threads.": "Failed to load Threads accounts.",
  "Gagal menghubungkan akun Threads.": "Failed to connect the Threads account.",
  "Gagal menyinkronkan profil.": "Failed to sync the profile.",
  "Gagal menghapus akun.": "Failed to remove the account.",

  // Banner OAuth / konfigurasi
  "Fitur hubungkan akun Threads belum diaktifkan oleh pengelola platform. Silakan coba lagi nanti atau hubungi admin.":
    "Connecting Threads accounts hasn't been enabled by the platform operator yet. Please try again later or contact your admin.",
  "Login Threads hanya bisa dari alamat https. Buka dashboard lewat domain https-nya, lalu klik Hubungkan Akun Threads lagi.":
    "Threads login only works over https. Open the dashboard on its https domain, then click Connect Threads Account again.",
  "Halaman ini dibuka lewat http, sedangkan Threads hanya mengizinkan login dari https. Di produksi (https) cukup satu klik.":
    "This page was opened over http, but Threads only allows login from https. In production (https) it takes one click.",
  "Untuk uji di komputer sendiri, jalankan": "To test on your own computer, run",
  "lalu buka https://localhost:3000.": "then open https://localhost:3000.",
  "Hubungkan akun Threads sekali klik belum diaktifkan oleh pengelola platform.":
    "One-click Threads account connection hasn't been enabled by the platform operator yet.",
  "(Pengelola: isi Threads App ID & App Secret di Super Admin > Integrasi.)":
    "(Operator: fill in the Threads App ID & App Secret under Super Admin > Integrations.)",
  "(Pengelola: isi Threads App ID & App Secret di Super Admin > Integrasi, dan TOKEN_ENCRYPTION_KEY di server.)":
    "(Operator: fill in the Threads App ID & App Secret under Super Admin > Integrations, and TOKEN_ENCRYPTION_KEY on the server.)",
  "Belum diaktifkan oleh pengelola platform": "Not enabled by the platform operator yet",

  // Kuota
  "Akun Threads Terhubung": "Connected Threads Accounts",
  "{used} / {max} Akun": "{used} / {max} Account||{used} / {max} Accounts",
  "{used} / Tanpa batas Akun": "{used} / Unlimited Accounts",
  "Paket aktif: {plan}. Setiap akun yang terhubung dapat dijadwalkan dan dijalankan otomatis oleh AI.":
    "Active plan: {plan}. Every connected account can be scheduled and run automatically by AI.",
  "Hubungkan akun Threads Anda untuk mulai menulis dan menerbitkan posting otomatis.":
    "Connect your Threads account to start writing and publishing posts automatically.",
  "Perpanjang Paket": "Renew plan",
  "Upgrade Kuota Akun": "Upgrade account quota",
  "Tambah Akun Threads": "Add Threads Account",
  "Paket {plan} sekarang maksimal {max} akun, sedangkan ada {used} akun terhubung.":
    "The {plan} plan now allows up to {max} accounts, but {used} accounts are connected.",
  "Paket Anda sekarang maksimal {max} akun, sedangkan ada {used} akun terhubung.":
    "Your plan now allows up to {max} accounts, but {used} accounts are connected.",
  '{n} akun terbaru (bertanda "Di luar kuota paket") dihentikan sementara: tidak bisa posting, Autopilot dijeda, dan komentar tidak dibalas.':
    'The newest account (marked "Over plan quota") is suspended: it can\'t post, Autopilot is paused, and comments aren\'t replied to.||The {n} newest accounts (marked "Over plan quota") are suspended: they can\'t post, Autopilot is paused, and comments aren\'t replied to.',
  "Hapus akun yang tidak dipakai atau upgrade paket, dan akun itu otomatis aktif lagi.":
    "Remove unused accounts or upgrade your plan, and those accounts become active again automatically.",
  "Kuota akun paket sudah penuh. Hapus akun yang tidak dipakai untuk mengosongkan slot, atau upgrade paket untuk menambah kuota.":
    "Your plan's account quota is full. Remove an unused account to free a slot, or upgrade your plan for more quota.",

  // Keadaan kosong
  "Belum ada akun Threads yang terhubung": "No Threads accounts connected yet",
  "Hubungkan Akun Threads": "Connect Threads Account",
  "Untuk developer: hubungkan dengan Access Token": "For developers: connect with an Access Token",
  "Hubungkan akun Threads brand Anda untuk mengaktifkan penjadwalan dan Autopilot AI.":
    "Connect your brand's Threads account to enable scheduling and AI Autopilot.",
  "1. Klik tombol di bawah": "1. Click the button below",
  "2. Masuk ke akun Threads Anda": "2. Log in to your Threads account",
  '3. Tekan "Izinkan", selesai': '3. Tap "Allow", done',

  // Dialog hapus akun
  "Hapus akun @{username}?": "Delete account @{username}?",
  "Akun dilepas dari workspace ini dan slot kuotanya bisa dipakai akun lain.":
    "The account is detached from this workspace and its quota slot can be used by another account.",
  "Hapus akun": "Delete account",
  "Posting terjadwal dan Autopilot akun ini dihentikan.": "Scheduled posts and Autopilot for this account are stopped.",
  "Balas komentar otomatis untuk akun ini dimatikan.": "Automatic comment replies for this account are turned off.",
  "Riwayat posting yang sudah terbit tetap tersimpan.": "History of published posts is kept.",
  "Postingan di Threads tidak ikut terhapus. Akun bisa dihubungkan lagi kapan saja.":
    "Posts on Threads are not deleted. The account can be reconnected at any time.",

  // Dialog Access Token
  "Hubungkan dengan Access Token": "Connect with an Access Token",
  "Cara manual untuk developer. Pengguna biasa cukup memakai tombol Hubungkan Akun Threads.":
    "Manual method for developers. Regular users can just use the Connect Threads Account button.",
  "Menghubungkan...": "Connecting...",
  "Verifikasi & Hubungkan": "Verify & connect",
  "Access Token Threads": "Threads Access Token",
  "Tempel token akses Threads Anda (diawali TH...)": "Paste your Threads access token (starts with TH...)",
  "Buat token di Meta for Developers > aplikasi Anda > Threads > Access Token (izin threads_basic dan threads_content_publish). Token dicek ke Threads lalu disimpan terenkripsi.":
    "Create a token in Meta for Developers > your app > Threads > Access Token (threads_basic and threads_content_publish permissions). The token is verified with Threads, then stored encrypted.",

  // Panduan Android
  "Pakai HP Android? Aplikasi Threads bisa terbuka sendiri": "On an Android phone? The Threads app may open by itself",
  "Bila aplikasi Threads terpasang, halaman login Threads (milik Meta) langsung pindah ke aplikasi sehingga dialog izin tidak muncul. Pilih salah satu cara ini:":
    "If the Threads app is installed, the Threads login page (by Meta) jumps straight to the app, so the permission dialog never appears. Choose one of these options:",
  "Cara 1 (paling mudah): lewat komputer": "Option 1 (easiest): use a computer",
  Buka: "Open",
  "di browser komputer, masuk dengan akun dashboard yang sama.": "in a computer browser and log in with the same dashboard account.",
  Klik: "Click",
  ", masuk ke Threads, lalu tekan": ", log in to Threads, then tap",
  Izinkan: "Allow",
  "Selesai. Akun langsung bisa dipakai juga dari HP ini.": "Done. The account is ready to use from this phone too.",
  "Cara 2: tetap dari HP ini": "Option 2: stay on this phone",
  "Setelan HP > Aplikasi > Threads": "Phone Settings > Apps > Threads",
  Ketuk: "Tap",
  "Buka secara default": "Open by default",
  "(di Samsung:": "(on Samsung:",
  "Tetapkan sebagai default": "Set as default",
  "), lalu matikan": "), then turn off",
  "Buka link yang didukung": "Open supported links",
  "Kembali ke sini, ketuk": "Come back here, tap",
  ", masuk dengan username dan password Threads, lalu tekan": ", log in with your Threads username and password, then tap",
  "Setelah terhubung, setelan tadi boleh dinyalakan lagi.": "Once connected, you can turn that setting back on.",

  // Keadaan tab bersama (states.tsx)
  "Koneksi bermasalah.": "Connection problem.",
  "Sesi berakhir.": "Session ended.",
  "Anda tidak punya akses ke bagian ini.": "You don't have access to this section.",
  "Workspace belum bisa ditentukan.": "The workspace couldn't be determined yet.",
  "Bagian ini belum siap dipakai.": "This section isn't ready yet.",
  "Gagal memuat data.": "Failed to load data.",
  "Pemilik dashboard perlu menjalankan": "The dashboard owner needs to run",
  "di Supabase.": "in Supabase.",

  // Galat API (OAuth & /api/threads/connect) yang tampil langsung
  "Workspace tidak ditemukan.": "Workspace not found.",
  "Masa berlaku paket sudah habis. Perpanjang paket di tab Langganan & Tagihan.":
    "Your plan has expired. Renew it in the Subscription & Billing tab.",
  "Masa berlaku paket workspace sudah habis. Perpanjang paket di tab Langganan & Tagihan.":
    "The workspace plan has expired. Renew it in the Subscription & Billing tab.",
  "Kuota akun paket {plan} sudah penuh ({used}/{max}). Naikkan paket untuk menambah akun.":
    "The {plan} plan's account quota is full ({used}/{max}). Upgrade your plan to add more accounts.",
  "Kuota akun paket Anda sudah penuh ({used}/{max}). Naikkan paket untuk menambah akun.":
    "Your plan's account quota is full ({used}/{max}). Upgrade your plan to add more accounts.",
  "Akses ditolak di halaman Threads. Jika Anda tidak menekan Batal, akun Threads ini mungkin belum menerima undangan Threads Tester.":
    "Access was denied on the Threads page. If you didn't tap Cancel, this Threads account may not have accepted the Threads Tester invitation yet.",
  "Sesi login Threads kedaluwarsa. Silakan ulangi.": "The Threads login session expired. Please try again.",
  "Login Threads dimulai oleh pengguna lain. Silakan ulangi dari akun Anda.":
    "The Threads login was started by another user. Please try again from your account.",
  "Akun dashboard tidak aktif.": "The dashboard account is inactive.",
  "Server sedang bermasalah. Coba lagi sebentar.": "The server is having trouble. Please try again shortly.",
  "Workspace aktif berubah selama login Threads. Silakan ulangi.":
    "The active workspace changed during the Threads login. Please try again.",
  "Hanya Pemilik atau Admin yang bisa menghubungkan akun Threads.": "Only an Owner or Admin can connect Threads accounts.",
  "Kode otorisasi Threads tidak ditemukan.": "Threads authorization code not found.",
  "Terlalu banyak percobaan. Coba lagi sebentar.": "Too many attempts. Please try again shortly.",
  "Server belum siap menyimpan akun Threads: TOKEN_ENCRYPTION_KEY belum diisi. Hubungi admin platform.":
    "The server isn't ready to store Threads accounts: TOKEN_ENCRYPTION_KEY is not set. Contact the platform admin.",
  "Masukkan Access Token Threads yang valid.": "Enter a valid Threads Access Token.",
  "Token Threads ditolak.": "The Threads token was rejected.",
  "Akun @{username} sudah terhubung ke workspace lain.": "Account @{username} is already connected to another workspace.",
  "Akun @{username} baru saja dihubungkan. Muat ulang halaman.": "Account @{username} was just connected. Reload the page.",
  "Threads API menolak permintaan (HTTP {status}).": "The Threads API rejected the request (HTTP {status}).",
  "Gagal memperbarui profil: {error}": "Failed to update profile: {error}",
  "Gagal memetakan akun untuk posting.": "Failed to map the account for posting.",
  "Akun tidak valid.": "Invalid account.",
  "Fitur hapus akun belum dipasang di database (sql/026_threads_account_remove.sql). Hubungi pengelola platform.":
    "Account removal isn't installed in the database yet (sql/026_threads_account_remove.sql). Contact the platform operator.",
  "Akun Threads tidak ditemukan. Muat ulang halaman.": "Threads account not found. Reload the page.",
  "Akun ini milik workspace lain dalam kelompok Anda dan hanya bisa dihapus dari sana.":
    "This account belongs to another workspace in your group and can only be removed from there.",
  "Threads menolak sesi akun ini. Klik Hubungkan ulang untuk login kembali.":
    "Threads rejected this account's session. Click Reconnect to log in again.",
  "Akun Threads terhubung, tetapi belum bisa dipakai posting: server belum siap (sql/016_threads_publish_map.sql). Hubungi pengelola platform.":
    "The Threads account is connected but can't post yet: the server isn't ready (sql/016_threads_publish_map.sql). Contact the platform operator.",
  "Akun Threads terhubung, tetapi gagal disiapkan untuk posting. Coba hubungkan ulang sebentar lagi.":
    "The Threads account is connected but couldn't be set up for posting. Try reconnecting in a moment.",
  "Akun Threads tidak ditemukan saat disiapkan untuk posting. Coba hubungkan ulang.":
    "The Threads account wasn't found while setting it up for posting. Try reconnecting.",
  "Profil Threads tidak lengkap (id/username tidak ada).": "The Threads profile is incomplete (missing id/username).",
  "Threads App ID dan App Secret belum dikonfigurasi.": "The Threads App ID and App Secret are not configured.",
  "Token akses Threads tidak ada pada respons OAuth.": "The OAuth response contained no Threads access token.",
  "Gagal menukar token Threads menjadi token 60 hari.": "Failed to exchange the Threads token for a 60-day token.",
  "Login Threads tidak selesai. Silakan ulangi.": "The Threads login didn't finish. Please try again.",

  // Profil AI (modal)
  "dari editan Anda": "from your edits",
  "dari ubahan versi AI": "from changes to the AI version",
  "dari tinjauan autopilot": "from autopilot review",
  "aturan Anda": "your rule",
  "Membaca postingan terbaru akun": "Reading the account's latest posts",
  "Mencari pola topik dan gaya bahasa": "Finding topic and writing-style patterns",
  "Menyusun peran akun": "Drafting the account role",
  "Gagal memuat Profil AI.": "Failed to load the AI Profile.",
  "Disusun AI dari postingan akun. Periksa dan ubah bila perlu, lalu simpan.":
    "Drafted by AI from the account's posts. Review and edit if needed, then save.",
  "AI belum bisa menyusun profil. Coba lagi.": "AI couldn't draft the profile yet. Please try again.",
  "Gagal menyimpan Profil AI.": "Failed to save the AI Profile.",
  "Gagal menambah aturan gaya.": "Failed to add the style rule.",
  "Gagal menghapus pelajaran.": "Failed to remove the lesson.",
  "@{username} · dipakai Studio AI, edit dengan AI, Autopilot, dan balas komentar":
    "@{username} · used by AI Studio, AI editing, Autopilot, and comment replies",
  Tutup: "Close",
  "Simpan profil": "Save profile",
  "Belum yakin menulis apa? Biar AI membaca postingan akun lalu menyusun perannya.":
    "Not sure what to write? Let AI read the account's posts and draft its role.",
  "Susun dengan AI": "Draft with AI",
  "Peran & tema akun": "Account role & themes",
  "Contoh: Akun pribadi developer yang bahas AI dan coding sehari-hari, gaya santai agak sarkas, buat programmer muda. Tidak pernah bahas politik.":
    "Example: A developer's personal account about AI and everyday coding, casual and a bit sarcastic, for young programmers. Never talks politics.",
  "Tulis seperti menjelaskan ke penulis bayangan: akun ini siapa, bahas apa, untuk siapa, nadanya bagaimana.":
    "Write it like a brief for a ghostwriter: who this account is, what it covers, who it's for, and its tone.",
  "Gaya sapaan": "Form of address",
  "Otomatis dari postingan": "Auto from posts",
  "gue / lo": "gue / lo (very casual)",
  "saya / kamu": "saya / kamu (semi-formal)",
  "aku / kamu": "aku / kamu (personal)",
  kita: "kita (inclusive)",
  "Kategori topik": "Topic categories",
  "Hapus kategori {name}": "Remove category {name}",
  "Tambah kategori lalu Enter": "Add a category, then press Enter",
  "Memori gaya": "Style memory",
  "AI belajar dari setiap koreksi Anda, makin lama makin mirip tulisan Anda":
    "AI learns from every correction you make, getting closer to your writing over time",
  "Belum ada. Setiap kali Anda mengubah draf AI lalu menyimpannya, AI mencatat pelajarannya di sini.":
    "Nothing yet. Each time you edit an AI draft and save it, AI records the lesson here.",
  "terbukti {n}x": "proven {n}x",
  "Hapus pelajaran": "Remove lesson",
  'Tambah aturan sendiri, mis. "jangan pakai kata banget"': 'Add your own rule, e.g. "don\'t use the word banget"',
  "Tambah aturan gaya": "Add style rule",
  "Postingan akun belum cukup untuk disimpulkan AI. Tulis Profil AI secara manual dulu.":
    "The account doesn't have enough posts for AI to draw conclusions. Write the AI Profile manually first.",
  "Tulis aturan gaya minimal 3 karakter.": "Write a style rule of at least 3 characters.",
  "Pelajaran tidak ditemukan.": "Lesson not found.",
  "Aksi tidak dikenal.": "Unknown action.",

  // Panel agen onboarding
  "Membaca postingan & metrik akun": "Reading the account's posts & metrics",
  "Mengenali peran dan gaya akun": "Learning the account's role and style",
  "Mencari tren viral di niche akun": "Finding viral trends in the account's niche",
  "Menyusun ide postingan pertama": "Drafting the first post ideas",
  "Menulis postingan pertama hari ini": "Writing today's first post",
  "Agen AI sedang mempelajari @{username}": "AI agent is learning @{username}",
  "Agen AI selesai mempelajari @{username}": "AI agent finished learning @{username}",
  "Agen AI belum selesai mempelajari @{username}": "AI agent didn't finish learning @{username}",
  "Membaca postingan, mengenali peran akun, mencari tren niche, lalu menyiapkan draf pertama hari ini.":
    "Reading posts, learning the account's role, finding niche trends, then preparing today's first draft.",
  "Tren, ide, dan draf pertama sudah disiapkan untuk akun ini.": "Trends, ideas, and a first draft are ready for this account.",
  "Tutup panel agen": "Close agent panel",
  "Lihat ide": "View ideas",
  "Atur Profil AI": "Edit AI Profile",
  "Jalankan ulang": "Run again",
  "Agen baru saja dijalankan. Coba lagi beberapa menit lagi.": "The agent just ran. Try again in a few minutes.",
  // Keterangan langkah agen (dari server)
  "{n} postingan dibaca": "{n} post read||{n} posts read",
  "Gagal membaca postingan.": "Failed to read posts.",
  "Memakai Profil AI yang sudah diisi pemilik akun": "Using the AI Profile filled in by the account owner",
  "Memakai Profil AI yang sudah diisi": "Using the existing AI Profile",
  "Postingan belum cukup untuk dikenali. Isi Profil AI supaya AI paham akun ini.":
    "Not enough posts to learn from. Fill in the AI Profile so AI understands this account.",
  "Profil AI dilengkapi": "AI Profile completed",
  "Riset tren belum berhasil. Dicoba lagi otomatis nanti.": "Trend research didn't succeed. It will retry automatically later.",
  "Niche akun belum jelas: isi Profil AI atau tunggu ada beberapa postingan.":
    "The account's niche isn't clear yet: fill in the AI Profile or wait for a few posts.",
  "{n} tren di niche akun": "{n} trend in the account's niche||{n} trends in the account's niche",
  "Niche sedang sepi, ide memakai tren umum": "The niche is quiet; ideas use general trends",
  "{n} ide baru siap dipakai": "{n} new idea ready to use||{n} new ideas ready to use",
  "{n} ide lama diganti": "{n} old idea replaced||{n} old ideas replaced",
  "Bank ide sudah terisi": "The idea bank is already filled",
  "Ide belum berhasil disusun. Dicoba lagi otomatis oleh autopilot.": "Ideas couldn't be drafted yet. Autopilot will retry automatically.",
  "Gagal menulis draf pertama.": "Failed to write the first draft.",
  "Autopilot belum dinyalakan. Nyalakan Autopilot supaya AI langsung menulis.":
    "Autopilot isn't on yet. Turn on Autopilot so AI starts writing right away.",
  "Autopilot akun ini sedang dijeda.": "Autopilot for this account is paused.",
  "Autopilot workspace sedang dinonaktifkan.": "Workspace Autopilot is turned off.",
  "Saklar penerbit sedang dinonaktifkan.": "The publishing switch is turned off.",
  "Akun belum siap diposting (periksa token/izin Threads).": "The account isn't ready to post (check the Threads token/permissions).",
  "Draf hari ini sudah siap di jadwal": "Today's draft is ready in the schedule",
  "Jam posting hari ini sudah lewat; jadwal mulai besok": "Today's posting times have passed; scheduling starts tomorrow",
  "1 draf dijadwalkan untuk hari ini": "1 draft scheduled for today",
  "1 draf siap ditinjau untuk hari ini": "1 draft ready for review today",
  "Draf pertama belum berhasil ditulis; dicoba lagi oleh autopilot.": "The first draft couldn't be written yet; autopilot will retry.",
  "Akun belum dipetakan ke workspace.": "The account isn't mapped to a workspace yet.",
  "Terhenti. Jalankan ulang.": "Stopped. Run again.",
  "Terhenti karena galat. Jalankan ulang.": "Stopped due to an error. Run again.",

  // Contoh gaya (panel di dialog Profil AI)
  "Contoh gaya": "Style examples",
  "Tempel postingan Threads yang Anda suka; AI meniru ritme dan tata letaknya, bukan kalimatnya":
    "Paste Threads posts you like; the AI copies their rhythm and layout, not their wording",
  "Fitur contoh gaya belum aktif di database. Hubungi pemilik dashboard.":
    "Style examples aren't enabled in the database yet. Contact the dashboard owner.",
  "Teks contoh gaya": "Style example text",
  "Tempel satu postingan Threads di sini, lengkap dengan baris barunya.\n\nContoh:\njujur ya\nkerja dari kafe itu cuma enak 2 jam pertama\nsisanya mikirin colokan":
    "Paste one Threads post here, line breaks included.\n\nExample:\nhonestly\nworking from a cafe is only nice for the first 2 hours\nthe rest is hunting for a power outlet",
  "Format ditebak otomatis dari teks": "Format is detected automatically from the text",
  "Format otomatis": "Auto format",
  "cerita pengalaman": "personal story",
  "opini / hot take": "opinion / hot take",
  "tips berbentuk daftar": "tips as a list",
  "pertanyaan pemancing obrolan": "conversation-starter question",
  "info / edukasi singkat": "quick info / education",
  "curhat / relatable": "venting / relatable",
  promosi: "promotion",
  "Berlaku untuk semua akun di workspace": "Apply to all accounts in the workspace",
  "Simpan contoh": "Save example",
  "Belum ada contoh. Tanpa contoh, AI tetap belajar dari postingan akun Anda dan akun lain di workspace yang paling ramai.":
    "No examples yet. Without them, the AI still learns from your account's posts and the best-performing accounts in the workspace.",
  "{lines} baris · {chars} karakter": "{lines} lines · {chars} characters",
  "Hapus contoh gaya": "Delete style example",
  "Gaya yang terbukti akan muncul setelah ada minimal 5 postingan yang ramai di akun atau workspace ini.":
    "Proven styles appear once this account or workspace has at least 5 high-performing posts.",
  "Gaya yang terbukti": "Proven style",
  "dari {n} postingan ramai": "from {n} high-performing post||from {n} high-performing posts",
  "Median panjang": "Median length",
  "Median baris": "Median lines",
  "{n} baris": "{n} line||{n} lines",
  "Berbentuk daftar": "List format",
  "Diakhiri tanya": "Ends with a question",
  "Format teratas:": "Top formats:",
  "Gagal memuat contoh gaya.": "Couldn't load style examples.",
  "Gagal menyimpan contoh gaya.": "Couldn't save the style example.",
  "Gagal menghapus contoh gaya.": "Couldn't delete the style example.",
};

export default dict;
