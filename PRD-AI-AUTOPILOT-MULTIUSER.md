# PRD & Rencana Implementasi: Autopilot Konten AI (Riset Tren, Ide, Tulis, Jadwal, Terbit, Belajar) + Multi-User

- **Proyek**: Bot_Dashboard (`D:\PROJECT-WEB-SS\Bot_Dashboard`), produksi https://wargi.sukashawarma.com
- **Proyek terkait**: auto-suka-shawarma / SukaPost (`D:\PROJECT-WEB-SS\auto-suka-shawarma\server`), pemilik penerbit Threads, pengumpul insight, OAuth, dan token
- **Referensi produk**: ThreadsBot (https://masterpro.web.id, aplikasi di https://app.masterpro.web.id)
- **Tanggal**: 2026-10-13
- **Status**: Draf untuk disetujui pemilik. Bagian 17 (Pertanyaan Terbuka) harus dijawab sebelum Fase 2 dan Fase 4.
- **Melanjutkan**: `PRD-AI-THREADS-PUBLISHING.md` (Fase 1 sampai 3 sudah terpasang). Dokumen ini **mencabut** aturan "tidak ada posting tanpa klik manusia" untuk akun yang autopilot-nya dinyalakan, dan menggantinya dengan pagar pengaman di bagian 8.

> **Untuk agent eksekutor:** baca seluruh dokumen sebelum menulis kode. Bagian 6 (Keputusan Arsitektur) dan 8 (Aturan Keras) wajib dipatuhi. Kerjakan fase demi fase (bagian 14). Next.js di proyek ini versi 16 dengan breaking changes: baca `node_modules/next/dist/docs/` sebelum membuat route handler, halaman, atau mengubah `src/proxy.ts` (lihat `AGENTS.md`). Proyek ini **tidak memakai Prisma** saat runtime; semua akses DB lewat `@supabase/supabase-js` dan fungsi RPC `dash_*`.

---

## 1. Ringkasan

Hari ini AI di dashboard hanya bekerja saat ada orang membuka tab dan menekan tombol. Fitur ini membuat AI bekerja sendiri, setiap hari, untuk setiap akun Threads yang autopilot-nya dinyalakan:

1. **Riset**: mengumpulkan sinyal tren dan konten yang sedang ramai (data performa jaringan sendiri, tren pencarian Indonesia, pencarian kata kunci Threads resmi, momen kalender, inspirasi yang ditempel manusia).
2. **Ide**: mengubah sinyal menjadi bank ide yang diberi skor, tidak mengulang topik, dan cocok dengan karakter tiap akun.
3. **Tulis**: menulis draf memakai mesin yang sudah ada (`content-ai.ts`), lalu melewati gerbang kualitas otomatis.
4. **Jadwal**: memasang **minimal 3 posting per hari per akun** di jam ramai akun itu sendiri, dihitung dari data, bukan diketik manual.
5. **Terbit**: memasukkan ke antrean bersama yang sudah teruji; penerbit SukaPost yang mengirim ke Threads.
6. **Belajar**: mengaitkan setiap posting dengan hasilnya, lalu memakai hasil itu untuk memilih ide, sudut, dan jam berikutnya.

Bagian kedua menambahkan **multi-user**: beberapa pengguna dengan peran berbeda, dibatasi per workspace dan per akun, dengan isolasi data yang diuji.

---

## 2. Hasil Riset Referensi (ThreadsBot)

**Sumber:** [masterpro.web.id](https://masterpro.web.id) dan [app.masterpro.web.id](https://app.masterpro.web.id)
**Tanggal ambil:** 2026-10-13 · **Strategi:** fetch HTML statis (curl), tanpa login · **Halaman:** landing, 15 artikel blog, halaman login/daftar, `manifest.json`, `sw.js`, `sitemap.xml`, `robots.txt`
**Kepercayaan:** SEDANG. Semua berasal dari halaman publik (materi pemasaran dan panduan). Bagian dalam aplikasi (`/dashboard`, `/tutorial`) terkunci login dan **tidak** diperiksa, jadi nama field persis dan perilaku tepi belum terverifikasi. Angka paket di landing dan di blog tidak konsisten satu sama lain.

| Area | Yang dilakukan referensi | Diadopsi di sini | Peningkatan kita |
|---|---|---|---|
| Autopilot | Penjadwal memeriksa tiap 30 menit; bila jam posting akun tiba, AI membuat topik baru, menulis, lalu memposting. Kunci atomik mencegah posting ganda. | Ya (Fase 1) | Slot direncanakan dulu dan tersimpan di DB, tulis menjelang tayang, status tiap langkah terlihat. |
| Pengaturan per akun | Tema, deskripsi tema, jam posting diketik manual (contoh `07,12,19,21`), jumlah komentar berantai, tombol aktif. | Ya | Jam default dihitung otomatis dari data views akun; jam manual tetap tersedia sebagai pilihan. |
| Anti-ulang | Topik tidak boleh sama dengan 50 posting terakhir. | Ya | Ditambah kemiripan teks dan batas antar-akun (33 akun satu brand). |
| Sumber ide | Topik dihasilkan dari tema akun. Tidak ada riset tren. "Viral" berarti 7 formula hook di dalam prompt. | Formula hook ya | **Radar tren** dan pola pemenang jaringan sendiri (bagian 7.1). |
| Knowledge base | Teks referensi produk/brand per akun yang selalu dirujuk AI. | Ya | Fakta di draf (harga, promo) wajib ada di knowledge base, dicek server. |
| Voice style | 4 gaya sapaan per akun (gue/lo, saya/kamu, aku/kamu, kita), berlaku di semua jalur generate. | Ya, sebagai override | Default tetap profil suara yang dihitung dari posting akun (`content-ai.ts:223-249`). |
| Antrean konten | Konten dibuat dulu, masuk antrean, terbit per interval. | Sudah ada (`/jadwal`) | Tidak berubah. |
| Analitik + insight | Views, likes, replies, reposts; 6 jam terbaik; rekomendasi AI bisa disimpan sebagai panduan autopilot. | Jam terbaik sudah ada | Loop belajar otomatis tanpa perlu disimpan manual (bagian 7.6). |
| Viral alert | Notifikasi saat posting melewati ambang engagement. | Ya (Fase 3) | Pemenang otomatis menjadi ide lanjutan dan pola untuk akun lain. |
| Autopilot produk | Rasio konten promosi terhadap organik, sudut dirotasi. | Ya, default 0% | Promo hanya dari knowledge base; aturan "jangan mengarang promo" tetap. |
| Komentar promo | Komentar pertama otomatis di tiap posting. | Ditunda | Butuh rantai balasan di penerbit SukaPost (bagian 17 nomor 2). |
| Balas komentar otomatis | Cek tiap 5 menit, maksimal 5 balasan per siklus, 4 gaya. | Di luar lingkup | SukaPost sudah punya fitur auto-komentar sendiri. |
| Multi-akun | Banyak akun dalam satu dashboard, pengaturan terpisah per akun, batas per paket. | Sudah ada (33 akun) | Ditambah pembatasan akun per pengguna. |
| Akun pengguna | Daftar/masuk dengan Google atau email+password, CSRF, Turnstile saat daftar, lupa password. | Ya (Fase 4) | Berbasis undangan dan peran; pendaftaran terbuka hanya di Fase 5 opsional. |
| Koneksi Threads | OAuth atau tempel token dari aplikasi Meta milik pengguna; refresh token harian. | Tidak berubah | Tetap di SukaPost. |
| Lain-lain | PWA + push notification, paket Free/Starter/Pro/Max, QRIS, afiliasi. | Hanya Fase 5 opsional | |

Saran jam dari referensi untuk audiens Indonesia (07:00, 12:00, 19:00 sampai 21:00 WIB, 3 sampai 4 kali sehari, jeda 2 sampai 3 jam, maksimal 6 kali) dipakai hanya sebagai **cadangan** saat data akun belum cukup.

---

## 3. Kondisi Saat Ini (Temuan Kode)

| Temuan | Detail | Dampak ke desain |
|---|---|---|
| Dashboard tidak pernah memanggil Threads API | Hanya menulis ke antrean lewat `dash_create_posts` (`sql/003_dashboard_rpc.sql:300-323`). Penerbit, token, insight ada di SukaPost. | Autopilot cukup menulis ke antrean yang sama. Riset lewat Threads API butuh token, jadi harus lewat SukaPost (keputusan D4). |
| Tidak ada proses latar | Tidak ada cron, worker, `instrumentation.ts`. Orkestrator mati saat tab ditutup, batas 300 detik (`src/app/api/content/orchestrate/route.ts:13`). | Perlu pelari latar baru (keputusan D1). |
| Jam ramai sudah dihitung | `dash_hour_rows` (views per jam WIB, 60 hari, paruh waktu 14 hari) dan `rankBestHours` dengan penyusutan Bayes (`src/lib/scheduling.ts:107`), cadangan jaringan (`src/lib/best-hours.ts:67-124`). | Dipakai ulang untuk memilih slot; cukup diperluas dari 3 teratas menjadi daftar terurut penuh. |
| Mesin tulis sudah ada | Profil suara, 12 sudut kreatif, gaya dari 6 posting terbaik, pembersihan, tolak mirip (Jaccard ≥ 0,8), larangan promo dan harga karangan (`src/lib/content-ai.ts`). | Dipakai ulang. Autopilot menambah ide, gerbang kualitas, dan memori performa. |
| Satu draf per akun per jalan | Orkestrator menghasilkan tepat satu draf per akun (`content-ai.ts:751`); tanpa hari target, N draf disebar satu per hari (`content-ai.ts:563, 860`). | Perencana slot baru yang menentukan 3+ slot per hari; mesin tulis dipanggil per slot. |
| Tidak ada memori belajar | Draf, sudut, dan alasan tidak disimpan; tidak ada kaitan posting ke `ThreadsPostStat`. | Tabel baru `AutopilotSlot` dan `ContentOutcome`. |
| Batas dan jeda | `CONTENT_MAX_POSTS_PER_DAY` default 6, `CONTENT_MIN_GAP_MINUTES` default 0 (`src/lib/content-config.ts:55-56`). | Autopilot punya jeda sendiri (default 150 menit); batas env tetap menjadi plafon. |
| Insight terlambat | Pengumpul SukaPost: sinkron harian 05:00 WIB, metrik posting diperbarui tiap 20 jam untuk posting berumur ≤ 3 hari. | Loop belajar berjeda minimal 1 hari. Deteksi viral cepat butuh perubahan di SukaPost (pertanyaan terbuka 2). |
| Model tenant sudah ada di DB | `Workspace`, `Membership`, `User`, `Role {ADMIN, OPERATOR}` milik SukaPost; `ThreadsAccount.workspaceId`, `ScheduledPost.workspaceId`. | Tenant = `Workspace` (keputusan D5). |
| Dashboard buta tenant | Semua RPC `dash_*` tanpa filter workspace; `dash_edit_post`, `dash_cancel_post`, `dash_retry_post` hanya memeriksa id; 10 cache proses tidak berkunci tenant; pengguna tanpa peran (`DashboardUser`). | Fase 4 menutup semuanya dan mengujinya. |
| Satu brand tertanam di kode | "Suka Shawarma" di 6 prompt, angka 32 di regex dan teks UI, WIB (+7) di 7 berkas dan di SQL. | Dipindah ke `WorkspaceSettings` di Fase 4. |

Temuan sampingan yang ikut dibereskan: `sql/apply_all.sql:457, 471` memakai `$` alih-alih `$$`; `README.md:46-50` belum menyebut `sql/001` dan `sql/004`; route chat membuang `scope.publish` (`src/app/api/bot/chat/route.ts:271, 279`); docstring `orchestrate/route.ts:18-22` sudah tidak benar; `DELETE /api/posts` menghapus permanen baris milik SukaPost tanpa cek kepemilikan dan tanpa audit (`src/app/api/posts/route.ts:192-223`).

---

## 4. Batasan Resmi Threads API (terverifikasi 2026-10-13)

| Kemampuan | Fakta dari dokumentasi Meta | Akibat |
|---|---|---|
| Pencarian kata kunci `GET /keyword_search` | `search_type` `TOP` (default, terpopuler) atau `RECENT`; `search_mode` `KEYWORD` atau `TAG`; `limit` maksimal 100; izin `threads_keyword_search`. **Tanpa persetujuan App Review, pencarian hanya atas posting milik pengguna sendiri.** Setelah disetujui, posting publik bisa dicari. | Sumber "konten viral di Threads" yang sah hanya ini, dan baru berguna setelah App Review lolos. |
| Hasil pencarian | Tidak ada angka engagement (tidak ada likes, views, replies). Hanya teks, tautan, waktu, penulis, `has_replies`, `topic_tag`. | Sinyal popularitas = urutan pada `TOP`. Tidak bisa menghitung "berapa viral". |
| Kuota pencarian | 2.200 kueri per pengguna per 24 jam bergulir, dihitung lintas aplikasi; kueri tanpa hasil tidak dihitung. | Cukup longgar; pakai satu akun pencari, bukan 33. |
| Profil publik `profile_lookup`, `profile_posts` | Izin `threads_profile_discovery`; akses standar hanya untuk akun resmi Meta; hanya profil ≥ 100 pengikut; 1.000 permintaan per 24 jam; tidak ada angka engagement per posting. | Pemantauan kompetitor baru mungkin setelah akses lanjutan. Tidak masuk lingkup awal. |
| Batas terbit | 250 posting dan 1.000 balasan per profil per 24 jam bergulir; `GET /threads_publishing_limit` melaporkan pemakaian. | 3 sampai 6 posting per hari jauh di bawah batas. |
| Insight | Hanya untuk posting milik sendiri: views, likes, replies, reposts, quotes, shares. Demografi pengikut butuh ≥ 100 pengikut. | Loop belajar hanya dari akun sendiri. |

**Mengambil data threads.net di luar API resmi (scraping, sesi login tiruan) ditolak**: melanggar ketentuan Meta dan mempertaruhkan 33 akun bisnis. Referensi sendiri juga hanya memakai API resmi.

---

## 5. Tujuan, Non-Tujuan, Metrik

### 5.1 Tujuan
- G1. Akun bermode `OTOMATIS` menerbitkan ≥ 3 posting per hari di jam ramainya tanpa satu pun klik manusia, termasuk saat tidak ada tab dashboard yang terbuka.
- G2. Setiap ide punya asal yang bisa dilacak (sinyal apa, kapan, skor berapa), dan setiap posting punya alasan pemilihan jam.
- G3. Tidak ada posting ganda dan tidak ada topik berulang dalam 50 posting terakhir akun.
- G4. Sistem berhenti sendiri saat tidak sehat (gagal beruntun, akun perlu disambung ulang, kinerja anjlok) dan memberi tahu manusia.
- G5. Hasil posting dipakai untuk memilih konten berikutnya, dan pengaruhnya terlihat di dashboard.
- G6. Beberapa pengguna dengan peran berbeda bisa memakai dashboard, dan pengguna tidak bisa melihat atau mengubah data di luar workspace dan akun yang diizinkan.

### 5.2 Non-tujuan (versi ini)
- Balas komentar otomatis dan komentar promo pertama (ada di SukaPost atau butuh perubahan penerbit).
- Foto, carousel, video dari autopilot. Autopilot hanya teks.
- Platform selain Threads.
- Menyambungkan akun Threads baru dari dashboard, pembayaran, dan paket berlangganan (Fase 5 opsional).
- Scraping di luar API resmi.

### 5.3 Metrik keberhasilan
- Kepatuhan slot: ≥ 95% hari-akun `OTOMATIS` mencapai ≥ 3 posting terbit.
- Ketepatan waktu: median selisih `tayangPada` terhadap waktu terbit ≤ 90 detik (ditentukan tick 30 detik penerbit).
- Tingkat sukses terbit ≥ 98%; posting ganda = 0.
- Lolos gerbang kualitas pada percobaan pertama ≥ 80%.
- Median views per posting autopilot tidak lebih rendah dari median 30 hari akun pada 2 minggu pertama; target +15% pada minggu ke-6.
- Intervensi manusia (edit atau batal) ≤ 10% posting pada minggu ke-4.
- Angka nyata (ms, KB, jumlah request, jumlah panggilan LLM per hari) dilaporkan di setiap ringkasan PR.

---

## 6. Keputusan Arsitektur

| # | Keputusan | Alasan | Alternatif yang ditolak |
|---|---|---|---|
| D1 | **Pelari = mesin status di DB + endpoint tick.** `POST /api/internal/autopilot/tick` dipanggil **Coolify Scheduled Task** tiap 5 menit, dilindungi `AUTOPILOT_CRON_SECRET`. | Bertahan saat restart dan deploy, bisa diamati, aman dijalankan ganda karena klaim baris memakai kunci. Ketepatan menit ditangani penerbit, jadi tick 5 menit cukup. | `setInterval` di `instrumentation.ts` (mati diam-diam, ganda bila lebih dari satu instance); pg_cron + pg_net (rahasia tersimpan di DB; dicadangkan bila Scheduled Task tidak tersedia); menaruh di SukaPost (mengikat dua repo). |
| D2 | **Terbit tetap lewat antrean bersama**, `source='DASHBOARD_AI'` tidak diubah. Penanda autopilot ada di `AutopilotSlot.postId` dan `DashboardPostLog.action='AUTOPILOT_CREATE'` dengan `userId='system:autopilot'`. | Semua RPC edit/batal/ulang dan filter Telegram bergantung pada nilai `source` itu. Halaman `/jadwal` langsung bisa mengedit dan membatalkan posting autopilot. | Nilai `source` baru (harus mengubah 8 klausa RPC dan berisiko memicu alur Telegram). |
| D3 | **Tiga mode per akun**: `MATI`, `TINJAU` (AI menulis dan memasang slot, manusia menyetujui; yang tidak disetujui sampai T-15 menit dilewati), `OTOMATIS`. | Memberi jalur naik bertahap dan tombol darurat per akun. | Satu saklar global. |
| D4 | **Sumber tren berlapis** (bagian 7.1). Lapis yang butuh token Threads dijalankan oleh pengumpul kecil di SukaPost yang menulis ke tabel bersama `TrendSignal`. | Dashboard tetap tanpa token dan tanpa kunci enkripsi. SukaPost sudah punya `keywordSearch` (`threads.service.ts:317-332`). | Menyalin kunci enkripsi ke dashboard (ditolak di PRD sebelumnya, alasannya masih berlaku). |
| D5 | **Tenant = `Workspace`.** Identitas dashboard tetap `DashboardUser`, ditambah `DashboardMembership` milik dashboard. Penegakan di parameter RPC dan konteks server, bukan RLS berbasis JWT. | Akun, outlet, dan posting sudah berkunci `workspaceId`. Aplikasi memakai service role dengan sesi sendiri; pindah ke Supabase Auth berarti menulis ulang auth. Tabel `User`/`Membership` milik SukaPost tidak disentuh. | Memakai `Membership` SukaPost langsung (mengubah skema repo lain); RLS + Supabase Auth (penulisan ulang). |
| D6 | **Konfigurasi pindah ke DB** (`WorkspaceSettings`, `AutopilotConfig`). Env tetap sebagai saklar darurat dan plafon global. | Env bersifat se-proses, tidak bisa per tenant atau per akun, dan butuh deploy untuk diubah. | Menambah variabel env per akun. |
| D7 | **Belajar dengan skor tersusut Bayes + eksplorasi kecil**, deterministik dan bisa diuji. | Konsisten dengan `rankBestHours`; data per akun tipis (3 posting per hari). | Model ML terpisah; bandit acak tanpa benih (tidak bisa diuji ulang). |
| D8 | **Autopilot hanya teks, satu posting per slot.** Rantai balasan (posting utama + 2 sampai 3 lanjutan) ditunda. | Antrean saat ini hanya menerima teks dari dashboard (`sql/003_dashboard_rpc.sql:312`); rantai butuh dukungan penerbit. | Menulis penerbit sendiri. |

```
Coolify Scheduled Task (tiap 5 menit)
   │  POST /api/internal/autopilot/tick   (x-cron-secret)
   ▼
┌──────────────── Bot_Dashboard (Next.js 16) ────────────────┐
│ RENCANA → RISET → IDE → TULIS → GERBANG → ANTRE → REKONSILIASI → BELAJAR → PENJAGA
│    │         │       │       │                │
│ AutopilotSlot  TrendSignal  ContentIdea   dash_create_posts
└──────────────────────────────────────────────┼─────────────┘
                                               ▼   (DB Supabase yang sama)
                      SukaPost: threads-publisher (tick 30 dtk) → Threads API
                      SukaPost: threads-insights (harian 05:00 WIB) → ThreadsPostStat
                      SukaPost: pengumpul tren (baru, Fase 2b) → TrendSignal
```

---

## 7. Alur Autopilot

### 7.1 Riset (sumber sinyal)

| Lapis | Sumber | Syarat | Isi sinyal | Fase |
|---|---|---|---|---|
| T1 | **Pemenang jaringan sendiri**: posting 14 hari terakhir dengan views ≥ 2× median akun pada umur yang sama | Sudah ada datanya (`ThreadsPostStat`) | Topik, sudut, format, jam, akun asal | 1 |
| T2 | **Tren pencarian Indonesia**: umpan RSS Google Trends `geo=ID` | Verifikasi keterjangkauan di Fase 0 | Kata kunci, peringkat, waktu | 2 |
| T3 | **Ringkasan tren berbasis pencarian web**: panggilan Gemini dengan grounding Google Search, per pilar konten | Butuh jalur Gemini langsung (Hermes belum tentu meneruskan tool); cek biaya di Fase 0 | Topik + alasan + tautan sumber | 2 |
| T4 | **Pencarian kata kunci Threads** `search_type=TOP`, mode `KEYWORD` dan `TAG`, untuk daftar pantau | App Review `threads_keyword_search` lolos + pengumpul di SukaPost | Teks posting teratas, urutan, tag topik | 2b |
| T5 | **Momen kalender**: tanggal gajian, akhir pekan, Ramadan, hari besar, musim hujan | Tabel `ContentMoment` diisi admin | Momen + rentang tanggal | 2 |
| T6 | **Inspirasi manual**: pengguna menempel tautan atau teks posting | Tidak ada | Pola hook dan struktur | 2 |

Aturan riset:
- Sinyal dari luar hanya dipakai sebagai **pola dan topik**, tidak pernah disalin. Teks posting orang lain tidak boleh muncul di draf; kemiripan Jaccard ≥ 0,5 terhadap sumber T4/T6 ditolak.
- Setiap sinyal punya `expiresAt` (tren: 48 jam; pemenang jaringan: 14 hari; momen: akhir rentang).
- Daftar topik sensitif (politik, SARA, bencana dan duka, klaim kesehatan, nama kompetitor) disaring sebelum menjadi ide.
- Sinyal T2 sampai T4 tanpa `workspaceId` berarti global dan bisa dipakai semua workspace; T1 dan T6 selalu milik satu workspace.

### 7.2 Ide
- Sekali sehari (05:45 WIB) dan saat bank ide akun < 2× kebutuhan harian, satu panggilan LLM per akun menghasilkan 8 kandidat: `topik`, `sudut` (dari 12 sudut yang ada), `formulaHook` (7 formula: pengakuan, pertanyaan terbuka, salah kaprah, cerita + pelajaran, daftar pendek, opini berbeda, sebelum-sesudah), `pilar`, `sinyalRujukan`.
- Skor ide = kekuatan sinyal × kecocokan brand × kebaruan × kinerja historis kombinasi (sudut, formula, pilar) akun itu. Rumus dan bobot ditulis sebagai fungsi murni dengan uji.
- Anti-ulang: `topicKey` (teks dinormalkan) tidak boleh mirip (pg_trgm ≥ 0,6) dengan 50 posting terakhir akun maupun ide yang masih aktif.
- Keragaman antar-akun: satu `topicKey` dipakai maksimal 3 akun per hari, masing-masing dengan sudut berbeda.
- Campuran pilar per akun mengikuti bobot di `AutopilotConfig.pillars` (contoh: edukasi 40, cerita 30, interaksi 20, promo 10).

### 7.3 Rencana slot (minimal 3 per hari di jam ramai)
1. Ambil daftar jam terurut penuh per akun (`rankBestHours(rows, 24)` atas `dash_hour_rows`). Bila data akun kurang, pakai jam jaringan; bila masih kurang, pakai `DEFAULT_SLOT_HOURS`.
2. Pilih serakah dari skor tertinggi dengan syarat: di dalam jendela aktif 06:00 sampai 22:59 waktu workspace, jarak antar slot ≥ `minGapMinutes` (default 150), dan mencakup minimal 2 bagian hari (pagi 06-10, siang 11-14, sore 15-17, malam 18-22).
3. **Eksplorasi**: dengan peluang `exploreRate` (default 0,15) per hari-akun, slot berskor terendah diganti jam yang paling jarang dicoba dalam 60 hari. Generator acak berbenih `accountId + dayKey` supaya hasil perencanaan ulang sama.
4. **Geser menit**: offset 0 sampai 17 menit dari hash `accountId + dayKey + slotIndex`, supaya 33 akun tidak terbit di detik yang sama.
5. Bentrok dengan antrean yang ada (SukaPost dan manual) diselesaikan dengan `resolveSlot` (langkah 15 menit).
6. Simpan ke `AutopilotSlot` dengan kunci unik `(accountId, dayKey, slotIndex)`. Perencanaan aman diulang kapan pun; cakupan: hari ini (sisa) dan besok.

Mode `JAM_TETAP` memakai `fixedHours` dari pengguna dan melewati langkah 1 sampai 3.

### 7.4 Tulis dan gerbang kualitas
- Slot ditulis saat `slotAt - sekarang ≤ 90 menit` (mode `TINJAU`: 6 jam) supaya sinyal tren masih segar.
- Penulisan memakai jalur agent yang ada dengan tambahan: ide terpilih, blok "pola yang terbukti di akun ini" dari `ContentOutcome`, knowledge base, dan override voice style.
- Gerbang, berurutan, berhenti di kegagalan pertama:
  1. Aturan yang sudah ada: panjang ≤ 450, tanpa placeholder, tidak identik dalam 7 hari, Jaccard < 0,8 terhadap 15 posting terakhir.
  2. Angka, harga, dan nama promo di draf harus ada di knowledge base (pola `answer-check.ts`).
  3. Daftar kata dan topik terlarang workspace.
  4. Kemiripan antar-akun pada hari yang sama < 0,6.
  5. Kritikus LLM (JSON: skor hook, relevansi, kesesuaian brand, daftar risiko). Ambang default 0,7.
- Gagal gerbang: satu kali tulis ulang dengan catatan kritikus. Gagal lagi: ganti ide berikutnya. Sampai T-10 menit belum ada draf lolos: slot `DILEWATI` dengan alasan, dan dihitung di metrik kepatuhan. **Tidak ada konten pengisi berkualitas rendah.**

### 7.5 Antre dan rekonsiliasi
- Draf lolos langsung dimasukkan lewat `dash_create_posts` dengan `tayangPada = slotAt` dan kunci idempotensi `autopilot:{slotId}`.
- Rekonsiliasi tiap tick membaca status `PostDispatch` untuk slot `TERANTRE` dalam satu RPC, lalu menandai `TERBIT` atau `GAGAL`.
- Posting yang diedit atau dibatalkan manusia di `/jadwal` tercermin di slot (`DIEDIT`, `DIBATALKAN`), dan dicatat untuk metrik intervensi.

### 7.6 Belajar
- Harian 06:00 WIB (setelah sinkron insight 05:00): untuk tiap posting terbit, simpan `ContentOutcome` berisi fitur (sudut, formula hook, pilar, jam, jenis slot, sumber sinyal) dan hasil (views, likes, replies, reposts pada cuplikan 24 jam dan 72 jam).
- Skor posting = log rasio views terhadap median 30 hari akun pada umur yang sama, ditambah bobot interaksi `(likes + 2×replies + 3×reposts) / views`.
- Agregat per akun per dimensi disusutkan ke rata-rata jaringan (prior = 3 posting, sama seperti `BEST_PRIOR`).
- Dipakai di: skor ide (7.2), blok prompt "pola yang terbukti", dan pemilihan jam (yang sudah berbasis views).
- **Viral**: views ≥ maks(3× median 30 hari akun, 1.000) dalam 24 jam. Akibatnya: notifikasi, ide lanjutan untuk akun yang sama di slot berikutnya, dan pola pemenang masuk bank ide jaringan (T1).

### 7.7 Penjaga (pagar otomatis)
| Kondisi | Tindakan |
|---|---|
| 3 kegagalan terbit beruntun pada satu akun | Jeda akun (`pausedReason`), notifikasi |
| Akun `NEEDS_RECONNECT`, `TOKEN_EXPIRED`, atau tidak siap | Jeda akun, slot hari itu `DILEWATI` |
| Median views 7 hari turun > 50% dibanding 7 hari sebelumnya | Turunkan ke mode `TINJAU`, notifikasi |
| Penerbit terlambat (posting `MENUNGGU` > 3 menit lewat jadwal) | Berhenti mengantre slot baru, notifikasi |
| Layanan LLM gagal 8 kali beruntun | Tick berhenti menulis sampai tick berikutnya |
| `CONTENT_PUBLISH_ENABLED` bukan `true` atau saklar workspace mati | Tidak ada yang diantre; rencana tetap dibuat |

### 7.8 Jadwal kerja tick

| Pekerjaan | Kapan | Batas |
|---|---|---|
| RENCANA | Tiap tick | 1 RPC untuk semua akun |
| RISET | Tiap 3 jam, 06:00 sampai 21:00 | ≤ 6 panggilan LLM |
| IDE | 05:45 dan saat bank ide tipis | 1 panggilan LLM per akun |
| TULIS + GERBANG | Slot dalam 90 menit ke depan | Konkurensi 6, anggaran 200 detik per tick |
| ANTRE | Setelah lolos gerbang | 1 RPC per kelompok |
| REKONSILIASI | Tiap tick | 1 RPC |
| BELAJAR | 06:00 | 1 RPC agregasi |
| PENJAGA | Tiap tick | 1 RPC |

Perkiraan beban untuk 33 akun × 3 posting: sekitar 99 penulisan + 99 kritikus + 20 tulis ulang + 33 ide + 6 riset = **kurang lebih 260 panggilan LLM per hari**, tersebar sepanjang hari karena ditulis menjelang slot.

---

## 8. Aturan Keras

1. **Dilarang** mengubah skema DB dengan Prisma atau alat migrasi apa pun. Perubahan DB hanya lewat berkas SQL aditif di `sql/` yang dijalankan manual setelah disetujui pemilik. Jangan menyentuh kolom atau tabel milik SukaPost.
2. Autopilot **tidak pernah** mengantre posting bila salah satu tidak terpenuhi: `CONTENT_PUBLISH_ENABLED=true`, saklar workspace hidup, mode akun `OTOMATIS` (atau slot `TINJAU` yang disetujui), akun siap, akun ada di `CONTENT_PUBLISH_TEST_ACCOUNTS` bila daftar itu terisi.
3. Plafon mutlak: `postsPerDay` 3 sampai 6, dan tidak pernah melebihi `CONTENT_MAX_POSTS_PER_DAY`. Jeda autopilot minimal 120 menit.
4. Endpoint tick hanya menerima `POST` dengan `x-cron-secret` yang cocok (perbandingan waktu-konstan). Pengecualian di `src/proxy.ts` hanya untuk path itu. Tanpa rahasia yang terpasang, endpoint menjawab 503.
5. Setiap langkah yang menulis harus idempoten: kunci unik slot, klaim dengan `FOR UPDATE SKIP LOCKED` + `leaseUntil`, kunci idempotensi antrean.
6. Tidak ada scraping threads.net di luar API resmi. Tidak ada teks orang lain yang disalin.
7. Promo, harga, dan klaim hanya dari knowledge base. Aturan "jangan mengarang promo" tetap berlaku.
8. Uji terbit sungguhan hanya ke akun uji yang disetujui pemilik di sesi itu. Lokal memakai data produksi (lihat catatan proyek): jalur tulis diuji dengan `rpc` tiruan.
9. Dashboard tetap tidak membaca `ThreadsAccount.accessToken`.
10. Performa: agregasi di DB, kolom eksplisit, paginasi keyset dengan urutan unik, tanpa N+1, jumlah perjalanan DB per tick tidak bergantung jumlah akun. Ukur dengan `EXPLAIN (ANALYZE, BUFFERS)` dan laporkan angka.
11. UI mengikuti `docs/superpowers/specs/2026-10-10-threads-bot-dashboard-design.md`: ikon `lucide-react`, tanpa emoji, kontrol kustom, modal konfirmasi kustom, token warna yang ada, tema gelap.
12. Setelah Fase 4: tidak ada fungsi `dash_*` yang bisa dipanggil tanpa `p_workspace`, dan tidak ada cache proses tanpa kunci workspace.

---

## 9. Data (tabel baru milik dashboard)

Semua `id` bertipe `text`, waktu bertipe `timestamp` UTC tanpa zona (mengikuti tabel yang ada), semua tabel RLS aktif tanpa policy dan hanya `service_role` yang diberi hak.

### 9.1 `sql/005_autopilot.sql`

```sql
CREATE TABLE IF NOT EXISTS "AutopilotConfig" (
  "accountId"     text PRIMARY KEY,                      -- ThreadsAccount.id
  "workspaceId"   text NOT NULL,
  mode            text NOT NULL DEFAULT 'MATI' CHECK (mode IN ('MATI','TINJAU','OTOMATIS')),
  "postsPerDay"   smallint NOT NULL DEFAULT 3 CHECK ("postsPerDay" BETWEEN 3 AND 6),
  "slotStrategy"  text NOT NULL DEFAULT 'JAM_RAMAI' CHECK ("slotStrategy" IN ('JAM_RAMAI','JAM_TETAP')),
  "fixedHours"    smallint[] NOT NULL DEFAULT '{}',
  "minGapMinutes" smallint NOT NULL DEFAULT 150 CHECK ("minGapMinutes" >= 120),
  "activeDays"    smallint[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  "exploreRate"   real NOT NULL DEFAULT 0.15 CHECK ("exploreRate" BETWEEN 0 AND 0.3),
  pillars         jsonb NOT NULL DEFAULT '[]',           -- [{key, bobot}]
  "promoRatio"    real NOT NULL DEFAULT 0 CHECK ("promoRatio" BETWEEN 0 AND 0.3),
  "voiceStyle"    text,                                  -- null = profil suara otomatis
  brief           text,                                  -- tema + deskripsi akun
  "pausedReason"  text,
  "pausedAt"      timestamp,
  "updatedBy"     text,
  "updatedAt"     timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS "AutopilotConfig_ws_mode" ON "AutopilotConfig" ("workspaceId", mode);

CREATE TABLE IF NOT EXISTS "AutopilotSlot" (
  id            text PRIMARY KEY,
  "workspaceId" text NOT NULL,
  "accountId"   text NOT NULL,
  "dayKey"      date NOT NULL,                           -- tanggal waktu workspace
  "slotIndex"   smallint NOT NULL,
  "slotAt"      timestamp NOT NULL,
  kind          text NOT NULL DEFAULT 'RAMAI',           -- RAMAI | EKSPLORASI | TREN | TETAP
  status        text NOT NULL DEFAULT 'DIRENCANAKAN',    -- lihat mesin status
  "ideaId"      text,
  draft         jsonb,                                   -- {text, topicTag, sudut, formulaHook, pilar, alasan}
  "criticScore" real,
  "postId"      text,                                    -- ScheduledPost.id
  attempt       smallint NOT NULL DEFAULT 0,
  "leaseUntil"  timestamp,
  "skipReason"  text,
  "lastError"   text,
  "createdAt"   timestamp NOT NULL,
  "updatedAt"   timestamp NOT NULL,
  UNIQUE ("accountId", "dayKey", "slotIndex")
);
CREATE INDEX IF NOT EXISTS "AutopilotSlot_kerja" ON "AutopilotSlot" ("slotAt")
  WHERE status IN ('DIRENCANAKAN','MENULIS','MENUNGGU_TINJAU','TERANTRE');
CREATE INDEX IF NOT EXISTS "AutopilotSlot_ws_hari" ON "AutopilotSlot" ("workspaceId", "dayKey", "accountId");
CREATE UNIQUE INDEX IF NOT EXISTS "AutopilotSlot_post" ON "AutopilotSlot" ("postId") WHERE "postId" IS NOT NULL;
```

Mesin status slot: `DIRENCANAKAN → MENULIS → (MENUNGGU_TINJAU) → TERANTRE → TERBIT | GAGAL`. Dari status mana pun sebelum `TERBIT` bisa ke `DILEWATI` atau `DIBATALKAN`. Transisi hanya lewat RPC bersyarat (`UPDATE ... WHERE status = <asal>`).

### 9.2 Tabel lain

| Tabel | Kolom inti | Indeks | Retensi |
|---|---|---|---|
| `TrendSignal` | `id`, `workspaceId` (null = global), `source` (JARINGAN, GTRENDS, WEB, THREADS_SEARCH, MOMEN, MANUAL), `keyword`, `title`, `summary`, `url`, `rank`, `score`, `raw` jsonb, `hash` unik, `capturedAt`, `expiresAt` | `(expiresAt)`, `(workspaceId, source, capturedAt DESC, id)` | 30 hari |
| `TrendKeyword` | `id`, `workspaceId`, `keyword`, `mode` (KEYWORD, TAG), `isActive`, `lastFetchedAt` | unik `(workspaceId, keyword, mode)` | - |
| `ContentMoment` | `id`, `workspaceId`, `nama`, `mulai`, `selesai`, `catatan` | `(workspaceId, mulai)` | - |
| `ContentIdea` | `id`, `workspaceId`, `accountId` (null = jaringan), `topik`, `topicKey`, `sudut`, `formulaHook`, `pilar`, `signalIds` text[], `score`, `scoreDetail` jsonb, `status` (BARU, DIPAKAI, DITOLAK, KEDALUWARSA), `pinnedBy`, `expiresAt`, `createdAt` | `(accountId, status, score DESC, id)`, GIN trigram pada `topicKey` | 60 hari |
| `KnowledgeBase` | `id`, `workspaceId`, `accountId` (null = seluruh workspace), `judul`, `isi`, `jenis` (FAKTA, PRODUK, PROMO, LARANGAN), `berlakuSampai`, `updatedBy`, `updatedAt` | `(workspaceId, accountId)` | - |
| `ContentOutcome` | `postId` PK, `workspaceId`, `accountId`, `slotId`, fitur (`sudut`, `formulaHook`, `pilar`, `jamLokal`, `jenisSlot`, `sumberSinyal`), `views24`, `views72`, `likes`, `replies`, `reposts`, `score`, `isViral`, `diukurPada` | `(accountId, diukurPada DESC)`, `(workspaceId, isViral) WHERE isViral` | 365 hari |
| `AutopilotRun` | `id`, `startedAt`, `finishedAt`, `durasiMs`, `hitung` jsonb (direncanakan, ditulis, diantre, dilewati, gagal, panggilanLlm), `error` | `(startedAt DESC)` | 30 hari |
| `AutopilotLease` | `name` PK, `holder`, `until` | - | - |
| `DashboardNotification` | `id`, `workspaceId`, `jenis`, `judul`, `isi`, `tautan`, `dibacaOleh` text[], `createdAt` | `(workspaceId, createdAt DESC, id)` | 90 hari |

### 9.3 Multi-user: `sql/008_multiuser.sql`

| Tabel | Kolom inti | Catatan |
|---|---|---|
| `DashboardMembership` | `userId`, `workspaceId`, `role` (OWNER, ADMIN, EDITOR, VIEWER), `accountScope` (SEMUA, PILIHAN), `createdAt`; PK `(userId, workspaceId)` | Indeks `(workspaceId)` |
| `DashboardMemberAccount` | `userId`, `workspaceId`, `accountId`; PK ketiganya | Hanya dibaca bila `accountScope='PILIHAN'` |
| `DashboardInvite` | `id`, `workspaceId`, `email`, `role`, `accountIds` text[], `tokenHash`, `expiresAt`, `acceptedAt`, `invitedBy` | Token sekali pakai, 72 jam, hanya hash yang disimpan |
| `DashboardPasswordReset` | `id`, `userId`, `tokenHash`, `expiresAt`, `usedAt` | 60 menit |
| `DashboardAuditLog` | `id`, `workspaceId`, `actor` (id pengguna atau `system:autopilot`), `action`, `target`, `detail` jsonb, `createdAt` | Indeks `(workspaceId, createdAt DESC, id)`; retensi 365 hari |
| `WorkspaceSettings` | `workspaceId` PK, `namaBrand`, `deskripsiBrand`, `zonaWaktu` (default `Asia/Jakarta`), `bahasa`, `autopilotAktif`, `maxPostsPerDay`, `topikTerlarang` text[], `akunDikecualikan` text[], `webhookNotifikasi` | Menggantikan nilai yang tertanam di kode |
| `DashboardUser` (ubah) | + `googleSub` text unik null, + `lastWorkspaceId` text null | Kolom aditif |

Migrasi data awal: satu baris `WorkspaceSettings` untuk workspace Suka Shawarma dengan nilai yang sekarang tertanam di kode, dan `DashboardMembership` peran `OWNER` untuk setiap `DashboardUser` aktif.

---

## 10. Kebutuhan Fungsional

### Autopilot
- **FR-A1 Pengaturan per akun.** Mode, jumlah posting per hari (3 sampai 6), strategi jam (jam ramai otomatis atau jam tetap), hari aktif, jeda minimal, pilar dan bobot, rasio promo, voice style, brief akun. Perubahan dicatat di audit.
- **FR-A2 Aksi massal.** Menyalakan, menjeda, atau mengganti mode untuk banyak akun sekaligus, dengan modal konfirmasi yang menyebut jumlah akun dan perkiraan posting per hari.
- **FR-A3 Rencana slot.** Sesuai 7.3. Pengguna melihat garis waktu 24 jam per akun dengan alasan tiap slot ("jam 19, views rata-rata 1,8× akun ini" atau "eksplorasi").
- **FR-A4 Radar tren.** Daftar sinyal aktif per sumber dengan waktu ambil dan kedaluwarsa; kelola daftar pantau kata kunci, momen kalender, dan inspirasi manual.
- **FR-A5 Bank ide.** Daftar ide dengan skor dan rinciannya; aksi sematkan (dipakai di slot berikutnya), tolak, dan "tulis sekarang".
- **FR-A6 Gerbang kualitas.** Sesuai 7.4. Hasil tiap pemeriksaan tersimpan di `draft` slot dan bisa dilihat.
- **FR-A7 Mode tinjau.** Kotak masuk draf menunggu persetujuan dengan aksi setujui, edit lalu setujui, tolak, ganti ide. Tidak disetujui sampai T-15 menit: dilewati.
- **FR-A8 Kendali manusia.** Posting autopilot yang sudah di antrean bisa diedit atau dibatalkan di `/jadwal` (berlabel "Autopilot"). Ada tombol "jeda semua" tingkat workspace.
- **FR-A9 Belajar.** Sesuai 7.6. Halaman performa menampilkan sudut, formula, pilar, dan jam terbaik per akun, serta perbandingan autopilot terhadap manual.
- **FR-A10 Notifikasi.** Lonceng di header (viral, akun dijeda, penerbit terlambat, slot dilewati beruntun, ringkasan harian). Opsional: webhook per workspace.
- **FR-A11 Kesehatan.** Halaman status: tick terakhir, durasi, jumlah per langkah, panggilan LLM hari ini, kepatuhan slot 7 hari, daftar kegagalan.
- **FR-A12 Knowledge base.** Kelola butir fakta, produk, promo (dengan tanggal berlaku), dan larangan, tingkat workspace atau per akun.

### Multi-user
- **FR-M1 Konteks.** Satu fungsi `requireCtx(request)` menghasilkan `{userId, workspaceId, role, accountIds | null}`. Semua route dan fungsi lib yang membaca data menerima konteks ini. Payload sesi ditambah `wid`.
- **FR-M2 Peran.**

  | Kemampuan | OWNER | ADMIN | EDITOR | VIEWER |
  |---|---|---|---|---|
  | Lihat analitik, jadwal, radar | ya | ya | ya | ya |
  | Chat AI dan buat draf | ya | ya | ya | ya |
  | Antre, edit, batal posting | ya | ya | ya | tidak |
  | Atur autopilot dan knowledge base | ya | ya | ya | tidak |
  | Jeda semua, pengaturan workspace | ya | ya | tidak | tidak |
  | Kelola anggota dan undangan | ya | ya | tidak | tidak |
  | Hapus baris statistik | ya | tidak | tidak | tidak |
  | Ubah peran OWNER, hapus workspace | ya | tidak | tidak | tidak |

  Semua kemampuan dibatasi lagi oleh `accountScope`: anggota berlingkup `PILIHAN` hanya melihat dan mengubah akun yang didaftarkan.
- **FR-M3 RPC berfilter.** Semua fungsi `dash_*` menerima `p_workspace` (wajib) dan, bila relevan, `p_account_ids`. Fungsi yang menyentuh satu posting memverifikasi `ScheduledPost.workspaceId` dan akun dispatch-nya. `scopedIds()` yang mengembalikan `undefined` = semua akun dihapus.
- **FR-M4 Keadaan proses.** Semua cache berkunci `workspaceId` (+ lingkup akun bila ada). Throttle berkunci workspace + pengguna. Pencarian replay idempotensi berkunci pengguna.
- **FR-M5 Kelola anggota.** Undang lewat email dan peran; sistem menghasilkan tautan sekali pakai yang ditampilkan untuk disalin (tanpa ketergantungan pengirim email di versi ini). Ubah peran, ubah lingkup akun, nonaktifkan. OWNER terakhir tidak bisa dihapus atau diturunkan.
- **FR-M6 Masuk dengan Google.** Authorization code + PKCE, `state` di cookie httpOnly. Hanya menautkan ke `DashboardUser` yang sudah ada atau undangan yang masih berlaku dengan email sama dan `email_verified = true`. Tidak ada pendaftaran terbuka.
- **FR-M7 Reset password.** Admin membuat tautan reset untuk anggota; pengguna juga bisa mengganti password sendiri dari halaman profil. Sesi lama gugur (mekanisme `pv` yang ada).
- **FR-M8 Audit.** Semua tindakan tulis oleh manusia dan oleh `system:autopilot` tercatat, bisa disaring per pelaku, akun, dan tindakan.
- **FR-M9 Pengaturan workspace.** Nama dan deskripsi brand, zona waktu, bahasa, plafon posting, topik terlarang, akun dikecualikan. Prompt dan teks UI membaca dari sini, bukan konstanta.
- **FR-M10 Pindah workspace.** Pemilih workspace di header untuk pengguna dengan lebih dari satu keanggotaan.
- **FR-M11 Uji isolasi.** Rangkaian uji yang memanggil setiap RPC dan setiap route dengan konteks workspace B dan memastikan tidak ada baris workspace A yang kembali atau berubah.

---

## 11. Kebutuhan Non-Fungsional

| Area | Anggaran |
|---|---|
| Tick tanpa pekerjaan LLM | ≤ 1,5 detik, ≤ 12 perjalanan DB, tidak bertambah seiring jumlah akun |
| RPC klaim slot | p95 ≤ 50 ms |
| RPC rencana (semua akun, hari ini + besok) | p95 ≤ 200 ms |
| `GET /api/autopilot/overview` | p95 ≤ 300 ms, ≤ 40 KB |
| Daftar radar, ide, audit | paginasi keyset 20 per halaman, ≤ 30 KB per halaman |
| Tulis satu slot (tulis + kritikus) | p50 ≤ 15 detik, p95 ≤ 40 detik |
| Beban browser | polling ringkasan autopilot tiap 30 detik hanya saat tab terlihat; tanpa realtime; halaman radar dan performa dimuat saat dibuka |
| Ketahanan | Tick yang terputus di tengah tidak meninggalkan slot macet: `leaseUntil` 10 menit lalu bisa diklaim ulang |
| Keamanan | Rahasia cron ≥ 32 byte acak; token undangan dan reset hanya disimpan sebagai hash; tidak ada rahasia di log |
| Biaya | Panggilan LLM per hari dan per workspace tercatat di `AutopilotRun`; ada plafon harian per workspace |

Setiap PR melampirkan hasil `EXPLAIN (ANALYZE, BUFFERS)` untuk RPC baru pada data produksi dan angka ms/KB/jumlah request sebelum dan sesudah.

---

## 12. Kontrak API (ringkas)

| Method & path | Peran minimal | Fungsi |
|---|---|---|
| `POST /api/internal/autopilot/tick` | rahasia cron | Menjalankan satu putaran; menjawab hitungan per langkah |
| `GET /api/autopilot/overview` | VIEWER | Ringkasan: mode per akun, slot hari ini, kesehatan |
| `GET, PUT /api/autopilot/accounts/[id]` | VIEWER, EDITOR | Baca dan ubah `AutopilotConfig` |
| `POST /api/autopilot/bulk` | EDITOR | Ubah mode banyak akun |
| `POST /api/autopilot/pause-all` | ADMIN | Saklar workspace |
| `GET /api/autopilot/slots?day=&accountId=` | VIEWER | Garis waktu slot |
| `POST /api/autopilot/slots/[id]/{approve,reject,rewrite,skip}` | EDITOR | Aksi mode tinjau |
| `GET, POST /api/trends/signals`, `GET, POST, DELETE /api/trends/keywords`, `GET, POST, DELETE /api/trends/moments` | VIEWER, EDITOR | Radar tren |
| `GET /api/ideas`, `POST /api/ideas/[id]/{pin,reject,write}` | VIEWER, EDITOR | Bank ide |
| `GET, POST, PATCH, DELETE /api/knowledge` | VIEWER, EDITOR | Knowledge base |
| `GET /api/autopilot/performance` | VIEWER | Agregat `ContentOutcome` |
| `GET /api/autopilot/health` | ADMIN | Riwayat tick |
| `GET /api/notifications`, `POST /api/notifications/read` | VIEWER | Lonceng |
| `GET, POST, PATCH, DELETE /api/team/members`, `POST /api/team/invites`, `POST /api/team/reset-link` | ADMIN | Anggota |
| `GET /api/auth/google`, `GET /api/auth/google/callback`, `POST /api/auth/invite/accept`, `POST /api/auth/workspace` | publik / sesi | Masuk Google, terima undangan, pindah workspace |
| `GET, PUT /api/workspace/settings`, `GET /api/audit` | ADMIN | Pengaturan dan audit |

Semua route non-internal tetap melewati sesi dan cek same-origin di `src/proxy.ts`, lalu `requireCtx` dan `requireRole`.

---

## 13. UI

| Halaman | Isi |
|---|---|
| `/autopilot` | Saklar workspace, kartu ringkas (akun aktif, slot hari ini, terbit, dilewati), tabel akun dengan mode dan garis waktu 24 jam, aksi massal |
| `/autopilot/[akun]` | Formulir pengaturan, pratinjau slot besok beserta alasannya, riwayat slot |
| `/autopilot/tinjau` | Kotak masuk draf menunggu persetujuan |
| `/radar` | Tab Sinyal, Ide, Kata Kunci, Momen, Inspirasi |
| `/autopilot/performa` | Sudut, formula, pilar, jam; autopilot dibanding manual |
| `/pengaturan` | Tab Brand, Knowledge Base, Batas, Tim, Audit, Kesehatan |
| `/jadwal` (ubah) | Label "Autopilot" pada baris, filter sumber |
| Header (ubah) | Pemilih workspace, lonceng notifikasi, nama dan peran pengguna asli |
| Sidebar dan bottom-nav (ubah) | Tambah Autopilot dan Radar; Pengaturan hanya untuk ADMIN ke atas |
| `/login` (ubah) | Tombol "Masuk dengan Google" |

---

## 14. Fase dan Kriteria Selesai

**Fase 0 — Verifikasi (tanpa kode fitur).**
Pastikan: penerbit SukaPost menyala di produksi; Coolify Scheduled Task bisa memanggil app (uji dengan endpoint tiruan); `PostDispatch` menyimpan data yang cukup untuk dicocokkan ke `ThreadsPostStat` (tautan atau id media); umpan Google Trends `geo=ID` terjangkau dari server; jalur Gemini langsung dengan grounding tersedia dan biayanya; kapasitas Hermes untuk ±260 panggilan per hari; status App Review `threads_keyword_search`.
*Selesai bila:* tiap butir punya jawaban tertulis dan bukti di ringkasan PR.

**Fase 1 — Mesin autopilot inti.**
`sql/005_autopilot.sql`, RPC klaim dan transisi, endpoint tick, pekerjaan RENCANA, TULIS, GERBANG (langkah 1 sampai 4), ANTRE, REKONSILIASI, PENJAGA; sinyal T1 saja; halaman `/autopilot`, pengaturan akun, `/autopilot/tinjau`, label di `/jadwal`. Semua tabel baru sudah berkolom `workspaceId`.
*Selesai bila:* satu akun uji berjalan 48 jam mode `TINJAU` lalu 72 jam `OTOMATIS` dengan ≥ 3 posting terbit per hari, 0 ganda, dan tick tetap bekerja tanpa tab terbuka.

**Fase 2 — Radar tren dan bank ide.**
Sinyal T2, T3, T5, T6; pekerjaan RISET dan IDE; skor ide; kritikus LLM; halaman `/radar`; knowledge base.
*Fase 2b (butuh persetujuan mengubah SukaPost dan App Review lolos):* pengumpul T4.
*Selesai bila:* ≥ 60% posting autopilot punya sinyal rujukan non-kosong dan lolos gerbang pertama ≥ 80%.

**Fase 3 — Belajar, viral, kesehatan.**
`ContentOutcome`, pekerjaan BELAJAR, blok "pola yang terbukti", deteksi viral dan ide lanjutan, notifikasi, halaman performa dan kesehatan, penurunan mode otomatis.
*Selesai bila:* skor ide berubah sesuai hasil pada data uji, dan posting viral buatan pada data uji menghasilkan notifikasi + ide lanjutan.

**Fase 4 — Multi-user.**
`sql/008_multiuser.sql`, `requireCtx`, peran, `p_workspace` di seluruh RPC, kunci cache, de-hardcode brand/zona waktu/angka akun, undangan, Google, reset, audit, pemilih workspace, pengamanan `DELETE /api/posts`, perbaikan temuan sampingan bagian 3.
*Selesai bila:* rangkaian uji isolasi FR-M11 hijau, dan pengguna VIEWER berlingkup satu akun tidak bisa melihat atau mengubah akun lain lewat UI maupun panggilan API langsung.

**Fase 5 — SaaS publik (opsional, hanya bila diminta).**
Pendaftaran terbuka + Turnstile + verifikasi email, menyambungkan akun Threads dari dashboard, paket dan batas, pembayaran, halaman kebijakan privasi/ketentuan/hapus data yang disyaratkan App Review, kuota LLM per tenant.

Urutan peluncuran produksi: 1 akun uji → 3 akun selama 7 hari → seluruh akun, dengan tombol "jeda semua" teruji di tiap tahap.

---

## 15. Kriteria Penerimaan

1. Dengan semua tab dashboard tertutup, akun `OTOMATIS` tetap terbit ≥ 3 kali per hari di slot yang direncanakan.
2. Memanggil tick dua kali bersamaan tidak menghasilkan slot atau posting ganda (diuji otomatis).
3. Mematikan `CONTENT_PUBLISH_ENABLED` atau saklar workspace menghentikan antrean baru dalam ≤ 1 tick.
4. Slot `TINJAU` yang tidak disetujui tidak pernah terbit.
5. Draf yang memuat harga atau promo di luar knowledge base ditolak gerbang (diuji dengan contoh).
6. Topik yang sama tidak muncul dua kali dalam 50 posting terakhir satu akun, dan tidak dipakai lebih dari 3 akun pada hari yang sama.
7. Akun yang `NEEDS_RECONNECT` dijeda otomatis dan memunculkan notifikasi.
8. Setiap posting autopilot bisa ditelusuri: sinyal → ide → slot → posting → hasil.
9. Endpoint tick menolak permintaan tanpa rahasia yang benar (401) dan saat rahasia belum dipasang (503).
10. Uji isolasi multi-user hijau; tidak ada fungsi `dash_*` tanpa `p_workspace`.
11. Semua anggaran bagian 11 terpenuhi dan angkanya dilaporkan.

---

## 16. Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| 33 akun satu brand memposting konten mirip secara otomatis | Terlihat sebagai jaringan spam; jangkauan turun atau akun dibatasi | Batas 3 akun per topik per hari, kemiripan antar-akun < 0,6, geser menit, mulai dari 3 posting per hari |
| App Review `threads_keyword_search` belum lolos atau ditolak | Tidak ada sinyal dari posting publik Threads | T1, T2, T3, T5, T6 cukup untuk berjalan; T4 dipasang belakangan |
| Konten tren menyentuh isu sensitif | Risiko reputasi brand | Saringan topik, kritikus, mode `TINJAU` sebagai jalur naik, jeda semua |
| Kualitas turun tanpa pengawasan | Engagement turun | Penjaga menurunkan mode saat views turun > 50%; metrik intervensi dan kepatuhan dipantau |
| Layanan LLM lambat atau kena batas | Slot dilewati | Tulis 90 menit sebelum slot, 3 percobaan lintas tick, failover model yang sudah ada, plafon harian |
| Insight terlambat ≥ 1 hari | Belajar dan deteksi viral lambat | Diterima untuk versi ini; percepatan butuh perubahan SukaPost |
| Tick ganda atau terputus | Posting ganda atau slot macet | Kunci unik, klaim `SKIP LOCKED`, lease 10 menit, kunci idempotensi antrean |
| Scheduled Task Coolify mati | Autopilot berhenti diam-diam | Penjaga di sisi baca: bila tick terakhir > 15 menit, banner dan notifikasi saat siapa pun membuka dashboard; cadangan pg_cron |
| Perubahan RPC multi-user merusak fitur yang ada | Regresi | Fase 4 terpisah, uji isolasi + uji yang ada (17 berkas vitest) harus hijau, fungsi lama diganti dalam satu berkas SQL yang bisa diulang |
| Kebocoran antar-workspace lewat cache | Data tenant lain terlihat | Aturan keras 12 + uji isolasi yang menghangatkan cache dengan workspace A lalu membaca sebagai B |
| Dua sistem identitas (`DashboardUser` dan `User` SukaPost) | Pengguna ganda | Diterima; `DashboardUser.googleSub` dan email menjadi jembatan bila kelak disatukan |

---

## 17. Pertanyaan Terbuka

1. **Arti "multi user"**: tim internal dengan peran dan pembatasan per cabang (asumsi dokumen ini, Fase 4), atau produk SaaS publik seperti ThreadsBot dengan pendaftaran terbuka dan paket berbayar (Fase 5)?
2. **Bolehkah SukaPost diubah?** Dibutuhkan untuk: pengumpul tren lewat pencarian Threads (T4), penyegaran metrik lebih cepat untuk posting berumur < 24 jam (deteksi viral cepat), rantai balasan dan komentar promo.
3. **Status App Review** untuk `threads_keyword_search` (pencarian posting publik): sudah disetujui, sedang diajukan, atau belum?
4. **Akun uji** untuk Fase 1 dan 3 akun untuk tahap kedua peluncuran.
5. **Jumlah posting per hari**: default 3 untuk semua akun, atau berbeda per akun? Plafon 6 sudah cukup?
6. **Promo**: bolehkah autopilot memposting promo (rasio berapa)? Siapa yang mengisi knowledge base (menu, harga, alamat, jam buka, promo berjalan)?
7. **Saluran notifikasi**: cukup lonceng di dashboard, atau juga Telegram / email?
8. **Kapasitas dan biaya LLM**: apakah Hermes sanggup ±260 panggilan per hari, dan berapa plafon harian yang diinginkan?
9. **Masuk dengan Google**: perlu pembatasan domain email? Siapa yang membuat OAuth client di Google Cloud?
10. **Verifikasi bagian dalam referensi**: perlu login ke app.masterpro.web.id untuk mencocokkan detail formulir autopilot, atau riset halaman publik sudah cukup?

---

## 18. Referensi

**Kode (Bot_Dashboard):** `src/lib/content-ai.ts`, `src/lib/content-orchestrator.ts`, `src/lib/auto-publish.ts`, `src/lib/scheduling.ts`, `src/lib/best-hours.ts`, `src/lib/threads-publish.ts`, `src/lib/content-config.ts`, `src/lib/gemini.ts`, `src/lib/answer-check.ts`, `src/lib/auth.ts`, `src/lib/users.ts`, `src/lib/supabase.ts`, `src/proxy.ts`, `src/app/api/content/orchestrate/route.ts`, `sql/003_dashboard_rpc.sql`, `supabase/setup.sql`.

**Kode (SukaPost, hanya dibaca):** `server/src/services/threads-publisher.service.ts`, `server/src/services/threads-insights.service.ts`, `server/src/services/threads.service.ts`, `server/prisma/schema.prisma`.

**Dokumentasi Meta Threads API:** [Keyword Search](https://developers.facebook.com/documentation/threads/keyword-search), [Threads Profiles](https://developers.facebook.com/documentation/threads/threads-profiles), [Retrieve Posts](https://developers.facebook.com/documentation/threads/retrieve-and-discover-posts/retrieve-posts), [Insights](https://developers.facebook.com/documentation/threads/insights), [Overview dan batas laju](https://developers.facebook.com/documentation/threads/overview).

**Referensi produk (halaman publik):** [landing](https://masterpro.web.id/), [autopilot](https://masterpro.web.id/blog/autopilot-threads), [posting otomatis](https://masterpro.web.id/blog/cara-posting-threads-otomatis), [jadwal posting](https://masterpro.web.id/blog/jadwal-posting-threads), [konten viral](https://masterpro.web.id/blog/cara-buat-konten-threads-viral), [voice style](https://masterpro.web.id/blog/voice-style-konten-threads), [multi akun](https://masterpro.web.id/blog/multi-akun-threads), [auto reply](https://masterpro.web.id/blog/cara-auto-reply-komentar-threads), [komentar promo](https://masterpro.web.id/blog/komentar-promo-threads), [jualan di Threads](https://masterpro.web.id/blog/cara-jualan-di-threads), [perbandingan](https://masterpro.web.id/blog/threadsbot-vs-kompetitor).

---

## 19. Status Implementasi (2026-10-13)

Dikerjakan di cabang `feat/ai-autopilot`. Belum ada yang di-commit dan belum ada posting sungguhan yang dikirim. `sql/005` sampai `sql/008` sudah dipasang di database produksi (project `nhpatcbdylkhpsifyhjb`) pada 2026-10-13 oleh pemilik lewat SQL Editor; kode yang ter-deploy masih versi lama dan tetap berjalan karena fungsi daftar antrean menerima pemanggilan gaya lama.

### 19.1 Yang sudah dibangun

| Fase | Isi | Bukti |
|---|---|---|
| 0 | Dua butir terjawab: umpan Google Trends `geo=ID` terjangkau (200, 22 KB, 181 ms), dan posting terbit bisa dicocokkan ke statistiknya lewat `PostDispatch.platformPostId = ThreadsPostStat.mediaId`. Butir lain menunggu pemilik (19.4). | Dicek langsung |
| 1 | `sql/005_autopilot.sql`; perencana slot jam ramai; gerbang kualitas; penulis slot; tick + endpoint ber-rahasia; pemulihan slot terputus; penjaga (jeda akun, gagal beruntun, penerbit telat); API dan halaman `/autopilot` (akun, tinjau, riwayat); label "Autopilot" di Jadwal. | `autopilot-plan/gate/tick/config.test.ts` |
| 2 | `sql/006_autopilot_radar.sql`; sinyal T1 (pemenang jaringan), T2 (tren pencarian), T5 (momen bawaan + kalender), T6 (inspirasi manual); bank ide dengan skor dan anti-ulang; knowledge base (fakta, produk, promo, larangan); editor AI (kritikus); halaman `/radar` (Ide, Sinyal, Momen). | `autopilot-radar.test.ts`, `radar-service.test.ts` |
| 3 | `sql/007_autopilot_learning.sql`; hasil posting dan skor terhadap kebiasaan akun; pola terbukti masuk ke prompt dan skor ide; deteksi viral + ide lanjutan; turun mode saat views anjlok; notifikasi (lonceng di header); ringkasan performa dan kesehatan di `/pengaturan`. | `autopilot-learning.test.ts` |
| 4 | `sql/008_multiuser.sql`; kelompok workspace (tenant), keanggotaan, empat peran, lingkup akun; lingkup tenant di titik akses data; semua route fitur lewat `withCtx`; undangan, reset password, ganti password, masuk dengan Google, pindah workspace, pengaturan workspace, audit; brand di prompt mengikuti workspace; halaman `/pengaturan` (Brand, Pengetahuan, Tim, Audit, Kesehatan), `/undangan/[token]`, `/reset-password/[token]`, menu akun dan pemilih workspace di header. | `multiuser.test.ts`, `workspace-group.test.ts` |

Angka terukur (Postgres in-memory dengan SQL asli, 33 akun; bukan angka produksi):

- 27 berkas uji, 368 uji, semuanya lulus (7,3 detik). `tsc` bersih. `eslint` bersih untuk semua berkas baru dan yang ditulis ulang; 5 galat dan 4 peringatan yang tersisa ada di 6 berkas lama yang tidak disentuh pekerjaan ini (tema, grafik mingguan, filter periode, dua halaman lama).
- Build produksi lulus dalam 13 detik. `/login` dan dua halaman bertoken di-prerender sebagian (cangkang statis, isi mengalir saat permintaan); halaman lain statis.
- JavaScript klien per rute di luar kerangka bersama (74,0 KB gzip), dihitung dari chunk yang dirujuk manifest tiap halaman: `/radar` 19,6 KB gzip (59,9 KB mentah), `/pengaturan` 30,0 KB (97,5 KB), `/autopilot` 24,5 KB (83,4 KB), `/undangan/[token]` 4,2 KB, `/reset-password/[token]` 2,0 KB, `/login` 2,5 KB.
- Tick sepi: 10 perjalanan database, tidak bertambah seiring jumlah akun (anggaran 12). Tick pertama yang merencanakan 99 slot dan menjalankan riset: 19.
- Ringkasan autopilot 33 akun dengan 198 slot (setelan maksimum 6 posting per hari, dua hari): 80,2 KB mentah, 7,3 KB setelah gzip.
- Tiap tab di `/radar` dan `/pengaturan` memuat datanya satu kali saat pertama dibuka (1 permintaan; daftar akun dibagi lewat satu cache). Simpan, hapus, sematkan, undang, dan sejenisnya masing-masing 1 permintaan lalu daftar diperbarui di tempat, kecuali menambah inspirasi manual (1 permintaan tambahan untuk memuat halaman pertama). Jumlah akun di sidebar ikut balasan `/api/auth/me`, jadi tidak menambah permintaan.
- 68 fungsi SQL baru atau diubah, semuanya `SECURITY DEFINER` dan hanya bisa dipanggil `service_role`; 17 tabel baru ber-RLS dan tertutup untuk `anon`/`authenticated`. Semua berkas SQL aman dijalankan ulang, termasuk menjalankan ulang berkas lama setelah `sql/008`.

### 19.2 Yang berbeda dari rancangan di atas

| Rancangan | Yang dibangun | Alasan |
|---|---|---|
| Satu workspace SukaPost = satu workspace dashboard | **Tenant = kelompok workspace** (`DashboardWorkspaceGroup`). Saat pertama dipasang, semua workspace yang sudah punya akun Threads menjadi satu tenant; workspace yang dibuat belakangan tidak otomatis bergabung dan tidak otomatis diberi pemilik. | Database produksi berisi 40 akun (33 saat dirancang) di 3 workspace milik organisasi yang sama dan 1 pengguna dashboard. Tanpa kelompok, pengguna itu harus berpindah-pindah workspace dan angka jaringan terpecah tiga. Cara menggabungkan workspace baru ada di README. |
| Semua fungsi `dash_*` wajib `p_workspace` (FR-M3, aturan keras 12) | Lingkup ditegakkan per **akun** di titik akses data pusat (`accountScope`, `scopedIds`, `excludedIdList`, `listPublishAccounts`) lewat `AsyncLocalStorage`, plus `p_account_ids` di fungsi daftar antrean. Fungsi baru (autopilot, radar, tim) memang menerima `p_workspace`. | Fungsi analitik lama sudah menerima `p_ids`; satu akun hanya milik satu tenant, jadi lingkup akun mencakup lingkup tenant tanpa mengubah 25 tanda tangan fungsi yang dipakai kode produksi lama. Isolasinya diuji lewat route asli. |
| Anti-ulang topik dengan `pg_trgm` | Kemiripan dihitung di server (Jaccard atas kata bermakna) | Tidak perlu memasang ekstensi database; datanya puluhan baris per akun. |
| Viral dalam 24 jam | Dinilai selama posting berumur sampai 4 hari | Metrik sumber diperbarui kira-kira tiap 20 jam, jadi jendela 24 jam hampir tidak pernah terisi. |
| Halaman `/autopilot/tinjau` dan `/autopilot/[akun]` | Tab "Tinjau" dan modal pengaturan di halaman `/autopilot` | Satu halaman, satu kali muat data. |
| `WorkspaceSettings.zonaWaktu`, `maxPostsPerDay`, `webhookNotifikasi` | Belum ada; zona waktu tetap WIB | Mengganti WIB berarti mengubah SQL jam ramai yang dipakai fitur lama. Perlu diputuskan dulu apakah akan ada workspace di luar WIB. |
| Tabel `TrendKeyword` | Tidak dibuat | Hanya berguna untuk T4, yang belum dikerjakan. |
| Pengirim email undangan/reset | Tautan ditampilkan sekali untuk disalin admin | Sesuai catatan FR-M5; belum ada layanan email. |
| Tombol Google berlogo | Tombol teks "Masuk dengan Google" | Aturan UI proyek: ikon hanya dari lucide, yang tidak memuat logo merek. |

### 19.3 Yang belum dikerjakan

- **T3 (tren web dengan grounding Gemini)** dan **T4 (pencarian kata kunci Threads)**. T4 menunggu izin mengubah SukaPost dan App Review; T3 menunggu kepastian biaya dan apakah model yang dipakai mendukung grounding.
- **Rantai balasan dan komentar promo pertama** (butuh dukungan penerbit SukaPost).
- **Fase 5 (SaaS publik)**: pendaftaran terbuka, paket, pembayaran. Akibatnya tenant baru dan pemilik pertamanya masih dibuat lewat SQL (lihat README).
- **Perbaikan route chat** yang membuang `scope.publish`: tidak disentuh karena mengubahnya berarti chat bisa memposting ke banyak akun dari satu kalimat; perlu keputusan pemilik.
- **Masuk dengan Google belum pernah dijalankan terhadap Google sungguhan** (belum ada `GOOGLE_CLIENT_ID`); yang teruji hanya pembantu murninya dan tampilan pesan galatnya.
- **Riwayat tick di tab Kesehatan bersifat global** (satu penjadwal melayani semua tenant): angka agregatnya terlihat oleh Admin tenant mana pun. Tidak memuat isi konten, tetapi perlu dipisah per tenant sebelum ada organisasi kedua.
- **Halaman yang butuh sesi belum dilihat di browser** pada sesi pengerjaan ini (tidak ada kredensial uji dan `localhost` terhubung ke database produksi). Yang sudah diperiksa: `tsc`, `eslint`, build produksi, dan halaman publik (masuk, undangan, reset) lewat permintaan GET.

### 19.4 Langkah pemilik sebelum menyala

1. ~~Jalankan `sql/005` sampai `sql/008`~~ Selesai 2026-10-13. Diverifikasi lewat API: 17 tabel dan 65 fungsi baru ada; tabel baru tidak bisa dibaca langsung bahkan oleh `service_role` (hanya lewat fungsi `dash_*`); pemanggilan gaya lama `dash_post_list`/`dash_post_summary`/`dash_posts_by_ids` tetap berjalan (46-67 ms); fungsi baca baru 39-145 ms per panggilan dari mesin lokal.
2. ~~Periksa kelompok workspace~~ Selesai: 3 workspace (24, 13, dan 3 akun) menjadi satu tenant "Suka Shawarma", dan pengguna `admin` menjadi Pemilik. Belum ada akun yang autopilot-nya menyala.
3. Pasang `AUTOPILOT_CRON_SECRET` di Coolify dan buat Scheduled Task tiap 5 menit (perintahnya ada di README).
4. Deploy, lalu buka `/autopilot`: peringatan "penjadwal belum berjalan" harus hilang dalam 5 menit.
5. Batasi dulu dengan `CONTENT_PUBLISH_TEST_ACCOUNTS`, nyalakan satu akun di mode **Tinjau dulu** selama 48 jam, baru naikkan ke **Otomatis** (bagian 14).
6. Isi Pengaturan > Brand dan Pengaturan > Pengetahuan (menu, harga, jam buka, promo berjalan) sebelum mengaktifkan porsi promo.
