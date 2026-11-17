# GEO & SEO Analysis: bottrit.com

Tanggal: 17 November 2026 · Halaman utama: `https://bottrit.com/selamat-datang`

## 1. GEO Readiness Score

| | Sebelum | Sesudah perubahan ini (belum di-deploy) |
|---|---|---|
| **Total** | **34/100** | **72/100** |
| Citability (25%) | 15/25 | 21/25 |
| Structural readability (20%) | 14/20 | 18/20 |
| Multi-modal (15%) | 9/15 | 11/15 |
| Authority & brand signals (20%) | 4/20 | 8/20 |
| Technical accessibility (20%) | 2/20 (robots/sitemap terkunci di balik login) | 14/20 |

Sisa 28 poin hampir seluruhnya **di luar kode**: sebutan merek di YouTube, Reddit, LinkedIn, dan media; ulasan pengguna; serta umur domain. Tidak ada yang bisa menjamin peringkat #1 di Google atau di jawaban AI. Yang bisa dilakukan adalah memastikan situs mudah dibaca, dipercaya, dan dikutip, lalu membangun sebutan merek di luar situs.

## 2. Platform breakdown (sesudah)

| Platform | Skor | Catatan |
|---|---|---|
| Google (Search + AI Overviews) | 70 | Teknis lengkap; butuh Search Console, backlink, dan waktu |
| ChatGPT Search | 65 | `OAI-SearchBot`/`GPTBot` diizinkan; butuh sebutan di Wikipedia/Reddit/media |
| Perplexity | 60 | `PerplexityBot` diizinkan; sumber utamanya Reddit dan diskusi komunitas |
| Bing Copilot | 65 | Perlu Bing Webmaster Tools + IndexNow |

## 3. AI crawler access

**Sebelum:** `/robots.txt`, `/sitemap.xml`, dan `/llms.txt` dialihkan (307) ke `/login`, jadi semua crawler mendapat halaman login.

**Sesudah:** semua mesin pencari dan AI diizinkan membaca halaman publik. Halaman aplikasi yang butuh login tetap dilewati (`/api/`, `/akun`, `/autopilot`, `/jadwal`, dan seterusnya). Bot yang disebut eksplisit: Googlebot, Bingbot, Google-Extended, GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User, anthropic-ai, PerplexityBot, Perplexity-User, Applebot(-Extended), Meta-ExternalAgent, DuckAssistBot, YouBot, cohere-ai, CCBot.

## 4. llms.txt

**Sebelum:** tidak ada (dan terkunci login). **Sesudah:** `/llms.txt` (7,2 KB) berisi ringkasan, definisi, 11 fakta utama, daftar halaman, dan 10 tanya jawab. Isinya diambil dari sumber yang sama dengan halaman (`src/lib/site.ts`, `src/components/landing/faq-data.ts`), jadi tidak bisa berbeda dengan yang dilihat pengunjung.

## 5. Brand mention analysis

Belum ada jejak yang terverifikasi di Wikipedia, Reddit, YouTube, atau LinkedIn. Ini sinyal terkuat untuk dikutip AI (korelasi YouTube ~0,74 vs backlink ~0,27, Ahrefs Des 2025). Nama juga terbelah: produk "BotThreads", domain "bottrit". Schema sekarang mencantumkan `alternateName: ["Bottrit", "Bot Threads"]`.

## 6. Passage-level citability

- **Baru:** bagian "Apa itu BotThreads?" berisi definisi 139 kata (EN 163 kata), di rentang optimal 134-167, diawali pola "BotThreads adalah ...".
- **Sudah kuat:** 10 jawaban FAQ yang spesifik (angka 0,7; 2,5 jam; 15 menit; 3 kali gagal; daftar metode bayar).
- **Baru:** tabel perbandingan BotThreads vs posting manual vs penjadwal biasa (5 baris).

## 7. Server-side rendering

Semua teks landing, FAQ, definisi, tabel, dan JSON-LD ada di HTML server (dicek dengan `curl` ber-user-agent GPTBot, tanpa JavaScript). Animasi Remotion dan demo interaktif memang butuh JavaScript, tetapi teks aslinya tetap ada di HTML.

## 8. Top 5 perubahan berdampak terbesar

1. ✅ Buka `robots.txt`, `sitemap.xml`, `llms.txt`, dan gambar OG dari kunci login (`src/proxy.ts`).
2. ✅ JSON-LD `@graph`: Organization, WebSite, WebPage, SoftwareApplication (+ Offer harga paket), FAQPage, BreadcrumbList.
3. ✅ Metadata lengkap: judul berkata kunci, deskripsi definisi, canonical, Open Graph + gambar 1200x630, Twitter card besar.
4. ⏳ **Setelah deploy:** daftarkan domain di Google Search Console (verifikasi DNS) dan Bing Webmaster Tools, kirim `https://bottrit.com/sitemap.xml`, lalu minta pengindeksan `/selamat-datang`.
5. ⏳ **Di luar kode:** video demo di YouTube (judul/deskripsi menyebut "BotThreads" + link bottrit.com), halaman LinkedIn perusahaan, thread jujur di Reddit/komunitas (r/indonesia, grup UMKM), dan listing di Product Hunt / direktori tools AI. Tambahkan URL-nya ke `sameAs` di `src/lib/site.ts`.

## 9. Schema

Sudah: lihat poin 8.2. Berikutnya bila datanya ada: `sameAs` (profil sosial resmi), `AggregateRating` (hanya dari ulasan asli yang tampil di halaman), dan `VideoObject` bila demo diunggah ke YouTube.

## 10. Saran konten berikutnya

- Halaman artikel/panduan di bawah domain yang sama, mis. "Jam terbaik posting di Threads untuk UMKM Indonesia" dan "Cara menjadwalkan posting Threads otomatis". Kueri seperti ini yang memicu AI Overviews.
- Data orisinal: statistik anonim dari autopilot (mis. rata-rata jam ramai per niche). Data unik paling sering dikutip AI.
- Byline dan tanggal "terakhir diperbarui" di halaman konten.

## Angka terukur (build lokal, `next start`)

| URL | Status | Ukuran | Waktu |
|---|---|---|---|
| `/robots.txt` | 200 (sebelumnya 307 → /login) | 1,1 KB | 12 ms |
| `/sitemap.xml` | 200 (sebelumnya 307 → /login) | 1,0 KB | 11 ms |
| `/llms.txt` | 200 (sebelumnya 307 → /login) | 7,2 KB | 13 ms |
| `/opengraph-image` | 200, statis saat build | 113 KB | 22 ms |
| `/selamat-datang` | 200 | 340 KB mentah / 58 KB gzip (produksi sekarang 273 KB / 46 KB gzip) | 63 ms |

HTML landing bertambah **+69 KB mentah, +12,5 KB gzip**. Sumber yang terukur: JSON-LD 10,8 KB dan bagian "Apa itu" 7,3 KB. Keduanya ikut tercetak lagi di payload RSC Next, jadi dihitung dua kali. Sisanya belum dirinci, dan sebagian bisa jadi karena build lokal tanpa DB, sehingga paketnya memakai data cadangan. Tidak ada request atau JavaScript tambahan di browser. Kalau mau dihemat: `description` SoftwareApplication bisa memakai deskripsi pendek (hemat ±2 KB), atau FAQPage dihapus dari JSON-LD (hemat ±12 KB mentah). Tapi FAQPage justru yang paling berguna untuk AI.
