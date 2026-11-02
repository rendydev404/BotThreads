// Membuat / memperbarui pengguna login dashboard di database PostgreSQL VPS (DATABASE_URL).
//
//   npm run user:create -- --username admin --password "rahasia-panjang" [--email a@b.com] [--name "Nama"]
//   npm run user:create -- --username admin --disable        (nonaktifkan akun)
//   npm run user:create -- --list                            (daftar pengguna)
//
// Butuh DATABASE_URL di .env.local.
import { randomBytes, randomUUID, scrypt } from "node:crypto";
import pg from "pg";
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

const dbUrl = (process.env.DATABASE_URL || process.env.DIRECT_URL || "").trim();
if (!dbUrl) {
  console.error("Set DATABASE_URL di .env.local");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });
const now = () => new Date().toISOString().replace("Z", "");

try {
  if (flag("list")) {
    const res = await pool.query(
      `SELECT username, email, name, "isActive", "lastLoginAt" FROM "DashboardUser" ORDER BY "createdAt" ASC`
    );
    console.table(res.rows);
  } else {
    const username = opt("username")?.trim().toLowerCase();
    if (!username) {
      console.error("Wajib: --username <nama>");
      process.exit(1);
    }

    if (flag("disable")) {
      const res = await pool.query(
        `UPDATE "DashboardUser" SET "isActive" = false, "updatedAt" = $1 WHERE username = $2 RETURNING id`,
        [now(), username]
      );
      console.log(res.rowCount ? `Akun "${username}" dinonaktifkan.` : "Pengguna tidak ditemukan.");
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
      const stamp = now();

      const existing = await pool.query(`SELECT id FROM "DashboardUser" WHERE username = $1 LIMIT 1`, [username]);
      if (existing.rows[0]) {
        const sets = [`"passwordHash" = $1`, `"isActive" = true`, `"updatedAt" = $2`];
        const vals = [passwordHash, stamp];
        if (email) {
          vals.push(email);
          sets.push(`email = $${vals.length}`);
        }
        if (name) {
          vals.push(name);
          sets.push(`name = $${vals.length}`);
        }
        vals.push(existing.rows[0].id);
        const upd = await pool.query(
          `UPDATE "DashboardUser" SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING username, email, name, "isActive"`,
          vals
        );
        console.log("Pengguna diperbarui:", upd.rows[0]);
      } else {
        const ins = await pool.query(
          `INSERT INTO "DashboardUser" (id, username, email, name, "passwordHash", "isActive", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, true, $6, $6)
           RETURNING username, email, name, "isActive"`,
          [randomUUID(), username, email, name, passwordHash, stamp]
        );
        console.log("Pengguna dibuat:", ins.rows[0]);
      }
    }
  }
} finally {
  await pool.end();
}
