import { FAQ } from "@/components/landing/faq-data";
import { MERCHANT_INFO } from "@/lib/legal-content";
import { LANDING_URL, PUBLIC_ROUTES, SITE_DEFINITION, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

/**
 * /llms.txt (llmstxt.org): ringkasan Markdown untuk mesin AI (ChatGPT, Claude, Perplexity, Gemini). Isinya diambil
 * dari sumber yang sama dengan halaman perkenalan, jadi fakta yang dikutip AI sama dengan yang dilihat pengunjung.
 * Tidak memakai data per permintaan, jadi di-prerender saat build.
 */
export function GET() {
  const pages = PUBLIC_ROUTES.map((r) => `- [${r.title}](${SITE_URL}${r.path})`).join("\n");
  const faq = FAQ.map((f) => `### ${f.q}\n\n${f.a}`).join("\n\n");

  const body = `# ${SITE_NAME}

> ${SITE_DESCRIPTION}

${SITE_DEFINITION}

## Fakta utama

- Nama produk: ${SITE_NAME} (juga dikenal sebagai Bottrit, sesuai domain bottrit.com)
- Kategori: aplikasi web autopilot konten, penjadwalan, dan analitik untuk akun Meta Threads
- Pembuat: ${MERCHANT_INFO.legalName}, ${MERCHANT_INFO.address}
- Pasar: Indonesia; antarmuka bahasa Indonesia dan Inggris
- Integrasi: API resmi Meta Threads (terbit, statistik, balasan, pencarian kata kunci); login lewat halaman resmi Threads, tanpa kata sandi
- Alur harian: tren dipantau, ide diberi skor, posting ditulis, diperiksa 4 hal plus skor editor AI minimal 0,7, masuk antrean, terbit di jam ramai akun
- Frekuensi bawaan: 3 posting per akun per hari, jeda antarposting 2,5 jam (bisa diatur 2 sampai 8 jam), sampai batas paket
- Mode per akun: Tinjau dulu (setiap posting disetujui pemilik) atau Otomatis (draf yang lolos pemeriksaan terbit sendiri)
- Pengaman: akun dijeda setelah 3 kali gagal terbit berturut-turut; turun ke mode Tinjau dulu bila views seminggu turun lebih dari separuh
- Pembayaran: Rupiah lewat Midtrans (QRIS, GoPay, ShopeePay, Virtual Account, Mandiri Bill); tanpa potongan otomatis bulanan
- Harga paket terbaru: ${LANDING_URL}#paket
- Kontak: ${MERCHANT_INFO.supportEmail}, WhatsApp ${MERCHANT_INFO.whatsappDisplay} (${MERCHANT_INFO.operatingHours})

## Halaman

${pages}

## Tanya jawab

${faq}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
