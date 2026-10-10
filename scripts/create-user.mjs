// Membuat / memperbarui pengguna login dashboard di database.
//
//   npm run user:create -- --username admin --password "rahasia-panjang" [--email a@b.com] [--name "Nama"]
//   npm run user:create -- --username admin --disable        (nonaktifkan akun)
//   npm run user:create -- --list                            (daftar pengguna)
//
// Jika username sudah ada, password/email/nama diperbarui (akun lama tetap sama).
import { randomBytes, scrypt } from "node:crypto";
import { PrismaClient } from "@prisma/client";
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

const prisma = new PrismaClient();

try {
  if (flag("list")) {
    const users = await prisma.dashboardUser.findMany({
      select: { username: true, email: true, name: true, isActive: true, lastLoginAt: true },
      orderBy: { createdAt: "asc" },
    });
    console.table(users);
  } else {
    const username = opt("username")?.trim().toLowerCase();
    if (!username) {
      console.error("Wajib: --username <nama>");
      process.exit(1);
    }

    if (flag("disable")) {
      const res = await prisma.dashboardUser.updateMany({
        where: { username },
        data: { isActive: false },
      });
      console.log(res.count ? `Akun "${username}" dinonaktifkan.` : "Pengguna tidak ditemukan.");
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

      const user = await prisma.dashboardUser.upsert({
        where: { username },
        create: { username, email, name, passwordHash },
        update: { passwordHash, isActive: true, ...(email && { email }), ...(name && { name }) },
        select: { username: true, email: true, name: true, isActive: true },
      });
      console.log("Tersimpan:", user);
    }
  }
} finally {
  await prisma.$disconnect();
}
