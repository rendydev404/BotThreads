-- Tabel audit posting dashboard. ADITIF: tidak menyentuh tabel milik auto-suka.
-- Jalankan MANUAL setelah disetujui pemilik (jangan lewat `prisma db push`).
-- Aman dijalankan berulang (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS "DashboardPostLog" (
  "id"        TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "postId"    TEXT         NOT NULL,
  "userId"    TEXT         NOT NULL,
  -- CREATE_NOW | CREATE_SCHEDULED | EDIT | CANCEL | RETRY
  "action"    TEXT         NOT NULL,
  -- model yang menghasilkan draf (null bila ditulis manual)
  "aiModel"   TEXT,
  -- teks diubah manusia sebelum dikirim
  "aiEdited"  BOOLEAN,
  -- idempotencyKey, batchId, jadwal, dll.
  "detail"    JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DashboardPostLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DashboardPostLog_postId_idx"    ON "DashboardPostLog" ("postId");
CREATE INDEX IF NOT EXISTS "DashboardPostLog_createdAt_idx" ON "DashboardPostLog" ("createdAt");

-- Supabase membuka tabel lewat API publik (PostgREST). RLS tanpa policy
-- memblokir akses anon/authenticated; Prisma (role postgres) tetap bisa.
ALTER TABLE "DashboardPostLog" ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- OPSIONAL - JANGAN dijalankan kecuali EXPLAIN (ANALYZE, BUFFERS) pada query
-- daftar antrean (src/lib/threads-publish.ts: listPosts) membuktikan index yang
-- ada (ScheduledPost_source_status_idx) tidak cukup. Ini index pada tabel milik
-- auto-suka; perubahannya harus disetujui pemilik.
--
-- Daftar antrean dashboard: filter source + urut tayangPada.
-- CREATE INDEX IF NOT EXISTS "ScheduledPost_source_tayangPada_idx"
--   ON "ScheduledPost" ("source", "tayangPada" DESC);
--
-- Cek anti-spam / duplikat per akun (join dari SocialAccount -> PostDispatch):
-- CREATE INDEX IF NOT EXISTS "PostDispatch_socialAccountId_idx"
--   ON "PostDispatch" ("socialAccountId");
-- =============================================================================
