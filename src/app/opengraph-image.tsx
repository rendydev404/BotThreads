import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * Gambar pratinjau 1200x630 saat tautan bottrit.com dibagikan (WhatsApp, Facebook, X, LinkedIn, Telegram) dan
 * gambar utama halaman di hasil AI. Dibuat sekali saat build lalu disajikan statis.
 */
export const alt = "BotThreads: autopilot AI untuk posting Threads otomatis";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const STEPS = ["Tren", "Ide", "Tulis", "Periksa", "Antre", "Terbit"];

// Dibaca di tingkat modul (bukan per permintaan) supaya gambar ini bisa dibuat saat build.
const iconSrc = `data:image/png;base64,${(await readFile(join(process.cwd(), "src/app/icon.png"))).toString("base64")}`;

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "linear-gradient(135deg, #0c0e16 0%, #151a3a 60%, #1f2447 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={iconSrc} width={72} height={72} alt="" style={{ borderRadius: 18 }} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 40, fontWeight: 800 }}>BotThreads</span>
            <span style={{ fontSize: 22, color: "#95a1ff", letterSpacing: 4 }}>AUTOPILOT AI UNTUK THREADS</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <span style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.02, letterSpacing: -2 }}>
            Threads Anda posting sendiri, setiap hari.
          </span>
          <span style={{ fontSize: 30, color: "#c8cdf5", lineHeight: 1.35, maxWidth: 980 }}>
            AI mencari ide dari tren, menulis dengan gaya brand, memeriksa, lalu memposting di jam ramai lewat API resmi.
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 10 }}>
            {STEPS.map((s, i) => (
              <span
                key={s}
                style={{
                  display: "flex",
                  padding: "10px 18px",
                  borderRadius: 12,
                  fontSize: 22,
                  fontWeight: 700,
                  background: i === STEPS.length - 1 ? "#7b8aff" : "rgba(255,255,255,0.08)",
                  color: i === STEPS.length - 1 ? "#0c0e16" : "#ffffff",
                }}
              >
                {s}
              </span>
            ))}
          </div>
          <span style={{ fontSize: 28, fontWeight: 700, color: "#95a1ff" }}>bottrit.com</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
