-- Tabel pengguna login dashboard. Aditif: tidak menyentuh tabel bot yang ada.
CREATE TABLE IF NOT EXISTS "DashboardUser" (
  "id"           TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "username"     TEXT         NOT NULL,
  "email"        TEXT,
  "name"         TEXT,
  "passwordHash" TEXT         NOT NULL,
  "isActive"     BOOLEAN      NOT NULL DEFAULT true,
  "lastLoginAt"  TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DashboardUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DashboardUser_username_key" ON "DashboardUser" ("username");
CREATE UNIQUE INDEX IF NOT EXISTS "DashboardUser_email_key"    ON "DashboardUser" ("email");

-- Supabase membuka tabel lewat API publik (PostgREST). RLS tanpa policy
-- memblokir akses anon/authenticated; Prisma (role postgres) tetap bisa.
ALTER TABLE "DashboardUser" ENABLE ROW LEVEL SECURITY;
