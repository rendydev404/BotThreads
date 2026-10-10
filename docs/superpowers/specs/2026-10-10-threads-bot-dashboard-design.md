# Spesifikasi Desain: Web Dashboard Bot Telegram & Analisis Threads (BotDash)

- **Tanggal Pembaruan**: 2026-10-10
- **Aesthetic Direction**: Neo-Fintech Precision (BankFlash Clean Modern Style)
- **Lokasi Proyek**: `d:\PROJECT-WEB-SS\Bot_Dashboard`
- **Stitch Project ID**: `13738798258660608187` ("BotDash - Threads Bot Analytics Dashboard")
- **Design System Stitch**: `assets/2c5bc0b2a0ea4fca90b000b32be17b39` ("Neo-Fintech Precision")

---

## 1. Konsep & Filosofi Desain

Mengadopsi referensi visual modern fintech **BankFlash** yang diminta: antarmuka super clean, lapang, ramah pengguna (*ultra user-friendly*), dan berkelas tinggi dengan kartu-kartu putih membulat lembut (*24px radius*), kanvas bernuansa abu kebiruan lembut, serta aksen warna **Electric / Cobalt Blue** (`#1814F3` / `#2D60FF`) yang tajam dan kontras.

### Aturan UI/UX Mutlak:
1. **Palet Warna**:
   - Canvas: `#F4F7FE` (Soft clean off-white canvas)
   - Cards / Containers: `#FFFFFF` dengan `rounded-3xl` (radius 24px) dan bayangan lembut `0 4px 20px rgba(52, 60, 106, 0.04)`.
   - Warna Primer: Solid Electric Cobalt Blue (`#1814F3` / `#2D60FF`).
   - Warna Aksen Pendukung: Mint Teal (`#16DBCC`) untuk pertumbuhan positif/interaksi, Coral Red (`#FF4B4A`) untuk metrik turun/alert, dan Slate Gray (`#718EBF`) untuk teks sekunder/label.
   - Tipografi Utama: Deep Navy (`#343C6A`) untuk judul dan teks tebal.
2. **Tanpa Emoji (Strictly SVG)**:
   - Menggunakan ikon SVG modern garis (*2px stroke*) dari `lucide-react`. Dilarang menggunakan emoji pada UI.
3. **Komponen 100% Kustom (Dilarang Native Controls)**:
   - Pill input search bar kustom dengan rounded-full (`#F5F7FA`), custom tab switcher dengan underline biru solid, custom pill buttons, dan modal konfirmasi custom.
4. **Konfirmasi Penghapusan Data Destruktif**:
   - Menampilkan modal persetujuan dengan judul tegas:
     `# KONFIRMASI PENGHAPUSAN DATA`
5. **Chart Interaktif Berkinerja Tinggi**:
   - Menggunakan chart interaktif (Recharts / SVG Spline) dengan bar pills vertikal, hover crosshair, dan tooltip melayang informatif.

---

## 2. Layar Desain di Google Stitch

Desain telah diregenerasi 100% di Google Stitch sesuai referensi:

### Layar 1: BotDash Analytics Dashboard (Overview)
- **Screen ID**: `769ea19fddec493cbe4078b1869b82a1`
- **Screenshot URL**: [Buka Screenshot Layar 1](https://lh3.googleusercontent.com/aida/AEtjO1VmMqrxiUAeA1cebRs5pZTk_-RBYczbq8VyC9xzyYP3kEmLyvOtrLjKxVIUcJi0oZMZpSgp_mTv0VEe7RAQio9bBwSgQ-jtROWpfm-51TnhpoSE89Cbbv_PT3JVX3eT1gyKkhga8CYEw6VYk1Fqi2ISGoqoEm9OfG8bfWWfZH3KpprkY_gyT1mv2xQtn_3uFRr6xbxvQTHGAw7A5HhRbILN2A77Ce8cS5jpXN7Fr1MCib6wTNzfc2yADrPe)
- **Struktur Komponen**:
  - **Sidebar Putih**: Logo `BotDash.` biru elektrik, navigasi dengan indikator pill vertikal biru di tepi kiri item aktif **Dashboard**, ikon bersih warna `#718EBF`.
  - **Top Header**: Judul besar "Overview" (`#343C6A`), pill search bar `#F5F7FA`, circular button settings (gear) & notifikasi (bell dengan badge merah), serta foto profil avatar.
  - **Row 1 (My Accounts & Recent Bot Activity)**:
    - *Hero Card (Biru Elektrik)*: Total Views `184,200`, chip ikon, `@sukashawarma`, status aktif, nomor masked `7194 **** **** 8820`, dual circles.
    - *Secondary Card (Putih)*: Avg Engagement `5.2% ER`, benchmark high performer, masked ID `5542 **** **** 1234`.
    - *Recent Bot Activity*: Kartu log aktivitas dengan circular icon chips kuning/amber (`Laporan Harian Terkirim`), soft blue (`Sync Metrik`), dan teal (`Auto-Komentar Terkirim`).
  - **Row 2 (Weekly Activity & Content Format Stats)**:
    - *Weekly Activity Bar Chart*: Bar rounded vertikal dual-warna (`Views #1814F3` vs `Interaksi #16DBCC`) skala 0–500 melintasi 7 hari (Sat–Fri).
    - *Content Format Stats*: Pie/donut chart proporsional (Teks 35%, Video 30%, Carousel 20%, Promo 15%).
  - **Row 3 (Quick AI Prompt & Engagement History)**:
    - *Quick AI Prompt (Hermes)*: Avatar persona AI (*Livia Bator - Strategist*, *Randy Press - Copywriter*, *Workman - Analyst*), pill input prompt dengan tombol solid blue `Send` berikon pesawat kertas.
    - *Engagement History*: Smooth Spline Area Line chart dengan kurva biru elektrik dan isian area lembut dari Jul hingga Jan.

---

### Layar 2: Threads Content & Posts Hub (Data Table)
- **Screen ID**: `d52a0752239041048e624ae2c8afa06f`
- **Screenshot URL**: [Buka Screenshot Layar 2](https://lh3.googleusercontent.com/aida/AEtjO1U2uOx60g29V5LBwsR1lol6Do5bwlDy7aoeZnTJj9-TVrNSGXAdF_fa73tpBopxIHAZAzIzrtFfBtNOi28BmoO9B4_-3Pe26x3Uoj0KhxyJ8lWwDdqLlGHXGxVAH7ZZc95nvPBHGuUuvJoiSntBC5_pdkLwf1IRyY23_0azIBUqHrBPaoqMssg6PVcT8SYx4akkSUFJrAQuoxsSmp2EuwRQyaYuLfpr9t6Sfs1ly0sKzwPbtTCpnuvWY9E)
- **Struktur Komponen**:
  - **Top Row**: My Accounts + Weekly Performance volume bar chart dengan highlight pilar teal (`48.2K Views`).
  - **Tabel Postingan Utama (Recent Posts Analysis)**:
    - Filter Tabs dengan underline biru: `All Posts`, `Top Performer`, `Flop / Evaluasi`.
    - Kolom Tabel: Icon arah performa lingkaran (teal panah atas / red panah bawah), Cuplikan Konten, Post ID `#12548796`, Type badge (Teks, Video, Foto, Carousel), Akun, Tanggal & Jam WIB, ER (%), dan tombol pill `Analyze AI`.
    - Pagination Bawah: `< Previous`, `1` (lingkaran biru aktif), `2`, `3`, `4`, `Next >`.

---

### Layar 3: Hermes AI Prompt Studio (Chat & Assistant)
- **Screen ID**: `87bb9e855f6d46508afdb2426a4269bb`
- **Screenshot URL**: [Buka Screenshot Layar 3](https://lh3.googleusercontent.com/aida/AEtjO1XwQYbOd8fHC8_k1Sga8q7NAXuWZL5mMtGFGmeq-xGJvezJj5SDozKwPVwNgKZooZvQoSEIf4kUHYchAPpYKd8GSZOGCRbi8m4jpFquyIZS_t3HmKc8fIEYC6OXoqYhMK01cpKPgDVc4TiYa5FUvcGzePWNc4g8mtu9YwnX6mpp-ouRMA4r1Wo15KssTC8T3PekJxs3W3i1Lg4aWGKiD3UAVT91qsb606BkMdpEi6LlvUCEzhLLM5e1X5rN)
- **Struktur Komponen**:
  - **Top Row**: Kartu Engine Hermes Agent v3.4 (`threads` profile, 12ms latency, token masked) + Model Context (`ANALYTIC-SOSMED-COMBO` via 9router) + Target Account Context `@sukashawarma`.
  - **Area Chat Interaktif**:
    - Suggestion Chips: `[Analisis Performa 7 Hari]`, `[Buat 3 Ide Post Besok]`, `[Evaluasi Postingan Flop]`, `[Rekomendasi Waktu Posting]`.
    - Chat Bubble Admin (kanan, background soft blue `#F4F7FE`).
    - Tool Call Execution Badge (mint-teal pill status `ringkasan_semua_akun` & `detail_akun` 112ms).
    - Respon Hermes AI terstruktur: Kartu metrik, temuan perilaku audiens, kotak draf konten siap publish, dan tombol aksi (*Kirim ke Telegram Bot*, *Salin Teks*, *Regenerate*).
    - Floating Pill Input: Input melayang rounded-full dengan tombol kirim bulat biru elektrik pesawat kertas.

---

## 3. Tech Stack & Arsitektur Kode

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript
- **Styling**: Tailwind CSS dengan custom utility tokens (BankFlash Soft Fintech theme)
- **Charts**: Recharts / SVG kustom interaktif (Rounded bar pills & Spline curves)
- **Icons**: `lucide-react` (Clean 2px stroke outline SVG)
- **Backend API**: Next.js Server Endpoints (`/api/analytics/*`, `/api/bot/*`)
- **Database**: PostgreSQL Supabase (Koneksi pooler pgbouncer port 6543)
- **AI Streaming**: Server-Sent Events (SSE) proxy ke Hermes API di VPS (`76.13.193.138:8643`) dengan fallback otomatis ke direct LLM/9router
