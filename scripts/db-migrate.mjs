// Menjalankan seluruh berkas migrasi SQL (sql/000_base_schema.sql s.d. sql/045_*.sql)
// secara berurutan ke database PostgreSQL VPS (DATABASE_URL), diikuti tuning autovacuum
// untuk tabel antrean ber-churn tinggi dan ANALYZE.
//
// Penggunaan:
//   npm run db:migrate
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const dbUrl = (process.env.DATABASE_URL || process.env.DIRECT_URL || "").trim();
if (!dbUrl) {
  console.error("Set DATABASE_URL di .env.local terlebih dahulu.");
  process.exit(1);
}

const sqlDir = path.resolve(process.cwd(), "sql");
const files = fs
  .readdirSync(sqlDir)
  .filter((f) => /^\d{3}_.*\.sql$/.test(f))
  .sort();

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();

try {
  console.log(`Menjalankan ${files.length} berkas migrasi SQL ke PostgreSQL...`);
  for (const file of files) {
    const content = fs.readFileSync(path.join(sqlDir, file), "utf8");
    const t0 = Date.now();
    await client.query(content);
    console.log(`  [OK] ${file} (${Date.now() - t0}ms)`);
  }

  // Tuning autovacuum agresif & fillfactor untuk tabel antrean BotThreads yang ber-churn tinggi
  const highChurnTables = [
    "AutopilotSlot",
    "AutopilotLease",
    "BuzzerTask",
    "ThreadsComment",
    "BtAutoCommentTarget",
  ];
  for (const tbl of highChurnTables) {
    await client
      .query(
        `ALTER TABLE IF EXISTS "${tbl}" SET (
           fillfactor = 85,
           autovacuum_vacuum_scale_factor = 0.02,
           autovacuum_analyze_scale_factor = 0.02
         )`
      )
      .catch(() => undefined);
  }

  await client.query("ANALYZE");
  console.log("Selesai! Seluruh skema, fungsi RPC, indeks, dan tuning PostgreSQL aktif.");
} finally {
  await client.end();
}
