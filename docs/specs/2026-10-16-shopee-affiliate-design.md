# Shopee Affiliate di Autopilot Threads — Desain

Tanggal: 2026-10-16 · Status: dikerjakan 2026-10-16 (menunggu sql/019 dipasang dan worker di-deploy)

## Tujuan

Akun Threads yang dijalankan autopilot sesekali menerbitkan postingan yang merekomendasikan produk
Shopee Affiliate. Postingannya harus terasa natural, mengikuti niche dan gaya akun. Fitur bisa
dinyalakan atau dimatikan per akun, dan semua angka frekuensi diatur sendiri oleh user.

## Keputusan

| Hal | Keputusan |
|---|---|
| Katalog produk | Per **niche**: satu katalog per tag niche, dipakai bersama semua akun yang niche-nya cocok |
| Posisi link | **Balasan pertama**: postingan utama tanpa link, worker membalas 1-3 menit kemudian berisi link + disclosure |
| Sumber link | **Manual dulu**: user menempel link affiliate Shopee dan catatan produk. Open API Shopee menyusul |
| Frekuensi | **Bebas diatur user**. Sistem hanya memberi peringatan risiko, tidak melarang |

## Pengaturan per akun

Disimpan di tabel `AffiliateConfig` (satu baris per akun), terpisah dari `AutopilotConfig`.

| Pengaturan | Rentang | Bawaan | Catatan |
|---|---|---|---|
| Affiliate aktif | ya/tidak | tidak | Ada juga saklar "jeda semua affiliate" per workspace |
| Maks per hari | 0 – jumlah postingan per hari akun | 1 | 0 = sama dengan mati |
| Porsi dari total postingan | 0 – 100% | 30% | Di atas 30% muncul peringatan "berisiko terlihat spam" |
| Jarak antar postingan affiliate | 0 – 12 jam | 4 jam | |
| Jeda produk sama di akun yang sama | 0 – 60 hari | 14 hari | |
| Niche akun | daftar tag | diusulkan dari pilar akun | Menentukan katalog mana yang dipakai |
| Teks balasan | teks bebas, wajib memuat `{link}` | "Yang nanya, ini link-nya: {link}
(link affiliate)" | Termasuk keterangan disclosure |

Batas yang dipakai selalu **yang paling ketat** di antara "maks per hari" dan "porsi". Contoh: akun
dengan 3 postingan sehari, maks 3, porsi 30% → hanya 1 affiliate.

Aturan lintas akun (bawaan, bisa dimatikan admin): satu produk tidak dipakai lebih dari satu akun
pada hari yang sama di workspace yang sama.

## Data baru (`sql/019_affiliate.sql`)

- **`AffiliateProduct`**: `id`, `workspaceId`, `nama`, `link` (hanya domain Shopee: `shopee.co.id`,
  `s.shopee.co.id`, `shope.ee`), `niche text[]`, `catatan` (fakta produk, satu-satunya sumber
  klaim untuk AI), `aktif`, `createdAt`, `updatedAt`. Index: `(workspaceId, aktif)`, GIN pada `niche`.
- **`AffiliateUse`**: `id`, `workspaceId`, `accountId`, `productId`, `slotId`, `postId`, `dayKey`,
  `replyStatus`, `replyPostId`, `createdAt`. Dipakai untuk aturan jeda/kembar dan laporan.
  Index: `(accountId, productId, createdAt desc)`, `(workspaceId, dayKey)`.
- **`AffiliateConfig`**: pengaturan per akun (tabel di atas). **`AffiliateWorkspace`**: saklar jeda per workspace.
- Antrean balasan pertama ada di `AffiliateUse` sendiri (`replyText`, `delayDetik`, `status`, `attempts`,
  `nextAt`, `replyPostId`, `error`). Tabel milik worker (`ScheduledPost`, `PostDispatch`) tidak diubah.
- Seperti file SQL lain: akses lewat fungsi `SECURITY DEFINER` `dash_aff_*`, diakhiri loop
  `REVOKE ... FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE ... TO service_role`.

## Alur

1. **Undian slot** (`autopilot-writer.ts`, di samping `pickPromo`): slot menjadi slot affiliate bila
   akun aktif, masih di bawah batas harian, porsi, dan jarak jam, serta ada produk aktif di niche
   akun yang lolos aturan jeda dan kembar. Kalau tidak memenuhi, slot menjadi postingan biasa.
   Undian tetap deterministik per slot (`hash32`) seperti pilar dan promo.
2. **Brief ke AI**: postingan sesuai niche dan gaya akun, produk muncul sebagai bagian cerita atau
   rekomendasi. Tanpa link, tanpa "beli", "checkout", atau "link di bio". Catatan produk masuk ke
   sumber fakta, jadi gerbang klaim yang sudah ada menolak harga atau diskon karangan.
3. **Gerbang** (`autopilot-gate.ts`), tambahan untuk slot affiliate: postingan utama tidak boleh
   berisi URL, kata ajakan jualan keras ditolak, dan nama produk harus disebut secara wajar.
   Kritikus AI menilai "apakah ini terasa seperti iklan".
4. **Mode Tinjau**: draf affiliate tampil dengan label "Affiliate" dan pratinjau balasan berisi link.
5. **Terbit**: postingan utama lewat antrean seperti biasa.
6. **Balasan pertama** (worker `auto-suka-shawarma`, `threads-publisher.service.ts`, tahap 3): worker
   memanggil `dash_aff_reply_due` (mengunci baris yang dispatch-nya TERBIT dan jedanya 1-3 menit sudah
   lewat), mengirim `threadsService.replyTo`, lalu `dash_aff_reply_done`. Coba ulang tiap 5 menit, maksimal
   3 kali. Kalau gagal, postingan utama tetap ada dan errornya dicatat.

## Laporan

- Per akun dan per produk: jumlah terbit, status balasan, dan jangkauan postingan (dari insight
  Threads yang sudah dikumpulkan).
- Komisi: impor laporan konversi Shopee Affiliate (CSV), lalu dicocokkan per produk. Pencocokan
  per akun membutuhkan sub_id per link, yang baru praktis setelah Open API tersedia.
- Umpan balik ke learning autopilot: produk dan gaya yang jangkauannya bagus lebih sering terpilih.

## UI

- Pengaturan autopilot per akun: bagian "Affiliate" berisi saklar, angka-angka, niche, dan
  disclosure, dengan peringatan kuning bila porsi di atas 30%.
- Halaman katalog: tambah, ubah, nonaktifkan produk, beri tag niche, dan lihat akun mana saja yang
  cocok dengan tiap niche.
- Daftar slot: label "Affiliate" dan status balasan.

## Rencana rilis

1. Nyalakan di beberapa akun dengan 1 per hari selama 1-2 minggu.
2. Bandingkan jangkauan akun sebelum dan sesudah, lalu naikkan frekuensi bila stabil.
3. Akun brand atau outlet (mis. Suka Shawarma) sebaiknya tidak memakai fitur ini.

## Di luar cakupan tahap ini

- Shopee Affiliate Open API (cari produk dan short link otomatis).
- Gambar produk di postingan.
- Pelacakan klik lewat redirect domain sendiri.
