/**
 * Data dokumen legalitas, privasi, syarat & ketentuan, pengembalian dana (refund),
 * pengiriman layanan digital, penghapusan data, dan identitas merchant.
 * Setiap dokumen memiliki halaman mandiri untuk keperluan verifikasi Payment Gateway (Midtrans) & OAuth.
 */

export type LegalDocId =
  | "privasi"
  | "ketentuan"
  | "pengembalian"
  | "pengiriman"
  | "penghapusan"
  | "kontak";

export interface LegalSpecRow {
  term: string;
  detail: string;
}

export interface LegalArticle {
  id: string;
  index: string;
  title: string;
  paragraphs: string[];
  rows?: LegalSpecRow[];
}

export interface LegalDocument {
  id: LegalDocId;
  order: string;
  href: string;
  shortTitle: string;
  category: string;
  title: string;
  subtitle: string;
  effectiveDate: string;
  docCode: string;
  jurisdiction: string;
  summarySpecs: LegalSpecRow[];
  articles: LegalArticle[];
}

export const MERCHANT_INFO = {
  brandName: "BotThreads",
  legalName: "PT SUKA PROFIT BERKAH",
  unitName: "Unit Layanan BotThreads Indonesia",
  tagline: "Autopilot konten, penjadwalan, dan analitik akun Meta Threads berbasis AI.",
  supportEmail: "dev.sukashawarma@gmail.com",
  billingEmail: "dev.sukashawarma@gmail.com",
  whatsappDisplay: "+62 822-9932-9686",
  whatsappHref: "https://wa.me/6282299329686",
  operatingHours: "Senin – Sabtu, 09.00 – 18.00 WIB",
  address: "Jl. Bukit Nirwana Raya No.3, RT.07/RW.12, Mulyaharja, Kec. Bogor Sel., Kota Bogor, Jawa Barat 16135",
  currency: "Rupiah Indonesia (IDR / Rp)",
  paymentGateway: "Midtrans (PT Midtrans / GoTo Financial)",
  effectiveDate: "2 Oktober 2026",
} as const;

export const LEGAL_DOCUMENTS: Record<LegalDocId, LegalDocument> = {
  privasi: {
    id: "privasi",
    order: "01",
    href: "/kebijakan-privasi",
    shortTitle: "Kebijakan Privasi",
    category: "PELINDUNGAN DATA PRIBADI",
    title: "Kebijakan Privasi",
    subtitle:
      "Bagaimana BotThreads mengumpulkan, mengenkripsi, dan memproses data akun, otorisasi API resmi Meta Threads & Google, serta informasi transaksi pelanggan.",
    effectiveDate: MERCHANT_INFO.effectiveDate,
    docCode: "BT-DOC/PP-01",
    jurisdiction: "UU No. 27 Tahun 2022 (UU PDP)",
    summarySpecs: [
      { term: "Metode Otorisasi", detail: "OAuth 2.0 resmi Meta Threads API & Google Sign-In (tanpa menyimpan password media sosial)" },
      { term: "Penyimpanan Token", detail: "Terenkripsi tingkat server (AES-256) dan terisolasi per workspace" },
      { term: "Data Pembayaran", detail: "Diproses langsung oleh Midtrans; kami tidak menyimpan nomor kartu atau PIN bank" },
      { term: "Penjualan Data", detail: "Tidak pernah menjual, menyewakan, atau membagikan data ke pengiklan pihak ketiga" },
    ],
    articles: [
      {
        id: "pendahuluan",
        index: "01",
        title: "Ruang Lingkup dan Kepatuhan Regulasi",
        paragraphs: [
          "Kebijakan Privasi ini mengatur tata cara BotThreads mengumpulkan, menggunakan, menyimpan, dan melindungi informasi pribadi serta data operasional milik pengguna saat menggunakan layanan perangkat lunak kami.",
          "Kebijakan ini disusun sesuai dengan Undang-Undang Republik Indonesia Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP), Undang-Undang Informasi dan Transaksi Elektronik (UU ITE), serta persyaratan pengembang resmi Meta Platforms, Inc. dan Google LLC.",
        ],
      },
      {
        id: "data-dikumpulkan",
        index: "02",
        title: "Data yang Kami Kumpulkan",
        paragraphs: [
          "Kami hanya mengumpulkan data yang secara fungsional dibutuhkan untuk menyediakan fitur penulisan AI, penjadwalan otomatis, analitik performa, dan pengelolaan tagihan langganan:",
        ],
        rows: [
          {
            term: "Identitas Akun",
            detail: "Nama tampilan, alamat email, username, peran anggota dalam workspace, serta hash kata sandi satu arah.",
          },
          {
            term: "Otorisasi Meta & Google",
            detail: "ID pengguna Threads, username, nama profil, cakupan izin (scopes), token akses terenkripsi dari API resmi Meta Threads, serta alamat email terverifikasi dari Google OAuth.",
          },
          {
            term: "Konten & Pengetahuan Brand",
            detail: "Fakta produk, daftar harga, promo aktif, larangan kata, draf posting, jadwal tayang, serta metrik tayangan (views, suka, balasan) dari akun Threads Anda sendiri.",
          },
          {
            term: "Catatan Transaksi",
            detail: "Nomor tagihan (Order ID), paket langganan, siklus durasi, metode bayar (QRIS, E-Wallet, Virtual Account), waktu lunas, dan nominal dalam Rupiah (IDR).",
          },
        ],
      },
      {
        id: "tujuan-pemrosesan",
        index: "03",
        title: "Tujuan Penggunaan Data",
        paragraphs: [
          "Seluruh informasi yang dikumpulkan diproses semata-mata untuk menjalankan instruksi pengguna di dalam aplikasi:",
        ],
        rows: [
          {
            term: "Penerbitan Terjadwal",
            detail: "Menyusun draf sesuai basis pengetahuan brand Anda, memeriksa kepatuhan aturan kualitas, dan menerbitkan posting ke Threads pada jam tayang terpilih.",
          },
          {
            term: "Kalibrasi Performa Akun",
            detail: "Menghitung jam ramai dan mengenali pola topik dengan tayangan tertinggi khusus pada akun Anda tanpa mencampurkannya dengan data pelanggan lain.",
          },
          {
            term: "Verifikasi Tagihan",
            detail: "Menerbitkan kode bayar melalui Midtrans Core API, memvalidasi pelunasan secara otomatis, dan mengaktifkan kuota paket pada workspace.",
          },
          {
            term: "Keamanan & Audit",
            detail: "Mencatat riwayat perubahan konfigurasi penting di dalam workspace untuk mencegah akses tanpa hak.",
          },
        ],
      },
      {
        id: "keamanan-data",
        index: "04",
        title: "Keamanan Infrastruktur dan Isolasi Multi-Tenant",
        paragraphs: [
          "Setiap workspace beroperasi di dalam batas isolasi data yang ditegakkan langsung di tingkat server dan basis data:",
        ],
        rows: [
          {
            term: "Enkripsi Kredensial",
            detail: "Token akses Meta Threads dienkripsi menggunakan kunci kriptografi server sebelum disimpan dan tidak pernah ditampilkan kembali dalam bentuk teks terbuka.",
          },
          {
            term: "Kontrol Akses Peran",
            detail: "Hak baca dan tulis dibatasi ketat berdasarkan peran anggota (Pemilik, Admin, Editor, Pengamat) serta daftar akun Threads yang diizinkan.",
          },
          {
            term: "Validasi Webhook",
            detail: "Notifikasi pembayaran diverifikasi menggunakan tanda tangan SHA-512 dan dikonfirmasi ulang ke endpoint resmi Midtrans.",
          },
        ],
      },
      {
        id: "pihak-ketiga",
        index: "05",
        title: "Mitra Infrastruktur Pihak Ketiga",
        paragraphs: [
          "Kami hanya meneruskan data secara terbatas kepada penyedia infrastruktur inti yang diperlukan agar layanan dapat berjalan:",
        ],
        rows: [
          {
            term: "Midtrans",
            detail: "Penyelenggara gerbang pembayaran resmi berlisensi Bank Indonesia untuk memproses transaksi QRIS, GoPay, ShopeePay, dan Virtual Account bank.",
          },
          {
            term: "Meta Platforms, Inc.",
            detail: "Penyedia API resmi Threads untuk penerbitan posting dan pengambilan metrik analitik akun yang telah Anda hubungkan.",
          },
          {
            term: "Google Cloud",
            detail: "Penyedia autentikasi Google Sign-In dan pemrosesan model bahasa alami untuk penyusunan draf konten.",
          },
        ],
      },
      {
        id: "data-publik-threads",
        index: "06",
        title: "Data Publik dari Pencarian Threads dan Auto Comment",
        paragraphs: [
          "Fitur Radar dan Auto Comment memakai API resmi Threads (izin threads_keyword_search) untuk mencari postingan publik berdasarkan kata kunci. Data publik milik orang lain yang kami tangani dari fitur ini:",
        ],
        rows: [
          {
            term: "Panel Cari di Threads",
            detail: "Pencarian yang Anda jalankan dengan akun Threads Anda sendiri. Hasilnya (username penulis, teks, tautan) hanya ditampilkan kepada Anda dan tidak disimpan.",
          },
          {
            term: "Tren Otomatis",
            detail: "Server kami mencari postingan populer untuk beberapa topik tren yang aman memakai satu akun Threads milik BotThreads, bukan akun pelanggan. Kami menyimpan teks postingan (maksimal 400 karakter), tautan, waktu, username penulis, dan topiknya; ditampilkan selama 48 jam lalu dihapus otomatis paling lambat 30 hari kemudian.",
          },
          {
            term: "Auto Comment",
            detail: "Hanya berjalan bila Anda mengaktifkannya untuk akun Anda. Kami menyimpan ID postingan, username penulis, potongan teks (maksimal 300 karakter), tautan, kata kunci, serta komentar yang dikirim akun Anda dan statusnya. Data ini dipakai untuk riwayat dan untuk mencegah satu postingan atau penulis dikomentari berulang, disimpan paling lama 90 hari, dan dihapus lebih awal bila akun Threads dihapus dari BotThreads atau permintaan penghapusan data diterima.",
          },
          {
            term: "Pemrosesan AI",
            detail: "Potongan teks postingan dikirim ke penyedia model bahasa (Pasal 05) hanya untuk menyusun draf komentar atau ide tulisan.",
          },
          {
            term: "Yang Tidak Kami Lakukan",
            detail: "Kami tidak menjual atau membagikan data ini, tidak memakainya untuk iklan, tidak membuat profil individu, tidak melatih model AI dengannya, dan tidak menyukai, mengikuti, me-repost, atau mengirim pesan kepada penulisnya.",
          },
        ],
      },
    ],
  },

  ketentuan: {
    id: "ketentuan",
    order: "02",
    href: "/syarat-ketentuan",
    shortTitle: "Syarat & Ketentuan",
    category: "PERJANJIAN PENGGUNAAN LAYANAN",
    title: "Syarat & Ketentuan Layanan",
    subtitle:
      "Ketentuan hukum penggunaan platform SaaS BotThreads, hak dan kewajiban pemilik workspace, aturan kepatuhan konten, serta ketentuan berlangganan.",
    effectiveDate: MERCHANT_INFO.effectiveDate,
    docCode: "BT-DOC/TC-02",
    jurisdiction: "Hukum Negara Republik Indonesia",
    summarySpecs: [
      { term: "Model Layanan", detail: "Perangkat lunak berbasis web (SaaS) untuk otomasi dan analitik konten Threads" },
      { term: "Mata Uang Tagihan", detail: "Seluruh harga paket tercantum dan ditagihkan dalam Rupiah Indonesia (IDR)" },
      { term: "Mekanisme Tagihan", detail: "Prabayar per siklus (1, 3, atau 12 bulan) tanpa pemotongan saldo otomatis" },
      { term: "Kendali Penerbitan", detail: "Mendukung mode Tinjau Dulu (manual) maupun Otomatis, serta tombol jeda instan" },
    ],
    articles: [
      {
        id: "ketentuan-umum",
        index: "01",
        title: "Definisi dan Penerimaan Ketentuan",
        paragraphs: [
          "BotThreads adalah layanan perangkat lunak berbasis cloud yang membantu pemilik usaha, kreator, dan tim pengelola merek merencanakan ide, menulis draf berbasis AI, menjadwalkan waktu tayang, dan menganalisis kinerja akun Meta Threads.",
          "Dengan membuat akun, mengakses ruang kerja (workspace), atau melakukan pembayaran paket langganan, Anda menyatakan telah membaca, memahami, dan menyetujui seluruh isi Syarat & Ketentuan ini.",
        ],
      },
      {
        id: "akun-dan-tim",
        index: "02",
        title: "Akun Pengguna, Keamanan, dan Kewenangan Workspace",
        paragraphs: [
          "Pengguna wajib memberikan informasi pendaftaran yang benar dan menjaga kerahasiaan kredensial masuk masing-masing:",
        ],
        rows: [
          {
            term: "Kepemilikan Workspace",
            detail: "Pendaftar mandiri otomatis menjadi Pemilik (Owner) atas workspace baru yang dibuat.",
          },
          {
            term: "Kewenangan Akun Threads",
            detail: "Anda menjamin bahwa setiap akun Threads yang dihubungkan ke workspace adalah milik sah organisasi Anda atau telah mendapat izin resmi.",
          },
          {
            term: "Tanggung Jawab Sesi",
            detail: "Segala tindakan penjadwalan atau perubahan pengaturan yang dilakukan melalui akun yang sah menjadi tanggung jawab pemegang akun tersebut.",
          },
        ],
      },
      {
        id: "kepatuhan-konten",
        index: "03",
        title: "Aturan Konten dan Larangan Penggunaan",
        paragraphs: [
          "Sistem kami menyediakan gerbang pemeriksaan otomatis (validasi klaim harga/promo terhadap basis pengetahuan, daftar kata terlarang, serta penilaian editor AI). Namun tanggung jawab akhir atas kebenaran informasi produk tetap berada pada pengguna.",
          "Pengguna dilarang menggunakan layanan BotThreads untuk memproduksi atau menyebarkan konten yang memuat:",
        ],
        rows: [
          {
            term: "Penipuan & Hoaks",
            detail: "Klaim produk palsu, skema penipuan keuangan, investasi ilegal, atau manipulasi informasi publik.",
          },
          {
            term: "Konten Ilegal",
            detail: "Perjudian daring, pornografi, pemerasan, atau perdagangan barang/jasa terlarang menurut hukum Republik Indonesia.",
          },
          {
            term: "Pelanggaran Hak & SARA",
            detail: "Ujaran kebencian berbasis SARA, pencemaran nama baik, atau pelanggaran hak kekayaan intelektual pihak ketiga.",
          },
          {
            term: "Penyalahgunaan API",
            detail: "Tindakan spam masif, upaya meretas infrastruktur, atau pelanggaran terhadap Ketentuan Penggunaan Meta Threads.",
          },
        ],
      },
      {
        id: "pembayaran-langganan",
        index: "04",
        title: "Harga, Siklus Berlangganan, dan Pembayaran",
        paragraphs: [
          "Kapasitas fitur di dalam workspace ditentukan oleh paket langganan aktif yang dipilih oleh Pemilik atau Admin:",
        ],
        rows: [
          {
            term: "Harga Rupiah (IDR)",
            detail: "Seluruh tarif paket ditampilkan secara transparan dalam mata uang Rupiah Indonesia (IDR) pada halaman Harga & Paket.",
          },
          {
            term: "Pilihan Siklus",
            detail: "Tersedia periode berlangganan 1 bulan (30 hari), 3 bulan (90 hari, hemat 10%), dan 12 bulan (360 hari, hemat 20%).",
          },
          {
            term: "Kanal Pembayaran",
            detail: "Pembayaran diproses secara resmi melalui Midtrans Core API menggunakan QRIS, GoPay, ShopeePay, atau Virtual Account bank nasional.",
          },
          {
            term: "Masa Aktif Berakhir",
            detail: "Jika masa aktif paket habis, penerbitan autopilot akan berhenti sementara hingga diperpanjang, namun seluruh data riwayat dan analitik tetap dapat diakses.",
          },
        ],
      },
      {
        id: "batasan-tanggung-jawab",
        index: "05",
        title: "Ketersediaan Layanan dan Batasan Tanggung Jawab",
        paragraphs: [
          "BotThreads dilengkapi mekanisme pengaman otomatis, termasuk jeda akun otomatis apabila penerbitan gagal tiga kali berturut-turut dan penurunan mode ke Tinjau Dulu apabila tayangan mingguan turun drastis.",
          "Pengguna memahami bahwa penerbitan akhir ke media sosial bergantung pada ketersediaan API resmi Meta Platforms, Inc. BotThreads tidak bertanggung jawab atas gangguan sisi server Meta, pembatasan akun oleh pihak Meta, atau perubahan kebijakan pihak ketiga.",
        ],
      },
    ],
  },

  pengembalian: {
    id: "pengembalian",
    order: "03",
    href: "/kebijakan-pengembalian",
    shortTitle: "Kebijakan Refund",
    category: "PENGEMBALIAN DANA & PEMBATALAN",
    title: "Kebijakan Pengembalian Dana & Pembatalan",
    subtitle:
      "Ketentuan pembatalan tagihan mandiri, penghentian perpanjangan langganan tanpa penalti, serta syarat dan prosedur pengajuan pengembalian dana (refund).",
    effectiveDate: MERCHANT_INFO.effectiveDate,
    docCode: "BT-DOC/RF-03",
    jurisdiction: "Standar Transaksi Midtrans & Perlindungan Konsumen",
    summarySpecs: [
      { term: "Pembatalan Tagihan", detail: "Dapat dibatalkan kapan saja sebelum dibayar langsung dari menu Tagihan" },
      { term: "Syarat Refund", detail: "Hanya untuk kendala teknis dari pihak kami atau pembayaran ganda, disertai bukti yang dapat diverifikasi" },
      { term: "Tagihan Ganda", detail: "Pengembalian penuh 100% apabila terjadi pemotongan ganda (double charge)" },
      { term: "Estimasi Pencairan", detail: "Verifikasi 2–3 hari kerja; pengembalian dana ke rekening asal 5–14 hari kerja" },
    ],
    articles: [
      {
        id: "pembatalan",
        index: "01",
        title: "Kebijakan Pembatalan Tagihan dan Langganan",
        paragraphs: [
          "Pelanggan memegang kendali penuh atas setiap tagihan dan keberlanjutan langganan workspace tanpa ikatan kontrak jangka panjang yang memaksa:",
        ],
        rows: [
          {
            term: "Tagihan Pending",
            detail: "Tagihan yang belum dibayar dapat dibatalkan kapan saja melalui tombol Batalkan di halaman Tagihan. Kode Virtual Account atau QRIS terkait akan langsung dinonaktifkan di Midtrans.",
          },
          {
            term: "Tanpa Auto-Debit",
            detail: "Kami tidak menerapkan penarikan saldo otomatis berulang. Anda bebas memilih untuk tidak memperpanjang paket pada akhir periode aktif tanpa biaya penalti.",
          },
          {
            term: "Hak Akses Sisa Periode",
            detail: "Apabila Anda memutuskan tidak melanjutkan langganan, seluruh fitur paket yang sudah dibayar tetap berfungsi normal hingga tanggal kedaluwarsa paket.",
          },
        ],
      },
      {
        id: "syarat-refund",
        index: "02",
        title: "Kriteria Kelayakan Pengembalian Dana (Refund)",
        paragraphs: [
          "Pengembalian dana (refund) hanya diberikan untuk kendala teknis yang dapat dibuktikan, yaitu salah satu dari kondisi berikut. Setiap pengajuan wajib menyertakan Order ID dan bukti pembayaran, dan diverifikasi terhadap data settlement Midtrans serta catatan sistem kami:",
        ],
        rows: [
          {
            term: "Kegagalan Aktivasi Sistem",
            detail: "Pembayaran telah terverifikasi Lunas (Settlement), namun kuota paket gagal aktif pada workspace dalam waktu lebih dari 24 jam akibat kendala teknis internal kami.",
          },
          {
            term: "Pembayaran Ganda",
            detail: "Terjadi pemotongan saldo lebih dari satu kali (double charge) untuk nomor tagihan atau periode perpanjangan yang sama.",
          },
        ],
      },
      {
        id: "pengecualian",
        index: "03",
        title: "Kondisi yang Tidak Dapat Dikembalikan",
        paragraphs: [
          "Pengembalian dana tidak berlaku untuk kondisi berikut:",
        ],
        rows: [
          {
            term: "Perubahan Keputusan",
            detail: "Berubah pikiran, merasa hasil tidak sesuai selera, atau tidak memakai layanan selama masa aktif paket. Paket yang sudah aktif dengan normal tidak dapat dikembalikan.",
          },
          {
            term: "Tanpa Bukti yang Dapat Diverifikasi",
            detail: "Pengajuan tanpa Order ID dan bukti pembayaran, atau kendala yang tidak tercatat pada data settlement Midtrans maupun catatan sistem kami.",
          },
          {
            term: "Pelanggaran Ketentuan",
            detail: "Penangguhan akses workspace yang disebabkan oleh pelanggaran Syarat & Ketentuan atau pemblokiran akun oleh pihak Meta.",
          },
        ],
      },
      {
        id: "prosedur-pengajuan",
        index: "04",
        title: "Prosedur Pengajuan dan Waktu Pencairan Dana",
        paragraphs: [
          "Setiap permohonan pengembalian dana diproses melalui tahapan terukur berikut:",
        ],
        rows: [
          {
            term: "Langkah 1 — Pengajuan",
            detail: `Kirim permohonan ke ${MERCHANT_INFO.billingEmail} atau WhatsApp ${MERCHANT_INFO.whatsappDisplay} dengan menyertakan Order ID, email akun pemilik workspace, bukti pembayaran, serta bukti kendala (misalnya tangkapan layar status paket yang belum aktif atau mutasi rekening yang terpotong dua kali).`,
          },
          {
            term: "Langkah 2 — Verifikasi",
            detail: "Tim keuangan kami mencocokkan data settlement Midtrans dan riwayat pemakaian workspace dalam waktu 2 hingga 3 hari kerja.",
          },
          {
            term: "Langkah 3 — Pencairan",
            detail: "Dana yang disetujui dikembalikan ke rekening bank atau kanal pembayaran asal pelanggan dalam waktu 5 hingga 14 hari kerja sesuai prosedur kliring bank dan Midtrans.",
          },
        ],
      },
    ],
  },

  pengiriman: {
    id: "pengiriman",
    order: "04",
    href: "/pengiriman-layanan",
    shortTitle: "Pengiriman Layanan",
    category: "KEBIJAKAN AKTIVASI PRODUK DIGITAL",
    title: "Kebijakan Pengiriman & Aktivasi Layanan",
    subtitle:
      "Penjelasan mekanisme serah terima produk perangkat lunak berbasis cloud (SaaS), standar waktu aktivasi otomatis, dan pemantauan status pembayaran.",
    effectiveDate: MERCHANT_INFO.effectiveDate,
    docCode: "BT-DOC/FD-04",
    jurisdiction: "Standar Serah Terima Produk Digital (SaaS)",
    summarySpecs: [
      { term: "Bentuk Produk", detail: "100% Perangkat Lunak Cloud (SaaS) — tanpa pengiriman barang fisik" },
      { term: "Biaya Pengiriman", detail: "Rp 0 (Bebas ongkos kirim; akses langsung melalui peramban web)" },
      { term: "Waktu Aktivasi (SLA)", detail: "Otomatis & instan (< 1 menit) setelah status pembayaran Settlement" },
      { term: "Bukti Serah Terima", detail: "Tercatat langsung pada riwayat tagihan dan status masa aktif di dashboard" },
    ],
    articles: [
      {
        id: "sifat-layanan",
        index: "01",
        title: "Sifat Produk Digital Tanpa Pengiriman Fisik",
        paragraphs: [
          "Seluruh paket langganan yang ditawarkan pada platform BotThreads adalah layanan perangkat lunak berbasis web (Software as a Service). Tidak ada pengiriman barang berwujud fisik melalui kurir atau ekspedisi.",
          "Serah terima layanan dinyatakan terpenuhi secara sah pada saat kuota paket (batas akun Threads, jumlah posting harian, dan izin mode Otomatis) telah aktif pada workspace pelanggan.",
        ],
      },
      {
        id: "standar-waktu-aktivasi",
        index: "02",
        title: "Standar Waktu Aktivasi Otomatis (SLA)",
        paragraphs: [
          "Sistem penagihan BotThreads terintegrasi langsung dengan Midtrans Core API untuk mengaktifkan paket secara otomatis begitu pembayaran diterima:",
        ],
        rows: [
          {
            term: "QRIS, GoPay & ShopeePay",
            detail: "Paket aktif secara instan (rata-rata kurang dari 10 detik) setelah pembayaran dikonfirmasi pada aplikasi e-wallet atau m-banking.",
          },
          {
            term: "Virtual Account Bank",
            detail: "Paket aktif otomatis dalam 10 hingga 60 detik setelah transfer ke nomor VA (BCA, BNI, BRI, Mandiri, Permata, CIMB Niaga) berhasil diverifikasi bank.",
          },
          {
            term: "Akumulasi Perpanjangan",
            detail: "Jika Anda memperpanjang paket sebelum masa aktif saat ini habis, durasi baru ditambahkan dari tanggal berakhirnya paket lama sehingga sisa hari aktif tidak hangus.",
          },
        ],
      },
      {
        id: "sinkronisasi-dan-bantuan",
        index: "03",
        title: "Pemantauan Status dan Penanganan Keterlambatan",
        paragraphs: [
          "Selain melalui notifikasi webhook real-time, layar pembayaran mengecek status transaksi secara otomatis setiap 8 detik dan penjadwal server menyinkronkan tagihan tertunda setiap 5 menit.",
          `Apabila terjadi jeda jaringan perbankan sehingga paket belum aktif dalam 15 menit setelah saldo terpotong, pelanggan dapat menekan tombol 'Saya sudah bayar' di halaman Tagihan atau menghubungi ${MERCHANT_INFO.billingEmail} untuk bantuan aktivasi segera.`,
        ],
      },
    ],
  },

  penghapusan: {
    id: "penghapusan",
    order: "05",
    href: "/penghapusan-data",
    shortTitle: "Penghapusan Data",
    category: "PROSEDUR DATA DELETION (UU PDP & META)",
    title: "Kebijakan & Prosedur Penghapusan Data",
    subtitle:
      "Panduan resmi bagi pengguna untuk mencabut akses token akun Meta Threads secara mandiri maupun mengajukan penghapusan permanen seluruh data akun dan workspace.",
    effectiveDate: MERCHANT_INFO.effectiveDate,
    docCode: "BT-DOC/DD-05",
    jurisdiction: "UU PDP Pasal 43 & Kebijakan Platform Meta",
    summarySpecs: [
      { term: "Cabut Akses Threads", detail: "Dapat dilakukan mandiri kapan saja dari menu Pengaturan > Akun Threads" },
      { term: "Hapus Konten & Jadwal", detail: "Dapat dihapus langsung oleh Pemilik/Admin dari halaman Jadwal & Pengetahuan" },
      { term: "Hapus Akun Permanen", detail: "Diproses maksimal 3 x 24 jam kerja melalui permohonan email terverifikasi" },
      { term: "Retensi Setelah Hapus", detail: "Token, draf, dan pengetahuan brand dihapus permanen dari basis data aktif" },
    ],
    articles: [
      {
        id: "pencabutan-mandiri",
        index: "01",
        title: "Pencabutan Akses Akun Threads Secara Mandiri",
        paragraphs: [
          "Anda memiliki kendali penuh untuk menghentikan koneksi antara akun Meta Threads Anda dan dashboard BotThreads kapan saja tanpa harus menunggu persetujuan tim kami:",
        ],
        rows: [
          {
            term: "Melalui Dashboard BotThreads",
            detail: "Buka menu Pengaturan > tab Akun Threads, pilih akun yang ingin dilepas, atau matikan mode Autopilot menjadi Mati. Seluruh jadwal antrean yang belum terbit dapat langsung dibatalkan.",
          },
          {
            term: "Melalui Pengaturan Aplikasi Meta",
            detail: "Buka aplikasi Threads atau Instagram > Pengaturan > Keamanan > Situs Web dan Izin Aplikasi, lalu cabut akses aplikasi BotThreads. Token akses di server kami akan otomatis gugur.",
          },
        ],
      },
      {
        id: "penghapusan-permanen",
        index: "02",
        title: "Prosedur Permohonan Penghapusan Akun dan Workspace Permanen",
        paragraphs: [
          "Apabila Anda ingin menghapus akun login beserta seluruh data workspace (termasuk token terenkripsi, basis pengetahuan brand, riwayat draf, dan keanggotaan tim) secara permanen dari server kami, ikuti langkah berikut:",
        ],
        rows: [
          {
            term: "1. Kirim Permohonan",
            detail: `Kirimkan email dari alamat email yang terdaftar sebagai Pemilik (Owner) workspace ke ${MERCHANT_INFO.supportEmail} dengan subjek: "Permohonan Penghapusan Data — [Nama Brand / Username]".`,
          },
          {
            term: "2. Verifikasi Kepemilikan",
            detail: "Tim kami akan memverifikasi bahwa permintaan dikirim oleh pemilik sah akun guna mencegah penghapusan tanpa hak oleh pihak lain.",
          },
          {
            term: "3. Eksekusi Penghapusan",
            detail: "Dalam waktu maksimal 3 x 24 jam kerja, seluruh data akun, token akses, basis pengetahuan, dan jadwal akan dihapus secara permanen dan Anda akan menerima bukti konfirmasi penghapusan melalui email.",
          },
        ],
      },
    ],
  },

  kontak: {
    id: "kontak",
    order: "06",
    href: "/kontak",
    shortTitle: "Kontak & Identitas",
    category: "INFORMASI PENYELENGGARA & LAYANAN PELANGGAN",
    title: "Kontak Resmi & Identitas Penyelenggara",
    subtitle:
      "Informasi resmi penyelenggara layanan, alamat operasional di Indonesia, saluran bantuan teknis, serta layanan pengaduan transaksi dan tagihan pelanggan.",
    effectiveDate: MERCHANT_INFO.effectiveDate,
    docCode: "BT-DOC/MC-06",
    jurisdiction: "Indonesia (WIB / UTC+7)",
    summarySpecs: [
      { term: "Nama Layanan", detail: MERCHANT_INFO.brandName },
      { term: "Email Resmi", detail: MERCHANT_INFO.supportEmail },
      { term: "WhatsApp Pelanggan", detail: MERCHANT_INFO.whatsappDisplay },
      { term: "Jam Operasional", detail: MERCHANT_INFO.operatingHours },
    ],
    articles: [
      {
        id: "saluran-bantuan",
        index: "01",
        title: "Saluran Komunikasi Resmi",
        paragraphs: [
          "Kami menyediakan jalur komunikasi terpisah sesuai kebutuhan agar setiap pertanyaan teknis maupun administrasi pembayaran dapat ditangani dengan cepat dan tepat:",
        ],
        rows: [
          {
            term: "Bantuan Teknis & Akun",
            detail: `Hubungi ${MERCHANT_INFO.supportEmail} untuk bantuan koneksi akun Threads, konfigurasi autopilot, kendala login Google, atau permohonan penghapusan data.`,
          },
          {
            term: "Layanan Tagihan & Refund",
            detail: `Hubungi ${MERCHANT_INFO.billingEmail} untuk pertanyaan pembayaran Midtrans (QRIS, E-Wallet, Virtual Account), bukti tagihan, atau pengajuan pengembalian dana.`,
          },
          {
            term: "Layanan Cepat WhatsApp",
            detail: `Hubungi ${MERCHANT_INFO.whatsappDisplay} pada jam kerja (${MERCHANT_INFO.operatingHours}) untuk bantuan langsung dari tim operasional kami.`,
          },
        ],
      },
      {
        id: "mekanisme-pengaduan",
        index: "02",
        title: "Standar Penanganan Pengaduan Pelanggan (SLA)",
        paragraphs: [
          "Setiap laporan kendala transaksi atau pengaduan layanan dicatat dan ditindaklanjuti berdasarkan standar waktu respons berikut:",
        ],
        rows: [
          {
            term: "Respons Awal",
            detail: "Maksimal 2 jam kerja sejak pesan diterima melalui WhatsApp atau email resmi pada jam operasional.",
          },
          {
            term: "Kendala Aktivasi Pembayaran",
            detail: "Diselesaikan dalam 1 hingga 4 jam kerja setelah bukti pembayaran dan Order ID diverifikasi terhadap catatan Midtrans.",
          },
          {
            term: "Penyelesaian Pengajuan Refund",
            detail: "Keputusan verifikasi diterbitkan dalam 2–3 hari kerja, dilanjutkan proses pengembalian dana 5–14 hari kerja.",
          },
        ],
      },
    ],
  },
};

export const LEGAL_DOC_LIST: LegalDocument[] = [
  LEGAL_DOCUMENTS.privasi,
  LEGAL_DOCUMENTS.ketentuan,
  LEGAL_DOCUMENTS.pengembalian,
  LEGAL_DOCUMENTS.pengiriman,
  LEGAL_DOCUMENTS.penghapusan,
  LEGAL_DOCUMENTS.kontak,
];
