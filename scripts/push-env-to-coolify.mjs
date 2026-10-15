// Mengirim variabel lingkungan produksi dari .env.local ke aplikasi Coolify.
// Nilai rahasia dibaca dan dikirim langsung dari mesin ini; tidak dicetak.
//
//   COOLIFY_API_TOKEN=xxxx npm run env:push -- --dry-run   (hanya tampilkan nama variabel)
//   COOLIFY_API_TOKEN=xxxx npm run env:push                (kirim variabel)
//   COOLIFY_API_TOKEN=xxxx npm run env:push -- --deploy    (kirim lalu deploy ulang)
//
// AUTH_SECRET dibuat acak baru HANYA jika belum ada di Coolify (agar sesi login
// tidak terhapus setiap kali skrip dijalankan).
import { randomBytes } from "node:crypto";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const BASE = (process.env.COOLIFY_URL || "https://coolify.sukashawarma.tech").replace(/\/$/, "");
const APP = process.env.COOLIFY_APP_UUID || "0rrjnshh4h4gravrer3pgbpz";
const TOKEN = process.env.COOLIFY_API_TOKEN;
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const deploy = args.includes("--deploy");

const KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GEMINI_API_KEY",
  "GEMINI_MODELS",
  "HERMES_HOST",
  "HERMES_PORT",
  "HERMES_PROFILE",
  "NINE_ROUTER_PORT",
  "HERMES_API_KEY",
  "HERMES_BASE_URL",
  "HERMES_MODELS",
  "ORCHESTRATE_CONCURRENCY",
  // Saklar posting (CONTENT_PUBLISH_ENABLED, CONTENT_PUBLISH_TEST_ACCOUNTS) sengaja TIDAK ikut didorong:
  // nilainya khusus tiap lingkungan dan harus diubah dengan sadar di Coolify.
  "CONTENT_MAX_POSTS_PER_DAY",
  "CONTENT_MIN_GAP_MINUTES",
  "EXCLUDED_THREADS_ACCOUNTS",
  "AUTOPILOT_CRON_SECRET",
  "AUTOPILOT_MAX_PER_TICK",
  "AUTOPILOT_CONCURRENCY",
  "AUTOPILOT_CRITIC",
  "AUTOPILOT_BANNED_TERMS",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "APP_URL",
  // Pembayaran (Midtrans) dan hubungkan akun Threads; bisa juga diisi dari panel Super Admin > Integrasi.
  "MIDTRANS_SERVER_KEY",
  "MIDTRANS_CLIENT_KEY",
  "MIDTRANS_MERCHANT_ID",
  "MIDTRANS_IS_PRODUCTION",
  "THREADS_APP_ID",
  "THREADS_APP_SECRET",
  // Wajib SAMA dengan worker auto-suka: kunci enkripsi token Threads.
  "TOKEN_ENCRYPTION_KEY",
];

if (!TOKEN && !dry) {
  console.error("Set dulu token Coolify: COOLIFY_API_TOKEN=... (Coolify > Keys & Tokens > API tokens)");
  process.exit(1);
}

async function api(path, init = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const envs = KEYS.filter((k) => process.env[k]).map((key) => ({
  key,
  value: process.env[key],
  is_literal: true,
  is_preview: false,
}));

if (dry) {
  console.log("Akan dikirim (nilai disembunyikan):");
  for (const e of envs) console.log(`  ${e.key}  (${e.value.length} karakter)`);
  console.log("  AUTH_SECRET  (dibuat baru jika belum ada di Coolify)");
  const missing = KEYS.filter((k) => !process.env[k] && ["DATABASE_URL", "DIRECT_URL", "GEMINI_API_KEY"].includes(k));
  if (missing.length) console.log("PERINGATAN, belum ada di .env.local:", missing.join(", "));
  process.exit(0);
}

const existing = await api(`/applications/${APP}/envs`);
const hasAuthSecret = Array.isArray(existing) && existing.some((e) => e.key === "AUTH_SECRET");
if (!hasAuthSecret) {
  envs.push({
    key: "AUTH_SECRET",
    value: randomBytes(48).toString("base64url"),
    is_literal: true,
    is_preview: false,
  });
}

await api(`/applications/${APP}/envs/bulk`, {
  method: "PATCH",
  body: JSON.stringify({ data: envs }),
});
console.log(`Terkirim ${envs.length} variabel ke Coolify (${envs.map((e) => e.key).join(", ")}).`);

if (deploy) {
  const r = await api(`/deploy?uuid=${APP}`, { method: "POST" });
  console.log("Deploy dipicu:", JSON.stringify(r));
}
