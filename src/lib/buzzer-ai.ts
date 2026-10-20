/**
 * Mesin AI Lintas-Niche untuk Buzzer (Komentar, Quote Share, dan Penyusunan Niche/Persona).
 *
 * Aturan inti perilaku komentar & kutipan lintas-niche:
 * 1. SEJALUR  (niche dekat/relevan)  -> nimbrung santai dengan reaksi atau pengalaman singkat yang nyambung.
 * 2. JEMBATAN (lintas niche dekat)   -> nimbrung kasual sambil menyelipkan sudut pandang/keseharian niche buzzer
 *                                       secara natural (tidak maksa, terasa organik seperti warga Threads).
 * 3. JAUH     (lintas niche jauh)    -> nimbrung santai sebagai netizen awam yang kebetulan lewat di timeline
 *                                       lalu bertanya secara natural dan penasaran.
 *
 * Seluruh teks melewati HUMAN_VOICE, pembersihan tanda pisah (dropDashes), saringan anti-template, dan
 * deduplikasi pembuka kalimat antar-buzzer dalam satu gelombang pengerahan.
 */
import { VOICE_STYLES, type VoiceStyle } from "./autopilot-types";
import type {
  BuzzerAccountDTO,
  BuzzerDraftItem,
  BuzzerNicheRelation,
  BuzzerProfilePatch,
} from "./buzzer-types";
import { generateWithFailover, type GeminiSchema } from "./gemini";
import { HUMAN_VOICE, dropDashes } from "./human-voice";
import { clipChars } from "./threads-text";

const BATCH_SIZE = 5;
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|id|net|co|ly|me)\b)/i;
const CODE =
  /`|=>|\b\w+\.\w+\([^)]*\)|[;{}][ \t]*$|\(\)[ \t]*[;{]|<\/?[a-z][a-z0-9]*[\s>/]|^[ \t]*(import|export|const|let|var|function|def|class|return|npm|npx|pip|git|sudo|curl)\s|\bSELECT\s.+\sFROM\b/im;

/** Pembuka kaku/template khas AI yang wajib dibuang bila muncul di awal kalimat. */
const ROBOTIC_OPENERS =
  /^(?:wah\s+menarik\s+sekali|setuju\s+banget|bener\s+banget|betul\s+banget|nah\s*,\s*|wah\s*,\s*|terima\s+kasih\s+(?:sudah|telah)\s+berbagi|informasi\s+yang\s+sangat\s+bermanfaat|postingan\s+yang\s+menarik|poin\s+yang\s+bagus)[,!.\s]*/i;

const clean = (s: string, max: number): string =>
  clipChars(s.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim(), max);

/** Rapikan dan saring teks komentar/kutipan buzzer agar 100% terlihat manusiawi dan aman. */
export function cleanBuzzerText(raw: string): string | null {
  if (!raw || CODE.test(raw)) return null;
  let text = dropDashes(
    raw
      .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "")
      .replace(/#\S+/g, "")
      .replace(/\*+/g, "")
  )
    .replace(ROBOTIC_OPENERS, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || [...text].length < 4 || [...text].length > 280 || LINK.test(text)) return null;
  return text;
}

/* ------------------------------------------------------------------ 1. Inferensi Niche & Persona dari Data Akun */

interface ArchetypeSeed {
  keywords: RegExp;
  niche: string;
  persona: string;
  voiceStyle: VoiceStyle;
}

const POST_ARCHETYPES: ArchetypeSeed[] = [
  {
    keywords: /\b(jira|deploy|koding|coding|bug|developer|programmer|sprint|pull request|server)\b/i,
    niche: "Software engineer, kerja IT & kehidupan tech",
    persona: "Anak IT yang sering lembur depan laptop, suka kopi dan jajanan malam, gaya ngobrol santai pakai gue/lo",
    voiceStyle: "gue_lo",
  },
  {
    keywords: /\b(pembukuan|verifikasi|rekonsiliasi|invoice|akuntansi|finance|excel|laporan bulanan)\b/i,
    niche: "Karyawati finance/akuntansi & kehidupan kantor",
    persona: "Staf finance kantoran yang teliti, suka jajan sore bareng teman divisi, pakai aku, ramah dan santai",
    voiceStyle: "aku_kamu",
  },
  {
    keywords: /\b(kurir|ekspedisi|pick\s*up|karung paket|orderan|packing|jualan online|resi)\b/i,
    niche: "Seller online shop, UMKM & ibu pekerja",
    persona: "Ibu pekerja sekaligus seller olshop rumahan yang sibuk packing paket tiap malam, pakai aku, semangat dan akrab",
    voiceStyle: "aku_kamu",
  },
  {
    keywords: /\b(pom bensin|tangki motor|narik|ojol|helm|jalanan|aspal|orderan masuk)\b/i,
    niche: "Pekerja lapangan, motoran & kuliner jalanan",
    persona: "Anak lapangan yang tiap hari di jalan naik motor, paham jajanan pinggir jalan, santai dan apa adanya",
    voiceStyle: "gue_lo",
  },
  {
    keywords: /\b(kartu bergambar|paud|tk\b|murid|mengajar|guru|kelas)\b/i,
    niche: "Guru PAUD/TK, edukasi anak & kehidupan anak kos",
    persona: "Guru PAUD/TK muda yang tinggal di kosan, sabar, suka cerita keseharian ngajar bocil, pakai aku",
    voiceStyle: "aku_kamu",
  },
  {
    keywords: /\b(maskeran|skincare|serum|moisturizer|drakor|film|rebahan di kasur kamar kosan)\b/i,
    niche: "Skincare, tontonan film/drakor & anak kos",
    persona: "Cewek kosan pecinta skincare dan maraton film malam Jumat, santai, suka racun barang bagus",
    voiceStyle: "aku_kamu",
  },
  {
    keywords: /\b(peron|stasiun|krl|commuter|kereta|gerbong)\b/i,
    niche: "Commuter KRL, pekerja kantoran & keluarga",
    persona: "Pejuang KRL Jabodetabek pulang pergi kerja, agak sarkas halus tapi hangat, pakai aku",
    voiceStyle: "aku_kamu",
  },
  {
    keywords: /\b(pengantin baru|suami baru|daftar belanjaan|masak berdua)\b/i,
    niche: "Pengantin baru, masak rumahan & belanja harian",
    persona: "Pengantin baru yang lagi seru-serunya ngurus rumah dan nyoba resep/jajanan baru bareng suami, pakai aku",
    voiceStyle: "aku_kamu",
  },
  {
    keywords: /\b(anak sd|buku pelajaran|dua bocah|ibu rumah tangga|bekal anak)\b/i,
    niche: "Ibu rumah tangga, parenting anak SD & kuliner keluarga",
    persona: "Ibu rumah tangga dengan 2 anak SD, hangat, suka bahas urusan rumah dan cemilan anak, pakai aku",
    voiceStyle: "aku_kamu",
  },
  {
    keywords: /\b(si kecil|pules tidur|ayah|shift|keluarga kecil)\b/i,
    niche: "Ayah muda, keluarga kecil & pekerja shift",
    persona: "Bapak muda pekerja keras yang sayang keluarga, suka beliin makanan buat istri dan anak di rumah, santai",
    voiceStyle: "saya_kamu",
  },
  {
    keywords: /\b(kontrakan|teh hangat|usaha rumahan)\b/i,
    niche: "Keluarga muda kontrakan, hidup hemat & kuliner",
    persona: "Ibu muda di kontrakan yang suka suasana tenang dan jajanan hemat keluarga, pakai aku, hangat",
    voiceStyle: "aku_kamu",
  },
  {
    keywords: /\b(kosan|semester akhir|skripsi|kuliah|anak-anak kos)\b/i,
    niche: "Mahasiswi semester akhir, anak kos & kuliner hemat",
    persona: "Mahasiswi tingkat akhir anak kos, receh, singkat, pakai gue/lo, suka berburu makanan enak murah",
    voiceStyle: "gue_lo",
  },
  {
    keywords: /\b(rantau|teman-teman lama|karier|lembur)\b/i,
    niche: "Anak rantau, karier awal & gaya hidup anak muda",
    persona: "Pekerja muda perantauan yang suka ngopi, nongkrong malam, dan ngobrol santai soal hidup",
    voiceStyle: "gue_lo",
  },
];

/** Archetype cadangan yang beragam supaya akun buzzer yang belum punya histori tetap punya karakter unik. */
const FALLBACK_ARCHETYPES: { niche: string; persona: string; voiceStyle: VoiceStyle }[] = [
  {
    niche: "Anak kos, kuliah & berburu kuliner malam",
    persona: "Mahasiswa anak kos yang sering lapar tengah malam, santai, receh, pakai gue/lo",
    voiceStyle: "gue_lo",
  },
  {
    niche: "Karyawan swasta, ngopi & kehidupan komuter",
    persona: "Karyawan kantoran yang hobi ngopi sore dan cari jajanan sepulang kerja, santai",
    voiceStyle: "aku_kamu",
  },
  {
    niche: "Ibu muda, parenting & masak praktis",
    persona: "Ibu muda yang suka cari ide cemilan keluarga dan cerita keseharian di rumah, pakai aku, ramah",
    voiceStyle: "aku_kamu",
  },
  {
    niche: "Freelancer desain, kerja WFC & gadget",
    persona: "Freelancer kreatif yang sering kerja dari kafe, suka mengamati tren baru, pakai gue/lo",
    voiceStyle: "gue_lo",
  },
  {
    niche: "Pecinta olahraga lari, gym pemula & hidup sehat",
    persona: "Anak muda yang lagi rajin olahraga pagi tapi tetap suka cheating day kulineran, santai",
    voiceStyle: "gue_lo",
  },
  {
    niche: "Penggemar film, musik & pop culture",
    persona: "Netizen aktif yang suka bahas tontonan akhir pekan dan tempat nongkrong seru, humoris",
    voiceStyle: "aku_kamu",
  },
  {
    niche: "UMKM rumahan, jualan online & tips hemat",
    persona: "Pelaku usaha rumahan yang ramah, suka ngobrol soal keseharian dan jajan bareng keluarga, pakai aku",
    voiceStyle: "aku_kamu",
  },
  {
    niche: "Otomotif harian, touring motor & kuliner pinggir jalan",
    persona: "Penghobi motoran santai yang hafal tempat makan enak di berbagai sudut kota, kasual",
    voiceStyle: "gue_lo",
  },
  {
    niche: "Karyawati HR/admin, skincare & lifestyle",
    persona: "Karyawati kantor yang suka sharing seputar kerjaan, skincare, dan jajanan hits, pakai aku",
    voiceStyle: "aku_kamu",
  },
  {
    niche: "Gamer kasual, teknologi & obrolan malam",
    persona: "Anak muda melek teknologi yang sering begadang dan nimbrung obrolan seru di Threads, pakai gue/lo",
    voiceStyle: "gue_lo",
  },
  {
    niche: "Barista kopi, musik indie & nongkrong malam",
    persona: "Anak skena kopi yang santai, suka ngulik racikan minuman dan obrolan tongkrongan malam, pakai gue/lo",
    voiceStyle: "gue_lo",
  },
  {
    niche: "Staf akuntansi, excel & kuliner makan siang",
    persona: "Karyawati finance yang teliti urusan angka, hobi berburu promo makan siang bareng teman kantor, pakai aku",
    voiceStyle: "aku_kamu",
  },
  {
    niche: "Fotografer jalanan, visual & keliling kota",
    persona: "Penghobi foto jalanan dan sudut kota yang suka mampir ke tempat makan unik, santai, pakai gue/lo",
    voiceStyle: "gue_lo",
  },
  {
    niche: "Ayah muda, kerja shift & keluarga kecil",
    persona: "Bapak muda pekerja keras yang sayang anak istri, suka bawa pulang makanan enak buat orang rumah",
    voiceStyle: "saya_kamu",
  },
  {
    niche: "Guru les privat, buku & kehidupan anak kos",
    persona: "Pengajar les privat yang sabar, suka baca buku dan berbagi cerita keseharian ngajar, pakai aku",
    voiceStyle: "aku_kamu",
  },
  {
    niche: "Content creator pemula, edit video & medsos",
    persona: "Anak muda yang lagi rajin bikin konten pendek di HP, antusias bahas tren sosial media, pakai gue/lo",
    voiceStyle: "gue_lo",
  },
  {
    niche: "Pecinta kucing, tanaman hias & dekor rumah",
    persona: "Warga rumahan yang hobi ngurus kucing dan pojok rumah estetik, hangat dan ramah, pakai aku",
    voiceStyle: "aku_kamu",
  },
  {
    niche: "Mahasiswa teknik, organisasi kampus & begadang",
    persona: "Anak teknik yang sering nginep di sekre atau kosan temen, gaya bicara lugas dan santai, pakai gue/lo",
    voiceStyle: "gue_lo",
  },
];

/** Simpulkan niche, persona, dan voiceStyle dari data akun buzzer yang ada (tanpa panggilan API). */
export function inferProfileHeuristic(
  account: Pick<BuzzerAccountDTO, "accountId" | "username" | "displayName" | "niche" | "persona" | "voiceStyle" | "samplePosts">,
  index = 0
): BuzzerProfilePatch {
  const joined = `${account.persona} ${account.niche} ${account.samplePosts.join(" ")}`;
  const hasExplicitProfile = account.niche.trim().length > 0 && account.persona.trim().length > 0;
  for (const arch of POST_ARCHETYPES) {
    if (arch.keywords.test(joined)) {
      return {
        accountId: account.accountId,
        aktif: true,
        niche: account.niche.trim() || arch.niche,
        persona: account.persona.trim() || arch.persona,
        voiceStyle: hasExplicitProfile && account.voiceStyle in VOICE_STYLES ? account.voiceStyle : arch.voiceStyle,
        inferredFrom: account.persona.trim() ? "AUTO_COMMENT" : "HISTORI",
      };
    }
  }
  if (account.persona.trim()) {
    const lower = account.persona.toLowerCase();
    const voice: VoiceStyle =
      lower.includes('"gue"') || lower.includes("'gue'") || /\bgue\b/.test(lower)
        ? "gue_lo"
        : lower.includes('"saya"') || /\bsaya\b/.test(lower)
          ? "saya_kamu"
          : "aku_kamu";
    const niche = account.niche.trim() || account.persona.split(",")[0]?.trim() || "Keseharian & gaya hidup";
    return {
      accountId: account.accountId,
      aktif: true,
      niche: clean(niche, 120),
      persona: clean(account.persona, 260),
      voiceStyle: voice,
      inferredFrom: "AUTO_COMMENT",
    };
  }
  const fb = FALLBACK_ARCHETYPES[index % FALLBACK_ARCHETYPES.length];
  return {
    accountId: account.accountId,
    aktif: true,
    niche: fb.niche,
    persona: fb.persona,
    voiceStyle: fb.voiceStyle,
    inferredFrom: "AI",
  };
}

/* ------------------------------------------------------------------ 2. Klasifikasi Jarak Niche (SEJALUR / JEMBATAN / JAUH) */

const STOPWORDS = new Set([
  "yang", "dan", "di", "ke", "dari", "ini", "itu", "untuk", "dengan", "bisa", "ada", "jadi", "kalo", "kalau",
  "buat", "sama", "aja", "banget", "udah", "sudah", "lagi", "tapi", "atau", "juga", "sih", "deh", "dong",
  "kami", "kita", "aku", "gue", "saya", "kamu", "lo", "dia", "mereka", "nya", "ya", "nih", "tuh", "pas",
  "anak", "orang", "suka", "sering", "hari", "tiap", "malam", "pagi", "sore", "hidup", "gaya",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
  );
}

const THEME_CLUSTERS: { name: string; re: RegExp; bridgeableWith: string[] }[] = [
  {
    name: "TECH_DIGITAL",
    re: /\b(ai\b|prompt|prompting|coding|koding|software|developer|programmer|algoritma|server|gpu|llm|react|nextjs|typescript|aplikasi|web|teknologi|tech|gadget|laptop|komputer|desain|freelancer|wfc|game|gamer|digital|bot|otomatis|otomasi|data|sistem|fitur|produk|tools|tool)\b/i,
    bridgeableWith: ["OFFICE_BIZ", "YOUTH_ENTERTAINMENT", "EDUCATION"],
  },
  {
    name: "OFFICE_BIZ",
    re: /\b(kantor|kantoran|karyawan|karyawati|swasta|kerja|kerjaan|lembur|meeting|rapat|krl|commuter|komuter|stasiun|finance|akuntansi|pembukuan|excel|invoice|gajian|karier|hr\b|admin|umkm|jualan|olshop|seller|orderan|paket|kurir|packing|usaha|bisnis|cuan|toko|pelanggan|shift)\b/i,
    bridgeableWith: ["TECH_DIGITAL", "FOOD_DAILY", "FAMILY_HOME", "YOUTH_ENTERTAINMENT", "FIELD_MOTOR"],
  },
  {
    name: "FOOD_DAILY",
    re: /\b(makan|makanan|kuliner|kulineran|jajan|jajanan|lapar|laper|kopi|ngopi|minum|shawarma|kebab|ayam|daging|sapi|pedas|pedes|roti|cemilan|porsi|menu|warung|kafe|resto|masak|resep|dapur|belanja|belanjaan|anget|hangat|gurih|kenyang|malem|malam|promo|diskon|hemat)\b/i,
    bridgeableWith: ["TECH_DIGITAL", "OFFICE_BIZ", "FAMILY_HOME", "YOUTH_ENTERTAINMENT", "FIELD_MOTOR", "EDUCATION"],
  },
  {
    name: "FAMILY_HOME",
    re: /\b(ibu|bunda|ayah|bapak|rumah|tangga|bocil|bocah|suami|istri|pengantin|keluarga|parenting|kontrakan|bekal|si kecil|masak rumahan|belanja harian)\b/i,
    bridgeableWith: ["FOOD_DAILY", "OFFICE_BIZ", "EDUCATION", "YOUTH_ENTERTAINMENT"],
  },
  {
    name: "EDUCATION",
    re: /\b(guru|paud|tk\b|sd\b|murid|mengajar|kelas|sekolah|edukasi|belajar|kuliah|kampus|skripsi|mahasiswa|mahasiswi|semester|buku|pelajaran)\b/i,
    bridgeableWith: ["TECH_DIGITAL", "FAMILY_HOME", "YOUTH_ENTERTAINMENT", "FOOD_DAILY", "OFFICE_BIZ"],
  },
  {
    name: "YOUTH_ENTERTAINMENT",
    re: /\b(kos|kosan|rantau|film|drakor|musik|pop culture|skincare|serum|moisturizer|maskeran|olahraga|lari|gym|sehat|nongkrong|tongkrongan|receh|viral|timeline|beranda)\b/i,
    bridgeableWith: ["FOOD_DAILY", "TECH_DIGITAL", "OFFICE_BIZ", "EDUCATION", "FAMILY_HOME", "FIELD_MOTOR"],
  },
  {
    name: "FIELD_MOTOR",
    re: /\b(motor|motoran|touring|jalanan|lapangan|ojol|narik|aspal|helm|pom bensin|tangki|otomotif)\b/i,
    bridgeableWith: ["FOOD_DAILY", "OFFICE_BIZ", "YOUTH_ENTERTAINMENT"],
  },
];

const BROAD_EVERYDAY_THEMES = THEME_CLUSTERS[2].re;
const SPECIALIZED_TECH_THEMES = THEME_CLUSTERS[0].re;

function detectClusters(text: string): Set<string> {
  const out = new Set<string>();
  for (const c of THEME_CLUSTERS) {
    if (c.re.test(text)) out.add(c.name);
  }
  return out;
}

const TECH_CORE_RE =
  /\b(ai\b|prompt|prompting|coding|koding|software|developer|programmer|algoritma|server|gpu|llm|react|nextjs|typescript|aplikasi|web|teknologi|tech|gadget|laptop|komputer|desain|freelancer|wfc|game|gamer|digital|bot|otomatis|otomasi)\b/i;

const TECH_BRIDGE_BUZZER_RE =
  /\b(kantor|kantoran|karyawan|karyawati|swasta|kerja|lembur|krl|commuter|komuter|finance|akuntansi|pembukuan|excel|hr\b|admin|umkm|jualan|olshop|seller|guru|paud|tk\b|edukasi|mengajar|kuliah|kampus|skripsi|mahasiswa|mahasiswi|semester|anak kos|kosan|film|musik|pop culture|drakor|skincare|olahraga|lari|gym)\b/i;

/**
 * Klasifikasi jarak antara niche postingan target dan niche buzzer:
 * - SEJALUR  : satu klaster tema atau banyak irisan kata -> nimbrung relate langsung (tanpa bertanya)
 * - JEMBATAN : lintas niche yang bisa disambungkan -> nimbrung sambil bawa sudut pandang niche buzzer (tanpa bertanya)
 * - JAUH     : beda dunia cukup jauh -> nimbrung sebagai warga awam & bertanya secara kasual
 */
export function classifyNicheRelation(
  targetText: string,
  targetNiche: string,
  buzzerNiche: string,
  buzzerPersona: string
): { relation: BuzzerNicheRelation; reason: string } {
  const targetCombined = `${targetNiche} ${targetText}`;
  const buzzerCombined = `${buzzerNiche} ${buzzerPersona}`;
  const targetTokens = tokenize(targetCombined);
  const buzzerTokens = tokenize(buzzerCombined);

  let overlap = 0;
  for (const t of buzzerTokens) {
    if (targetTokens.has(t)) overlap++;
  }

  const targetIsTech = TECH_CORE_RE.test(targetCombined);
  const buzzerIsTech = TECH_CORE_RE.test(buzzerCombined);

  // Jika postingan bertema teknologi/digital/AI/koding:
  if (targetIsTech) {
    if (buzzerIsTech || overlap >= 2) {
      return {
        relation: "SEJALUR",
        reason: `Nyambung langsung dengan niche buzzer (${clean(buzzerNiche, 60)}); nimbrung relate secara kasual`,
      };
    }
    if (TECH_BRIDGE_BUZZER_RE.test(buzzerCombined) || overlap >= 1) {
      return {
        relation: "JEMBATAN",
        reason: `Lintas niche; nimbrung santai sambil bawa sudut pandang ${clean(buzzerNiche, 60)}`,
      };
    }
    return {
      relation: "JAUH",
      reason: `Topik di luar keseharian ${clean(buzzerNiche, 55)}; nimbrung santai sambil bertanya`,
    };
  }

  const targetClusters = detectClusters(targetCombined);
  const buzzerClusters = detectClusters(buzzerCombined);

  // 1. Apakah ada klaster tema yang sama persis atau irisan kata kuat (>= 2 kata)? -> SEJALUR
  let sameCluster = false;
  for (const c of buzzerClusters) {
    if (targetClusters.has(c)) {
      sameCluster = true;
      break;
    }
  }
  if (overlap >= 2 || sameCluster) {
    return {
      relation: "SEJALUR",
      reason: `Nyambung langsung dengan niche buzzer (${clean(buzzerNiche, 60)}); nimbrung relate secara kasual`,
    };
  }

  // 2. Apakah klaster buzzer bisa menjembatani klaster postingan target, atau topik kuliner/harian? -> JEMBATAN
  let canBridge = overlap >= 1 || targetClusters.has("FOOD_DAILY") || targetClusters.size === 0;
  if (!canBridge) {
    for (const tc of targetClusters) {
      const meta = THEME_CLUSTERS.find((x) => x.name === tc);
      if (!meta) continue;
      for (const bc of buzzerClusters) {
        if (meta.bridgeableWith.includes(bc)) {
          canBridge = true;
          break;
        }
      }
    }
  }

  if (canBridge) {
    return {
      relation: "JEMBATAN",
      reason: `Lintas niche; nimbrung santai sambil bawa sudut pandang ${clean(buzzerNiche, 60)}`,
    };
  }

  // 3. Sisanya benar-benar lintas jauh
  return {
    relation: "JAUH",
    reason: `Topik di luar keseharian ${clean(buzzerNiche, 55)}; nimbrung santai sambil bertanya`,
  };
}

/* ------------------------------------------------------------------ 3. Generator AI Komentar & Quote Lintas-Niche */

const hasLlmEnv = (): boolean =>
  Boolean(
    process.env.GEMINI_API_KEY ||
      process.env.HERMES_API_KEY ||
      process.env.HERMES_BASE_URL ||
      (process.env.HERMES_HOST && process.env.NINE_ROUTER_PORT)
  );

const DRAFT_SYSTEM = `Anda adalah sutradara percakapan organik Threads Indonesia yang menulis komentar atau kutipan (quote post) untuk beberapa akun warga net (buzzer) dengan niche dan kepribadian yang berbeda-beda.
Tujuan utama: meramaikan postingan target secara 100% NATURAL, KASUAL, dan MANUSIAWI seperti warga Threads asli yang sedang scroll HP. TIDAK BOLEH terlihat seperti bot, template seragam, atau AI.

ATURAN INTI LINTAS-NICHE & VARIASI BENTUK KALIMAT (WAJIB PATUH):
Setiap akun buzzer memiliki "Niche Buzzer", "Persona", dan "Mode Relasi":
1. Mode "SEJALUR" (niche buzzer nyambung dengan topik postingan):
   - Tulis PERNYATAAN kasual, celetukan relate, opini singkat, atau pengalaman 1 kalimat yang relevan langsung dengan topik postingan.
   - DILARANG bertanya (JANGAN pakai tanda tanya "?").
2. Mode "JEMBATAN" (lintas niche yang disambungkan ke keseharian buzzer):
   - Tulis PERNYATAAN atau reaksi santai yang menanggapi isi postingan SAMBIL menyelipkan sedikit konteks keseharian/profesi/niche si buzzer secara mulus dan natural!
   - DILARANG bertanya (JANGAN pakai tanda tanya "?").
   - Contoh alami (perhatikan tiap akun membawa dunianya sendiri tanpa kaku):
     * Freelancer desain/WFC: "pas banget lagi kerja di kafe buka timeline nemu bahasan ini, emang kerasa banget sih efeknya"
     * Karyawan komuter/KRL: "baca ini sambil berdiri di gerbong KRL pulang kerja langsung manggut-manggut sendiri"
     * Guru PAUD/TK: "habis beresin mainan bocil di kelas buka threads lewat bahasan ini, lumayan nambah insight baru"
     * Pengantin baru: "suami aku semalem juga baru banget ngomongin hal persis kayak gini pas lagi santai di rumah"
     * Pekerja lapangan/motoran: "lagi minggir ngopi bentar abis muter jalanan, nyimak obrolan gini seru juga ternyata"
     * Anak kos/kuliah: "anak kosan kayak gue paling seneng nih kalo udah nemu bahasan yang aplikatif gini"
3. Mode "JAUH" (hanya untuk sebagian kecil akun yang nichenya benar-benar jauh):
   - Buzzer nimbrung santai sambil bertanya secara spesifik dari sudut pandang kesehariannya sendiri (tetap sebutkan konteks dirinya, JANGAN pertanyaan template umum!).
   - Contoh alami:
     * Ibu muda/parenting: "aku yang sehari-hari ngurus bocil di rumah jujur baru denger soal ini, kalo buat rumahan kepake juga ga ya kak?"
     * Seller olshop/UMKM: "kalo diterapin buat usaha rumahan kecil-kecilan kayak tempat aku kira-kira cocok ga ya bang?"

ATURAN KEBERAGAMAN MUTLAK ANTAR-AKUN:
- JANGAN PERNAH membuat semua akun bertanya! Mayoritas akun wajib berupa komentar pernyataan/reaksi/cerita pendek, hanya akun bermode JAUH yang bertanya.
- Setiap akun WAJIB punya pembuka kalimat, diksi, panjang kalimat (antara 5 sampai 18 kata), dan sudut pandang yang BERBEDA sesuai Niche & Persona-nya.
- Sebagian akun boleh memakai huruf kecil semua tanpa titik di akhir (gaya ketikan HP di Threads), sebagian normal.
- Ikuti kata ganti masing-masing akun ("gue/lo", "aku", "saya", atau tanpa kata ganti).
- DILARANG menulis hashtag, markdown, link, atau tanda pisah panjang (—).

${HUMAN_VOICE}`;

const DRAFT_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    targetNiche: { type: "STRING" },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          buzzerAccountId: { type: "STRING" },
          nicheRelation: { type: "STRING" },
          text: { type: "STRING" },
          alasanRelasi: { type: "STRING" },
        },
        required: ["buzzerAccountId", "nicheRelation", "text", "alasanRelasi"],
      },
    },
  },
  required: ["targetNiche", "items"],
};

/** Ekstrak topik singkat (1-3 kata kunci) dari teks postingan target agar fallback tetap spesifik ke isi postingan. */
function extractTargetTopicHint(targetText: string): string {
  const lower = targetText.toLowerCase();
  if (/\bshawarma\b/.test(lower)) return "shawarma";
  if (/\b(kuliner|makan|jajan|menu|porsi|pedas|ayam|daging|kopi)\b/.test(lower)) return "makanan gini";
  if (/\b(ai|prompt|prompting|llm|gpt|bot|otomasi)\b/.test(lower)) return "urusan AI gini";
  if (/\b(coding|koding|software|developer|aplikasi|web|bug|server|arsitektur)\b/.test(lower)) return "teknologi gini";
  if (/\b(bisnis|usaha|jualan|omzet|cuan|marketing|iklan|konten)\b/.test(lower)) return "strategi usaha gini";
  if (/\b(kerja|kantor|karier|lembur|gaji|produktivitas)\b/.test(lower)) return "urusan kerjaan gini";
  const words = [...tokenize(targetText)].slice(0, 2);
  return words.length > 0 ? `soal ${words.join(" ")}` : "bahasan gini";
}

/**
 * Fallback kontekstual per-archetype: bila LLM lambat/offline, setiap buzzer tetap menghasilkan komentar
 * yang 100% spesifik dengan niche/persona dirinya + topik postingan target, dengan kalimat yang berbeda-beda.
 */
export function buildFallbackDraft(
  buzzer: Pick<BuzzerAccountDTO, "accountId" | "username" | "displayName" | "niche" | "persona" | "voiceStyle">,
  action: "KOMEN" | "QUOTE",
  relation: BuzzerNicheRelation,
  targetText: string,
  index: number
): string {
  const isGue = buzzer.voiceStyle === "gue_lo" || /\bgue\b/i.test(buzzer.persona);
  const me = isGue ? "gue" : buzzer.voiceStyle === "saya_kamu" ? "saya" : "aku";
  const np = `${buzzer.niche} ${buzzer.persona}`.toLowerCase();
  const topic = extractTargetTopicHint(targetText);
  const isFood = /\b(shawarma|makan|kuliner|pedas|ayam|sapi|daging|roti|kebab|jajan|lapar|enak|porsi|menu)\b/i.test(targetText);

  if (action === "QUOTE") {
    const quotePool = [
      `pas lagi sela-sela aktivitas baca ${topic}, menarik banget sudut pandangnya`,
      `valid sih ini, dari kemarin ${me} juga kepikiran hal yang mirip soal ${topic}`,
      `simpen dulu di profil ${me}, lumayan banget buat referensi minggu ini`,
      `nah ini jarang dibahas nih, padahal penting banget buat sehari-hari`,
      `lewat di beranda ${me} pas jam istirahat, boleh juga idenya`,
      `setuju sama poin utamanya, simpel tapi sering kelewat`,
    ];
    return quotePool[index % quotePool.length];
  }

  // Komentar spesifik berdasarkan identitas niche buzzer untuk mode SEJALUR & JEMBATAN (pernyataan kasual, TANPA tanda tanya)
  if (relation === "SEJALUR" || relation === "JEMBATAN") {
    const pick = (arr: string[]) => arr[index % arr.length];

    if (/\b(gamer|game|teknologi)\b/.test(np) && index < 30) {
      return pick(
        isFood
          ? [
              `pas banget lagi begadang main game liat ${topic} lewat di timeline, auto laper malem-malem`,
              `anak begadang kayak ${me} paling ga tahan kalo jam segini beranda lewat ${topic}`,
              `cocok banget nih ${topic} buat temen mabar malem minggu bareng anak-anak`,
            ]
          : [
              `sebagai yang tiap malem ngulik teknologi sama game, poin ${topic} ini emang kerasa banget sih di lapangan`,
              `bener banget, kalo udah biasa ngulik teknologi gini emang bikin alur kerjaan jauh lebih praktis`,
              `valid sih, anak-anak tongkrongan discord ${me} belakangan juga sering banget bahas ${topic}`,
            ]
      );
    }
    if (/\b(freelancer|desain|wfc|gadget|fotografer|creator|video)\b/.test(np) && index < 30) {
      return pick(
        isFood
          ? [
              `abis kelar revisi desain klien pas WFC liat ${topic} gini langsung pengen pesen buat temen kerja`,
              `lagi WFC depan laptop liat ${topic} seliweran di beranda langsung buyar fokus ${me}`,
              `beres render kerjaan klien malam ini wajib melipir nyobain ${topic} sih`,
            ]
          : [
              `pas lagi WFC di kafe sambil ngerjain desain, bahasan ${topic} gini emang paling relate sih buat kerjaan kreatif`,
              `kerasa banget sih ini, semenjak alur kerjaan kreatif dibantu ${topic} revisian klien jadi jauh lebih cepet beres`,
              `sebagai freelancer yang kerja serba sendiri, bahasan ${topic} gini beneran ngasih sudut pandang segar`,
            ]
      );
    }
    if (/\b(software|engineer|programmer|koding|coding|it\b|teknik)\b/.test(np) && index < 30) {
      return pick(
        isFood
          ? [
              `jam segini abis benerin bug seharian disuguhin ${topic} di beranda, langsung keroncongan perut ${me}`,
              `amunisi wajib pas lagi lembur deploy malem-malem nih ${topic}`,
              `kelar ngurusin kodingan langsung pengen pesen ${topic} porsi gede buat ganjel perut`,
            ]
          : [
              `dari kacamata anak IT yang tiap hari ngadepin kodingan, ${topic} ini valid banget bikin kerjaan jauh lebih rapi`,
              `setuju, asal pondasi logikanya udah bener, penerapan ${topic} gini emang mangkas waktu kerja banget`,
              `persis yang lagi diterapin di tim kerjaan ${me}, hasilnya emang jauh lebih efisien`,
            ]
      );
    }
    if (/\b(guru|paud|tk\b|edukasi|mengajar|les)\b/.test(np) && index < 30) {
      return pick(
        isFood
          ? [
              `pulang ngajar bocil di PAUD liat ${topic} gini rasanya pengen langsung mampir beli buat di kosan`,
              `abis seharian ngajar di kelas, liat ${topic} hangat gini langsung bikin semangat balik lagi`,
              `besok pulang ngajar pengen mampir bungkus ${topic} ah buat makan malam`,
            ]
          : [
              `habis ngajar anak-anak PAUD tadi pagi terus buka Threads nemu bahasan ${topic}, dapet insight baru hari ini`,
              `biarpun sehari-hari ${me} ngajar bocil di sekolah, baca bahasan ${topic} gini tetep seru buat nambah wawasan`,
              `suka sama penjelasannya yang runtut, jadi gampang dicerna bahkan buat yang di dunia pendidikan kayak ${me}`,
            ]
      );
    }
    if (/\b(hr\b|admin|skincare|lifestyle)\b/.test(np) && index < 30) {
      return pick(
        isFood
          ? [
              `di kantor tadi sore anak-anak divisi ${me} juga baru pada ngomongin pengen jajan ${topic}`,
              `lagi santai maskeran di kamar buka beranda malah kena racun ${topic}, auto ngiler`,
              `masuk daftar jajan sore bareng temen kantor minggu ini sih ${topic}`,
            ]
          : [
              `di tempat kerja ${me} sekarang juga udah mulai banyak yang ngebahas ${topic} buat bantu rutinitas admin harian`,
              `sambil istirahat beres ngurus administrasi kantor, baca ${topic} gini lumayan banget buat upgrade cara kerja`,
              `bener sih, kalo alurnya udah rapi kayak gini kerjaan harian di kantor juga jadi ga keteteran`,
            ]
      );
    }
    if (/\b(film|musik|pop culture|drakor|kopi|barista)\b/.test(np) && index < 30) {
      return pick(
        isFood
          ? [
              `cocok banget nih ${topic} buat cemilan wajib pas ${me} lagi maraton film malem minggu di kamar`,
              `nonton film malem-malem ditemenin ${topic} sih perpaduan paling pas`,
              `lihat ${topic} lewat di timeline pas lagi dengerin musik malam, jadi pengen pesen sekarang`,
            ]
          : [
              `lagi santai rehat nonton film terus nyimak bahasan ${topic} di beranda, seru juga ternyata sudut pandangnya`,
              `baca ulasan ${topic} gini berasa lagi nyimak obrolan seru yang daging banget isinya`,
              `sambil ngopi santai scroll timeline nemu bahasan ${topic}, penyampaiannya enak diikutin`,
            ]
      );
    }
    if (/\b(pengantin baru|suami baru|masak berdua)\b/.test(np) && index < 30) {
      return pick(
        isFood
          ? [
              `langsung pengen ngajak suami mampir nyobain ${topic} nih kalo lagi libur masak di rumah`,
              `pas banget malam ini lagi males masak di rumah, liat ${topic} jadi pengen langsung beli`,
              `suami ${me} paling demen nih kalo udah urusan ${topic} buat makan malam berdua`,
            ]
          : [
              `semalem suami ${me} di rumah juga baru banget ngobrolin ${topic}, ternyata emang lagi rame dibahas ya`,
              `biarpun lagi sibuk ngurus rumah tangga baru, nyimak bahasan ${topic} gini tetep asik buat obrolan bareng suami`,
              `jadi inget cerita suami sepulang kerja tadi sore yang juga menyinggung soal ${topic}`,
            ]
      );
    }
    if (/\b(krl|commuter|komuter|karyawan swasta|ngopi)\b/.test(np) && index < 30) {
      return pick(
        isFood
          ? [
              `baca ini pas di gerbong KRL pulang kantor bikin ga sabar pengen cepet turun terus nyari makan`,
              `sepulang kerja badan capek liat ${topic} gini langsung auto pengen melipir mampir`,
              `teman ngopi sore sepulang kantor paling bener emang sambil nyemil ${topic}`,
            ]
          : [
              `nyimak bahasan ${topic} sambil ngopi sore sepulang kantor, poinnya kena banget buat pekerja harian kayak ${me}`,
              `baca ini pas perjalanan pulang di KRL, langsung kepikiran buat nyobain alurnya di kerjaan besok`,
              `relate banget buat rutinitas kantoran, hal yang keliatan sepele gini justru paling ngaruh ke waktu kerja`,
            ]
      );
    }
    if (/\b(lapangan|motoran|touring|jalanan|ojol|otomotif)\b/.test(np) && index < 30) {
      return pick(
        isFood
          ? [
              `pas lagi menepi istirahat motoran liat ${topic} lewat di HP, mantep banget kayaknya buat isi tenaga`,
              `abis muter jalanan seharian paling bener emang mampir makan ${topic} porsi mantap gini`,
              `masuk radar kuliner pinggir jalan yang wajib disinggahi pas lewat jalur situ nih`,
            ]
          : [
              `lagi minggir ngopi bentar abis seharian di jalanan, baca obrolan ${topic} gini lumayan nambah wawasan baru`,
              `sambil neduh istirahat motoran buka Threads, nemu bahasan ${topic} yang penjelasannya masuk akal banget`,
              `biarpun kerjaan ${me} lebih sering di lapangan, seneng tiap kali baca sharing ${topic} yang praktis gini`,
            ]
      );
    }
    if (/\b(anak kos|mahasisw|kuliah|skripsi)\b/.test(np) && index < 30) {
      return pick(
        isFood
          ? [
              `penyelamat anak kosan banget ini mah kalo pas lagi lembur ngerjain tugas kuliah malem-malem`,
              `anak kos kayak ${me} langsung senyum lebar liat porsi ${topic} yang mantep gini`,
              `masuk list wajib cobain bareng temen kosan pas abis kelas malam nih`,
            ]
          : [
              `buat anak kuliah yang lagi ngebut tugas di kosan kayak ${me}, bahasan ${topic} gini beneran ngebantu banget sih`,
              `lagi ngerjain skripsi di kamar kos sambil nyimak ${topic}, lumayan banget dapet cara biar ga buang waktu`,
              `anak kampus sekarang emang kebantu banget sih kalo udah paham alur ${topic} yang bener`,
            ]
      );
    }
    if (/\b(ibu muda|ibu rumah tangga|parenting|anak sd|bocil|ayah|bapak|kucing|tanaman)\b/.test(np) && index < 30) {
      return pick(
        isFood
          ? [
              `anak-anak sama orang rumah pasti langsung lahap sih kalo malem-malem dibawain ${topic} hangat gini`,
              `ide bagus nih buat cemilan bareng keluarga di rumah pas akhir pekan nanti`,
              `orang rumah paling suka kalo sore-sore dibeliin ${topic} buat temen minum teh hangat`,
            ]
          : [
              `mumpung anak-anak udah beres belajar di rumah, buka Threads baca ${topic} gini lumayan banget nambah ilmu baru`,
              `sambil nemenin bocil santai di rumah, nyimak bahasan ${topic} ternyata menarik juga buat diikutin`,
              `seneng liat postingan yang ngebahas ${topic} dengan bahasa yang ringan gini, jadi ikut paham`,
            ]
      );
    }
    if (/\b(umkm|olshop|seller|jualan online|packing)\b/.test(np) && index < 30) {
      return pick(
        isFood
          ? [
              `beres packing paket orderan malam ini langsung pengen pesen ${topic} buat hadiah capek seharian`,
              `teman setia pas lagi rekap resi orderan malem-malem nih ${topic}`,
            ]
          : [
              `sebagai yang tiap hari ngurusin jualan online dari rumah, poin ${topic} ini nyambung banget kalo diterapin pelan-pelan`,
              `buat usaha rumahan yang dipegang sendiri kayak tempat ${me}, efisiensi dari ${topic} gini berasa banget manfaatnya`,
            ]
      );
    }
    if (/\b(finance|akuntansi|pembukuan|excel)\b/.test(np) && index < 30) {
      return pick(
        isFood
          ? [
              `abis pusing ngurusin rekap laporan di kantor, liat ${topic} langsung balik lagi mood ${me}`,
              `obat penawar pusing abis seharian pelototin angka di excel nih ${topic}`,
            ]
          : [
              `di sela-sela ngurus pembukuan kantor, baca ${topic} ini bikin ${me} sadar alur yang rapi emang ngaruh banget`,
              `kebiasaan ngurus data di finance bikin ${me} setuju banget kalau sistem yang terstruktur itu nghemat tenaga`,
            ]
      );
    }
    if (/\b(olahraga|lari|gym|sehat)\b/.test(np) && index < 30) {
      return pick(
        isFood
          ? [
              `jadwal cheating day minggu ini abis lari pagi wajib banget melipir nyobain ${topic} sih`,
              `habis olahraga sore liat ${topic} lewat di beranda langsung tergoda buat mampir`,
            ]
          : [
              `habis lari sore sambil pendinginan baca bahasan ${topic}, konsistensi sama alur yang bener emang kuncinya`,
              `setuju sih, mau di olahraga ataupun di ${topic}, kalo ritmenya udah ketemu pasti hasilnya jauh lebih maksimal`,
            ]
      );
    }

    const variedStatements = [
      `baru buka timeline langsung ketemu bahasan ${topic}, poinnya dapet banget sih`,
      `dari sudut pandang keseharian ${me}, hal kayak gini emang makin kerasa manfaatnya sekarang`,
      `setuju sih sama alurnya, simpel tapi sering kelewat kalo ga diperhatiin bener-bener`,
      `pas banget kemarin sore baru diobrolin bareng temen, eh sekarang lewat di beranda ${me}`,
      `nah ini valid, kadang pendekatan praktis kayak gini yang justru paling jalan di lapangan`,
      `suka sama cara ngejelasinnya, ringkas dan langsung kebayang praktiknya gimana`,
      `nyimak dari tadi, emang paling bener kalo fondasi awalnya dirapiin dulu kayak gini`,
      `lumayan banget dapet perspektif baru pas lagi santai scroll Threads malam ini`,
      `jarang ada yang ngerangkum ${topic} seringkas ini, langsung nangkep intinya`,
      `kalo udah nemu pola yang pas emang bikin urusan harian jauh lebih ringan sih`,
    ];
    return variedStatements[index % variedStatements.length];
  }

  // Mode JAUH (hanya sebagian kecil akun yang benar-benar jauh nichenya -> nimbrung & bertanya sesuai karakter dirinya)
  const shortRole = clean(buzzer.niche.split(/[&,]/)[0] || "warga awam", 32).toLowerCase();
  const variedQuestions = isFood
    ? [
        `kak kalo buat orang rumah yang baru pertama kali mau nyobain ${topic}, paling rekomen pesen varian apa dulu ya?`,
        `serius nanya kak, itu porsinya kalo buat makan berdua di rumah udah cukup mengenyangkan belum ya?`,
        `eh sering lewat di beranda ${me} nih, kalo buat yang kurang tahan pedes ada pilihan level bumbunya ga kak?`,
        `kak kalo dipesen malem-malem gini biasanya masih lengkap ga ya pilihannya?`,
      ]
    : [
        `kak jujur dari keseharian ${me} di ${shortRole} masih awam soal ${topic}, kalo baru mau mulai belajar enaknya dari mana dulu ya?`,
        `serius penasaran bang, kalo buat yang sehari-hari di luar bidang ini kayak ${me}, ${topic} gini susah ga sih dipelajarinya?`,
        `eh sering denger orang bahas ${topic} di timeline, kalo diterapin buat kebutuhan harian biasa ngaruh juga ga ya kak?`,
        `bang kalo buat pemula yang belum pernah nyentuh ${topic} sama sekali, langkah awalnya ribet ga sih?`,
      ];
  return variedQuestions[index % variedQuestions.length];
}

function extractAiItems(
  json: unknown
): { targetNiche?: string; items: { buzzerAccountId?: string; nicheRelation?: string; text?: string; alasanRelasi?: string }[] } {
  if (Array.isArray(json)) {
    return { items: json as { buzzerAccountId?: string; nicheRelation?: string; text?: string; alasanRelasi?: string }[] };
  }
  if (typeof json === "object" && json !== null) {
    const obj = json as Record<string, unknown>;
    const arr = Array.isArray(obj.items)
      ? obj.items
      : Array.isArray(obj.drafts)
        ? obj.drafts
        : Array.isArray(obj.data)
          ? obj.data
          : [];
    return {
      targetNiche: typeof obj.targetNiche === "string" ? obj.targetNiche : undefined,
      items: arr as { buzzerAccountId?: string; nicheRelation?: string; text?: string; alasanRelasi?: string }[],
    };
  }
  return { items: [] };
}

export interface GenerateBuzzerDraftsInput {
  targetUsername: string;
  targetDisplayName?: string | null;
  targetNiche?: string | null;
  targetText: string;
  catatanAdmin?: string | null;
  action: "KOMEN" | "QUOTE";
  buzzers: BuzzerAccountDTO[];
  existingTexts?: string[];
}

export async function generateBuzzerDrafts(input: GenerateBuzzerDraftsInput): Promise<{
  targetNiche: string;
  items: BuzzerDraftItem[];
}> {
  const targetText = clean(input.targetText, 700);
  const inferredTargetNiche =
    clean(input.targetNiche || "", 120) ||
    (SPECIALIZED_TECH_THEMES.test(targetText)
      ? "Teknologi & Digital"
      : BROAD_EVERYDAY_THEMES.test(targetText)
        ? "Kuliner & Gaya Hidup Harian"
        : "Obrolan Umum");
  const usedOpeners = new Set<string>();
  const usedTexts = new Set<string>((input.existingTexts ?? []).map((t) => t.toLowerCase().trim()));
  let detectedTargetNiche = inferredTargetNiche;

  // 1. Klasifikasi awal seluruh akun buzzer di gelombang ini, lalu seimbangkan agar JAUH (bertanya) maksimal ~25%
  const maxJauh = Math.max(1, Math.floor(input.buzzers.length * 0.25));
  let jauhCount = 0;

  const allPreclassified = input.buzzers.map((b, idx) => {
    const prof = b.niche.trim() && b.persona.trim() ? b : { ...b, ...inferProfileHeuristic(b, idx) };
    const rel = classifyNicheRelation(targetText, detectedTargetNiche, prof.niche, prof.persona);
    let relation = rel.relation;
    let reason = rel.reason;
    if (relation === "JAUH") {
      if (jauhCount < maxJauh) {
        jauhCount++;
      } else {
        relation = "JEMBATAN";
        reason = `Lintas niche; nimbrung santai sambil bawa sudut pandang ${clean(prof.niche, 60)}`;
      }
    }
    return { buzzer: prof, relation, reason, idx };
  });

  // 2. Bagi ke dalam batch kecil (5 akun per batch) dan jalankan paralel agar cepat (< 10 detik untuk 10-30 akun)
  const chunks: (typeof allPreclassified)[] = [];
  for (let offset = 0; offset < allPreclassified.length; offset += BATCH_SIZE) {
    chunks.push(allPreclassified.slice(offset, offset + BATCH_SIZE));
  }

  const aiMap = new Map<string, { nicheRelation?: string; text?: string; alasanRelasi?: string }>();

  if (hasLlmEnv() && chunks.length > 0) {
    const chunkResults = await Promise.all(
      chunks.map(async (preclassified) => {
        const buzzerLines = preclassified.map(({ buzzer, relation }) => {
          const voiceHint = VOICE_STYLES[buzzer.voiceStyle]?.hint ?? VOICE_STYLES.aku_kamu.hint;
          const modeRule =
            relation === "SEJALUR"
              ? "SEJALUR (WAJIB pernyataan/reaksi relate, DILARANG bertanya)"
              : relation === "JEMBATAN"
                ? "JEMBATAN (WAJIB pernyataan kasual sambil bawa dikit konteks niche buzzer ini, DILARANG bertanya)"
                : "JAUH (nimbrung santai sambil bertanya dari sudut pandang niche buzzer ini)";
          const sample = buzzer.samplePosts[0] ? ` | Contoh ketikan: "${clean(buzzer.samplePosts[0], 100)}"` : "";
          return `- buzzerAccountId: "${buzzer.accountId}" | @${buzzer.username ?? buzzer.displayName} | Niche Buzzer: "${clean(buzzer.niche, 100)}" | Persona: "${clean(buzzer.persona, 160)}" | Sapaan: ${voiceHint} | Mode: ${modeRule}${sample}`;
        });

        const prompt = [
          `AKSI: ${input.action === "QUOTE" ? "QUOTE SHARE (kutipan di feed buzzer saat membagikan postingan target)" : "KOMEN (komentar langsung di bawah postingan target)"}`,
          `AKUN TARGET: @${clean(input.targetUsername, 40)}${input.targetDisplayName ? ` (${clean(input.targetDisplayName, 60)})` : ""}`,
          `NICHE TARGET: ${detectedTargetNiche}`,
          `<postingan_target>\n${targetText}\n</postingan_target>`,
          input.catatanAdmin ? `ARAHAN TAMBAHAN SUPER ADMIN: ${clean(input.catatanAdmin, 300)}` : null,
          `DAFTAR AKUN BUZZER (${preclassified.length} akun):`,
          ...buzzerLines,
          "",
          "PENTING: Buat komentar yang BEDA-BEDA untuk tiap akun sesuai Niche & Persona-nya! Akun dengan Mode SEJALUR dan JEMBATAN DILARANG memakai kalimat tanya ('?'). Hanya akun dengan Mode JAUH yang boleh bertanya.",
        ]
          .filter(Boolean)
          .join("\n\n");

        return generateWithFailover({
          system: DRAFT_SYSTEM,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          temperature: 0.92,
          maxOutputTokens: 1600,
          hedgeMs: 12_000,
          timeoutMs: 22_000,
          deadlineMs: 32_000,
          responseSchema: DRAFT_SCHEMA,
          validate: (json) => extractAiItems(json).items.length > 0,
        });
      })
    );

    for (const reply of chunkResults) {
      if (!reply?.json) continue;
      const parsed = extractAiItems(reply.json);
      if (typeof parsed.targetNiche === "string" && parsed.targetNiche.trim().length >= 3) {
        detectedTargetNiche = clean(parsed.targetNiche, 100);
      }
      for (const it of parsed.items) {
        if (typeof it?.buzzerAccountId === "string") {
          aiMap.set(it.buzzerAccountId, it);
        }
      }
    }
  }

  // 3. Susun keluaran akhir dengan tetap menjaga keseimbangan relasi dan keunikan kalimat per akun
  const out: BuzzerDraftItem[] = [];
  for (const item of allPreclassified) {
    const rawAi = aiMap.get(item.buzzer.accountId);
    // Gunakan relasi terukur dari allPreclassified supaya batas maksimal JAUH (~25%) tidak dilanggar AI
    const rel: BuzzerNicheRelation = item.relation;

    let candidate = rawAi?.text ? cleanBuzzerText(rawAi.text) : null;
    // Bila mode SEJALUR atau JEMBATAN tapi AI malah menulis kalimat tanya ('?'), ganti atau buang kalimat tanyanya
    if (candidate && (rel === "SEJALUR" || rel === "JEMBATAN") && candidate.includes("?")) {
      candidate = null;
    }
    if (candidate) {
      const words = candidate.toLowerCase().split(/\s+/);
      const opener = words.slice(0, 2).join(" ");
      if (usedTexts.has(candidate.toLowerCase()) || (opener.length >= 4 && usedOpeners.has(opener))) {
        candidate = null;
      }
    }
    if (!candidate) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const tryText = buildFallbackDraft(item.buzzer, input.action, rel, targetText, item.idx + attempt);
        const w = tryText.toLowerCase().split(/\s+/);
        const op = w.slice(0, 2).join(" ");
        if (!usedTexts.has(tryText.toLowerCase()) && (!usedOpeners.has(op) || attempt > 12)) {
          candidate = tryText;
          break;
        }
      }
      if (!candidate) {
        candidate = buildFallbackDraft(item.buzzer, input.action, rel, targetText, item.idx + 31);
      }
    }
    const words = candidate.toLowerCase().split(/\s+/);
    usedOpeners.add(words.slice(0, 2).join(" "));
    usedTexts.add(candidate.toLowerCase());

    out.push({
      buzzerAccountId: item.buzzer.accountId,
      action: input.action,
      nicheRelation: rel,
      text: candidate,
      alasanRelasi: clean(rawAi?.alasanRelasi || item.reason, 160),
    });
  }

  return { targetNiche: detectedTargetNiche, items: out };
}

/* ------------------------------------------------------------------ 4. Generator AI Profil Niche & Persona Buzzer */

const PROFILE_SYSTEM = `Anda menyusun identitas niche dan persona warga net Indonesia (buzzer organik) untuk akun-akun Threads.
Aturan:
- Bila akun memiliki contoh postingan (<sample_posts>) atau persona awal, simpulkan niche dan persona yang konsisten dengan postingan itu.
- Bila akun belum memiliki contoh postingan, berikan niche dan persona warga net Indonesia sehari-hari yang UNIK, BERBEDA antar-akun, dan cocok dengan nama/username akun (mis. mahasiswa kos, karyawan komuter, freelancer desain, ibu muda, pecinta film/skincare, penghobi olahraga/motoran, UMKM rumahan, staf finance, programmer, dll).
- "niche": singkat dan jelas, maksimal 80 karakter (contoh: "Mahasiswi kos, skripsi & kuliner hemat").
- "persona": deskripsi karakter & gaya bicara saat berkomentar di Threads, maksimal 180 karakter.
- "voiceStyle": salah satu dari "gue_lo", "aku_kamu", "saya_kamu", "kita".`;

const PROFILE_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          accountId: { type: "STRING" },
          niche: { type: "STRING" },
          persona: { type: "STRING" },
          voiceStyle: { type: "STRING" },
        },
        required: ["accountId", "niche", "persona", "voiceStyle"],
      },
    },
  },
  required: ["items"],
};

export async function generateBuzzerProfilesAI(accounts: BuzzerAccountDTO[]): Promise<BuzzerProfilePatch[]> {
  const out: BuzzerProfilePatch[] = [];
  for (let offset = 0; offset < accounts.length; offset += 15) {
    const chunk = accounts.slice(offset, offset + 15);
    const lines = chunk.map((a, i) => {
      const samples = a.samplePosts.slice(0, 2).map((s) => `"${clean(s, 120)}"`).join("; ");
      return `${i + 1}. accountId="${a.accountId}" | @${a.username ?? a.displayName} (${a.displayName}) | Persona awal: "${clean(a.persona, 120)}" | Postingan: ${samples || "(belum ada postingan, buatkan niche & persona warga net Indonesia yang unik)"}`;
    });

    const reply = hasLlmEnv()
      ? await generateWithFailover({
          system: PROFILE_SYSTEM,
          contents: [{ role: "user", parts: [{ text: `Susun niche, persona, dan voiceStyle yang beragam untuk ${chunk.length} akun berikut:\n\n${lines.join("\n")}` }] }],
          temperature: 0.85,
          maxOutputTokens: 2500,
          timeoutMs: 25_000,
          deadlineMs: 35_000,
          responseSchema: PROFILE_SCHEMA,
          validate: (json) => Array.isArray((json as { items?: unknown })?.items),
        })
      : null;

    const aiMap = new Map<string, { niche?: string; persona?: string; voiceStyle?: string }>();
    if (reply?.json) {
      const parsed = reply.json as { items?: { accountId?: string; niche?: string; persona?: string; voiceStyle?: string }[] };
      for (const it of parsed.items ?? []) {
        if (typeof it?.accountId === "string") aiMap.set(it.accountId, it);
      }
    }

    chunk.forEach((acc, idx) => {
      const ai = aiMap.get(acc.accountId);
      const heur = inferProfileHeuristic(acc, offset + idx);
      const validVoice =
        ai?.voiceStyle && ai.voiceStyle in VOICE_STYLES
          ? (ai.voiceStyle as VoiceStyle)
          : heur.voiceStyle;
      out.push({
        accountId: acc.accountId,
        aktif: acc.aktif,
        niche: clean(ai?.niche || heur.niche, 120),
        persona: clean(ai?.persona || heur.persona, 260),
        voiceStyle: validVoice,
        catatan: acc.catatan,
        inferredFrom: ai?.niche ? "AI" : heur.inferredFrom,
      });
    });
  }
  return out;
}
