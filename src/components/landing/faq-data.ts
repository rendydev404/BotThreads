/**
 * Tanya jawab halaman perkenalan. Dipakai bersama oleh halaman (/selamat-datang), JSON-LD FAQPage, dan /llms.txt,
 * jadi teks yang dibaca mesin pencari dan AI sama persis dengan yang dilihat pengunjung.
 */
// Setiap jawaban mengikuti perilaku sistem yang sebenarnya (autopilot-config, autopilot-gate, radar, midtrans,
// legal-content). Ubah bersama kodenya bila aturannya berubah.
export const FAQ: { q: string; a: string }[] = [
  {
    q: "BotThreads itu sebenarnya apa?",
    a: "Asisten AI untuk akun Threads. Setiap hari ia mencari ide, menulis posting dengan gaya akun Anda, memeriksanya, lalu memposting di jam ketika pengikut akun itu paling aktif. Anda cukup menghubungkan akun dan mengisi profil brand sekali di awal. Setelah itu Anda tinggal memantau hasilnya, atau ikut menyetujui setiap posting bila mau.",
  },
  {
    q: "Apakah saya harus memberikan kata sandi Threads?",
    a: "Tidak. Akun dihubungkan lewat halaman login resmi Threads, jadi kata sandi Anda tidak pernah kami terima. Memposting, membaca statistik, dan mencari posting populer semuanya memakai API resmi Threads. Permintaan penghapusan data bisa diajukan kapan saja lewat halaman Penghapusan Data di bagian bawah situs ini.",
  },
  {
    q: "Apakah setiap posting harus saya setujui dulu?",
    a: "Anda yang memilih, per akun. Mode Tinjau dulu: AI menulis sekitar 6 jam sebelum jam tayang, lalu Anda menyetujui, mengedit, atau menolak. Draf yang belum disetujui sampai 15 menit sebelum jamnya dilewati, tidak diterbitkan. Mode Otomatis: AI menulis sekitar 90 menit sebelum jam tayang, dan draf yang lolos pemeriksaan terbit sendiri. Beberapa paket hanya menyediakan mode Tinjau dulu.",
  },
  {
    q: "Apakah AI bisa memposting sesuatu yang memalukan brand saya?",
    a: "Setiap draf diperiksa dulu: harga, persen, dan kata promo hanya boleh muncul bila ada di data brand Anda. Topik sensitif dan kata terlarang diblokir, draf tidak boleh mirip posting akun lain Anda di hari yang sama, dan panjangnya dicek. Setelah itu draf dinilai editor AI dan harus mendapat skor minimal 0,7 dari 1. Draf yang gagal ditulis ulang. Kalau tetap gagal, jadwal itu dilewati, bukan dipaksa terbit.",
  },
  {
    q: "Dari mana AI tahu harga, menu, dan promo saya?",
    a: "Dari menu Pengetahuan yang Anda isi sendiri, dengan empat jenis isian: fakta brand, produk dan harga, promo beserta tanggal berakhirnya, serta larangan. Draf yang menyebut harga atau promo yang tidak tertulis di sana tidak lolos pemeriksaan.",
  },
  {
    q: "Dari mana ide postingannya?",
    a: "Dari posting akun Anda yang paling ramai, tren pencarian Google di Indonesia, berita terbaru seputar niche akun Anda, posting Threads paling populer untuk topik yang sedang naik, momen kalender seperti gajian, tanggal tua, akhir pekan, dan momen yang Anda tambahkan sendiri, serta catatan inspirasi yang Anda tulis sendiri. Semua ide masuk ke menu Radar lengkap dengan skor dan contoh tulisannya. Sumbernya hanya dijadikan bahan, teksnya tidak disalin.",
  },
  {
    q: "Berapa kali sehari akun saya posting, dan jam berapa?",
    a: "Bawaannya 3 kali sehari per akun. Jumlahnya bisa Anda ubah sampai batas paket. Jamnya dipilih dari jam ketika pengikut akun itu paling aktif, dengan jeda antarposting bawaan 2,5 jam (bisa diatur 2 sampai 8 jam), jadi akun tidak terlihat seperti spam.",
  },
  {
    q: "Kalau hasilnya tidak cocok, bagaimana menghentikannya?",
    a: "Satu tombol di menu Autopilot menjeda semua akun sekaligus, dan autopilot tiap akun juga bisa dimatikan satu per satu. Posting yang sudah terjadwal tetap bisa diubah atau dibatalkan dari menu Jadwal. Sistem juga punya rem sendiri: akun yang gagal terbit tiga kali berturut-turut dijeda otomatis. Kalau views seminggu turun lebih dari separuh, akun itu pindah ke mode Tinjau dulu dan Anda diberi tahu.",
  },
  {
    q: "Bagaimana cara bayar, dan kapan paket aktif?",
    a: "Pembayaran dalam Rupiah lewat Midtrans: QRIS, GoPay, ShopeePay, Virtual Account (BCA, BNI, BRI, Permata, CIMB Niaga), atau Mandiri Bill. Paket aktif otomatis begitu pembayaran lunas. Tidak ada potongan otomatis tiap bulan, jadi Anda memperpanjang sendiri bila ingin lanjut, dan sisa hari tidak hangus. Kalau paket habis, autopilot berhenti, tetapi data dan statistik Anda tetap bisa dibuka.",
  },
  {
    q: "Bisakah uang saya dikembalikan (refund)?",
    a: "Hanya bila ada kendala teknis yang bisa dibuktikan: pembayaran sudah lunas tetapi paket tidak aktif lebih dari 24 jam karena kesalahan sistem kami, atau saldo terpotong dua kali untuk tagihan yang sama. Pengajuan wajib menyertakan Order ID dan bukti pembayaran, lalu kami cocokkan dengan data Midtrans. Berubah pikiran atau tidak memakai layanan bukan alasan refund. Rinciannya ada di halaman Kebijakan Pengembalian.",
  },
];
