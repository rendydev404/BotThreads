# Meta App Review: `threads_keyword_search` (Advanced Access) + `threads_profile_discovery` (opsional)

Produk: BotThreads, https://bottrit.com. Disusun 22 Oktober 2026 dari kode repo + dokumentasi Meta yang dibuka hari ini.
Teks yang harus ditempel ke formulir Meta (wajib bahasa Inggris) ditandai **"Tempel ke formulir Meta (English)"**.
Yang tidak bisa saya pastikan ditandai **perlu dicek**.

---

## 1. Ringkasan

**Yang diminta**: Advanced Access untuk `threads_keyword_search` supaya `GET /keyword_search` mengembalikan posting publik semua orang, bukan hanya posting pemilik token.
`threads_profile_discovery` sebaiknya **tidak diajukan sekarang** (lihat bagian 3B).

**Kenapa**: fitur Radar > "Tren Viral" dan bank ide butuh sinyal "apa yang sedang dibahas di niche akun ini di Threads". Tanpa izin ini, kolom "Viral di Threads" kosong dan UI sendiri menulis "Aktif setelah izin ... disetujui Meta".

**Status sekarang (standard access)**
- Scope `threads_keyword_search` sudah ikut di OAuth (`THREADS_SCOPES` di `src/lib/threads-connect.ts`), jadi akun yang terhubung sudah memegang scope itu.
- Tes langsung (dari Anda): `keyword_search` hanya mengembalikan posting milik pemegang token. Cocok dengan dokumen Meta: *"Without approval of threads_keyword_search, the search will be performed only on posts owned by the authenticated user."* (https://developers.facebook.com/docs/threads/keyword-search, dibaca 22 Okt 2026).
- Kode `src/lib/threads-trends.ts` menganggap hasil "bukan publik" bila semua posting milik pemegang token, lalu **membuangnya** (`status: "not_approved"`). Akibatnya di build sekarang kolom Viral di Threads selalu kosong. Ini penting untuk screencast (bagian 4).

**Fakta API yang sudah diverifikasi di dokumen Meta**

| Hal | Nilai |
|---|---|
| Izin wajib | `threads_basic` + `threads_keyword_search` |
| Parameter | `q`, `search_type` = `TOP` (default) / `RECENT`, `search_mode` = `KEYWORD` (default) / `TAG`, `media_type`, `since`, `until`, `limit` (default 25, **maks 100**), `author_username` |
| Rate limit | **2.200 query per 24 jam bergulir per pengguna (token), berlaku lintas semua aplikasi**; query yang hasilnya kosong tidak dihitung; query berulang untuk kata sama tetap dihitung |
| Kata sensitif/ofensif | mengembalikan array kosong |
| Kolom `owner` | tidak dikembalikan |
| Batas pemakaian data | halaman dokumen **tidak** memuat aturan penyimpanan/penggunaan data; aturannya ada di Platform Terms / Developer Policies (bagian 6, **perlu dicek**) |

---

## 2. Prasyarat sebelum submit

Legenda: OK = sudah ada di repo, GAP = harus dikerjakan, CEK = harus Anda cek di dashboard Meta.

| # | Prasyarat | Status | Keterangan |
|---|---|---|---|
| 1 | Business Verification (Meta Business Portfolio) | CEK | Advanced Access hampir selalu mensyaratkan bisnis terverifikasi. Penyelenggara di situs: PT SUKA PROFIT BERKAH, Bogor. Dokumen legal (akta/NIB/NPWP) harus cocok dengan nama di Business Portfolio. |
| 2 | App mode **Live** | CEK | Tidak bisa saya lihat dari repo. Izin Advanced hanya bisa diminta bila app Live, dan semua field wajib di Settings > Basic terisi. |
| 3 | Privacy Policy URL | ADA, tapi belum memadai | `https://bottrit.com/kebijakan-privasi` (sumber `src/lib/legal-content.ts`, berlaku 2 Okt 2026). Tidak menyebut pencarian publik Threads sama sekali. Wajib ditambah (bagian 2A). |
| 4 | Data Deletion URL | ADA (versi instruksi) | `https://bottrit.com/penghapusan-data`. Dokumen Meta "Create an app": data deletion URL boleh berupa instruksi **atau** callback. Callback otomatis **belum ada** (bagian 2B). |
| 5 | Deauthorize / Uninstall callback | **GAP** | Tidak ada route di repo (grep `deauthorize`, `uninstall`, `signed_request`: nihil). |
| 6 | Terms of Service URL | OK | `https://bottrit.com/syarat-ketentuan`. Tambahkan klausul data publik Threads (bagian 2A). |
| 7 | App icon 1024x1024 | CEK | Repo hanya punya `src/app/icon.png` dan `apple-icon.png`; ukuran asli belum saya periksa. Siapkan PNG 1024x1024. |
| 8 | Platform / Website URL | OK | `https://bottrit.com` harus sama dengan domain Redirect URI `https://bottrit.com/api/threads/oauth/callback` yang terdaftar di use case Threads. |
| 9 | Akun uji untuk reviewer | **GAP** | Perlu workspace khusus reviewer (bagian 5). Menghubungkan akun butuh peran ADMIN dan paket aktif (`connectThreadsAccount` menolak bila paket kedaluwarsa atau kuota penuh). |
| 10 | Fitur terlihat di build yang dites | **GAP** | Tidak ada feature flag di repo. Fitur "tampil" hanya bila API mengembalikan posting orang lain (bagian 4.3). |
| 11 | Kontak & email dukungan | OK | `dev.sukashawarma@gmail.com`, WhatsApp +62 822-9932-9686 (halaman `/kontak`). |
| 12 | Data Use Checkup / pertanyaan penanganan data | CEK | Meta menanyakan pemroses data, entitas bertanggung jawab, negara, dsb. Siapkan jawaban (bagian 6). |
| 13 | Izin dasar sudah dipakai | CEK | Meta cenderung menolak Advanced Access untuk izin bila izin dasar app belum pernah dipanggil. `threads_basic` dipanggil tiap `/me`; pastikan ada panggilan API sukses 30 hari terakhir di dashboard. |

### 2A. Tambahan wajib untuk Kebijakan Privasi dan Syarat & Ketentuan

**Yang ada sekarang** (kutipan dari `legal-content.ts`):
- Pasal 02 "Data yang Kami Kumpulkan": identitas akun, otorisasi Meta/Google, "Konten & Pengetahuan Brand ... dari akun Threads Anda sendiri", catatan transaksi.
- Pasal 03 "Kalibrasi Performa Akun": "...khusus pada akun Anda tanpa mencampurkannya dengan data pelanggan lain."
- Ringkasan: "Tidak pernah menjual, menyewakan, atau membagikan data ke pengiklan pihak ketiga."
- Pasal 05 mitra: Midtrans, Meta Platforms, Google Cloud ("pemrosesan model bahasa alami").

**Yang bertentangan atau kurang**
1. Kebijakan hanya bicara data **akun Anda sendiri**. Fitur baru memproses posting **publik milik orang lain**. Harus dinyatakan.
2. Tidak ada angka retensi di mana pun.
3. Pasal 05 tidak menyebut router AI "Hermes" (9Router, model hulu bergilir; `src/lib/gemini.ts`). Bila teks posting publik ikut dikirim sebagai konteks prompt, penyedia AI itu adalah pemroses data dan harus dicantumkan. **perlu dicek**: siapa penyedia hulu Hermes dan apakah mereka melatih model dari input.
4. Halaman penghapusan hanya membahas token dan data workspace, tidak membahas data posting publik yang dicache.

**Tambahkan sebagai pasal baru "Data Publik dari Pencarian Threads" (Indonesia, untuk `legal-content.ts` > `privasi.articles`)**

> **Data Publik dari Pencarian Threads.** Bila Anda menghubungkan akun Threads dan mengaktifkan fitur Radar, BotThreads memakai API resmi Threads (izin `threads_keyword_search`) untuk mencari posting publik berdasarkan kata kunci dan tagar topik yang sesuai niche akun Anda. Dari hasil pencarian itu kami menyimpan: teks posting, tautan (permalink), waktu posting, username penulis, dan topik pencarian. Tujuannya hanya (a) menampilkan topik yang sedang ramai di niche Anda di tab Radar, (b) membantu menyusun ide posting yang selalu Anda tinjau, dan (c) mempelajari pola gaya penulisan secara agregat (mis. panjang, jumlah baris, format). Kami tidak menyalin isi posting orang lain, tidak memposting ulang, tidak membalas, menyukai, atau mengikuti penulisnya, tidak membuat profil individu, dan tidak menjual atau membagikan data ini kepada pihak lain. Data hasil pencarian disimpan paling lama 14 hari lalu dihapus otomatis, dipisahkan per workspace, dan dihapus lebih awal bila akun Threads dilepas, workspace dihapus, atau penulis menghapus posting aslinya di Threads. Anda dapat meminta penghapusan kapan saja lewat halaman Penghapusan Data.

**Tempel ke formulir/halaman privasi (English)**

> **Public data from Threads search.** When you connect a Threads account and use the Radar feature, BotThreads uses the official Threads API (`threads_keyword_search`) to search public posts by keywords and topic tags related to your account's niche. We store the post text, permalink, timestamp, author username and the search topic. We use this only to (a) show which topics are currently discussed in your niche, (b) help generate post ideas that you review, and (c) learn aggregate writing-style patterns such as length, line breaks and format. We do not copy other people's posts, repost them, reply to, like or follow their authors, build profiles of individuals, or sell or share this data. Search results are kept for at most 14 days and then deleted automatically, are isolated per workspace, and are deleted sooner if you disconnect your Threads account, your workspace is deleted, or the author deletes the original post on Threads. You can request deletion at any time through our Data Deletion page.

Tambah juga di Pasal 05 (mitra): penyedia AI yang dipakai (Hermes/9Router + Gemini) dan fakta bahwa teks posting publik tidak dipakai untuk melatih model (**hanya tulis ini bila terbukti benar**).
Tambah di Syarat & Ketentuan (pasal "Penyalahgunaan API"): pengguna dilarang memakai Radar untuk menyalin konten, memantau/menguntit individu, atau mengekstrak data massal.

### 2B. Penghapusan data dan callback: kondisi nyata di repo

Yang sudah ada:
- Halaman instruksi `/penghapusan-data` (kode dokumen BT-DOC/DD-05): cabut akses mandiri lewat Pengaturan > Akun Threads atau lewat pengaturan aplikasi Meta; penghapusan permanen akun/workspace via email ke `dev.sukashawarma@gmail.com`, maks 3x24 jam kerja. Cukup untuk "Data Deletion Requests URL" versi instruksi.
- Hapus akun Threads dari dashboard: fungsi SQL `dash_tc_remove` (`sql/026_threads_account_remove.sql`) lewat `removeThreadsAccount`. Isinya: antrean posting `DRAF`/`MENUNGGU` ditandai `GAGAL`, slot Autopilot dibatalkan, konfigurasi dihapus, `SocialAccount` dihapus, baris `ThreadsAccount` (termasuk token terenkripsi) dihapus. **Riwayat posting tetap ada** (`socialAccountId` jadi NULL).
- Halaman privasi dan penghapusan sudah menyebut "Token akses di server kami akan otomatis gugur" bila izin dicabut di Meta. Itu **hanya benar secara fungsional** (token ditolak Meta saat dipakai, akun ditandai `needsReconnect`); tokennya sendiri **tidak dihapus** dari DB sampai pengguna menghapus akun.

Yang belum ada (GAP):
1. **Deauthorize/Uninstall callback**: route yang menerima `signed_request` dari Meta (verifikasi HMAC-SHA256 dengan App Secret Threads) lalu memanggil logika setara `dash_tc_remove` untuk `threadsUserId` yang bersangkutan.
2. **Data Deletion callback**: route yang menerima `signed_request`, menghapus semua data pengguna itu (token, `TrendSignal` yang terkait akun, riwayat), dan membalas JSON `{ "url": "<halaman status>", "confirmation_code": "<kode>" }`. Halaman status bisa `https://bottrit.com/penghapusan-data?kode=...`.
3. Penghapusan **data hasil pencarian publik**: tabel `TrendSignal` (sumber `THREADS_SEARCH`) saat ini kedaluwarsa 48 jam dan baru dihapus fisik 30 hari sesudahnya (`dash_radar_prune`, sql/006), jadi efektif **sekitar 32 hari, bukan 14**. Ubah ke 14 hari sebelum submit, atau jangan klaim 14 hari.
4. Di dashboard Meta (Use case Threads > Settings) isi kolom callback bila tersedia; nama persis kolom (Uninstall/Delete/Deauthorize callback URL) **perlu dicek** karena dokumen menyebut dua nama berbeda.

---

## 3. Teks formulir Meta

### 3A. `threads_keyword_search`: "How will your app use this permission?"

> **Pastikan semua klaim di bawah benar saat Anda merekam screencast. Lihat daftar "Gap" di bagian 7 sebelum menempel.**

**Tempel ke formulir Meta (English)**

```
BotThreads (https://bottrit.com) is a SaaS dashboard that helps Indonesian businesses and creators plan, write and publish posts on their OWN Threads accounts. We use threads_keyword_search in one feature only: "Radar > Tren Viral" (Trending Topics), which tells the account owner WHAT is being discussed in their niche on Threads right now, so they can decide what to write about.

Step by step:
1. A business owner signs in at https://bottrit.com and connects their Threads account through the official Threads OAuth flow (scopes: threads_basic, threads_content_publish, threads_read_replies, threads_manage_replies, threads_manage_insights, threads_keyword_search).
2. The owner sets the account's niche (account theme and topic categories, for example "AI tools", "small business", "coffee shop").
3. Every 2-3 hours our server calls GET /keyword_search with THAT account's own access token, using (a) keywords from the niche and (b) topic tags (search_mode=TAG, e.g. "AI Threads", "Business Threads"), with search_type=TOP and search_type=RECENT, limit=25 and fields id, username, text, permalink, timestamp. We stay far below the 2,200 queries / 24h per-user limit, and queries are spread per account.
4. We group the results by topic and show in the Radar tab (a) the topics currently discussed in the niche and (b) a few public posts per topic as read-only cards: author @username, the post text and a "View on Threads" link to the original post. We do not modify, repost or republish them.
5. The owner then sees AI-generated post ideas (written by our AI engine) based on those topics. The ideas are original drafts that the owner reviews, edits, schedules or discards. Before any draft is accepted, an automatic check rejects it if it shares 6 or more consecutive words with any example post.
6. From the same results we compute aggregate writing-style features only (post length, number of line breaks, use of lists/questions/hashtags). We do not store these features per author.

What we do NOT do with search results:
- We do not copy, repost, quote, reply to, like or follow anything found through search.
- We do not contact authors, build lists or profiles of individual people, or track individuals over time.
- We do not sell, license, share or expose the data to other customers or third parties. Results are isolated per workspace.
- We do not use search results to target ads, and we do not use them to train AI models.

Data handling: we store post text, permalink, timestamp, author username and the search topic. Search data is kept for 14 days and then deleted automatically. It is deleted earlier when the owner disconnects the Threads account, deletes the workspace, or when the original post is deleted on Threads. Users can request deletion at https://bottrit.com/penghapusan-data. Our privacy policy is at https://bottrit.com/kebijakan-privasi.

Why advanced access is needed: with standard access, keyword_search only returns the authenticated user's own posts, which cannot show what is being discussed in the wider niche. Public search is the core of the Radar feature; no other permission provides this data.
```

Catatan isi untuk Anda (jangan ditempel):
- Kalimat "6 or more consecutive words" dan "aggregate writing-style features" **belum diimplementasi** (bagian 7, gap 1 dan 2). Bila belum selesai saat submit, **hapus kalimat itu**; jangan berbohong ke Meta.
- "do not use ... to train AI models": benar hanya jika penyedia hulu Hermes tidak melatih dari input. **perlu dicek**.
- "TAG" dan "RECENT" belum dipanggil di kode (hanya `TOP`, `KEYWORD`). Bagian Phase B harus jadi sebelum rekaman, atau hapus dari teks.

### 3B. `threads_profile_discovery` (opsional): **rekomendasi: jangan diajukan sekarang**

Fakta (https://developers.facebook.com/documentation/threads/threads-profiles, dibaca 22 Okt 2026):
- `GET /profile_lookup?username=` butuh `threads_basic` + `threads_profile_discovery`.
- Mengembalikan `username, name, profile_picture_url, biography, follower_count, likes_count, quotes_count, reposts_count, views_count, is_verified`.
- Hanya profil publik dengan **minimal 100 pengikut**; di standard access hanya akun resmi Meta (@meta, @threads, @instagram, @facebook).
- Rate limit **1.000 request / 24 jam** per pengguna.

Alasan menunda: tidak ada kode yang memakainya di repo, dan tidak ada fitur di Phase B yang butuh profil individu. Permintaan izin tanpa fitur yang bisa didemokan pasti ditolak, dan bisa menurunkan peluang `threads_keyword_search` yang diajukan bersamaan. Selain itu "no profiling of individuals" di kebijakan Anda bertabrakan dengan izin ini.

Bila nanti ada fitur nyata (contoh: pengguna mengetik @username kompetitor untuk benchmark), ajukan terpisah dengan teks ini:

**Tempel ke formulir Meta (English)**

```
In BotThreads (https://bottrit.com), a business owner can type the exact @username of a public Threads profile (for example a competitor or an industry reference) into "Radar > Benchmark". We call GET /profile_lookup once for that username and show the owner the public profile fields username, name, follower_count and views_count next to their own account's numbers, so they can compare their growth. Lookups happen only when the owner clicks "Compare" for a username they typed; there is no bulk or automatic lookup, no crawling, and no list building. We store the result for 24 hours for display, isolated per workspace, and never sell, share or use it for ads. Users can request deletion at https://bottrit.com/penghapusan-data.
```

---

## 4. Naskah screencast (target 2:30 sampai 3:00)

Format: rekam layar 1080p, suara atau teks overlay bahasa Inggris, **tanpa memotong** bagian pemanggilan API. Gunakan browser desktop, tema terang, zoom 110 persen. Siapkan sebelumnya: akun uji sudah pernah login Threads supaya tidak ada captcha atau 2FA di tengah rekaman.

### 4.1 Urutan

| Waktu | Layar | Aksi | Yang harus terlihat oleh reviewer | Narasi singkat (EN) |
|---|---|---|---|---|
| 0:00-0:10 | https://bottrit.com | Tampilkan landing, tunjuk footer "Kebijakan Privasi" dan "Penghapusan Data" | Domain di address bar, tautan legal | "This is BotThreads, a dashboard for planning and publishing posts on your own Threads account." |
| 0:10-0:25 | /login | Login dengan akun uji | Login sukses ke dashboard | "I sign in as a business owner." |
| 0:25-0:55 | /akun ("Akun Threads") | Klik **Hubungkan Threads** (atau tunjukkan akun yang sudah terhubung lalu **Hubungkan ulang**) | Halaman izin Threads dengan daftar scope, termasuk "keyword search"; kembali ke dashboard dengan akun `@...` terhubung | "The owner grants permissions through the official Threads OAuth. threads_keyword_search is one of them." |
| 0:55-1:10 | Pengaturan > Brand, atau Autopilot | Tunjukkan niche/tema akun terisi | Tema atau kategori topik akun | "The niche tells us which keywords and topic tags to search." |
| 1:10-1:50 | /radar > tab **Tren Viral** > filter **Viral di Threads** | Klik Segarkan; tunjukkan kartu: Topik, `@username`, teks, "Lihat di Threads", waktu Diperbarui. Klik satu "Lihat di Threads" untuk membuka posting asli di Threads | Hasil keyword_search tampil di aplikasi; link kembali ke sumber; label topik dan sumber | "Our server calls keyword_search with the owner's token for niche keywords and topic tags. Results appear here, read-only, with attribution and a link to the original post." |
| 1:50-2:15 | /radar > tab **Ide** | Tunjukkan ide yang bersumber "ramai di Threads", klik ide, tunjukkan draf orisinal yang disusun AI, status menunggu tinjauan | Ide berasal dari topik, bukan salinan teks | "Ideas are original drafts. The owner reviews, edits or discards them. Nothing is copied from the search results." |
| 2:15-2:35 | /kebijakan-privasi (pasal baru "Data Publik dari Pencarian Threads") | Gulir ke pasal itu, bacakan retensi 14 hari | Pasal retensi dan penggunaan | "We store text, permalink, timestamp and username for 14 days, isolated per workspace, never sold." |
| 2:35-2:55 | /akun lalu /penghapusan-data | Klik **Hapus** pada akun Threads (di akun uji kedua, bukan yang dipakai reviewer), lalu tunjukkan halaman Penghapusan Data | Konfirmasi hapus, instruksi dan alamat email | "The owner can disconnect at any time, and data deletion instructions are public." |

### 4.2 Hal yang wajib terlihat
- Address bar `bottrit.com` sepanjang rekaman.
- Dialog izin Threads yang memuat scope pencarian.
- **Hasil pencarian milik orang lain** di Radar (bukan hanya posting akun sendiri). Di standard access ini tidak mungkin, lihat 4.3.
- Tautan "Lihat di Threads" yang benar-benar membuka posting.
- Teks retensi dan penghapusan.

### 4.3 Masalah besar: fitur tidak akan terlihat di build sekarang
Di standard access, `keyword_search` hanya mengembalikan posting pemilik token. `captureThreadsViral` membuang posting milik pemegang token (`posts.filter((p) => p.username !== auth.username)`) dan mengembalikan `not_approved`, jadi tab "Viral di Threads" kosong dan hanya menampilkan teks "akan muncul setelah izin disetujui Meta" (`src/components/radar/signals-tab.tsx`). Reviewer yang melihat itu akan menolak karena fitur tidak terbukti jalan.

Meta tahu bahwa sebelum disetujui hanya posting sendiri yang kembali, jadi demo dengan posting sendiri **boleh dan lazim** asal jelas. Yang dibutuhkan (**perubahan kode di luar dokumen ini, belum dilakukan**):
1. Env pada build review, mis. `THREADS_SEARCH_REVIEW_MODE=1` (nama usulan): jangan buang posting milik pemegang token, simpan sebagai sinyal `THREADS_SEARCH` untuk workspace akun uji, dan beri label "Mode uji: hasil dari akun Anda sendiri".
2. Siapkan 4-6 posting nyata di akun uji tentang topik niche (mis. "AI Threads", "Business Threads") supaya pencarian TOP dan RECENT mengembalikan sesuatu.
3. Pastikan riset benar-benar jalan untuk akun uji (saat ini `runResearch` hanya jalan pada jam aktif `RESEARCH_FIRST_HOUR` sampai `RESEARCH_LAST_HOUR` dan bila sinyal basi, dengan lease). Untuk rekaman sediakan tombol atau route admin "Segarkan sekarang", atau jalankan tick internal sebelum merekam.
4. Setelah disetujui, matikan env itu (bagian 8).

Setelah semua itu, uji ulang di akun uji: tab Tren Viral harus berisi minimal satu kartu dengan `@username`, teks, dan link sebelum merekam.

---

## 5. Instruksi akses untuk reviewer

**Tempel ke formulir Meta, kolom "Instructions / Test credentials" (English)**

```
Website: https://bottrit.com
Sign in: https://bottrit.com/login
Test account (BotThreads dashboard)
  Email:    <ISI: email akun uji>
  Password: <ISI: kata sandi akun uji>
This workspace already has an active plan and a connected Threads test account (@<ISI: username>), so you do not need to log in to Threads or pass 2FA.

How to see threads_keyword_search in use:
1. Sign in at https://bottrit.com/login with the credentials above.
2. Open "Radar" in the left sidebar (https://bottrit.com/radar).
3. Open the "Tren Viral" tab, then choose the filter "Viral di Threads". Each card shows the search topic, the author @username, the post text and a "Lihat di Threads" link to the original post.
4. Click the refresh button at the top right of the list to reload results. (Searches run on the server every 2-3 hours; refresh only re-reads stored results. <ISI: ganti bila Anda menambah tombol "Segarkan sekarang">)
5. Open the "Ide" tab to see post ideas generated from these topics.
6. To see the permission request: open https://bottrit.com/akun and click "Hubungkan ulang" next to the connected account. The Threads consent screen lists the requested permissions. (Optional; this requires a Threads login.)
7. Privacy policy: https://bottrit.com/kebijakan-privasi. Data deletion: https://bottrit.com/penghapusan-data.

Note: while threads_keyword_search is in standard access, Threads returns only the test account's own posts, so the cards you see come from the test account's posts (labelled "test mode"). After approval the same call returns public posts.
```

Persiapan di sisi Anda (belum otomatis):
- Buat workspace reviewer dengan peran Pemilik, paket aktif (kuota akun >= 1, masa berlaku jauh ke depan; `quota.expired` memblokir koneksi).
- Hubungkan akun Threads uji **sebelum** submit supaya reviewer tidak perlu OAuth. Tambahkan akun itu sebagai **Threads Tester** di App roles bila app masih punya mode pengembangan (**perlu dicek**).
- Jangan pakai akun pribadi atau akun pelanggan sungguhan. Buat akun Threads khusus uji, publik, berisi posting tentang topik niche.
- Isi kredensial hanya di formulir Meta, jangan di repo.

---

## 6. Kepatuhan

Verifikasi sumber: rate limit keyword search dari https://developers.facebook.com/docs/threads/keyword-search (22 Okt 2026). Isi Platform Terms / Developer Policies penuh tidak bisa saya buka dari lingkungan ini, jadi poin di tabel kolom "Sumber" bertanda **perlu dicek** adalah ringkasan umum yang harus Anda cocokkan dengan teks resminya sebelum submit.

| Isu | Aturan / fakta | Sumber | Cara BotThreads patuh | Status |
|---|---|---|---|---|
| Rate limit | 2.200 query per 24 jam per pengguna, lintas app | Dokumen keyword-search (terverifikasi) | Hitung anggaran: tiap niche = (2 kata kunci + 2 tag) x (TOP + RECENT) = 8 query per putaran; tiap 3 jam = 8 putaran/hari = **64 query/niche/hari**. Satu token aman untuk sekitar 34 niche per hari. Gunakan token akun masing-masing, jangan satu akun untuk semua. | Perlu kode: pembatas query per token + penghitung 24 jam |
| Token pelanggan untuk pencarian bersama | Kode sekarang (`loadSearchTokens`) mengambil sampai 3 token akun dari **workspace mana pun** untuk sinyal global (`workspaceId: null`) yang dilihat semua workspace, 8 topik Google Trends, TTL 48 jam | Kode | Bertentangan dengan klaim "isolasi per workspace". Phase B harus: tiap workspace memakai token akunnya sendiri, sinyal disimpan dengan `workspaceId`. Bila memakai akun milik perusahaan untuk pencarian global, pakai satu akun Threads milik BotThreads (`THREADS_SEARCH_USERNAME`), bukan akun pelanggan, dan nyatakan di privasi. | **GAP** |
| Menampilkan posting orang lain | Dokumen Overview Threads: API dipakai untuk "display those posts within your app solely to the person who created it" (konteks: posting yang dibuat pengguna itu sendiri). Tentang hasil pencarian tidak diatur di halaman itu. | https://developers.facebook.com/documentation/threads/overview.md | Kartu Radar menampilkan teks maksimal 400 karakter (`cleanExternal`), dibatasi 6 baris, dengan `@username` dan link ke sumber; tidak ada repost. Risiko penolakan sedang. **perlu dicek** di Platform Terms. | Risiko |
| Tidak scraping / tidak bulk | Larangan mengumpulkan data massal di luar API | Platform Terms (**perlu dicek**) | Hanya `keyword_search` resmi, `limit` 25, tidak ada crawler, tidak ada akses tanpa token | OK |
| Tidak jual / lisensi data | Dilarang menjual atau melisensikan data platform | Platform Terms (**perlu dicek**) | Tertulis di privasi; tidak ada ekspor atau API data publik | OK |
| Retensi dan penghapusan | Hapus data bila pengguna menghapus akses atau konten sumber dihapus | Platform Terms (**perlu dicek**) | Retensi 14 hari (belum dikodekan, sekarang ~32 hari), hapus saat akun dilepas. Posting yang dihapus penulisnya: dengan retensi 14 hari kecil kemungkinan masih tersimpan; jelaskan ini di privasi. | **GAP** pada angka retensi dan hapus saat akun dilepas (sinyal tidak terkait `accountId` pada sinyal global) |
| Pemroses pihak ketiga (AI) | Pengungkapan pemroses data; larangan melatih model dari data platform | Data Use Checkup / Platform Terms (**perlu dicek**) | Teks posting publik hanya dikirim sebagai konteks prompt ke Hermes/Gemini; tulis penyedianya di privasi | **GAP** |
| Tidak menargetkan individu | Tidak membuat profil, tidak menghubungi | Platform Terms (**perlu dicek**) | Hanya agregat topik dan fitur gaya; `username` disimpan untuk atribusi, bukan untuk analisis per orang. Jangan mengurutkan atau memberi skor per penulis. | OK bila tidak ada fitur per penulis |
| Konten sensitif | Kata sensitif mengembalikan hasil kosong | Dokumen keyword-search | Saringan `DEFAULT_BANNED_TERMS`, `HARD_NEWS_TERMS` dan larangan tambahan sudah dijalankan sebelum simpan (`viralToSignals`) | OK |
| Data Use Checkup tahunan | Meta meminta sertifikasi ulang | Meta (**perlu dicek**) | Jadwalkan pengingat tahunan | Operasional |

---

## 7. Risiko penolakan dan cara menghindarinya

**Gap teknis dan konten yang harus dibereskan sebelum submit (urut prioritas)**

1. **Anti-copy gate "6+ kata berurutan" tidak ada di repo** (grep `anti.?copy`, `berurutan`, `consecutive` tidak menemukan gate itu; `content-ai.ts` hanya memakai kemiripan Jaccard antar draf). Bangun dan uji, atau hapus klaimnya dari teks Meta.
2. **Pembelajaran gaya agregat tidak ada** (hanya `autopilot-learning.ts` untuk akun sendiri; **perlu dicek** isinya). Bangun atau hapus butir 6 dari teks Meta.
3. **`TAG` dan `RECENT` belum dipakai**: `searchTopPosts` hanya `search_type=TOP`, tanpa `search_mode`; topik berasal dari Google Trends, bukan niche akun. Phase B belum ada.
4. **Isolasi per workspace belum ada**: sinyal `THREADS_SEARCH` global dengan token akun pelanggan mana pun.
5. **Retensi 14 hari belum dikodekan** (efektif ~32 hari) dan sinyal global tidak ikut terhapus saat akun dilepas.
6. **Mode review** (bagian 4.3) agar fitur terlihat tanpa izin.
7. **Callback deauthorize dan data deletion** (bagian 2B).
8. **Kebijakan privasi dan S&K** diperbarui dan sudah live **sebelum** submit (bagian 2A). Reviewer membuka halamannya.
9. Ganti teks UI "Aktif setelah izin ... disetujui Meta" pada build review. Teks itu mengakui fitur belum aktif di depan reviewer.

**Penyebab penolakan umum dan penangkalnya**

| Penyebab penolakan | Penangkal |
|---|---|
| Screencast tidak menunjukkan penggunaan izin | Ikuti bagian 4; pastikan kartu hasil terlihat; mode review aktif |
| Use case terdengar seperti scraping atau pengumpulan data | Tekankan: dipakai untuk wawasan topik pemilik akun, bukan data pihak lain; batas retensi; tidak ada ekspor |
| Teks formulir tidak cocok dengan apa yang tampak di video | Setiap kalimat di 3A harus bisa ditunjuk di rekaman, atau dihapus |
| Privacy policy tidak menyebut data ini | Bagian 2A harus live; tunjukkan di rekaman |
| Data deletion URL / callback tidak berfungsi | Uji URL dari jaringan luar; bila memakai callback, kirim `signed_request` uji |
| Login reviewer gagal (2FA, captcha, paket kedaluwarsa) | Workspace dan akun Threads sudah terhubung; paket aktif panjang; uji login dari jaringan dan perangkat lain |
| Business Verification belum lengkap | Selesaikan lebih dulu; nama bisnis sama dengan dokumen |
| Izin diminta tapi tidak ada panggilan API | Pastikan ada panggilan `keyword_search` dari app dalam 30 hari terakhir (log) |
| Mengajukan banyak izin sekaligus tanpa demo | Ajukan satu izin dulu (`threads_keyword_search`); jangan sertakan `threads_profile_discovery` |
| Tampilan konten orang lain dianggap melanggar | Tampilkan hanya cuplikan + atribusi + link; tidak ada tombol salin; tidak ada repost |
| Skala query tidak masuk akal | Sertakan hitungan di 6 (64 query/niche/hari) dan batas per token |

Bila ditolak: Meta menulis alasan per izin. Perbaiki hanya yang disebut, rekam ulang bagian terkait, kirim ulang (biasanya beberapa hari sampai 2 minggu; **perlu dicek**).

---

## 8. Langkah setelah disetujui

1. **Verifikasi**: di Graph API Explorer atau panggilan server, `keyword_search` dengan token akun lain harus mengembalikan posting dari username berbeda (`publicSearch` menjadi true di `searchTopPosts`).
2. **Matikan mode review** (`THREADS_SEARCH_REVIEW_MODE`), supaya posting milik pemegang token tidak lagi dimasukkan.
3. **Hapus** teks "akan muncul setelah izin disetujui Meta" di `signals-tab.tsx` dan `EMPTY_COPY.THREADS_SEARCH`.
4. **Aktifkan bertahap**: mulai dengan 1-2 workspace internal, 1 putaran per 3 jam, lalu naik ke 2 jam. Catat per putaran: jumlah query, jumlah hasil, jumlah hasil kosong.
5. **Pemantauan**
   - Hitungan query per token per 24 jam; alarm di 70 persen dari 2.200.
   - Error API (`4xx` izin dicabut, `429`/rate limit): hentikan token itu sementara.
   - Rasio hasil kosong tinggi = kata kunci sensitif atau niche terlalu sempit.
   - Pemeriksaan harian bahwa `dash_radar_prune` benar-benar menghapus data > 14 hari.
   - Uji bulanan: deauthorize dan data deletion callback dengan akun uji.
6. **Kalender kepatuhan**: Data Use Checkup tahunan, tinjau ulang kebijakan privasi tiap ada perubahan fitur, simpan bukti persetujuan (tanggal, nama izin) di repo internal.
7. **Jangan memperluas** pemakaian (profil, ekspor, notifikasi ke penulis) tanpa meninjau izin dan kebijakan lagi.

---

## Lampiran: sumber dan file yang dibaca

- Kode: `src/lib/threads-connect.ts`, `src/lib/threads-trends.ts`, `src/lib/autopilot-research.ts`, `src/components/radar/signals-tab.tsx`, `src/app/radar/page.tsx`, `src/lib/legal-content.ts`, `src/app/api/threads/oauth/route.ts`, `src/app/api/webhooks/threads/route.ts`, `sql/006_autopilot_radar.sql`, `sql/026_threads_account_remove.sql`, `sql/027_radar_niche_trends.sql`, `src/lib/gemini.ts`.
- Dokumen Meta yang dibuka 22 Okt 2026: keyword search (`/docs/threads/keyword-search`), profil (`/documentation/threads/threads-profiles`), create-an-app, overview.
- Tidak bisa dibuka/ditemukan: Platform Terms penuh, halaman App Review Threads, aturan Advanced Access dan Business Verification. Semua yang bersumber dari sana bertanda **perlu dicek**.
