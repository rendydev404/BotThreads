# Implementation Plan: AI Multi-Agent Content Orchestrator

## 1. Goal Description
Membangun fitur canggih dan interaktif yang memungkinkan user menginstruksikan AI untuk membuat konten Threads hingga ke 32 akun sekaligus. Sistem akan mengorkestrasi "Sub-Agent" untuk setiap akun agar gaya bahasanya disesuaikan secara unik. Antarmuka (UI) akan dilengkapi dengan pemilih akun & waktu (custom headless UI), animasi agen secara *real-time* via SSE (*Server-Sent Events*), dan rekomendasi jam tayang berbasis AI—semuanya didesain super *clean*, tanpa *gradient*, dan tanpa elemen OS bawaan.

## 2. User Review Required (Konfirmasi Penting)
> ⚠️ **Keputusan Arsitektur**: Seperti yang telah disepakati, kita akan menggunakan **In-Memory Concurrency dengan SSE Streaming**. Ini berarti Anda akan melihat animasi *progress* yang sangat memukau (32 agen "berpikir" secara simultan) langsung di layar. Namun, karena ini bersifat *streaming* langsung, jika Anda menutup *tab browser* di tengah-tengah proses, *progress generation* yang belum selesai akan terhenti. Apakah batasan ini bisa diterima demi kecepatan dan visual canggih?

## 3. Tahapan Perubahan (Proposed Changes)

### Tahap 1: Intent Recognition & Alur Chat
Mencegat perintah pembuatan konten di API Chat agar memunculkan UI Orchestrator, bukan sekadar membalas teks.
*   **[MODIFY]** `src/app/api/bot/chat/route.ts`
    *   Mendeteksi kata kunci seperti "buat ide konten", "bikinkan postingan".
    *   Mengembalikan respons terstruktur (intent: `MULTI_AGENT_ORCHESTRATOR`) ke frontend.

### Tahap 2: Multi-Agent Backend (SSE Streaming)
Membuat *endpoint* khusus yang menggerakkan 32 sub-agent secara paralel.
*   **[NEW]** `src/app/api/content/orchestrate/route.ts`
    *   **Logika & Konteks:** Membaca daftar akun tujuan. Mengambil gaya bahasa dari post teramai sebelumnya per akun (via RPC) untuk disuntikkan ke prompt sub-agent.
    *   **Konkurensi:** Membatasi pemanggilan API Gemini maksimal 5 agen dalam satu waktu agar terhindar dari *Error 429 (Rate Limit)*.
    *   **Streaming:** Mengembalikan `text/event-stream`. Mengirimkan data JSON secara *real-time* untuk status `START`, `PROGRESS`, `SUCCESS`, dan `ERROR` per akun.

### Tahap 3: Komponen UI Orchestrator (Custom & Clean)
Membangun UI interaktif dengan mengikuti aturan mutlak (tanpa OS default input, tanpa emoji, warna solid).
*   **[NEW]** `src/components/content/orchestrator-card.tsx` (Card utama wizard/langkah-langkah).
*   **[NEW]** `src/components/content/custom-dropdown.tsx` (Dropdown akun rapi dan animasi *smooth* tanpa elemen `<select>`).
*   **[NEW]** `src/components/content/custom-time-picker.tsx` (Pemilih jam tayang kustom tanpa elemen `<input type="time">`).
*   **[NEW]** `src/components/content/agent-node-grid.tsx` (Grid animasi yang memunculkan 32 kartu status agen dengan efek *CSS pulse* menyala sesuai statusnya).

### Tahap 4: Integrasi Smart Scheduling
*   **[MODIFY]** `src/lib/content-ai.ts` atau Helper Analytics
    *   Menyambungkan tombol "Rekomendasi AI" untuk mengambil jam terbaik memposting (jam dengan *views/likes* terbanyak dari data historis).

### Tahap 5: Final Review & Batch Publishing
*   **[NEW]** `src/components/content/unified-review-board.tsx`
    *   Menampilkan hasil konten (draf) dari seluruh agen yang berhasil dalam format *grid/masonry* yang rapi.
    *   Satu tombol "Setujui & Jadwalkan Semua" yang langsung mengirim semua draf final ke dalam *queue*/antrean database.

## 4. Verification Plan

### Automated Tests
Kita akan menambahkan Unit Test untuk memvalidasi utilitas *chunking/concurrency*:
```bash
npm run test
```

### Manual Verification
1. Buka halaman `/chat` atau `/dashboard`.
2. Ketik prompt: *"Buatkan konten motivasi untuk semua akun"*.
3. Pastikan `orchestrator-card` muncul.
4. Uji komponen Dropdown dan Time Picker, pastikan tidak menggunakan elemen *native* OS.
5. Klik **"Rekomendasi AI"** dan pastikan waktu terisi otomatis dengan cerdas.
6. Klik **"Generate"** dan perhatikan animasi di `agent-node-grid`. Pastikan event log masuk secara asinkron tanpa terputus (Timeout 504).
7. Klik **"Jadwalkan Semua"** dan pastikan tabel database `ScheduledPost` terisi dengan benar.