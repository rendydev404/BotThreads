-- =============================================================================
-- Perbaikan: daftar akun baru (Google, /daftar, terima undangan) gagal dengan
--   null value in column "id" of relation "DashboardUser" violates not-null constraint (23502)
--
-- Penyebab: tabel "DashboardUser" di produksi dibuat Prisma. `@default(uuid())` Prisma dibuat di sisi
-- aplikasi, jadi kolom id tidak punya default database, sedangkan dash_mu_signup (sql/009) dan
-- dash_mu_invite_accept (sql/008) menyisipkan pengguna tanpa id. sql/001 sebenarnya memberi default,
-- tetapi CREATE TABLE IF NOT EXISTS dilewati karena tabelnya sudah ada.
--
-- Berkas ini memasang default tersebut, sehingga kedua fungsi yang sudah terpasang langsung bekerja
-- tanpa perlu dipasang ulang. ADITIF dan idempoten; jalankan MANUAL di Supabase SQL Editor.
-- =============================================================================

ALTER TABLE "DashboardUser" ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "DashboardUser" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "DashboardUser" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
