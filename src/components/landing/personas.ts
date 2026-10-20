/**
 * Contoh brand untuk peraga halaman perkenalan. Semuanya tulisan tangan (bukan data pelanggan), tetapi
 * aturannya sama dengan yang dijalankan autopilot: jam ramai berjarak minimal 2,5 jam, gaya santai khas
 * Threads, dan ide selalu punya sumber. Dipakai peraga interaktif dan animasi Remotion di bagian pembuka.
 */

export const pad = (n: number): string => String(n).padStart(2, "0");

export interface Persona {
  key: string;
  label: string;
  handle: string;
  /** Rata-rata views per jam 00-23 (bentuknya saja yang penting). */
  hours: number[];
  posts: { text: string; from: string }[];
}

export const PERSONAS: Persona[] = [
  {
    key: "kuliner",
    label: "Kuliner",
    handle: "@kedai.sore",
    hours: [8, 4, 2, 1, 1, 3, 9, 16, 21, 18, 22, 41, 58, 37, 20, 19, 27, 44, 62, 71, 66, 48, 30, 15],
    posts: [
      { text: "jam 11 tuh jam paling rawan. belum laper-laper amat, tapi udah buka aplikasi pesen makan tiap 5 menit 🫠", from: "Jam makan siang" },
      { text: "tim saus dipisah apa tim langsung disiram? jawab jujur, ini nentuin kita bisa temenan apa nggak", from: "Posting terbaik minggu lalu" },
      { text: "tanggal 25, dompet senyum lagi. yang kemarin ngomong mau hemat, malem ini traktir siapa nih?", from: "Momen gajian" },
    ],
  },
  {
    key: "kopi",
    label: "Kedai kopi",
    handle: "@seduh.pagi",
    hours: [5, 3, 1, 1, 2, 9, 31, 55, 64, 47, 29, 22, 26, 33, 41, 38, 30, 24, 28, 36, 39, 27, 16, 9],
    posts: [
      { text: "senin itu bukan soal semangat. senin itu soal siapa yang nyampe kantor duluan dan kebagian kopi yang masih panas", from: "Momen awal pekan" },
      { text: "kopi susu gula aren udah 5 tahun dibilang tren sesaat. ya tetep di sini, tetep dipesen, tetep enak 🤷", from: "Tren pencarian" },
      { text: "jam 3 sore: mata berat, kerjaan numpuk, gelas kedua mulai kedengeran masuk akal", from: "Jam ramai akun ini" },
    ],
  },
  {
    key: "fashion",
    label: "Fashion",
    handle: "@lemari.kecil",
    hours: [12, 6, 3, 1, 1, 2, 6, 11, 14, 17, 21, 26, 34, 30, 24, 23, 29, 36, 43, 57, 74, 79, 58, 31],
    posts: [
      { text: "baju yang paling sering dipake tuh bukan yang paling mahal. tapi yang gak perlu disetrika. setuju gak?", from: "Posting terbaik minggu lalu" },
      { text: "outfit kondangan bulan ini udah 3x sama. solusinya bukan beli baju baru, tapi ganti circle. bercanda. dikit.", from: "Momen akhir pekan" },
      { text: "malem minggu, keranjang penuh, saldo bilang sabar dulu. kira-kira siapa yang menang malem ini? 😭", from: "Jam ramai akun ini" },
    ],
  },
];

/* ------------------------------------------------------------------ bisnis yang diketik pengunjung */

export const CUSTOM_KEY = "custom";

/** Contoh tambahan khusus kolom "coba untuk bisnis Anda" (tidak tampil sebagai tab). */
const EXTRA: Record<string, Omit<Persona, "key" | "label" | "handle">> = {
  kecantikan: {
    hours: [10, 5, 2, 1, 1, 2, 6, 12, 15, 17, 19, 22, 30, 26, 21, 20, 24, 31, 38, 47, 63, 77, 68, 33],
    posts: [
      { text: "skincare paling mahal itu yang udah dibeli tapi gak pernah dipake. yang paling murah? tidur cukup. dua-duanya penting sih", from: "Posting terbaik minggu lalu" },
      { text: "siang ini panasnya gak ngotak ☀️ sunscreen udah di-reapply belum? apa masih ngandelin yang tadi pagi jam 7", from: "Tren cuaca" },
      { text: "tim cuci muka 2x apa tim sekali aja cukup? kolom komen dibuka, silakan membela diri", from: "Jam ramai akun ini" },
    ],
  },
};

/** Kata kunci -> contoh yang paling mirip. Selain itu dipakai tulisan umum yang menyebut bisnisnya. */
const MATCHERS: [RegExp, string][] = [
  [/kopi|coffee|kafe|cafe|teh|boba|minum/, "kopi"],
  [/makan|kuliner|resto|warung|bakso|ayam|mie|kue|roti|bakery|katering|catering|seblak|martabak|sambal|frozen|snack|camilan/, "kuliner"],
  [/baju|fashion|hijab|outfit|sepatu|tas|thrift|kaos|batik|gamis/, "fashion"],
  [/skin|kosmetik|makeup|make up|salon|barber|kecantikan|parfum|spa|nail/, "kecantikan"],
];

const GENERIC_HOURS = [9, 5, 2, 1, 1, 3, 8, 15, 20, 22, 24, 30, 42, 35, 25, 23, 28, 37, 46, 58, 66, 61, 40, 18];

/** Nama akun contoh dari teks bebas: "Kopi Kenangan" -> "@kopi.kenangan", "skincare" -> "@skincare.id". */
function handleFor(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 18)
    .replace(/\.+$/, "");
  return `@${slug.includes(".") ? slug : `${slug || "bisnis"}.id`}`;
}

export function cleanBusiness(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 24);
}

/** Persona untuk bisnis yang diketik: posting dari contoh yang mirip, atau tulisan umum yang menyebut bisnisnya. */
function customPersona(raw: string): Persona {
  const text = cleanBusiness(raw) || "bisnis Anda";
  const lower = text.toLowerCase();
  const match = MATCHERS.find(([re]) => re.test(lower))?.[1];
  const base = match ? (PERSONAS.find((p) => p.key === match) ?? EXTRA[match]) : undefined;
  return {
    key: CUSTOM_KEY,
    label: text,
    handle: handleFor(text),
    hours: base?.hours ?? GENERIC_HOURS,
    posts: base?.posts ?? [
      { text: `jujur ya, ${lower} yang bagus tuh kerasa dari hal-hal kecil yang gak pernah dipamerin`, from: "Posting terbaik minggu lalu" },
      { text: `tanggal muda, rencana banyak. kalo hari ini cuma boleh pilih satu, ${lower} masuk list gak? 👀`, from: "Momen gajian" },
      { text: `pertanyaan serius nih: kalian pilih ${lower} karena harganya, karena kata temen, atau karena udah terlanjur cocok?`, from: "Tren pencarian" },
    ],
  };
}

/** Persona untuk kunci contoh brand, atau untuk bisnis yang diketik pengunjung (key = CUSTOM_KEY). */
export function personaFor(key: string, custom: string): Persona {
  if (key === CUSTOM_KEY) return customPersona(custom);
  return PERSONAS.find((p) => p.key === key) ?? PERSONAS[0];
}

/* ------------------------------------------------------------------ jam ramai */

/** Pilih `n` jam terbaik yang berjarak minimal 3 jam (aturan produk: jeda minimal 150 menit). */
export function pickHours(hours: number[], n: number): number[] {
  const order = hours.map((v, h) => ({ v, h })).filter((x) => x.h >= 6).sort((a, b) => b.v - a.v);
  const out: number[] = [];
  for (const { h } of order) {
    if (out.length >= n) break;
    if (out.every((o) => Math.abs(o - h) >= 3)) out.push(h);
  }
  return out.sort((a, b) => a - b);
}

/** Menit tayang digeser sedikit supaya tidak tampak seperti mesin (di produk: 0-17 menit per akun per hari). */
export const jitter = (h: number, seed: number): number => (h * 7 + seed * 5) % 18;
