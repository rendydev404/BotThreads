/**
 * Aturan gaya "manusia" bersama untuk semua tulisan AI yang tampil atas nama akun (postingan dan balasan komentar),
 * plus daftar ciri tulisan mesin untuk penilai kealamian. Satu sumber supaya nadanya konsisten dan gampang disetel.
 */

export interface VoiceOptions {
  /**
   * Postingan boleh berupa daftar polos ("1." / "-" per baris) karena gaya akun/niche memang memakainya (profil
   * layout atau contoh gaya berbentuk daftar, atau idenya tips/daftar). Markdown (huruf tebal, judul) tetap
   * dilarang. Balasan komentar tidak pernah memakai opsi ini.
   */
  plainLists?: boolean;
}

const FORMAT_STRICT = "- Tanpa tanda pisah panjang (— atau –), tanpa titik koma, tanpa tanda seru beruntun, tanpa daftar atau markdown.";
const FORMAT_LISTS =
  '- Tanpa tanda pisah panjang (— atau –), tanpa titik koma, tanpa tanda seru beruntun, tanpa markdown (huruf tebal **, judul #). Daftar polos boleh bila isinya memang daftar (tips, langkah, ranking): tiap butir satu baris pendek diawali "1." atau "-", tanpa judul dan tanpa huruf tebal.';

/** Aturan gaya manusia; `plainLists` hanya untuk postingan yang gaya akun/niche-nya memang memakai daftar. */
export function humanVoice(o: VoiceOptions = {}): string {
  return `GAYA MANUSIA (wajib untuk semua teks yang tampil atas nama akun)
Tulis seperti orang Indonesia asli yang lagi ngetik santai di HP, bukan seperti AI, admin, atau copywriter. Ikuti GAYA SAPAAN akun bila ada; aturan di bawah tetap berlaku.
- Bahasa sehari-hari yang wajar untuk akun itu ("gak/nggak", "udah", "aja", "banget", "kayak", "sih", "deh", "kok" boleh dipakai). Tidak perlu baku atau lengkap. Huruf kecil di awal kalimat dan tanpa titik di akhir boleh.
- Pendek dan langsung ke poin, satu ide saja. Sering cukup beberapa kata.
- JANGAN selalu menutup dengan pertanyaan. Kebanyakan teks TIDAK diakhiri pertanyaan; bertanya hanya bila benar-benar penasaran.
- JANGAN membuka dengan pola template seperti "Nah,", "Wah,", "Bener banget", "Setuju banget", "Haha bener", "Betul", "Menarik", "Pertanyaan bagus", "Kamu benar", atau "Poin bagus". Jangan memuji lawan bicara atau komentarnya.
- JANGAN mengulang atau merangkum ucapan orang dengan kata lain lalu menambah nasihat. Tanggapi seperti teman: setuju singkat, cerita kecil, candaan, atau beda pendapat.
- Hindari kata yang terdengar mesin: "ironisnya", "menariknya", "faktanya", "intinya", "pada akhirnya", "di era", "tak hanya ... tetapi juga", "tentu saja", "sangat", "krusial", "esensial", "perlu diingat", "mari kita".
${o.plainLists ? FORMAT_LISTS : FORMAT_STRICT}
- Jangan memakai struktur yang sama berulang (mis. setuju + penjelasan + pertanyaan). Teks yang terlalu rapi dan seimbang justru terasa AI.
- Emoji menyesuaikan suasana, seperti orang beneran: kadang pakai satu atau dua yang pas (mis. 😭 buat ngenes, 🤣 buat lucu, 🙏 buat sungkan), kadang tanpa emoji sama sekali. Jangan seragam di setiap teks, jangan menempel emoji di tiap kalimat, dan jangan emoji dekorasi (✨🚀💯) di akhir tanpa alasan. "wkwk"/"haha" boleh sesekali, bukan di setiap teks.`;
}

/** Aturan bawaan (tanpa daftar): dipakai balasan komentar dan semua teks yang tidak punya alasan memakai daftar. */
export const HUMAN_VOICE = humanVoice();

/** Ciri tulisan mesin yang menurunkan nilai "alami" di penilai. */
export const AI_TELLS =
  'ditutup pertanyaan pancingan yang tidak perlu, pembuka template ("Nah,", "Bener banget", "Haha bener", "Menarik"), memuji lawan bicara, mengulang ucapan orang lalu menasihati, tanda pisah panjang (—), kata seperti "ironisnya", "menariknya", "pada akhirnya", "di era", atau susunan kalimat yang terlalu rapi dan seimbang';

/**
 * Ciri tulisan mesin yang bisa dideteksi tanpa AI (cermin aturan HUMAN_VOICE). Tiap pola punya label untuk
 * ditunjukkan ke pengguna dan bobot untuk `humanScore`. `list` = pola daftar polos, dilewati bila `plainLists`.
 */
const SLOP_PATTERNS: { re: RegExp; label: string; weight: number; list?: true }[] = [
  { re: /[—–]/, label: "tanda pisah panjang", weight: 18 },
  { re: /;/, label: "titik koma", weight: 8 },
  { re: /!{2,}/, label: "tanda seru beruntun", weight: 10 },
  { re: /^\s*(nah|wah|bener banget|setuju banget|haha bener|betul|menarik|pertanyaan bagus|poin bagus)\b[,!.\s]/i, label: "pembuka template", weight: 18 },
  {
    re: /\b(ironisnya|menariknya|faktanya|intinya|pada akhirnya|di era|tak hanya|tidak hanya .{1,40} tetapi juga|tentu saja|krusial|esensial|perlu diingat|mari kita|siapa sangka|tahukah kamu|jangan lupa|yuk)\b/i,
    label: "kata khas mesin",
    weight: 16,
  },
  { re: /(halo|hai) (sobat|guys|teman)/i, label: "sapaan template", weight: 14 },
  { re: /(tetap semangat|semoga (hari|harimu|kalian)|jangan lupa bersyukur|gimana menurut kalian|kalian tim mana)/i, label: "penutup klise", weight: 14 },
  // Markdown selalu ciri mesin (Threads tidak merender huruf tebal/judul).
  { re: /\*\*|^\s*#{1,6}\s|#{2,}/m, label: "format markdown", weight: 12 },
  { re: /^\s*(?:[-*•]|\d{1,2}[.)])\s+\S/m, label: "format daftar", weight: 12, list: true },
  { re: /#\p{L}/u, label: "hashtag di badan teks", weight: 6 },
];

const EMOJI_G = /\p{Extended_Pictographic}/gu;

const activePatterns = (o: VoiceOptions) => (o.plainLists ? SLOP_PATTERNS.filter((p) => !p.list) : SLOP_PATTERNS);

/** Daftar ciri mesin yang ditemukan pada teks (kosong = tidak terdeteksi). */
export function slopTells(text: string, o: VoiceOptions = {}): string[] {
  const found = activePatterns(o)
    .filter((p) => p.re.test(text))
    .map((p) => p.label);
  if ((text.match(EMOJI_G)?.length ?? 0) > 2) found.push("emoji berlebihan");
  return found;
}

/** Skor kealamian 0-100 (100 = tidak ada ciri mesin yang terdeteksi). Penilaian kasar, bukan penilai AI. */
export function humanScore(text: string, o: VoiceOptions = {}): number {
  let penalty = 0;
  for (const p of activePatterns(o)) if (p.re.test(text)) penalty += p.weight;
  if ((text.match(EMOJI_G)?.length ?? 0) > 2) penalty += 10;
  return Math.max(0, 100 - penalty);
}

/**
 * Tanda pisah panjang (— –) khas tulisan mesin diganti koma. Rentang angka ("10–12") jadi tanda hubung biasa,
 * dan tanda di awal baris tidak disentuh.
 */
export const dropDashes = (text: string): string =>
  text
    .replace(/(\d)[ \t]*[—–][ \t]*(?=\d)/g, "$1-")
    .replace(/(\S)[ \t]*[—–][ \t]*/g, "$1, ")
    .replace(/,[ \t]*,/g, ",");
