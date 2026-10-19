This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Posting AI ke Threads (Jadwal)

Asisten AI merekomendasikan draf Threads siap posting per akun cabang. Pengguna memilih **Posting sekarang** atau **Jadwalkan** (WIB). Dashboard hanya **menulis ke antrean bersama** (`ScheduledPost` dengan `source='DASHBOARD_AI'` + `PostDispatch` dengan `publisher='THREADS'`); worker `threads-publisher` di repo auto-suka yang menerbitkan. Dashboard tidak menyimpan token Threads. Di alur ini AI tidak memposting tanpa klik pengguna; posting tanpa klik hanya terjadi untuk akun yang autopilot-nya dinyalakan (lihat bagian Autopilot di bawah).

Akses data memakai `supabase-js` (service role, hanya di server). Penulisan antrean dan query kompleks dilakukan lewat fungsi RPC `SECURITY DEFINER` (`dash_*`), sehingga service role tidak butuh GRANT langsung ke tabel milik auto-suka.

### Setup database (sekali, oleh pemilik)

Jalankan berurutan di SQL Editor Supabase (aditif, idempoten, tidak mengubah/menghapus data):

1. `sql/001_dashboard_user.sql` (tabel pengguna login `DashboardUser`)
2. `supabase/setup.sql` (grant + fungsi agregasi analitik)
3. `sql/002_dashboard_post_log.sql` (tabel audit `DashboardPostLog`)
4. `sql/003_dashboard_rpc.sql` (fungsi RPC penjadwalan/antrean)
5. `sql/004_dashboard_chat_insights.sql` (statistik per akun untuk asisten AI; opsional, hanya menghemat bandwidth)

Env wajib: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### Variabel lingkungan fitur

| Variabel | Default | Fungsi |
| --- | --- | --- |
| `CONTENT_PUBLISH_ENABLED` | mati | Kill switch. Selama bukan `true`, semua endpoint tulis membalas 403 dan tombol Posting/Jadwalkan dinonaktifkan. |
| `CONTENT_PUBLISH_TEST_ACCOUNTS` | kosong | Daftar id atau username akun Threads (dipisah koma) yang boleh diposting. Kosong berarti tanpa pembatasan akun. |
| `CONTENT_MAX_POSTS_PER_DAY` | `6` | Batas posting per akun per hari (WIB). |
| `CONTENT_MIN_GAP_MINUTES` | `0` | Jarak minimum antar posting pada akun yang sama (`0` = tanpa batas). |
| `HERMES_API_KEY` | - | Kunci router AI (9Router). Tanpa ini semua panggilan AI langsung memakai Gemini. |
| `HERMES_BASE_URL` | `http://$HERMES_HOST:$NINE_ROUTER_PORT/v1` | Alamat router AI bergaya OpenAI. |
| `HERMES_MODELS` | `hermes-combo` | Model router, dipisah koma, dicoba berurutan. |
| `GEMINI_API_KEY` | - | Cadangan bila router gagal (sisi server saja). |
| `ORCHESTRATE_CONCURRENCY` | `10` | Jumlah agen Multi-Agent Orchestrator yang berjalan serentak (1-16). |

### Tes

```bash
npm test
```
## Autopilot konten (AI menulis dan menjadwalkan sendiri)

Spesifikasi lengkap: `PRD-AI-AUTOPILOT-MULTIUSER.md`. Untuk akun yang autopilot-nya dinyalakan, AI merencanakan minimal 3 slot per hari di jam ramai akun itu (dihitung dari data views), menulis draf menjelang tayang, memeriksanya, lalu memasukkannya ke antrean yang sama dengan posting manual. Penerbitan tetap dikerjakan worker `threads-publisher` di auto-suka; dashboard tetap tidak memegang token Threads.

Tiga mode per akun: **Mati**, **Tinjau dulu** (AI menulis, manusia menyetujui; yang tidak disetujui 15 menit sebelum tayang dilewati), dan **Otomatis**. Posting autopilot tampil di halaman Jadwal dengan label "Autopilot" dan tetap bisa diubah atau dibatalkan.

### Halaman

| Halaman | Isi |
| --- | --- |
| `/autopilot` | Mode dan jumlah posting per akun, jadwal hari ini, draf yang menunggu tinjauan, riwayat, tombol jeda semua |
| `/radar` | Bank ide (sematkan atau tolak), sinyal tren beserta inspirasi manual, kalender momen |
| `/pengaturan` | Brand, pengetahuan untuk AI (fakta, produk, promo, larangan), tim dan undangan, audit, kesehatan penjadwal dan hasil belajar |
| `/undangan/<token>`, `/reset-password/<token>` | Halaman publik dari tautan sekali pakai yang dibuat Admin |

Notifikasi (posting viral, akun dijeda, mode diturunkan, penerbit terlambat) muncul di lonceng header. Menu akun di pojok kanan atas memuat pindah workspace, ganti password, dan keluar.

### Setup database (sekali, oleh pemilik)

Jalankan berurutan di SQL Editor Supabase setelah `sql/002` dan `sql/003`. Semua aditif dan aman diulang. Tiap berkas boleh dipasang bertahap: tanpa berkas berikutnya, fitur yang bergantung padanya mati dengan sendirinya dan sisanya tetap berjalan.

| Berkas | Isi | Tanpa berkas ini |
| --- | --- | --- |
| `sql/005_autopilot.sql` | Kelompok workspace (tenant), pengaturan per akun, slot, riwayat tick, audit | Halaman Autopilot menampilkan pesan "belum dipasang"; tick menjawab 503 |
| `sql/006_autopilot_radar.sql` | Radar tren, bank ide, knowledge base, momen kalender | Autopilot menulis tanpa ide dan tanpa knowledge base |
| `sql/007_autopilot_learning.sql` | Hasil posting, deteksi viral, notifikasi | Tidak ada loop belajar dan notifikasi |
| `sql/008_multiuser.sql` | Keanggotaan workspace, peran, undangan, reset password | Semua pengguna aktif tetap berperan Pemilik atas semua akun (perilaku lama) |
| `sql/009_signup.sql` | Pendaftaran mandiri (akun + workspace baru) | Tombol daftar menjawab "belum siap di server" |
| `sql/011_plans.sql` | Paket langganan dan batasnya; batas bawah posting per hari turun dari 3 ke 1 | Tidak ada paket; semua workspace tanpa batas |
| `sql/010_superadmin.sql` | Super admin sistem: blokir pengguna, tangguhkan workspace, tautkan sumber akun, saklar platform, audit platform | Tidak ada super admin; panel `/admin` menjawab "belum dipasang" |
| `sql/012_billing_and_integrations.sql` | Tagihan langganan (pelunasan atomik) dan penyimpanan kunci integrasi dari panel `/admin` | Pembayaran online mati; kunci Google/Threads hanya bisa diisi lewat env |
| `sql/017_midtrans.sql` | Pembayaran via Midtrans Core API: kunci Midtrans di panel, instruksi bayar per tagihan, ganti metode, pencocokan status oleh penjadwal | Paket berbayar ditolak dengan petunjuk memasang file ini; paket gratis tetap jalan |
| `sql/013_fix_dashboard_user_id.sql` | Default `id` untuk `DashboardUser` (tabel dibuat Prisma tanpa default database) | Daftar akun baru (Google, `/daftar`, terima undangan) gagal dengan 23502 `null value in column "id"` |

`sql/008` mengganti tiga fungsi daftar antrean (`dash_post_list`, `dash_posts_by_ids`, `dash_post_summary`) dengan versi berparameter tambahan yang bernilai bawaan, jadi aman dipasang sebelum maupun sesudah kode baru di-deploy.

### Penjadwal (wajib supaya autopilot berjalan)

Autopilot digerakkan satu endpoint yang dipanggil tiap 5 menit. Di Coolify, buka aplikasi `wargi-dashboard` > Scheduled Tasks > tambah tugas:

- Frequency: `*/5 * * * *`
- Command:

```bash
node -e "fetch('http://127.0.0.1:3000/api/internal/autopilot/tick',{method:'POST',headers:{'x-cron-secret':process.env.AUTOPILOT_CRON_SECRET}}).then(async r=>{console.log(r.status,(await r.text()).slice(0,300));process.exit(r.ok?0:1)})"
```

Coolify membatasi perintah tugas terjadwal maksimal 255 karakter; perintah di atas 236 karakter. Riset tren (Radar > Tren Viral) tetap berjalan walau `CONTENT_PUBLISH_ENABLED` mati; bank ide (memakai AI) hanya diisi saat posting menyala.

Endpoint itu hanya menerima `POST` dengan rahasia yang benar (401 bila salah, 503 bila `AUTOPILOT_CRON_SECRET` belum dipasang). Aman dipanggil ganda: tick kedua langsung selesai. Halaman Autopilot menampilkan peringatan bila tick terakhir lebih dari 15 menit yang lalu.

### Penerbit Threads (wajib supaya antrean terbit)

Database BotThreads tidak dibaca worker auto-suka, jadi dashboard menerbitkan antreannya sendiri (`src/lib/threads-publisher.ts`, fungsi SQL di `sql/022_threads_publisher.sql`). Tambah Scheduled Task kedua dengan Frequency `* * * * *` dan perintah yang sama, ganti path menjadi `/api/internal/publisher/tick`. Hanya postingan `DASHBOARD_AI` teks yang diterbitkan; yang belum diproses lebih dari 2 jam setelah jam tayang ditandai gagal, bukan diterbitkan terlambat. Token dibaca dengan `TOKEN_ENCRYPTION_KEY` dan diperpanjang otomatis bila tersisa kurang dari 7 hari.

Putaran yang sama juga **membalas komentar otomatis** (`src/lib/threads-replies.ts`, SQL di `sql/023_threads_replies.sql`): komentar postingan 7 hari terakhir diambil berkala (tiap 2 menit di 24 jam pertama), dibalas AI dengan jeda 20 detik per akun dan maksimal 100 balasan per akun per hari. Spam, promosi akun lain, dan komentar kasar dilewati. Bawaannya menyala untuk akun bermode Otomatis; saklar per akun ada di Autopilot > Komentar. Akun Threads butuh izin `threads_read_replies` dan `threads_manage_replies`.

### Variabel lingkungan

| Variabel | Default | Fungsi |
| --- | --- | --- |
| `AUTOPILOT_CRON_SECRET` | - | Rahasia pemanggil tick, minimal 32 karakter acak (`npm run auth:secret` bisa dipakai membuatnya). |
| `AUTOPILOT_MAX_PER_TICK` | `12` | Slot yang ditulis per tick. |
| `AUTOPILOT_CONCURRENCY` | `6` | Penulisan serentak antar akun. |
| `AUTOPILOT_CRITIC` | nyala | `false` mematikan penilaian editor AI (pemeriksaan aturan tetap berjalan). |
| `AUTOPILOT_BANNED_TERMS` | kosong | Kata/frasa terlarang tambahan untuk semua workspace, dipisah koma. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | - | Mengaktifkan tombol "Masuk dengan Google". |
| `APP_URL` | dari header proxy | Asal publik aplikasi untuk alamat kembali Google, Threads, dan notifikasi Midtrans, mis. `https://wargi.sukashawarma.com`. Daftarkan `<APP_URL>/api/auth/google/callback` di Google Cloud. |
| `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`, `MIDTRANS_MERCHANT_ID`, `MIDTRANS_IS_PRODUCTION` | - | Pembayaran paket via Midtrans Core API. `MIDTRANS_IS_PRODUCTION=true` untuk uang sungguhan. Bisa juga diisi di `/admin` tab Integrasi (nilai panel menang atas env). |
| `THREADS_APP_ID`, `THREADS_APP_SECRET` | - | Tombol "Login dengan Threads" untuk pelanggan. Bisa juga diisi di panel. |
| `TOKEN_ENCRYPTION_KEY` | `META_APP_SECRET` | **Wajib sama dengan worker auto-suka.** Kunci enkripsi token Threads; tanpa ini akun tidak bisa dihubungkan dari dashboard. |

`CONTENT_PUBLISH_ENABLED` tetap menjadi saklar darurat: selama bukan `true`, autopilot hanya menyusun rencana dan tidak menulis atau mengantre apa pun. `CONTENT_PUBLISH_TEST_ACCOUNTS` juga berlaku, jadi uji coba bisa dibatasi ke akun tertentu.

### Pagar pengaman

- Gerbang kualitas sebelum antre: panjang dan kelengkapan teks, harga/persen/kata promo hanya bila ada di fakta akun atau knowledge base, topik sensitif dan kata terlarang, tidak kembar dengan akun lain hari itu, lalu penilaian editor AI.
- Satu slot tidak bisa menghasilkan dua posting (kunci idempotensi `autopilot:<slotId>`, klaim baris dengan lease, pemulihan slot yang terputus).
- Akun dijeda otomatis bila tidak siap diposting atau tiga posting terakhir gagal; mode diturunkan ke Tinjau bila views seminggu turun lebih dari separuh; penulisan berhenti selama penerbit terlambat.
- Sumber tren hanya yang sah: data jaringan sendiri, umpan tren pencarian Google Indonesia, momen kalender, dan inspirasi yang ditempel pengguna. Tidak ada pengambilan data threads.net di luar API resmi.

## Multi-user

Setelah `sql/008_multiuser.sql` dipasang, akses dibatasi per workspace dan per akun:

| Peran | Lihat | Buat draf | Antre, edit, batal, atur autopilot | Jeda semua, pengaturan workspace, kelola tim | Hapus baris statistik |
| --- | --- | --- | --- | --- | --- |
| Pemilik | ya | ya | ya | ya | ya |
| Admin | ya | ya | ya | ya | tidak |
| Editor | ya | ya | ya | tidak | tidak |
| Pengamat | ya | ya | tidak | tidak | tidak |

Anggota bisa dibatasi ke akun tertentu saja. Pembatasan ditegakkan di titik akses data (akun di luar lingkup diperlakukan seperti tidak ada), bukan hanya disembunyikan di tampilan; ini diuji di `src/lib/__tests__/multiuser.test.ts`.

Anggota baru masuk lewat undangan: Admin membuat tautan undangan (berlaku 72 jam, sekali pakai) di Pengaturan > Tim dan mengirimkannya sendiri; belum ada pengirim email. Reset password juga lewat tautan yang dibuat Admin (60 menit, sekali pakai). Skrip `npm run user:create` tetap berfungsi untuk membuat pengguna pertama, tetapi pengguna itu baru punya akses setelah menjadi anggota workspace.

### Workspace dashboard = kelompok workspace SukaPost

Satu organisasi bisa punya beberapa workspace di SukaPost (auto-suka). Di dashboard, beberapa workspace itu dikelola sebagai **satu** workspace (tenant) lewat tabel `DashboardWorkspaceGroup` (`workspaceId` -> `groupId`, yaitu id workspace pemimpin kelompok). Kolom `workspaceId` di semua tabel milik dashboard berisi id tenant itu; antrean posting tetap ditulis ke workspace asli pemilik akunnya.

- **Saat `sql/005` pertama dipasang**, semua workspace yang sudah punya akun Threads dijadikan satu kelompok, dipimpin workspace dengan akun terbanyak. Anggapannya: data yang sudah ada milik satu organisasi. Periksa hasilnya dengan `SELECT * FROM "DashboardWorkspaceGroup";` dan ubah isinya bila anggapan itu tidak tepat.
- **Saat `sql/008` pertama dipasang** (tabel keanggotaan masih kosong), setiap pengguna dashboard yang aktif menjadi Pemilik tenant itu.
- **Workspace SukaPost yang dibuat belakangan tidak otomatis bergabung** dan tidak otomatis punya pemilik, supaya pengguna lama tidak mendadak menguasai organisasi lain. Akun-akunnya belum tampil di dashboard sampai salah satu langkah ini dijalankan di SQL Editor:

```sql
-- Gabungkan ke tenant yang sudah ada (ganti kedua id):
INSERT INTO "DashboardWorkspaceGroup" ("workspaceId", "groupId") VALUES ('<id workspace baru>', '<id tenant>');

-- ATAU jadikan tenant terpisah dengan pemilik pertamanya:
INSERT INTO "DashboardMembership" ("userId", "workspaceId", role) VALUES ('<id DashboardUser>', '<id workspace baru>', 'OWNER');
```

Perubahan kelompok berlaku paling lambat 60 detik kemudian (cache server). Pengguna yang menjadi anggota lebih dari satu workspace memilihnya dari menu akun di pojok kanan atas.

### Super admin sistem

Di atas empat peran workspace ada satu peran tingkat platform: **super admin** (`sql/010_superadmin.sql`). Panelnya di `/admin` dan hanya tampil di menu untuk super admin.

| Bagian | Yang bisa dilakukan |
| --- | --- |
| Ringkasan | Jumlah pengguna, workspace, akun, keadaan autopilot dan penjadwal |
| Pengguna | Cari dan saring semua pengguna; blokir (wajib alasan) dan buka blokir; keluarkan dari semua perangkat; buat tautan reset password; beri atau cabut peran super admin |
| Workspace | Lihat semua workspace dan anggotanya; tangguhkan (anggota kehilangan akses, autopilot berhenti) dan pulihkan; tambah, ubah, atau keluarkan anggota |
| Sumber akun | Tautkan workspace SukaPost (tempat akun Threads berada) ke workspace dashboard, supaya akunnya tampil di sana |
| Sistem | Buka/tutup pendaftaran mandiri, saklar darurat autopilot untuk semua workspace, pengumuman di atas dashboard |
| Audit | Semua tindakan super admin: siapa, apa, terhadap siapa, kapan |

Pengaman yang ditegakkan di database, bukan hanya di tampilan:

- Setiap fungsi yang mengubah data memeriksa sendiri bahwa pelakunya super admin aktif, dan mencatat tindakannya.
- Super admin tidak bisa memblokir dirinya sendiri, tidak bisa memblokir sesama super admin (cabut dulu perannya), dan super admin terakhir tidak bisa dicabut.
- Blokir menggugurkan semua sesi pengguna itu; pesan "diblokir" di halaman masuk hanya muncul setelah password benar.

Saat `sql/010` pertama dipasang, pengguna aktif **tertua** menjadi super admin. Pemasangan ulang tidak menambah super admin baru; sesudahnya peran itu diberikan dari panel. Blokir, penangguhan, dan saklar berlaku paling lambat 30 detik kemudian (cache server); di proses yang menerima tindakannya berlaku seketika.

### Paket langganan

Paket adalah data yang diisi super admin di `/admin` tab **Paket** (`sql/011_plans.sql`); tidak ada paket atau harga bawaan di kode. Tiap paket menentukan:

| Batas | Artinya | Ditegakkan di |
| --- | --- | --- |
| Akun | Jumlah akun Threads yang autopilot-nya boleh menyala bersamaan | Saat menyimpan pengaturan autopilot |
| Posting per akun per hari | 1 sampai 6 | Saat menyimpan pengaturan autopilot; pilihan di layar ikut dibatasi |
| Anggota tim | Termasuk undangan yang belum diterima | Saat mengundang |
| Mode Otomatis | Bila tidak, hanya Tinjau dulu | Saat menyimpan pengaturan autopilot |

Aturan pemakaian:

- Workspace tanpa paket sendiri mengikuti **paket bawaan** platform. Tanpa paket bawaan, workspace itu tanpa batas (perilaku sebelum `sql/011`). Supaya workspace internal tidak ikut dibatasi saat paket bawaan dipasang, buat satu paket longgar yang tidak publik lalu pasang ke workspace itu.
- Paket yang **habis masa berlakunya** menghentikan autopilot workspace itu sampai diperpanjang. Datanya tetap bisa dibuka, dan mematikan autopilot selalu boleh.
- Mengubah paket tidak mematikan autopilot yang sudah berjalan di atas batas baru; batasnya ditegakkan pada perubahan berikutnya.
- **Pembayaran lewat Midtrans** (`sql/012` + `sql/017`). Pelanggan memilih paket dan metode bayar di Pengaturan > Langganan, nomor VA / QR / tombol e-wallet tampil di halaman aplikasi sendiri (tanpa Snap), dan paket aktif otomatis setelah lunas. Perpanjangan paket yang sama ditambahkan dari tanggal berakhirnya. Super admin tetap bisa memasang paket manual dari tab Workspace atau menandai tagihan lunas dari tab Transaksi.

### Pembayaran (Midtrans Core API)

1. Pasang `sql/012_billing_and_integrations.sql` lalu `sql/017_midtrans.sql`.
2. Dashboard Midtrans > Settings > Access Keys: salin Merchant ID, Client Key, dan Server Key. Kunci sandbox dan production berbeda.
3. Isi di `/admin` tab Integrasi, pilih Sandbox atau Production, dan centang metode bayar yang sudah aktif di akun Midtrans (QRIS, GoPay, ShopeePay, BCA/BNI/BRI/Permata/CIMB VA, Mandiri Bill).
4. Dashboard Midtrans > Settings > Configuration > Payment Notification URL: isi `<APP_URL>/api/billing/webhook`. Charge juga mengirim header `X-Append-Notification` ke URL itu bila aplikasi berjalan di https.

Notifikasi hanya pemicu: `signature_key` dicek, lalu status dan nominal selalu diambil ulang dari API Midtrans memakai server key, jadi notifikasi palsu tidak bisa mengaktifkan paket. Notifikasi ganda tidak memperpanjang dua kali. Ganti metode mematikan transaksi lama (order `<id tagihan>-2`, `-3`, ...). Layar bayar mengecek status tiap 8 detik, dan penjadwal mencocokkan tagihan menunggu tiap tick, jadi di localhost (notifikasi tidak sampai) pembayaran tetap terdeteksi. Uji sandbox dibayar lewat https://simulator.sandbox.midtrans.com.

### Hubungkan akun Threads (pelanggan)

Pelanggan menghubungkan akunnya di Pengaturan > Akun Threads, lewat "Login dengan Threads" (butuh Threads App ID + Secret, dan `<APP_URL>/api/threads/oauth/callback` terdaftar di Meta App > Threads API > Redirect Callback URLs; Meta mewajibkan https) atau dengan menempel Access Token. Token disimpan terenkripsi dengan format worker auto-suka, dan akun otomatis dipetakan ke cabang + SocialAccount supaya worker bisa memposting. Panel Integrasi menunjukkan apakah `TOKEN_ENCRYPTION_KEY` cocok dengan token yang disimpan worker.

Paket yang aktif dan publik tampil di halaman perkenalan (bagian "Paket"); bila belum ada, bagian itu tidak muncul. Anggota melihat paket dan pemakaian workspace-nya di halaman Pengaturan.

### Masuk dengan Google

Opsional. Pasang `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, dan `APP_URL`, lalu daftarkan `<APP_URL>/api/auth/google/callback` sebagai Authorized redirect URI di Google Cloud. Tombolnya baru muncul di halaman masuk setelah dua variabel pertama terpasang. Google hanya membuktikan email: yang bisa masuk tetap hanya akun yang sudah terdaftar, atau pemegang undangan yang masih berlaku untuk email yang sama. Tidak ada pendaftaran terbuka.
