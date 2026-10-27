import type { MascotMood } from "./mascot";

/**
 * Isi tur pengenalan, berurutan mengikuti alur kerja pengguna baru: hubungkan akun -> kenalkan akun ke AI ->
 * nyalakan otomatisasi -> pantau hasil. `anchor` = nilai atribut data-tour elemen yang disorot (dicoba
 * berurutan; yang pertama terlihat dipakai). Tanpa anchor yang terlihat, kartu tampil di tengah layar.
 */
export interface TourStep {
  id: string;
  /** Label singkat di progres. */
  chip: string;
  title: string;
  body: string;
  /** Poin singkat "yang bisa dilakukan di sini". */
  points?: string[];
  /** Halaman yang dibuka saat langkah ini tampil (supaya pengguna melihat tampilan aslinya). */
  route?: string;
  anchors?: string[];
  mood: MascotMood;
}

/** Menu samping (desktop), bilah bawah (HP), lalu tombol "Lainnya" bila menunya tidak ada di bilah bawah. */
const nav = (href: string) => [`nav:${href}`, `bnav:${href}`, "bnav:more"];

export const TOUR_STEPS: TourStep[] = [
  {
    id: "halo",
    chip: "Halo",
    title: "Hai! Aku robot BotThreads",
    body: "Tugasku menulis, menjadwalkan, dan memposting konten Threads akunmu selagi kamu tidur. Ayo keliling sebentar, cuma 2 menit.",
    mood: "wake",
  },
  {
    id: "akun",
    chip: "Akun",
    title: "1. Hubungkan akun Threads",
    body: "Semua dimulai di sini. Begitu akun terhubung, aku langsung membaca postinganmu, mengenali gayamu, riset tren di niche-mu, lalu menyusun ide pertama.",
    points: ["Hubungkan satu atau beberapa akun", "Isi Profil AI: siapa akunnya, bahas apa, untuk siapa"],
    route: "/akun",
    anchors: nav("/akun"),
    mood: "point",
  },
  {
    id: "profil",
    chip: "Profil AI",
    title: "2. Profil AI = otak akunmu",
    body: "Peran & tema, kategori topik, dan gaya sapaan (gue/lo, aku/kamu...). Semua fitur AI menulis mengikuti profil ini. Kalau kamu mengubahnya, aku otomatis riset ulang dan mengganti ide lama.",
    points: ["Bisa minta Studio AI membuatkan prompt peran lengkap", "Klik Perbesar untuk menulis profil yang panjang"],
    route: "/akun",
    anchors: ["profil-ai", ...nav("/akun")],
    mood: "talk",
  },
  {
    id: "autopilot",
    chip: "Autopilot",
    title: "3. Autopilot: aku yang posting",
    body: "Pilih mode tiap akun. Tinjau dulu: aku menulis, kamu menyetujui. Otomatis: aku menulis dan memposting sendiri di jam ramai akunmu.",
    points: ["Atur jumlah posting per hari dan jamnya", "Draf yang tidak lolos pemeriksaan kutulis ulang, jam tayang tidak dibiarkan kosong"],
    route: "/autopilot",
    anchors: ["autopilot-accounts", ...nav("/autopilot")],
    mood: "point",
  },
  {
    id: "kerja-ai",
    chip: "Kerja AI",
    title: "Lihat aku bekerja",
    body: "Kartu ini menampilkan yang sedang kukerjakan: mencari ide, menyusun konten, review, sampai siap posting. Isinya data asli, bukan contoh.",
    route: "/autopilot",
    anchors: ["ai-pipeline", ...nav("/autopilot")],
    mood: "talk",
  },
  {
    id: "tab-autopilot",
    chip: "Tab",
    title: "Rencana, Tinjau, Komentar, Riwayat",
    body: "Rencana: isi tiap jam tayang. Tinjau: setujui atau minta tulis ulang. Komentar: balasan otomatis. Riwayat: yang sudah terbit. Affiliate: rekomendasi produk Shopee dengan link di balasan pertama.",
    route: "/autopilot",
    anchors: ["autopilot-tabs", ...nav("/autopilot")],
    mood: "point",
  },
  {
    id: "radar",
    chip: "Radar",
    title: "4. Radar (di HP: Trend): bahan bakar tulisanku",
    body: "Di sini ada bank ide lengkap dengan skor dan preview postingannya, tren yang lagi viral di niche-mu, dan kalender momen penting.",
    points: ['Klik "Posting ide ini duluan" supaya ide favoritmu dipakai lebih dulu', "Preview ide = teks yang nanti diposting (bila lolos pemeriksaan)"],
    route: "/radar",
    anchors: nav("/radar"),
    mood: "point",
  },
  {
    id: "studio",
    chip: "Studio AI",
    title: "5. Studio AI: tanya apa saja",
    body: "Ngobrol denganku soal performa akun: kenapa interaksi turun, pola postingan terbaik, sampai minta 3 draf siap jadwal atau prompt peran akun yang lengkap.",
    route: "/prompt-studio",
    anchors: nav("/prompt-studio"),
    mood: "talk",
  },
  {
    id: "jadwal",
    chip: "Jadwal",
    title: "6. Jadwal: semua antrean posting",
    body: "Semua postingan terjadwal dan riwayatnya ada di sini. Buka satu postingan untuk mengedit, memperbaiki dengan AI (lebih manusiawi, hook lebih kuat), atau posting sekarang.",
    route: "/jadwal",
    anchors: nav("/jadwal"),
    mood: "point",
  },
  {
    id: "pantau",
    chip: "Pantau",
    title: "7. Pantau hasilnya",
    body: "Ringkasan menunjukkan views, interaksi, dan akun terbaik. Postingan berisi semua postingan beserta metriknya, bisa disaring per format.",
    route: "/",
    anchors: [...nav("/"), ...nav("/posts")],
    mood: "point",
  },
  {
    id: "pengetahuan",
    chip: "Pengaturan",
    title: "8. Pengetahuan brand",
    body: "Isi fakta brand, produk & harga, promo, dan kata terlarang di Pengaturan > Pengetahuan. Hanya fakta dari sini yang boleh kusebut, jadi aku tidak pernah mengarang harga atau promo.",
    route: "/pengaturan?tab=pengetahuan",
    anchors: nav("/pengaturan"),
    mood: "talk",
  },
  {
    id: "selesai",
    chip: "Selesai",
    title: "Siap! Sisanya serahkan padaku",
    body: "Hubungkan akun, isi Profil AI, lalu nyalakan Autopilot. Tur ini bisa diputar lagi kapan saja dari menu profil di kanan atas.",
    mood: "cheer",
  },
];
