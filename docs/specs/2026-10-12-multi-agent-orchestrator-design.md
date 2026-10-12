# Multi-Agent Content Orchestrator Design

## 1. Overview
Fitur ini menambahkan kapabilitas Multi-Agent untuk menghasilkan konten Threads secara massal (hingga 32 akun) dengan gaya yang disesuaikan untuk masing-masing akun. Sistem menggunakan Streaming (Server-Sent Events) untuk memberikan *feedback* visual instan kepada pengguna tanpa perlu setup database antrean tambahan (Opsi A).

## 2. Architecture & Data Flow
Pendekatan: **In-Memory Concurrency dengan Server-Sent Events (SSE)**

1. **Intent Interception:**
   Ketika user meminta pembuatan ide di chat, `Chat API` mengembalikan respons JSON khusus (intent: `MULTI_AGENT_ORCHESTRATOR`). Frontend merender form interaktif di dalam bubble chat.
2. **User Input:**
   - **Scope:** 1 Akun (Custom Dropdown) atau Semua Akun.
   - **Jadwal:** Pilih jam spesifik (Custom Time Picker) atau "Rekomendasi AI" (memanggil fungsi analitik `dash_hour_rows` untuk mencari jam puncak).
3. **Execution (SSE Endpoint):**
   - Frontend memanggil `/api/content/orchestrate` melalui `EventSource` atau Fetch Stream.
   - Backend membagi 32 akun ke dalam *batch* konkurensi (maksimal 5 *request* paralel ke Gemini) untuk menghindari *Rate Limit* (429) dan *Timeout*.
   - **Sub-Agent Logic:** Untuk tiap akun, backend mengambil data *Top Post* terbaru sebagai *context* gaya bahasa, lalu memanggil `gemini.ts`.
   - Backend memancarkan (emit) *events*: `AGENT_START`, `AGENT_PROGRESS`, `AGENT_SUCCESS`, `AGENT_ERROR`.
4. **Unified Review:**
   Hasil yang selesai dikumpulkan di Frontend. User dapat mereview dan menekan "Jadwalkan Semua" (memanggil `/api/threads/publish` secara *batch*).

## 3. UI/UX Specifications
Sesuai **Aturan Mutlak Pengembangan**:
- **Komponen Custom:** Dilarang menggunakan `<select>` atau `<input type="time">` bawaan OS/Browser. Dibuat menggunakan elemen kustom (React state + *absolute positioning* untuk *dropdown*).
- **Estetika:** Super *clean*, modern, *solid colors* (tanpa gradient), *subtle borders*.
- **Iconography:** Eksklusif menggunakan `lucide-react`. Dilarang menggunakan emoji di dalam UI komponen.
- **Visualisasi Multi-Agent:** Grid yang menampilkan daftar agen (akun). Menggunakan animasi *CSS pulse* murni pada border/indikator status (abu-abu = *waiting*, biru = *thinking*, hijau = *done*, merah = *error*).

## 4. Edge Cases & Handling
- **Gemini Quota Exceeded:** Jika satu agen gagal, statusnya menjadi *Error* dan dikembalikan ke UI. Agen lain tetap berjalan.
- **Browser Closed Mid-Stream:** Proses stream akan terputus. Karena tidak menggunakan database *queue*, state akan hilang. Ini *trade-off* yang diterima untuk mendapatkan kecepatan dan *real-time experience* tanpa overhead infrastruktur antrean kompleks.
- **Empty Top Posts:** Jika akun belum pernah memposting, *context* gaya bahasa akan kosong, agen menggunakan instruksi default yang netral.