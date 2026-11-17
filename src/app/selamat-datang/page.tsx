import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  ChevronDown,
  Clock,
  Eye,
  Flame,
  PlayCircle,
  Repeat2,
  ShieldAlert,
  ShieldCheck,
  Workflow,
  Zap,
} from "lucide-react";
import { GateDemo, HoursPlanner, IdeaSources } from "@/components/landing/demos";
import { OnboardingFlow } from "@/components/landing/onboarding-flow";
import { FilmSection } from "@/components/landing/film/film-section";
import { DeskSection } from "@/components/landing/hero-film/desk-section";
import { HeroCopy } from "@/components/landing/hero-film/hero-copy";
import { LandingFooter } from "@/components/landing/legal-section";
import { HeroDesc, HeroHeadline, HeroStatus, HeroSub, HeroTry } from "@/components/landing/hero-interactive";
import { LandingMotion, Magnetic, Tilt } from "@/components/landing/motion";
import { Pricing } from "@/components/landing/pricing";
import { FAQ } from "@/components/landing/faq-data";
import { JsonLd } from "@/components/seo/json-ld";
import { FAQ_PATH, FEATURES_PATH, HOW_PATH, LANDING_PATH, OG_IMAGE, SITE_DEFINITION, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, landingJsonLd } from "@/lib/site";
import { SystemFlow } from "@/components/flow/system-flow";
import { ThreadsMark, ThreadsPost } from "@/components/landing/threads-mark";
import { SiteHeader } from "@/components/landing/site-header";
import { BTN, LANDING_FONTS, WRAP } from "@/components/landing/fonts";
import { COMPARISON } from "@/components/landing/public-data";
import { DocTitle, T } from "@/components/i18n/t";
import "./landing.css";

const TITLE = SITE_TITLE;

// Metadata tetap bahasa Indonesia (halaman di-prerender); judul tab pengguna EN diganti di klien (DocTitle).
// URL kanonis = alamat halaman ini sendiri: beranda "/" hanya mengalihkan (307) pengunjung tanpa sesi ke sini.
export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: LANDING_PATH },
  // openGraph/twitter di halaman menimpa SELURUH objek bawaan layout (bukan digabung), jadi semua isinya ditulis
  // lengkap di sini, termasuk gambar: tanpa itu pratinjau tautan beranda tampil tanpa gambar.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "id_ID",
    alternateLocale: ["en_US"],
    url: LANDING_PATH,
    title: TITLE,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: SITE_DESCRIPTION, images: [OG_IMAGE] },
};

const PIPELINE = ["Tren", "Ide", "Tulis", "Periksa", "Antre", "Terbit"];

// Angka di bawah film: aturan sistem, bukan klaim hasil.
const AUTOMATION_FACTS = [
  { Icon: Workflow, value: "6 tahap", label: "dari tren sampai terbit, berjalan sendiri" },
  { Icon: ShieldCheck, value: "4 cek", label: "plus skor editor AI sebelum antre" },
  { Icon: Clock, value: "2,5 jam", label: "jeda bawaan antarposting, di jam ramai akun" },
  { Icon: BadgeCheck, value: "API resmi", label: "terbit dan statistik lewat Threads" },
];

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


/** Kepala bagian: cap waktu ala papan jadwal + judul. `time` adalah jam pada hari simulasi. */
function SectionHead({ time, label, title, body }: { time: string; label: string; title: string; body: string }) {
  return (
    <div className="max-w-2xl" data-reveal>
      <p className="lp-mono flex items-center gap-3 text-xs font-bold tracking-widest text-accent">
        <span className="inline-flex items-center h-7 px-2.5 rounded-md bg-accent text-on-accent tabular-nums">{time}</span>
        <T>{label}</T>
      </p>
      <h2 className="lp-display mt-4 text-[2rem] leading-[1.05] md:text-[2.75rem] font-extrabold">
        <T>{title}</T>
      </h2>
      <p className="mt-4 text-[15px] md:text-base text-muted leading-relaxed">
        <T>{body}</T>
      </p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <LandingMotion className={`${LANDING_FONTS} flex-1 w-full min-h-screen bg-canvas text-fg overflow-x-clip`}>
      <DocTitle title={TITLE} />
      <JsonLd data={landingJsonLd(FAQ)} />
      {/* Header mengambang: jam simulasi ikut bergerak saat halaman digulir (06.00 di atas, 22.00 di bawah). */}
      <SiteHeader clock />

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
                <T>AUTOPILOT UNTUK THREADS</T>
              </p>
              {/* Judul + deskripsi. Desktop: intro Remotion diputar sekali di atas teks ini (hero-copy.tsx).
                  Ponsel: judul "diketik" CSS (.lp-type) dan kata kunci menyala (.lp-key). Teks utuh selalu di HTML. */}
              <HeroCopy>
                <HeroHeadline />
                <HeroDesc />
                <HeroSub />
              </HeroCopy>
              {/* Ajakan mulai + pintasan ke daftar harga */}
              <div className="lp-rise mt-8" style={{ "--i": 5 } as React.CSSProperties}>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <Magnetic className="w-full sm:w-auto">
                    <Link href="/daftar" className={`${BTN} lp-glow h-14 px-8 text-base w-full sm:w-auto bg-accent hover:bg-accent-hover text-on-accent`}>
                      <T>Mulai Sekarang</T>
                      <ArrowRight className="lp-arrow w-5 h-5" />
                    </Link>
                  </Magnetic>
                  <a
                    href="#demo"
                    className={`${BTN} h-14 px-6 text-base w-full sm:w-auto border border-line bg-surface hover:bg-subtle text-fg`}
                  >
                    <PlayCircle className="w-5 h-5 text-accent" />
                    <T>Tonton demo 23 detik</T>
                  </a>
                </div>
                <p className="mt-5 flex items-center gap-2 text-[13px] text-muted">
                  <ThreadsMark className="w-4 h-4 text-fg" />
                  <T>Terbit langsung ke akun Threads Anda lewat API resmi.</T>
                </p>
              </div>
              <div className="lp-rise mt-8 pt-7 border-t border-line" style={{ "--i": 6 } as React.CSSProperties}>
                <HeroTry />
              </div>
            </div>

            {/* Papan jadwal: lapisan terdepan, bergerak sedikit lebih lambat dari halaman dan miring mengikuti kursor. */}
            <div className="lp-rise relative min-w-0" style={{ "--i": 4 } as React.CSSProperties}>
              <div data-drift="0.07">
                <Tilt max={3}>
                  <DeskSection />
                </Tilt>
              </div>
              {/* Cap status ikut tahap yang sedang tampil di monitor animasi (menulis, memeriksa, terbit). */}
              <div data-drift="-0.08" className="hidden md:block absolute -top-5 -left-6 z-10">
                <HeroStatus className="flex" />
              </div>
              <p
                data-drift="0.16"
                aria-hidden="true"
                className="lp-mono hidden md:flex absolute -bottom-4 -right-4 items-center gap-2 h-9 px-3 rounded-lg border border-line bg-surface text-[11px] font-bold text-fg shadow-pop"
              >
                <T>jeda antarposting 2,5 jam</T>
              </p>
            </div>
          </div>
        </section>

        {/* ---------- pita alur kerja: bergeser mendatar mengikuti gulir ---------- */}
        <div aria-hidden="true" className="overflow-hidden border-y border-line bg-surface py-6 md:py-8">
          <div data-parallax="-0.42" data-axis="x" className="lp-band lp-display font-extrabold flex gap-[0.6em] -ml-[6vw]">
            {[...PIPELINE, ...PIPELINE].map((word, i) => (
              <span key={i} className={i % PIPELINE.length === 5 ? "is-on" : undefined}>
                <T>{`${word}@@pipeline`}</T>
                {" →"}
              </span>
            ))}
          </div>
        </div>

        {/* ---------- apa itu: definisi utuh yang bisa dikutip mesin pencari dan AI, plus perbandingan ---------- */}
        <section id="apa-itu" className={`${WRAP} pt-16 md:pt-24 scroll-mt-24`} aria-labelledby="apa-itu-judul">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-10 lg:gap-14 items-start">
            <div data-reveal>
              <p className="lp-mono text-xs font-bold tracking-widest text-accent">
                <T>APA ITU BOTTHREADS?</T>
              </p>
              <h2 id="apa-itu-judul" className="lp-display mt-4 text-[2rem] leading-[1.05] md:text-[2.75rem] font-extrabold">
                <T>Apa itu BotThreads?</T>
              </h2>
              <p className="mt-5 text-[15px] md:text-base text-muted leading-relaxed">
                <T>{SITE_DEFINITION}</T>
              </p>
              <Link href={FEATURES_PATH} className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
                <T>Lihat semua fitur</T>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="min-w-0" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
              <h3 className="text-base font-bold">
                <T>BotThreads dibandingkan cara lain mengelola Threads</T>
              </h3>
              {/* Ponsel: kartu bertumpuk supaya kolom BotThreads tidak tersembunyi di balik gulir mendatar. */}
              <ul className="mt-4 space-y-3 md:hidden">
                {COMPARISON.map((c) => (
                  <li key={c.row} className="rounded-2xl border border-line bg-surface p-4">
                    <p className="text-sm font-bold">
                      <T>{c.row}</T>
                    </p>
                    <p className="mt-2.5 rounded-xl bg-accent-soft px-3 py-2 text-[13px] font-medium text-fg leading-snug">
                      <span className="block text-[11px] font-bold text-accent">BotThreads</span>
                      <T>{c.bot}</T>
                    </p>
                    <dl className="mt-2.5 grid grid-cols-2 gap-3 text-[12px] leading-snug">
                      <div>
                        <dt className="font-semibold text-faint">
                          <T>Posting manual</T>
                        </dt>
                        <dd className="mt-0.5 text-muted">
                          <T>{c.manual}</T>
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-faint">
                          <T>Penjadwal biasa</T>
                        </dt>
                        <dd className="mt-0.5 text-muted">
                          <T>{c.scheduler}</T>
                        </dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
              <div className="mt-4 hidden md:block overflow-x-auto rounded-2xl border border-line bg-surface">
                <table className="w-full min-w-[560px] text-left text-[13px] leading-snug">
                  <caption className="sr-only">
                    <T>Perbandingan posting manual, aplikasi penjadwal biasa, dan BotThreads</T>
                  </caption>
                  <thead>
                    <tr className="border-b border-line text-xs text-muted">
                      <th scope="col" className="p-3 font-semibold w-[24%]">
                        <span className="sr-only">
                          <T>Pekerjaan</T>
                        </span>
                      </th>
                      <th scope="col" className="p-3 font-semibold">
                        <T>Posting manual</T>
                      </th>
                      <th scope="col" className="p-3 font-semibold">
                        <T>Penjadwal biasa</T>
                      </th>
                      <th scope="col" className="p-3 font-bold text-accent bg-accent-soft">BotThreads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARISON.map((c) => (
                      <tr key={c.row} className="border-b border-line last:border-0 align-top">
                        <th scope="row" className="p-3 font-semibold text-fg">
                          <T>{c.row}</T>
                        </th>
                        <td className="p-3 text-muted">
                          <T>{c.manual}</T>
                        </td>
                        <td className="p-3 text-muted">
                          <T>{c.scheduler}</T>
                        </td>
                        <td className="p-3 font-medium text-fg bg-accent-soft">
                          <T>{c.bot}</T>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- cara kerja: peta alur yang sama dengan di dalam aplikasi (lib/system-flow) ---------- */}
        <section id="cara-kerja" className={`${WRAP} py-16 md:py-24 scroll-mt-24`}>
          <div className="max-w-2xl" data-reveal>
            <p className="lp-mono text-xs font-bold tracking-widest text-accent">
              <T>CARA KERJA</T>
            </p>
            <h2 className="lp-display mt-4 text-[2rem] leading-[1.05] md:text-[2.75rem] font-extrabold">
              <T>Anda kerjakan 2 langkah,</T>{" "}
              <span className="lp-gradient-text">
                <T>sisanya jalan sendiri.</T>
              </span>
            </h2>
            <p className="mt-4 text-[15px] md:text-base text-muted leading-relaxed">
              <T>
                {"Hubungkan akun Threads dan kenalkan brand Anda ke AI, cukup sekali. Setelah itu BotThreads mencari ide, menulis, memeriksa, memposting, dan belajar dari hasilnya setiap hari. Klik tiap langkah untuk melihat apa yang terjadi dan menu mana yang dipakai di aplikasi."}
              </T>
            </p>
          </div>
          <div className="mt-10" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
            <SystemFlow variant="landing" />
          </div>
          <Link href={HOW_PATH} className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
            <T>Baca cara kerja selengkapnya</T>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </section>

        {/* ---------- film demo: satu hari autopilot dalam 23 detik (Remotion, dimuat saat mendekati layar) ---------- */}
        <section id="demo" className="relative scroll-mt-24 overflow-hidden">
          <div aria-hidden="true" className="lp-grid-floor" />
          <div className={`${WRAP} relative py-16 md:py-24`}>
            <div className="max-w-2xl mx-auto text-center" data-reveal>
              <p className="lp-mono inline-flex items-center gap-2 h-7 px-3 rounded-full border border-line bg-surface text-xs font-bold tracking-widest text-accent">
                <span className="lp-live w-1.5 h-1.5 rounded-full bg-success" />
                <T>DEMO · 23 DETIK</T>
              </p>
              <h2 className="lp-display mt-4 text-[2rem] leading-[1.05] md:text-[3rem] font-extrabold">
                <T>Satu hari autopilot,</T>{" "}
                <span className="lp-gradient-text">
                  <T>tanpa Anda sentuh.</T>
                </span>
              </h2>
              <p className="mt-4 text-[15px] md:text-base text-muted leading-relaxed">
                <T>Dari tren pagi sampai views malam: inilah yang dikerjakan BotThreads untuk tiap akun, setiap hari.</T>
              </p>
            </div>
            <div className="mt-10 md:mt-12 max-w-[1040px] mx-auto" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
              <FilmSection />
            </div>
            <ul className="mt-8 max-w-[1040px] mx-auto grid grid-cols-2 md:grid-cols-4 gap-3" data-reveal style={{ "--i": 2 } as React.CSSProperties}>
              {AUTOMATION_FACTS.map(({ Icon, value, label }) => (
                <li key={label} className="lp-lift lp-glass rounded-2xl border border-line p-4">
                  <Icon className="w-5 h-5 text-accent" />
                  <p className="lp-display mt-3 text-2xl font-extrabold tabular-nums">
                    <T>{value}</T>
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted leading-snug">
                    <T>{label}</T>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- 06.00 ide ---------- */}
        <section id="rincian" className={`${WRAP} py-16 md:py-24 scroll-mt-24`}>
          <SectionHead
            time="06.00"
            label="TREN DIPANTAU"
            title="Setiap posting punya asal-usul"
            body="Tidak ada ide yang muncul dari udara. Pilih satu sumber di bawah untuk melihat bagaimana sebuah tren berubah menjadi bahan tulisan."
          />
          <div className="mt-10" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
            <IdeaSources />
          </div>
        </section>

        {/* ---------- 06.05 jadwal ---------- */}
        <section className="bg-surface border-y border-line">
          <div className={`${WRAP} py-16 md:py-24`}>
            <SectionHead
              time="06.05"
              label="JADWAL HARI INI DISUSUN"
              title="Jam tayang dihitung, bukan ditebak"
              body="Tiap akun punya jam ramainya sendiri. Ganti contoh brand dan jumlah posting per hari, lalu lihat jam mana yang dipilih."
            />
            <div className="mt-10" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
              <HoursPlanner />
            </div>
          </div>
        </section>

        {/* ---------- 10.42 pemeriksaan ---------- */}
        <section className={`${WRAP} py-16 md:py-24`}>
          <SectionHead
            time="10.42"
            label="DRAF DITULIS DAN DIPERIKSA"
            title="Tidak semua draf boleh terbit"
            body="Sembilan puluh menit sebelum jam tayang, draf ditulis lalu diperiksa empat hal dan dinilai editor AI. Buka ketiga contoh ini: satu lolos, dua ditolak, masing-masing dengan alasannya."
          />
          <div className="mt-10" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
            <GateDemo />
          </div>
        </section>

        {/* ---------- 12.12 terbit ---------- */}
        <section className="bg-surface border-y border-line">
          <div className={`${WRAP} py-16 md:py-24`}>
            <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] gap-10 items-center">
              <SectionHead
                time="12.12"
                label="TERBIT DI THREADS"
                title="Anda yang menentukan seberapa lepas tangan"
                body="Tepat di jamnya, posting muncul di akun Threads Anda seperti posting biasa. Seberapa banyak Anda ikut campur sebelum itu, diatur per akun dan bisa diganti kapan saja."
              />
              <div data-reveal style={{ "--i": 1 } as React.CSSProperties}>
                <p className="lp-mono mb-2 text-[11px] font-bold tracking-widest text-faint">
                  <T>CONTOH TAMPILAN DI THREADS</T>
                </p>
                <div data-parallax="-0.06">
                  <ThreadsPost
                    handle="@kedai.sore"
                    time={
                      <>
                        12.12 · <T>baru saja</T>
                      </>
                    }
                    text={<T>jam 11 tuh jam paling rawan. belum laper-laper amat, tapi udah buka aplikasi pesen makan tiap 5 menit 🫠</T>}
                  />
                </div>
              </div>
            </div>
            <div className="mt-10 grid md:grid-cols-2 gap-4">
              <article className="lp-lift rounded-3xl border border-line bg-canvas p-6 md:p-7" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
                <div className="w-11 h-11 rounded-2xl bg-warning-soft text-warning flex items-center justify-center">
                  <Eye className="w-5 h-5" />
                </div>
                <h3 className="lp-display mt-5 text-2xl font-bold">
                  <T>Tinjau dulu</T>
                </h3>
                <p className="mt-2 text-sm text-muted leading-relaxed">
                  <T>
                    {"AI menulis beberapa jam sebelum tayang dan menunggu. Anda menyetujui, mengedit, meminta tulis ulang, atau menolak. Yang tidak disetujui sampai 15 menit sebelum jamnya dilewati, bukan diterbitkan."}
                  </T>
                </p>
                <p className="lp-mono mt-5 text-[11px] font-bold tracking-wider text-fg">
                  <T>UNTUK MINGGU PERTAMA DAN AKUN UTAMA</T>
                </p>
              </article>
              <article className="lp-lift rounded-3xl border border-accent bg-accent-soft p-6 md:p-7" data-reveal style={{ "--i": 2 } as React.CSSProperties}>
                <div className="w-11 h-11 rounded-2xl bg-accent text-on-accent flex items-center justify-center">
                  <Zap className="w-5 h-5" />
                </div>
                <h3 className="lp-display mt-5 text-2xl font-bold">
                  <T>Otomatis</T>
                </h3>
                <p className="mt-2 text-sm text-muted leading-relaxed">
                  <T>
                    {"Draf yang lolos pemeriksaan langsung masuk antrean dan terbit di jamnya. Anda menerima notifikasi bila ada posting yang viral, akun yang dijeda, atau kinerja yang turun."}
                  </T>
                </p>
                <p className="lp-mono mt-5 text-[11px] font-bold tracking-wider text-fg">
                  <T>SETELAH GAYA TULISNYA TERASA PAS</T>
                </p>
              </article>
            </div>
          </div>
        </section>

        {/* ---------- 22.00 belajar ---------- */}
        <section className={`${WRAP} py-16 md:py-24`}>
          <SectionHead
            time="22.00"
            label="BELAJAR DARI HASIL"
            title="Besok lebih tajam dari hari ini"
            body="Setelah angka views masuk, tiap posting dibandingkan dengan kebiasaan akunnya sendiri, bukan dengan akun lain."
          />
          <ol className="mt-10 grid md:grid-cols-3 gap-4">
            {LEARNING.map(({ Icon, title, body }, i) => (
              <li key={title} className="lp-lift rounded-3xl border border-line bg-surface p-6" data-reveal style={{ "--i": i + 1 } as React.CSSProperties}>
                <div className="flex items-center justify-between">
                  <div className="w-11 h-11 rounded-2xl bg-accent-soft text-accent flex items-center justify-center">
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="lp-mono text-xs font-bold text-faint tabular-nums">0{i + 1}</span>
                </div>
                <h3 className="mt-5 text-base font-bold">
                  <T>{title}</T>
                </h3>
                <p className="mt-1.5 text-sm text-muted leading-relaxed">
                  <T>{body}</T>
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------- cara mulai: alur pengguna baru dalam empat langkah ---------- */}
        <section id="cara-mulai" className="bg-surface border-y border-line scroll-mt-24">
          <div className={`${WRAP} py-16 md:py-24`}>
            <div className="max-w-2xl" data-reveal>
              <p className="lp-mono text-xs font-bold tracking-widest text-accent">
                <T>CARA MULAI</T>
              </p>
              <h2 className="lp-display mt-4 text-[2rem] leading-[1.05] md:text-[2.75rem] font-extrabold">
                <T>Dari daftar sampai autopilot, empat langkah</T>
              </h2>
              <p className="mt-4 text-[15px] md:text-base text-muted leading-relaxed">
                <T>Klik tiap langkah dan coba layarnya. Tidak perlu memasang apa pun, dan Anda yang memutuskan kapan AI boleh berjalan sendiri.</T>
              </p>
            </div>
            <div className="mt-10" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
              <OnboardingFlow />
            </div>
            <div className="mt-8" data-reveal style={{ "--i": 5 } as React.CSSProperties}>
              <Link href="/daftar" className={`${BTN} bg-accent hover:bg-accent-hover text-on-accent`}>
                <T>Mulai langkah pertama</T>
                <ArrowRight className="lp-arrow w-[18px] h-[18px]" />
              </Link>
            </div>
          </div>
        </section>

        {/* ---------- paket: dari database, tampil hanya bila super admin sudah mengisinya ---------- */}
        <Suspense fallback={null}>
          <Pricing wrap={WRAP} />
        </Suspense>

        {/* ---------- tanya jawab ---------- */}
        <section id="tanya" className="bg-surface border-y border-line scroll-mt-24">
          <div className={`${WRAP} py-16 md:py-24 grid lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-10`}>
            <div data-reveal>
              <p className="lp-mono text-xs font-bold tracking-widest text-accent">
                <T>TANYA JAWAB</T>
              </p>
              <h2 className="lp-display mt-4 text-[2rem] leading-[1.05] md:text-[2.75rem] font-extrabold">
                <T>Yang biasanya ditanyakan lebih dulu</T>
              </h2>
              <p className="mt-4 text-[15px] text-muted leading-relaxed">
                <T>Jawaban apa adanya, termasuk batasannya.</T>
              </p>
              <Link href={FAQ_PATH} className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
                <T>Buka halaman tanya jawab</T>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="divide-y divide-line border-y border-line" data-reveal style={{ "--i": 1 } as React.CSSProperties}>
              {FAQ.map((f) => (
                <details key={f.q} className="group">
                  <summary className="flex items-center justify-between gap-4 py-5 cursor-pointer list-none text-[15px] font-semibold hover:text-accent transition-colors [&::-webkit-details-marker]:hidden">
                    <T>{f.q}</T>
                    <ChevronDown className="w-5 h-5 text-muted shrink-0 transition-transform duration-300 group-open:rotate-180" />
                  </summary>
                  <p className="pb-6 pr-9 text-sm text-muted leading-relaxed">
                    <T>{f.a}</T>
                  </p>
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
                <h2 className="lp-display text-[2rem] leading-[1.05] md:text-[3rem] font-extrabold">
                  <T>Mulai dari satu akun, mode Tinjau dulu.</T>
                </h2>
                <p className="mt-3 text-sm md:text-base opacity-75 leading-relaxed">
                  <T>Lihat gaya tulisnya selama dua hari. Kalau cocok, biarkan berjalan sendiri.</T>
                </p>
              </div>
              <Link href="/daftar" className={`${BTN} bg-accent hover:bg-accent-hover text-on-accent shrink-0`}>
                <T>Buat workspace</T>
                <ArrowUpRight className="lp-arrow w-[18px] h-[18px]" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter wrap={WRAP} />
    </LandingMotion>
  );
}
