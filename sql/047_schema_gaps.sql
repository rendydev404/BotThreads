-- Celah skema setelah pindah dari Supabase ke PostgreSQL VPS (ditemukan 18 Nov 2026 dari log produksi):
-- - PostDispatch."platformKind" dipakai dash_pub_finish (sql/022, sql/040). Tanpa kolom ini penerbit gagal 42703
--   dan semua postingan tertahan di "Processing".
-- - AnalyticsReportLog dibaca halaman Overview (src/lib/overview.ts). Tanpa tabel ini /api/analytics/overview gagal 42P01.
-- Idempoten: aman dijalankan ulang dan aman untuk database yang sudah dibuat dari 000_base_schema.sql versi baru.

ALTER TABLE "PostDispatch" ADD COLUMN IF NOT EXISTS "platformKind" TEXT;

CREATE TABLE IF NOT EXISTS "AnalyticsReportLog" (
  "id"        TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "kind"      TEXT         NOT NULL,
  "periodKey" TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsReportLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AnalyticsReportLog_kind_periodKey_key" ON "AnalyticsReportLog" ("kind", "periodKey");
-- Overview membaca 4 laporan terbaru (ORDER BY createdAt DESC LIMIT 4).
CREATE INDEX IF NOT EXISTS "AnalyticsReportLog_createdAt_idx" ON "AnalyticsReportLog" ("createdAt" DESC);

REVOKE ALL ON TABLE "AnalyticsReportLog" FROM PUBLIC;
