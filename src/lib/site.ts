import { MERCHANT_INFO } from "@/lib/legal-content";

/**
 * Identitas situs publik untuk SEO dan mesin AI (metadata, robots, sitemap, llms.txt, JSON-LD).
 * Satu sumber supaya nama, alamat, dan deskripsi yang dibaca Google, ChatGPT, Perplexity, dan lainnya selalu sama.
 *
 * Alamat dikunci ke domain produksi, bukan APP_URL: halaman publik di-prerender saat build (di CI tanpa env
 * produksi), dan URL kanonis memang harus selalu domain utama.
 */
export const SITE_URL = "https://bottrit.com";
export const SITE_NAME = MERCHANT_INFO.brandName;
/** Nama lain yang mungkin diketik orang (nama domain). Dipakai di schema `alternateName`. */
export const SITE_ALT_NAMES = ["Bottrit", "Bot Threads"];
export const LANDING_PATH = "/selamat-datang";
export const LANDING_URL = `${SITE_URL}${LANDING_PATH}`;

export const SITE_TITLE = "BotThreads: Autopilot AI untuk Posting Threads Otomatis";
/** <=160 karakter: dibaca utuh di hasil Google. Kalimat "X adalah ..." memudahkan AI mengutip definisinya. */
export const SITE_DESCRIPTION =
  "BotThreads adalah autopilot AI untuk Threads: cari ide dari tren, tulis dengan gaya brand Anda, periksa, lalu posting otomatis di jam ramai lewat API resmi.";

/** Gambar pratinjau dari app/opengraph-image.tsx, untuk halaman yang menulis openGraph/twitter sendiri. */
export const OG_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "BotThreads: autopilot AI untuk posting Threads otomatis",
};

export const SITE_KEYWORDS = [
  "BotThreads",
  "Bottrit",
  "autopilot Threads",
  "auto posting Threads",
  "jadwal posting Threads",
  "penjadwal Threads",
  "AI untuk Threads",
  "bot Threads Indonesia",
  "tools Threads untuk UMKM",
  "manajemen akun Threads",
  "analitik Threads",
  "Meta Threads API",
];

/**
 * Definisi utuh (134-167 kata) yang bisa dikutip AI tanpa konteks lain. Ditampilkan apa adanya di bagian
 * "Apa itu BotThreads?" pada halaman perkenalan dan dipakai di /llms.txt. Setiap klaim mengikuti perilaku
 * sistem yang sebenarnya (lihat faq-data.ts); ubah bersama kodenya bila aturannya berubah.
 */
export const SITE_DEFINITION =
  "BotThreads adalah aplikasi autopilot berbasis AI untuk akun Meta Threads, dibuat di Indonesia oleh PT Suka Profit Berkah. Setiap hari BotThreads mencari ide dari posting terbaik akun, tren pencarian Google Indonesia, berita seputar niche akun, dan posting Threads populer. Dari ide itu AI menulis posting dengan gaya bahasa brand, memeriksa harga, promo, topik sensitif, kemiripan, dan panjang tulisan, lalu meminta editor AI memberi skor minimal 0,7 dari 1. Draf yang lolos diterbitkan lewat API resmi Threads di jam ketika pengikut akun paling aktif, bawaannya 3 kali sehari dengan jeda 2,5 jam. Pemilik akun memilih mode Tinjau dulu, yang menunggu persetujuan untuk setiap posting, atau mode Otomatis. Setelah angka views masuk, sistem belajar dari pola yang berhasil dan menjeda akun bila kinerjanya turun tajam. Akun dihubungkan lewat login resmi Threads tanpa memberikan kata sandi, dan pembayaran dalam Rupiah lewat Midtrans.";

/**
 * Halaman informasi publik yang berdiri sendiri (calon sitelink Google). `/cara-kerja` sudah dipakai halaman
 * dashboard, jadi halaman publiknya `/cara-kerja-botthreads`.
 */
export const FEATURES_PATH = "/fitur";
export const HOW_PATH = "/cara-kerja-botthreads";
export const PRICING_PATH = "/harga";
export const FAQ_PATH = "/faq";

/** Menu utama di header dan footer setiap halaman publik. `headerClass`: mulai lebar layar berapa tautan tampil di header. */
export const PUBLIC_NAV: { path: string; label: string; headerClass: string }[] = [
  { path: FEATURES_PATH, label: "Fitur@@menu", headerClass: "hidden md:inline-flex" },
  { path: HOW_PATH, label: "Cara kerja", headerClass: "hidden lg:inline-flex" },
  { path: PRICING_PATH, label: "Harga@@menu", headerClass: "hidden sm:inline-flex" },
  { path: FAQ_PATH, label: "Tanya jawab", headerClass: "hidden md:inline-flex" },
];

/** Halaman publik yang boleh diindeks, beserta prioritas relatifnya di sitemap. */
export const PUBLIC_ROUTES: { path: string; title: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" | "yearly" }[] = [
  { path: LANDING_PATH, title: "Halaman utama BotThreads: fitur, cara kerja, harga, dan tanya jawab", priority: 1, changeFrequency: "weekly" },
  { path: FEATURES_PATH, title: "Fitur BotThreads: ide otomatis, penulisan gaya brand, pemeriksaan, jadwal jam ramai, analitik", priority: 0.9, changeFrequency: "monthly" },
  { path: HOW_PATH, title: "Cara kerja BotThreads: dari tren sampai terbit, dan cara mulai", priority: 0.9, changeFrequency: "monthly" },
  { path: PRICING_PATH, title: "Harga dan paket langganan BotThreads dalam Rupiah", priority: 0.9, changeFrequency: "weekly" },
  { path: FAQ_PATH, title: "Tanya jawab (FAQ) seputar BotThreads", priority: 0.8, changeFrequency: "monthly" },
  { path: "/daftar", title: "Daftar akun dan buat workspace", priority: 0.8, changeFrequency: "monthly" },
  { path: "/kontak", title: "Kontak dan dukungan", priority: 0.6, changeFrequency: "monthly" },
  { path: "/kebijakan-privasi", title: "Kebijakan Privasi", priority: 0.4, changeFrequency: "yearly" },
  { path: "/syarat-ketentuan", title: "Syarat dan Ketentuan", priority: 0.4, changeFrequency: "yearly" },
  { path: "/kebijakan-pengembalian", title: "Kebijakan Pengembalian Dana", priority: 0.3, changeFrequency: "yearly" },
  { path: "/pengiriman-layanan", title: "Pengiriman Layanan", priority: 0.3, changeFrequency: "yearly" },
  { path: "/penghapusan-data", title: "Penghapusan Data", priority: 0.3, changeFrequency: "yearly" },
];

/** Bagian aplikasi yang hanya untuk pengguna masuk: tidak ada gunanya dirayapi. */
export const PRIVATE_PATHS = [
  "/api/",
  "/admin",
  "/akun",
  "/autopilot",
  "/billing",
  "/cara-kerja",
  "/jadwal",
  "/pengaturan",
  "/posts",
  "/prompt-studio",
  "/radar",
  "/undangan/",
  "/reset-password/",
  "/threads-terhubung",
];

/* ------------------------------------------------------------------ JSON-LD */

const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;
export const APP_ID = `${SITE_URL}/#software`;

const ORGANIZATION = {
  "@type": "Organization",
  "@id": ORG_ID,
  name: SITE_NAME,
  alternateName: SITE_ALT_NAMES,
  legalName: MERCHANT_INFO.legalName,
  url: SITE_URL,
  logo: { "@type": "ImageObject", url: `${SITE_URL}/icon.png` },
  description: MERCHANT_INFO.tagline,
  email: MERCHANT_INFO.supportEmail,
  telephone: MERCHANT_INFO.whatsappDisplay.replace(/[\s-]/g, ""),
  address: {
    "@type": "PostalAddress",
    streetAddress: "Jl. Bukit Nirwana Raya No.3, RT.07/RW.12, Mulyaharja",
    addressLocality: "Kota Bogor",
    addressRegion: "Jawa Barat",
    postalCode: "16135",
    addressCountry: "ID",
  },
  areaServed: { "@type": "Country", name: "Indonesia" },
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "customer support",
    email: MERCHANT_INFO.supportEmail,
    telephone: MERCHANT_INFO.whatsappDisplay.replace(/[\s-]/g, ""),
    availableLanguage: ["id", "en"],
    hoursAvailable: {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      opens: "09:00",
      closes: "18:00",
    },
  },
};

/** Organisasi + situs + aplikasi + FAQ dalam satu @graph untuk halaman perkenalan. */
export function landingJsonLd(faq: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      ORGANIZATION,
      {
        "@type": "WebSite",
        "@id": SITE_ID,
        url: SITE_URL,
        name: SITE_NAME,
        alternateName: SITE_ALT_NAMES,
        description: SITE_DESCRIPTION,
        inLanguage: "id-ID",
        publisher: { "@id": ORG_ID },
      },
      {
        "@type": "WebPage",
        "@id": `${LANDING_URL}#webpage`,
        url: LANDING_URL,
        name: SITE_TITLE,
        description: SITE_DESCRIPTION,
        inLanguage: "id-ID",
        isPartOf: { "@id": SITE_ID },
        about: { "@id": APP_ID },
        primaryImageOfPage: `${SITE_URL}/opengraph-image`,
      },
      {
        "@type": "SoftwareApplication",
        "@id": APP_ID,
        name: SITE_NAME,
        alternateName: SITE_ALT_NAMES,
        url: LANDING_URL,
        description: SITE_DEFINITION,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Social Media Management",
        operatingSystem: "Web",
        inLanguage: ["id", "en"],
        image: `${SITE_URL}/opengraph-image`,
        publisher: { "@id": ORG_ID },
        provider: { "@id": ORG_ID },
        featureList: [
          "Ide posting otomatis dari tren Google Indonesia, berita niche, dan posting Threads populer",
          "Penulisan posting dengan gaya bahasa brand",
          "Pemeriksaan harga, promo, topik sensitif, kemiripan, dan panjang tulisan",
          "Skor editor AI minimal 0,7 sebelum antre",
          "Jadwal posting di jam ramai tiap akun dengan jeda antarposting",
          "Mode Tinjau dulu dan mode Otomatis per akun",
          "Analitik views dan belajar dari posting yang berhasil",
          "Moderasi balasan: balas, sembunyikan, dan atur siapa yang boleh membalas",
          "Terbit dan statistik lewat API resmi Meta Threads",
        ],
      },
      {
        "@type": "FAQPage",
        "@id": `${LANDING_URL}#faq`,
        isPartOf: { "@id": `${LANDING_URL}#webpage` },
        inLanguage: "id-ID",
        mainEntity: faq.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };
}

/** Daftar harga paket sebagai Offer pada SoftwareApplication yang sama (digabung lewat @id). */
export function offersJsonLd(plans: { id: string; nama: string; deskripsi?: string | null; hargaBulanan: number }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": APP_ID,
    name: SITE_NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    offers: plans.map((p) => ({
      "@type": "Offer",
      name: `Paket ${p.nama}`,
      ...(p.deskripsi ? { description: p.deskripsi } : {}),
      price: p.hargaBulanan,
      priceCurrency: "IDR",
      url: `${SITE_URL}/daftar?plan=${encodeURIComponent(p.id)}`,
      availability: "https://schema.org/InStock",
      ...(p.hargaBulanan > 0
        ? {
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              price: p.hargaBulanan,
              priceCurrency: "IDR",
              unitCode: "MON",
              referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
            },
          }
        : {}),
      seller: { "@id": ORG_ID },
    })),
  };
}

/** FAQPage untuk halaman /faq (halaman perkenalan memuat FAQPage yang sama di dalam @graph-nya). */
export function faqPageJsonLd(faq: { q: string; a: string }[], path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${SITE_URL}${path}#faq`,
    url: `${SITE_URL}${path}`,
    inLanguage: "id-ID",
    about: { "@id": APP_ID },
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/** WebPage untuk halaman informasi publik, ditautkan ke aplikasi dan situs lewat @id. */
export function webPageJsonLd(name: string, description: string, path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${SITE_URL}${path}#webpage`,
    url: `${SITE_URL}${path}`,
    name,
    description,
    inLanguage: "id-ID",
    isPartOf: { "@id": SITE_ID },
    about: { "@id": APP_ID },
    primaryImageOfPage: `${SITE_URL}/opengraph-image`,
  };
}

/** Breadcrumb untuk halaman publik turunan (dokumen legal, daftar, kontak). */
export function breadcrumbJsonLd(name: string, path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: SITE_NAME, item: LANDING_URL },
      { "@type": "ListItem", position: 2, name, item: `${SITE_URL}${path}` },
    ],
  };
}

/** Serialisasi aman untuk <script type="application/ld+json"> (cegah penutupan tag lewat "<"). */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
