// Membuat / memperbarui pengguna login dashboard di database (lewat Supabase REST).
//
//   npm run user:create -- --username admin --password "rahasia-panjang" [--email a@b.com] [--name "Nama"]
//   npm run user:create -- --username admin --disable        (nonaktifkan akun)
//   npm run user:create -- --list                            (daftar pengguna)
//
// Butuh SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY (dibaca dari .env.local).
// Jika username sudah ada, password/email/nama diperbarui (akun lama tetap sama).
import { randomBytes, randomUUID, scrypt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function hashPassword(password) {
  const N = 16384, r = 8, p = 1;
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N, r, p, maxmem: 128 * N * r * 2 }, (err, key) =>
      err
        ? reject(err)
        : resolve(`scrypt:${N}:${r}:${p}:${salt.toString("base64")}:${key.toString("base64")}`)
    );
  });
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di .env.local");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const must = ({ data, error }) => {
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data;
};
const now = () => new Date().toISOString().replace("Z", "");
const SEL = "username, email, name, isActive, lastLoginAt";

if (flag("list")) {
  console.table(
    must(await db.from("DashboardUser").select(SEL).order("createdAt", { ascending: true }))
  );
} else {
  const username = opt("username")?.trim().toLowerCase();
  if (!username) {
    console.error("Wajib: --username <nama>");
    process.exit(1);
  }

  if (flag("disable")) {
    const rows = must(
      await db
        .from("DashboardUser")
        .update({ isActive: false, updatedAt: now() })
        .eq("username", username)
        .select("id")
    );
    console.log(rows.length ? `Akun "${username}" dinonaktifkan.` : "Pengguna tidak ditemukan.");
  } else {
    const password = opt("password");
    if (!password || password.length < 6) {
      console.error("Wajib: --password <minimal 6 karakter>");
      process.exit(1);
    }
    if (password.length < 10) {
      console.warn("PERINGATAN: password kurang dari 10 karakter, mudah ditebak. Pakai yang lebih kuat untuk produksi.");
    }
    const email = opt("email")?.trim().toLowerCase() || null;
    const name = opt("name")?.trim() || null;
    const passwordHash = await hashPassword(password);

    const existing = must(
      await db.from("DashboardUser").select("id").eq("username", username).maybeSingle()
    );
    const user = existing
      ? must(
          await db
            .from("DashboardUser")
            .update({
              passwordHash,
              isActive: true,
              updatedAt: now(),
              ...(email && { email }),
              ...(name && { name }),
            })
            .eq("id", existing.id)
            .select("username, email, name, isActive")
            .single()
        )
      : must(
          await db
            .from("DashboardUser")
            .insert({
              id: randomUUID(),
              username,
              email,
              name,
              passwordHash,
              isActive: true,
              createdAt: now(),
              updatedAt: now(),
            })
            .select("username, email, name, isActive")
            .single()
        );
    console.log("Tersimpan:", user);
  }
}
