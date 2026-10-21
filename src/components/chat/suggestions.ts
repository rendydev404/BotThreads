import {
  CalendarClock,
  ChartColumn,
  Lightbulb,
  PenLine,
  Search,
  TrendingUp,
  Trophy,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import type { ChatMessage } from "./use-chat";

export interface Suggestion {
  label: string;
  hint: string;
  prompt: string;
  icon: LucideIcon;
}

export interface SuggestionGroup {
  title: string;
  /** Nama token warna: ikon memakai `bg-{tone}-soft text-{tone}`. */
  tone: "accent" | "success" | "warning";
  items: Suggestion[];
}

/** Layar awal: pertanyaan siap pakai, dikelompokkan menurut tujuan pengguna. */
export const suggestionGroups: SuggestionGroup[] = [
  {
    title: "Pahami performa",
    tone: "accent",
    items: [
      {
        label: "Ringkasan 7 hari",
        hint: "Total, perubahan, dan peringkat akun",
        prompt: "Ringkasan performa 7 hari terakhir",
        icon: ChartColumn,
      },
      {
        label: "Akun yang naik dan turun",
        hint: "Bandingkan dengan minggu lalu",
        prompt: "Akun mana yang paling naik dan paling turun dibanding minggu lalu, dan apa penyebabnya?",
        icon: TrendingUp,
      },
      {
        label: "Peringkat views",
        hint: "Siapa yang paling dilihat minggu ini",
        prompt: "Peringkat akun berdasarkan views minggu ini",
        icon: Trophy,
      },
    ],
  },
  {
    title: "Cari penyebab",
    tone: "warning",
    items: [
      {
        label: "Kenapa ER rendah?",
        hint: "Diagnosis dan langkah perbaikan",
        prompt: "Kenapa interaksi rendah dan apa solusinya?",
        icon: Search,
      },
      {
        label: "Pola postingan terbaik",
        hint: "Format, jam, dan gaya yang berhasil",
        prompt: "Apa pola postingan terbaik dan kenapa berhasil?",
        icon: Lightbulb,
      },
    ],
  },
  {
    title: "Buat konten",
    tone: "success",
    items: [
      {
        label: "Prompt peran akun",
        hint: "Role lengkap dari data akun, siap pakai",
        prompt: "Buatkan prompt peran yang lengkap untuk akun saya",
        icon: UserCog,
      },
      {
        label: "3 draf untuk besok",
        hint: "Siap edit dan jadwalkan",
        prompt: "Buat 3 draf postingan untuk besok",
        icon: PenLine,
      },
      {
        label: "Jadwalkan 3 post minggu ini",
        hint: "Ke jam ramai tiap akun",
        prompt: "Jadwalkan 3 post minggu ini",
        icon: CalendarClock,
      },
    ],
  },
];

export interface FollowUp {
  label: string;
  prompt: string;
}

/** Meminta asisten mengerjakan saran terakhirnya; server menyusun rencana aksi dan kartu pilihan waktu. */
const EXECUTE: FollowUp = { label: "Kerjakan saran ini otomatis", prompt: "Kerjakan saran tadi secara otomatis" };

const GENERIC: FollowUp[] = [
  { label: "Ringkasan 7 hari", prompt: "Ringkasan performa 7 hari terakhir" },
  { label: "Peringkat views", prompt: "Peringkat akun berdasarkan views minggu ini" },
  { label: "Pola postingan terbaik", prompt: "Apa pola postingan terbaik dan kenapa berhasil?" },
  { label: "3 draf untuk besok", prompt: "Buat 3 draf postingan untuk besok" },
];

/**
 * Saran lanjutan menurut isi jawaban terakhir. Kalimatnya dipilih agar jatuh ke jalur yang benar di
 * server (revisi draf, draf baru, atau analisis), bukan sekadar teks bebas.
 */
export function followUpsFor(last: ChatMessage | undefined): FollowUp[] {
  if (!last || last.role !== "assistant" || last.isError || last.pending) return GENERIC;

  if (last.drafts?.length) {
    return [
      { label: "Lebih singkat", prompt: "Ubah draf tadi jadi lebih singkat" },
      { label: "Lebih santai", prompt: "Ganti draf tadi dengan gaya yang lebih santai" },
      { label: "Hook lebih kuat", prompt: "Perbaiki draf tadi dengan hook yang lebih kuat di kalimat pertama" },
      { label: "3 draf lagi", prompt: "Buat 3 draf lagi dengan sudut yang berbeda" },
    ];
  }

  if (/```ide/.test(last.content)) {
    return [
      { label: "3 ide lagi", prompt: "Buat 3 ide lagi dengan sudut yang berbeda dari tadi" },
      { label: "Jam terbaik untuk ini", prompt: "Jam berapa paling bagus untuk memposting ide-ide tadi?" },
      { label: "Jadwalkan besok", prompt: "Jadwalkan 3 post besok" },
    ];
  }

  if (last.plan) return GENERIC;

  if (last.kind === "execution") {
    return [
      { label: "Lihat jadwal terdekat", prompt: "Apa saja yang sudah terjadwal di antrean sekarang?" },
      { label: "Bandingkan hasilnya nanti", prompt: "Bagaimana cara memantau hasil posting tadi dan kapan sebaiknya saya cek?" },
      { label: "Buat tugas berikutnya", prompt: "Dari hasil tadi, apa langkah berikutnya yang paling berdampak?" },
      { label: "Ringkasan 7 hari", prompt: "Ringkasan performa 7 hari terakhir" },
    ];
  }

  if (last.report) {
    return [
      EXECUTE,
      { label: "Kenapa ada yang turun?", prompt: "Akun mana yang turun paling tajam dan apa penyebabnya?" },
      { label: "Apa yang harus dilakukan?", prompt: "Dari laporan ini, 3 langkah apa yang paling berdampak minggu depan?" },
      { label: "Akun yang perlu dibenahi", prompt: "Akun mana yang paling perlu dibenahi dan kenapa?" },
      { label: "Ringkasan 30 hari", prompt: "Ringkasan performa 30 hari terakhir" },
    ];
  }

  return [
    EXECUTE,
    { label: "Jelaskan lebih rinci", prompt: "Jelaskan lebih rinci dengan angka pendukungnya" },
    { label: "Apa langkah selanjutnya?", prompt: "Dari analisis tadi, apa 3 langkah konkret yang harus saya lakukan?" },
    { label: "Buat draf dari ini", prompt: "Buat 3 draf postingan berdasarkan temuan tadi" },
  ];
}
