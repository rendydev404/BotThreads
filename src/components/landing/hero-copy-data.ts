/**
 * Teks judul + deskripsi bagian pembuka, dipakai bersama oleh HTML asli (page.tsx) dan animasi intro
 * Remotion (hero-film/headline-film.tsx). Kelasnya juga dibagi: animasi intro harus menata teks persis
 * sama dengan HTML-nya, karena diputar tepat di atasnya lalu diserahkan kembali ke teks asli.
 */

export const H1_CLASS = "lp-display mt-5 text-[clamp(2.35rem,11.5vw,3.1rem)] leading-[1] md:text-[4.4rem] md:leading-[0.95] font-extrabold";
export const DESC_CLASS = "mt-6 text-[1.08rem] md:text-[1.22rem] font-medium text-fg leading-[1.65] max-w-xl";
export const SUB_CLASS = "mt-3 text-[1.02rem] md:text-lg font-bold text-fg";

export const HEADLINE_LINES = [
  { text: "Threads Anda", className: "" },
  { text: "posting sendiri,", className: "lp-gradient-text" },
  { text: "setiap hari.", className: "" },
];

/** Deskripsi sebagai potongan; `key` = kata kunci yang ditebalkan dan menyala ke warna aksen. */
export const DESC: { text: string; key?: boolean }[] = [
  { text: "AI mencari ide dari " },
  { text: "posting terbaik Anda", key: true },
  { text: " dan " },
  { text: "tren hari ini", key: true },
  { text: ", menulis dengan " },
  { text: "suara brand", key: true },
  { text: ", memeriksa hasilnya, lalu menerbitkannya ke Threads di " },
  { text: "jam akun Anda paling ramai", key: true },
  { text: "." },
];

export const SUB = { lead: "Berapa kali sehari? ", accent: "Anda yang atur per akun." };
