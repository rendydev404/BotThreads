/**
 * Alur kerja BotThreads dalam bahasa awam: satu sumber untuk peta alur (landing & /cara-kerja),
 * panduan per halaman, dan pengelompokan menu. Angka & aturan di sini mengikuti perilaku sistem
 * yang sebenarnya; ubah bersama kodenya bila aturannya berubah.
 */

export type FlowStepId = "hubungkan" | "kenalkan" | "ide" | "tulis" | "terbit" | "pantau";

export interface FlowStep {
  id: FlowStepId;
  no: number;
  /** Judul singkat di node peta. */
  title: string;
  /** Satu kalimat di node peta. */
  short: string;
  /** Penjelasan lengkap saat langkah dipilih. */
  what: string;
  /** Yang perlu dilakukan pengguna; `null` = tidak ada, berjalan sendiri. */
  you: string | null;
  /** Siapa yang mengerjakan langkah ini. */
  by: "anda" | "otomatis";
  /** Menu di aplikasi tempat langkah ini terlihat. */
  menu: string;
  href: string;
  /** Halaman lain yang termasuk langkah ini (untuk panduan per halaman). */
  extraPaths?: string[];
}

export const FLOW_STEPS: FlowStep[] = [
  {
    id: "hubungkan",
    no: 1,
    title: "Hubungkan akun Threads",
    short: "Login resmi Threads, sekali saja.",
    what: "Anda masuk lewat halaman login resmi Threads, bukan memberi kata sandi ke kami. Setelah terhubung, BotThreads membaca posting lama akun itu untuk mengenali gaya dan jam ramainya.",
    you: "Klik Hubungkan Threads di menu Akun Threads. Bisa lebih dari satu akun.",
    by: "anda",
    menu: "Akun Threads",
    href: "/akun",
  },
  {
    id: "kenalkan",
    no: 2,
    title: "Kenalkan brand ke AI",
    short: "Isi siapa akunnya dan fakta brand.",
    what: "Profil AI berisi akun ini siapa, membahas apa, untuk siapa, dan gaya sapaannya. Pengetahuan berisi produk, harga, promo, dan kata terlarang. AI hanya boleh menyebut fakta yang tertulis di sini.",
    you: "Isi Profil AI di Akun Threads, lalu Pengetahuan di Pengaturan. Cukup sekali, bisa diubah kapan saja.",
    by: "anda",
    menu: "Akun Threads & Pengaturan",
    href: "/akun",
    extraPaths: ["/pengaturan"],
  },
  {
    id: "ide",
    no: 3,
    title: "AI mengumpulkan ide",
    short: "Dari tren, momen, dan posting terbaik Anda.",
    what: "Setiap hari Radar memantau tren pencarian Google Indonesia, momen kalender, dan posting Anda yang paling ramai. Hasilnya disimpan sebagai ide berskor 0 sampai 100, lengkap dengan contoh tulisannya.",
    you: "Tidak wajib. Kalau mau, pilih ide favorit agar diposting duluan, atau buang ide yang tidak cocok.",
    by: "otomatis",
    menu: "Radar",
    href: "/radar",
  },
  {
    id: "tulis",
    no: 4,
    title: "AI menulis & memeriksa",
    short: "Draf dicek dulu sebelum boleh tayang.",
    what: "Sekitar 90 menit sebelum jam tayang, autopilot menulis draf dari ide dengan skor tertinggi. Draf diperiksa (bentuk, klaim harga dan promo, topik terlarang, mirip akun lain) lalu dinilai editor AI. Yang gagal ditulis ulang atau dilewati.",
    you: "Pilih mode tiap akun. Tinjau dulu: Anda menyetujui setiap draf. Otomatis: draf yang lolos langsung antre.",
    by: "otomatis",
    menu: "Autopilot",
    href: "/autopilot",
  },
  {
    id: "terbit",
    no: 5,
    title: "Terbit sesuai jadwal",
    short: "Di jam ramai tiap akun, berjeda 2,5 jam.",
    what: "Posting muncul di akun Threads Anda seperti posting biasa, di jam ketika pengikut akun itu paling aktif. Semua antrean terlihat di Jadwal dan bisa diubah, dibatalkan, atau diposting sekarang.",
    you: "Tidak wajib. Buka Jadwal bila ingin mengubah atau membatalkan posting tertentu.",
    by: "otomatis",
    menu: "Jadwal",
    href: "/jadwal",
  },
  {
    id: "pantau",
    no: 6,
    title: "Pantau hasil, AI belajar",
    short: "Pola yang berhasil dipakai lagi besok.",
    what: "Views dan interaksi masuk ke Ringkasan dan Postingan. Pola yang menaikkan views dipakai lagi untuk ide berikutnya. Kalau views seminggu anjlok lebih dari separuh, akun turun sendiri ke mode Tinjau dulu dan Anda diberi tahu.",
    you: "Cek Ringkasan sesekali. Tanya Studio AI bila ingin tahu kenapa angka naik atau turun.",
    by: "otomatis",
    menu: "Ringkasan & Postingan",
    href: "/",
    extraPaths: ["/posts", "/prompt-studio"],
  },
];

/** Langkah yang memuat halaman ini, untuk panduan di atas halaman. */
export function flowStepForPath(pathname: string): FlowStep | null {
  const match = (p: string) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`));
  return FLOW_STEPS.find((s) => match(s.href) && s.id !== "kenalkan") ?? FLOW_STEPS.find((s) => s.extraPaths?.some(match)) ?? null;
}
