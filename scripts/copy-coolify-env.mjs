// Menyalin SEMUA variabel lingkungan dari aplikasi Coolify lama ke aplikasi baru (mis. pindah VPS).
// Nilai dibaca dan dikirim langsung lewat API; tidak pernah dicetak. Rahasia yang harus sama di kedua
// server (AUTH_SECRET, TOKEN_ENCRYPTION_KEY, AUTOPILOT_CRON_SECRET, ...) ikut tersalin apa adanya.
//
//   SRC_COOLIFY_URL=... SRC_COOLIFY_TOKEN=... SRC_APP_UUID=... \
//   DST_COOLIFY_URL=... DST_COOLIFY_TOKEN=... DST_APP_UUID=... \
//   npm run env:copy                (hanya bandingkan: nama variabel dan apakah nilainya sama)
//   npm run env:copy -- --apply     (tulis ke aplikasi baru)
//
// Bila kedua aplikasi ada di Coolify yang sama, DST_COOLIFY_URL/DST_COOLIFY_TOKEN boleh dikosongkan.
// Token sumber butuh izin "read:sensitive" (atau root) agar nilai variabel bisa dibaca.

const args = process.argv.slice(2);
const apply = args.includes("--apply");

const src = {
  base: (process.env.SRC_COOLIFY_URL || "").replace(/\/$/, ""),
  token: process.env.SRC_COOLIFY_TOKEN,
  app: process.env.SRC_APP_UUID,
};
const dst = {
  base: (process.env.DST_COOLIFY_URL || src.base).replace(/\/$/, ""),
  token: process.env.DST_COOLIFY_TOKEN || src.token,
  app: process.env.DST_APP_UUID,
};

const missing = [
  ["SRC_COOLIFY_URL", src.base],
  ["SRC_COOLIFY_TOKEN", src.token],
  ["SRC_APP_UUID", src.app],
  ["DST_APP_UUID", dst.app],
].filter(([, v]) => !v);
if (missing.length) {
  console.error("Belum diisi:", missing.map(([k]) => k).join(", "));
  process.exit(1);
}
if (src.base === dst.base && src.app === dst.app) {
  console.error("Aplikasi sumber dan tujuan sama; batal.");
  process.exit(1);
}

async function api(side, path, init = {}) {
  const res = await fetch(`${side.base}/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${side.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// Variabel preview (deploy PR) tidak ikut; produksi saja.
const prodEnvs = (list) => (Array.isArray(list) ? list.filter((e) => !e.is_preview) : []);

const from = prodEnvs(await api(src, `/applications/${src.app}/envs`));
const to = prodEnvs(await api(dst, `/applications/${dst.app}/envs`));

if (!from.length) {
  console.error("Aplikasi sumber tidak punya variabel produksi; periksa SRC_APP_UUID.");
  process.exit(1);
}
const unreadable = from.filter((e) => typeof e.value !== "string");
if (unreadable.length) {
  console.error(
    `Nilai ${unreadable.length} variabel tidak terbaca (${unreadable.map((e) => e.key).join(", ")}).`,
    "Buat token sumber dengan izin read:sensitive.",
  );
  process.exit(1);
}

const existing = new Map(to.map((e) => [e.key, e.value]));
console.log(`Sumber: ${from.length} variabel. Tujuan saat ini: ${to.length} variabel.`);
for (const e of from) {
  const state = !existing.has(e.key) ? "baru" : existing.get(e.key) === e.value ? "sama" : "BEDA, akan ditimpa";
  console.log(`  ${e.key}  (${state})`);
}
const extra = to.filter((e) => !from.some((f) => f.key === e.key)).map((e) => e.key);
if (extra.length) console.log("Hanya ada di tujuan (dibiarkan):", extra.join(", "));

if (!apply) {
  console.log("\nMode banding saja. Jalankan lagi dengan --apply untuk menulis ke aplikasi baru.");
  process.exit(0);
}

await api(dst, `/applications/${dst.app}/envs/bulk`, {
  method: "PATCH",
  body: JSON.stringify({
    data: from.map((e) => ({
      key: e.key,
      value: e.value,
      is_preview: false,
      is_literal: Boolean(e.is_literal),
      is_multiline: Boolean(e.is_multiline),
      is_shown_once: Boolean(e.is_shown_once),
    })),
  }),
});

// Baca ulang dan cocokkan supaya salinan yang terpotong/hilang langsung ketahuan.
const after = new Map(prodEnvs(await api(dst, `/applications/${dst.app}/envs`)).map((e) => [e.key, e.value]));
const mismatch = from.filter((e) => typeof after.get(e.key) === "string" && after.get(e.key) !== e.value).map((e) => e.key);
const absent = from.filter((e) => !after.has(e.key)).map((e) => e.key);
if (mismatch.length || absent.length) {
  if (absent.length) console.error("Tidak ada di tujuan setelah disalin:", absent.join(", "));
  if (mismatch.length) console.error("Nilai berbeda setelah disalin:", mismatch.join(", "));
  process.exit(1);
}
console.log(`\nTersalin ${from.length} variabel ke aplikasi baru dan sudah dicocokkan.`);
