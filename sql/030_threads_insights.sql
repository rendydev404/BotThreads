-- =============================================================================
-- Pengumpul metrik Threads milik dashboard (src/lib/threads-insights.ts, dipanggil tiap 5 menit lewat
-- /api/internal/insights/tick).
--
-- Sebelumnya ThreadsAccountDaily dan ThreadsPostStat diisi worker auto-suka di database lain, jadi akun
-- yang dihubungkan dari dashboard tidak pernah punya data. Kini dashboard mengambilnya sendiri.
--
-- Upsert dari dashboard memakai kunci unik (threadsAccountId, date) dan (mediaId), bukan id. Supaya
-- baris baru tidak perlu id dari klien (dan upsert tidak pernah menimpa id baris lama), id diberi default.
--
-- ADITIF dan idempoten. Prasyarat: sql/003_dashboard_rpc.sql.
-- =============================================================================

ALTER TABLE "ThreadsAccountDaily" ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "ThreadsPostStat" ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

GRANT SELECT, INSERT, UPDATE ON "ThreadsAccountDaily", "ThreadsPostStat" TO service_role;
GRANT SELECT, UPDATE ON "ThreadsAccount" TO service_role;

NOTIFY pgrst, 'reload schema';
