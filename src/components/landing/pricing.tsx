import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { publicPlans } from "@/lib/plan";
import { formatRupiah, type PublicPlansResponse } from "@/lib/plan-types";
import { cn } from "@/lib/utils";

const FALLBACK_PLANS: PublicPlansResponse["items"] = [
  {
    id: "starter",
    nama: "Starter",
    deskripsi: "Untuk pemilik satu brand atau UMKM yang ingin mulai rutin posting setiap hari dengan pengawasan.",
    label: null,
    hargaBulanan: 99_000,
    maxAkun: 1,
    maxPostingPerHari: 3,
    maxAnggota: 2,
    modeOtomatis: false,
  },
  {
    id: "pro",
    nama: "Pro",
    deskripsi: "Untuk brand berkembang dan tim konten yang membutuhkan autopilot penuh di beberapa akun sekaligus.",
    label: null,
    hargaBulanan: 249_000,
    maxAkun: 5,
    maxPostingPerHari: 6,
    maxAnggota: 5,
    modeOtomatis: true,
  },
  {
    id: "agensi",
    nama: "Agensi",
    deskripsi: "Untuk agensi kreatif dan jaringan multi-cabang yang mengelola banyak akun Threads dalam satu ruang kerja.",
    label: null,
    hargaBulanan: 599_000,
    maxAkun: 15,
    maxPostingPerHari: 6,
    maxAnggota: 15,
    modeOtomatis: true,
  },
];

/**
 * Daftar paket di halaman perkenalan. Isinya dari database (paket aktif yang publik, diatur super admin),
 * dibaca saat permintaan datang.
 */
export async function Pricing({ wrap }: { wrap: string }) {
  await connection();
  const dbItems = await publicPlans().then(
    (r) => r.items,
    () => []
  );
  const items = dbItems.length > 0 ? dbItems : FALLBACK_PLANS;

  // Utamakan paket "pro" bila ada, atau paket berbayar tengah sebagai pilihan utama.
  const proPlan = items.find((p) => p.id === "pro");
  const featured = proPlan ? proPlan.id : items.length >= 2 ? items[Math.min(1, items.length - 1)].id : null;

  return (
    <section id="paket" className={`${wrap} py-16 md:py-24 scroll-mt-24`}>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6" data-reveal>
        <div className="max-w-2xl">
          <p className="lp-mono text-xs font-bold tracking-widest text-accent">HARGA & PAKET LANGGANAN</p>
          <h2 className="lp-display mt-4 text-[2rem] leading-[1.05] md:text-[2.75rem] font-extrabold">
            Pilih paket sesuai skala akun Threads Anda
          </h2>
          <p className="mt-4 text-[15px] md:text-base text-muted leading-relaxed">
            Mulai dari uji coba gratis hingga skala agensi. Jumlah posting per hari diatur per akun sampai batas paketnya, dan paket bisa dinaikkan kapan saja.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-line bg-surface text-xs font-semibold text-fg shrink-0">
          <Sparkles className="w-4 h-4 text-accent shrink-0" />
          <span>Hemat 10% (3 Bulan) · Hemat 20% (Tahunan)</span>
        </div>
      </div>

      <div
        className={cn(
          "mt-10 grid gap-4",
          items.length === 1
            ? "max-w-md"
            : items.length === 2
              ? "md:grid-cols-2"
              : items.length === 3
                ? "md:grid-cols-3"
                : "md:grid-cols-2 lg:grid-cols-4"
        )}
      >
        {items.map((p, i) => {
          const on = p.id === featured;
          const isFree = p.hargaBulanan === 0;
          return (
            <article
              key={p.id}
              data-reveal
              style={{ "--i": i + 1 } as React.CSSProperties}
              className={cn(
                "lp-lift relative rounded-3xl border p-6 flex flex-col justify-between",
                on ? "border-accent bg-accent-soft" : "border-line bg-surface"
              )}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="lp-display text-xl font-bold">{p.nama}</h3>
                  {p.label ? (
                    <span className="lp-mono px-2.5 py-1 rounded-md bg-accent text-on-accent text-[10px] font-bold tracking-wider uppercase">
                      {p.label === "REKOMENDASI" ? "Rekomendasi" : "Terlaris"}
                    </span>
                  ) : on ? (
                    <span className="lp-mono px-2.5 py-1 rounded-md bg-accent text-on-accent text-[10px] font-bold tracking-wider uppercase">
                      Populer
                    </span>
                  ) : null}
                </div>
                {p.deskripsi && <p className="mt-2 text-xs text-muted leading-relaxed min-h-[2.25rem]">{p.deskripsi}</p>}
                <div className="mt-5 pt-5 border-t border-line">
                  <p className="flex items-baseline gap-1.5">
                    <span className="lp-display text-[1.85rem] leading-none font-extrabold tabular-nums">
                      {isFree ? "Gratis" : formatRupiah(p.hargaBulanan)}
                    </span>
                    {!isFree && <span className="text-xs text-muted font-medium">/ bulan</span>}
                  </p>
                  <p className="mt-1.5 text-[11px] text-muted">
                    {isFree ? "Uji coba fitur dasar tanpa biaya" : "Bisa dibayar bulanan, 3 bulan, atau tahunan"}
                  </p>
                </div>
                <ul className="mt-6 space-y-2.5 text-xs text-fg">
                  {[
                    `Autopilot untuk ${p.maxAkun} akun Threads`,
                    `Sampai ${p.maxPostingPerHari} posting / akun / hari`,
                    `Hingga ${p.maxAnggota} anggota tim`,
                    p.modeOtomatis ? "Mode Tinjau Dulu & Full Otomatis" : "Mode Tinjau Dulu (persetujuan manual)",
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2.5 leading-relaxed">
                      <Check className="w-4 h-4 mt-0.5 text-success shrink-0" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <Link
                href={`/daftar?plan=${encodeURIComponent(p.id)}`}
                className={cn(
                  "lp-cta mt-7 inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl text-sm font-semibold transition-colors",
                  on ? "bg-accent hover:bg-accent-hover text-on-accent" : "border border-line bg-canvas hover:bg-subtle text-fg"
                )}
              >
                {isFree ? "Coba Gratis" : `Pilih ${p.nama}`}
                <ArrowRight className="lp-arrow w-4 h-4" />
              </Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}
