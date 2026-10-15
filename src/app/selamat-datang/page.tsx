import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import { ArrowRight, ArrowUpRight, ChevronDown, Eye, Flame, Repeat2, ShieldAlert, Zap } from "lucide-react";
import { GateDemo, HeroDemo, HoursPlanner, IdeaSources } from "@/components/landing/demos";
import { LandingMotion, Tilt } from "@/components/landing/motion";
import { Pricing } from "@/components/landing/pricing";
import { ThreadsMark, ThreadsPost } from "@/components/landing/threads-mark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import "./landing.css";

// Dua huruf khusus halaman ini: judul yang berkarakter dan angka jam ala papan jadwal.
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", weight: ["500", "700"], display: "swap" });

export const metadata: Metadata = {
  title: "BotThreads: Threads Anda posting sendiri, setiap hari",
  description:
    "AI mencari ide dari tren dan posting terbaik Anda, menulis, lalu menjadwalkan posting Threads setiap hari di jam ramai tiap akun. Jumlah posting per hari Anda yang atur.",
};

const PIPELINE = ["Tren", "Ide", "Tulis", "Periksa", "Antre", "Terbit"];

const LEARNING = [
  {
    Icon: Repeat2,
    title: "Pola yang terbukti dipakai lagi",
    body: "Pembuka, tema, dan jam yang menaikkan views di akun itu masuk ke bahan tulisan berikutnya dan menaikkan skor ide yang serupa.",
  },
  {
    Icon: Flame,
    title: "Yang viral langsung dilanjutkan",
    body: "Posting yang views-nya melonjak jauh di atas kebiasaan akun memicu notifikasi dan ide lanjutan, selagi topiknya masih hangat.",
  },
  {
    Icon: ShieldAlert,
    title: "Kalau turun, remnya ditarik",
    body: "Views seminggu anjlok lebih dari separuh? Akun itu turun sendiri ke mode Tinjau dulu dan Anda diberi tahu.",
  },
];

const FAQ = [
  {
    q: "Apakah AI bisa memposting sesuatu yang memalukan brand saya?",
    a: "Setiap draf melewati pemeriksaan aturan (bentuk, klaim harga dan promo, topik terlarang, kembar dengan akun lain) lalu dinilai editor AI. Yang tidak lolos ditulis ulang atau dilewati. Anda juga bisa memulai dengan mode Tinjau dulu, di mana tidak ada yang terbit tanpa persetujuan Anda.",
  },
  {
    q: "Dari mana AI tahu harga, menu, dan promo saya?",
    a: "Dari halaman Pengetahuan yang Anda isi sendiri: fakta, produk, promo beserta tanggal berakhirnya, dan larangan. AI tidak boleh menyebut harga atau promo yang tidak ada di sana.",
  },
  {
    q: "Apakah ini mengambil data dari Threads secara diam-diam?",
    a: "Tidak. Penerbitan dan statistik memakai API resmi Threads lewat login resmi Threads. Ide diambil dari posting akun Anda sendiri, tren pencarian Google Indonesia, momen kalender, dan catatan yang Anda tempel.",
  },
  {
    q: "Kalau hasilnya tidak cocok, bagaimana menghentikannya?",
    a: "Satu tombol menjeda semua akun. Tiap posting yang sudah dijadwalkan tetap bisa diubah atau dibatalkan dari halaman Jadwal. Akun yang gagal terbit tiga kali berturut-turut dijeda otomatis.",
  },
];

const WRAP = "max-w-[1180px] mx-auto px-4 md:px-8";
const BTN = "lp-cta inline-flex items-center justify-center gap-2 h-12 px-6 rounded-xl text-[15px] font-semibold transition-colors";

/** Kepala bagian: cap waktu ala papan jadwal + judul. `time` adalah jam pada hari simulasi. */
function SectionHead({ time, label, title, children }: { time: string; label: string; title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-2xl" data-reveal>
      <p className="lp-mono flex items-center gap-3 text-xs font-bold tracking-widest text-accent">
        <span className="inline-flex items-center h-7 px-2.5 rounded-md bg-accent text-on-accent tabular-nums">{time}</span>
        {label}
      </p>
      <h2 className="lp-display mt-4 text-[2rem] leading-[1.05] md:text-[2.75rem] font-extrabold">{title}</h2>
      <p className="mt-4 text-[15px] md:text-base text-muted leading-relaxed">{children}</p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <LandingMotion className={`${display.variable} ${mono.variable} flex-1 w-full min-h-screen bg-canvas text-fg overflow-x-clip`}>
      {/* Header mengambang: jam simulasi ikut bergerak saat halaman digulir (06.00 di atas, 22.00 di bawah). */}
      <header className="sticky top-3 z-30 px-3 md:px-6">
        <div className="lp-nav relative max-w-[1180px] mx-auto h-14 pl-3 pr-2 rounded-2xl border backdrop-blur-md flex items-center justify-between gap-3 overflow-hidden">
          <Link href="/selamat-datang" className="flex items-center gap-2.5 min-w-0">
            <Image src="/logo.webp" alt="" width={34} height={34} priority className="w-[34px] h-[34px] rounded-xl shrink-0" />
            <span className="text-[15px] font-bold truncate hidden sm:block">BotThreads</span>
          </Link>

          <p
            className="lp-mono hidden lg:flex items-center gap-2 h-8 px-3 rounded-lg bg-subtle text-xs font-bold text-fg"
            title="Gulir halaman untuk menjalani satu hari autopilot"
            aria-hidden="true"
          >
            <span className="lp-live w-1.5 h-1.5 rounded-full bg-success" />
            <span data-clock className="tabular-nums">
              06.00
            </span>
            <span className="text-faint font-medium">WIB</span>
          </p>

          <nav className="flex items-center gap-0.5 sm:gap-1 shrink-0">
            <a href="#cara-kerja" className="hidden md:inline-flex h-10 px-3 rounded-lg text-sm font-semibold text-muted hover:text-fg items-center transition-colors">
              Cara kerja
            </a>
            <a href="#paket" className="hidden sm:inline-flex h-10 px-3 rounded-lg text-sm font-semibold text-muted hover:text-fg items-center transition-colors">
              Harga & Paket
            </a>
            <a href="#tanya" className="hidden md:inline-flex h-10 px-3 rounded-lg text-sm font-semibold text-muted hover:text-fg items-center transition-colors">
              Tanya jawab
            </a>
            <ThemeToggle />
            <Link href="/login" className="h-10 px-3 sm:px-4 rounded-lg text-sm font-semibold hover:bg-subtle inline-flex items-center transition-colors">
              Masuk
            </Link>
            <Link href="/daftar" className="h-10 px-3.5 sm:px-4 rounded-xl text-sm font-semibold bg-accent hover:bg-accent-hover text-on-accent inline-flex items-center transition-colors">
              Daftar
            </Link>
          </nav>
          <span aria-hidden="true" className="lp-progress absolute left-0 bottom-0 h-[2px] w-full bg-accent" />
        </div>
      </header>

      <main>
        {/* ---------- pembuka ---------- */}
        <section data-spot className="relative -mt-[4.25rem] pt-[4.25rem]">
          <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
            <div data-drift="0.28" className="absolute inset-0">
              <div className="lp-dots" />
              <div className="lp-dots-accent" />
            </div>
            <div className="lp-halo" />
          </div>

          <div className={`${WRAP} relative pt-10 pb-16 md:pt-24 md:pb-32 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-10 lg:gap-16 items-center`}>
            <div>
              <p className="lp-rise lp-mono inline-flex items-center gap-2.5 text-xs font-bold tracking-widest text-accent" style={{ "--i": 0 } as React.CSSProperties}>
                <ThreadsMark className="w-4 h-4 text-fg" />
                AUTOPILOT UNTUK THREADS
              </p>
              <h1 className="lp-display mt-5 text-[clamp(2.35rem,11.5vw,3.1rem)] leading-[1] md:text-[4.4rem] md:leading-[0.95] font-extrabold">
                <span className="lp-rise block" style={{ "--i": 1 } as React.CSSProperties}>
                  Threads Anda
                </span>
                <span className="lp-rise block text-accent" style={{ "--i": 2 } as React.CSSProperties}>
                  posting sendiri,
                </span>
                <span className="lp-rise block" style={{ "--i": 3 } as React.CSSProperties}>
                  setiap hari.
                </span>
              </h1>
              <p className="lp-rise mt-6 text-base md:text-lg text-muted leading-relaxed max-w-xl" style={{ "--i": 4 } as React.CSSProperties}>
                AI mencari ide dari posting terbaik Anda dan tren hari ini, menulis dengan suara brand, memeriksa hasilnya, lalu
                menerbitkannya ke Threads di jam akun Anda paling ramai. Berapa kali sehari, Anda yang atur per akun.
              </p>
              {/* Ajakan mulai + pintasan ke daftar harga */}
              <div className="lp-rise mt-8" style={{ "--i": 5 } as React.CSSProperties}>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <Link href="/daftar" className={`${BTN} h-14 px-8 text-base w-full sm:w-auto bg-accent hover:bg-accent-hover text-on-accent`}>
                    Mulai Sekarang
                    <ArrowRight className="lp-arrow w-5 h-5" />
                  </Link>
                  <a
                    href="#paket"
                    className={`${BTN} h-14 px-6 text-base w-full sm:w-auto border border-line bg-surface hover:bg-subtle text-fg`}
                  >
                    Lihat Harga
                  </a>
                </div>
                <p className="mt-5 flex items-center gap-2 text-[13px] text-muted">
                  <ThreadsMark className="w-4 h-4 text-fg" />
                  Terbit langsung ke akun Threads Anda lewat API resmi.
                </p>
              </div>
            </div>

            {/* Papan jadwal: lapisan terdepan, bergerak sedikit lebih lambat dari halaman dan miring mengikuti kursor. */}
            <div className="lp-rise relative" style={{ "--i": 4 } as React.CSSProperties}>
              <div data-drift="0.07">
                <Tilt>
                  <HeroDemo />
                </Tilt>
              </div>
              <p
                data-drift="-0.08"
                aria-hidden="true"
                className="lp-mono hidden md:flex absolute -top-5 -left-6 items-center gap-2 h-9 px-3 rounded-lg bg-fg text-canvas text-[11px] font-bold shadow-pop"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-success" />
                skor editor 0,87 · lolos
              </p>
              <p
                data-drift="0.16"
                aria-hidden="true"
                className="lp-mono hidden md:flex absolute -bottom-4 -right-4 items-center gap-2 h-9 px-3 rounded-lg border border-line bg-surface text-[11px] font-bold text-fg shadow-pop"
              >
                jeda antarposting min. 2,5 jam
              </p>
            </div>
          </div>
        </section>

        {/* ---------- pita alur kerja: bergeser mendatar mengikuti gulir ---------- */}
        <div aria-hidden="true" className="overflow-hidden border-y border-line bg-surface py-6 md:py-8">
          <div data-parallax="-0.42" data-axis="x" className="lp-band lp-display font-extrabold flex gap-[0.6em] -ml-[6vw]">
            {[...PIPELINE, ...PIPELINE].map((word, i) => (
              <span key={i} className={i % PIPELINE.length === 5 ? "is-on" : undefined}>
                {word}
                {" →"}
              </span>
            ))}
          </div>
        </div>

        {/* ---------- 06.00 ide ---------- */}
        <section id="cara-kerja" className={`${WRAP} py-16 md:py-24 scroll-mt-24`}>
          <SectionHead time="06.00" label="TREN DIPANTAU" title="Setiap posting punya asal-usul">
            Tidak ada ide yang muncul dari udara. Pilih satu sumber di bawah untuk melihat bagaimana sebuah tren berubah menjadi bahan
            tulisan.
          </SectionHead>
          <div className="mt-10" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
            <IdeaSources />
          </div>
        </section>

        {/* ---------- 06.05 jadwal ---------- */}
        <section className="bg-surface border-y border-line">
          <div className={`${WRAP} py-16 md:py-24`}>
            <SectionHead time="06.05" label="JADWAL HARI INI DISUSUN" title="Jam tayang dihitung, bukan ditebak">
              Tiap akun punya jam ramainya sendiri. Ganti contoh brand dan jumlah posting per hari, lalu lihat jam mana yang dipilih.
            </SectionHead>
            <div className="mt-10" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
              <HoursPlanner />
            </div>
          </div>
        </section>

        {/* ---------- 10.42 pemeriksaan ---------- */}
        <section className={`${WRAP} py-16 md:py-24`}>
          <SectionHead time="10.42" label="DRAF DITULIS DAN DIPERIKSA" title="Tidak semua draf boleh terbit">
            Sembilan puluh menit sebelum jam tayang, draf ditulis lalu diperiksa empat hal dan dinilai editor AI. Buka ketiga contoh ini:
            satu lolos, dua ditolak, masing-masing dengan alasannya.
          </SectionHead>
          <div className="mt-10" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
            <GateDemo />
          </div>
        </section>

        {/* ---------- 12.12 terbit ---------- */}
        <section className="bg-surface border-y border-line">
          <div className={`${WRAP} py-16 md:py-24`}>
            <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] gap-10 items-center">
              <SectionHead time="12.12" label="TERBIT DI THREADS" title="Anda yang menentukan seberapa lepas tangan">
                Tepat di jamnya, posting muncul di akun Threads Anda seperti posting biasa. Seberapa banyak Anda ikut campur sebelum itu,
                diatur per akun dan bisa diganti kapan saja.
              </SectionHead>
              <div data-reveal style={{ "--i": 1 } as React.CSSProperties}>
                <div data-parallax="-0.06">
                  <ThreadsPost
                    handle="@kedai.sore"
                    time="12.12 · baru saja"
                    text="Jam 11 itu jam paling jujur. Belum lapar banget, tapi sudah mulai buka aplikasi pesan antar tiap lima menit."
                  />
                </div>
              </div>
            </div>
            <div className="mt-10 grid md:grid-cols-2 gap-4">
              <article className="lp-lift rounded-3xl border border-line bg-canvas p-6 md:p-7" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
                <div className="w-11 h-11 rounded-2xl bg-warning-soft text-warning flex items-center justify-center">
                  <Eye className="w-5 h-5" />
                </div>
                <h3 className="lp-display mt-5 text-2xl font-bold">Tinjau dulu</h3>
                <p className="mt-2 text-sm text-muted leading-relaxed">
                  AI menulis beberapa jam sebelum tayang dan menunggu. Anda menyetujui, mengedit, meminta tulis ulang, atau menolak.
                  Yang tidak disetujui sampai 15 menit sebelum jamnya dilewati, bukan diterbitkan.
                </p>
                <p className="lp-mono mt-5 text-[11px] font-bold tracking-wider text-fg">UNTUK MINGGU PERTAMA DAN AKUN UTAMA</p>
              </article>
              <article className="lp-lift rounded-3xl border border-accent bg-accent-soft p-6 md:p-7" data-reveal style={{ "--i": 2 } as React.CSSProperties}>
                <div className="w-11 h-11 rounded-2xl bg-accent text-on-accent flex items-center justify-center">
                  <Zap className="w-5 h-5" />
                </div>
                <h3 className="lp-display mt-5 text-2xl font-bold">Otomatis</h3>
                <p className="mt-2 text-sm text-muted leading-relaxed">
                  Draf yang lolos pemeriksaan langsung masuk antrean dan terbit di jamnya. Anda menerima notifikasi bila ada posting
                  yang viral, akun yang dijeda, atau kinerja yang turun.
                </p>
                <p className="lp-mono mt-5 text-[11px] font-bold tracking-wider text-fg">SETELAH GAYA TULISNYA TERASA PAS</p>
              </article>
            </div>
          </div>
        </section>

        {/* ---------- 22.00 belajar ---------- */}
        <section className={`${WRAP} py-16 md:py-24`}>
          <SectionHead time="22.00" label="BELAJAR DARI HASIL" title="Besok lebih tajam dari hari ini">
            Setelah angka views masuk, tiap posting dibandingkan dengan kebiasaan akunnya sendiri, bukan dengan akun lain.
          </SectionHead>
          <ol className="mt-10 grid md:grid-cols-3 gap-4">
            {LEARNING.map(({ Icon, title, body }, i) => (
              <li key={title} className="lp-lift rounded-3xl border border-line bg-surface p-6" data-reveal style={{ "--i": i + 1 } as React.CSSProperties}>
                <div className="flex items-center justify-between">
                  <div className="w-11 h-11 rounded-2xl bg-accent-soft text-accent flex items-center justify-center">
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="lp-mono text-xs font-bold text-faint tabular-nums">0{i + 1}</span>
                </div>
                <h3 className="mt-5 text-base font-bold">{title}</h3>
                <p className="mt-1.5 text-sm text-muted leading-relaxed">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------- paket: dari database, tampil hanya bila super admin sudah mengisinya ---------- */}
        <Suspense fallback={null}>
          <Pricing wrap={WRAP} />
        </Suspense>

        {/* ---------- tanya jawab ---------- */}
        <section id="tanya" className="bg-surface border-y border-line scroll-mt-24">
          <div className={`${WRAP} py-16 md:py-24 grid lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-10`}>
            <div data-reveal>
              <p className="lp-mono text-xs font-bold tracking-widest text-accent">TANYA JAWAB</p>
              <h2 className="lp-display mt-4 text-[2rem] leading-[1.05] md:text-[2.75rem] font-extrabold">Yang biasanya ditanyakan lebih dulu</h2>
              <p className="mt-4 text-[15px] text-muted leading-relaxed">Jawaban apa adanya, termasuk batasannya.</p>
            </div>
            <div className="divide-y divide-line border-y border-line" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
              {FAQ.map((f) => (
                <details key={f.q} className="group">
                  <summary className="flex items-center justify-between gap-4 py-5 cursor-pointer list-none text-[15px] font-semibold hover:text-accent transition-colors [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <ChevronDown className="w-5 h-5 text-muted shrink-0 transition-transform duration-300 group-open:rotate-180" />
                  </summary>
                  <p className="pb-6 pr-9 text-sm text-muted leading-relaxed">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- ajakan penutup ---------- */}
        <section className={`${WRAP} py-16 md:py-24`}>
          <div className="relative rounded-[2rem] bg-fg text-canvas px-6 py-12 md:px-14 md:py-16 overflow-hidden" data-reveal>
            <p aria-hidden="true" data-parallax="-0.12" className="lp-display absolute -right-4 -bottom-10 text-[9rem] md:text-[15rem] leading-none font-extrabold opacity-[0.07] select-none">
              22.00
            </p>
            <div className="relative flex flex-col md:flex-row md:items-end justify-between gap-8">
              <div className="max-w-xl">
                <h2 className="lp-display text-[2rem] leading-[1.05] md:text-[3rem] font-extrabold">Mulai dari satu akun, mode Tinjau dulu.</h2>
                <p className="mt-3 text-sm md:text-base opacity-75 leading-relaxed">
                  Lihat gaya tulisnya selama dua hari. Kalau cocok, biarkan berjalan sendiri.
                </p>
              </div>
              <Link href="/daftar" className={`${BTN} bg-accent hover:bg-accent-hover text-on-accent shrink-0`}>
                Buat workspace
                <ArrowUpRight className="lp-arrow w-[18px] h-[18px]" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className={`${WRAP} py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-faint`}>
          <p>BotThreads</p>
          <p className="text-center sm:text-right">
            Jam dan contoh di halaman ini adalah ilustrasi. Threads adalah merek dagang Meta; layanan ini tidak berafiliasi dengan Meta.
          </p>
        </div>
      </footer>
    </LandingMotion>
  );
}
