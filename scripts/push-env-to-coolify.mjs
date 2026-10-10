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
  "DATABASE_URL",
  "DIRECT_URL",
  "GEMINI_API_KEY",
  "GEMINI_MODELS",
  "HERMES_HOST",
  "HERMES_PORT",
  "HERMES_PROFILE",
  "NINE_ROUTER_PORT",
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
