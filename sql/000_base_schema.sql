-- =============================================================================
-- Skema Dasar Mandiri BotThreads (PostgreSQL 16/17 Standalone)
--
-- Menggantikan tabel-tabel inti yang sebelumnya menumpang pada skema Prisma
-- proyek Auto-Suka Shawarma, sehingga BotThreads berdiri 100% independen di
-- PostgreSQL VPS tanpa ketergantungan sistem eksternal.
--
-- Optimasi performa tinggi yang diterapkan:
--  1. ekstensi pgcrypto & pg_trgm (pencarian teks cepat ILIKE/trigram).
--  2. Peran kompatibilitas (anon, authenticated, service_role) agar seluruh
--     migrasi 001..045 berjalan mulus di PostgreSQL murni.
--  3. fillfactor = 85 + autovacuum agresif pada tabel antrean ber-churn tinggi
--     (PostDispatch, ScheduledPost) agar UPDATE status/lock menggunakan
--     Heap-Only Tuple (HOT) update dan bebas table bloat.
--  4. Composite & Partial Indexes presisi untuk query dashboard, cron penerbit,
--     dan agregasi metrik harian.
--
-- Aman dijalankan berulang (idempoten).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Peran kompatibilitas untuk skrip 001..045 (GRANT/REVOKE)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$$;

-- ------------------------------------------------------------------ ENUMs

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PostStatus') THEN
    CREATE TYPE "PostStatus" AS ENUM ('DRAF', 'MENUNGGU', 'DIPROSES', 'SELESAI', 'GAGAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DispatchStatus') THEN
    CREATE TYPE "DispatchStatus" AS ENUM ('DRAF', 'MENUNGGU', 'TERBIT', 'GAGAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TargetType') THEN
    CREATE TYPE "TargetType" AS ENUM ('SEMUA_OUTLET', 'CLUSTER', 'PILIH_OUTLET', 'SATU_OUTLET');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Platform') THEN
    CREATE TYPE "Platform" AS ENUM ('TIKTOK', 'INSTAGRAM', 'FACEBOOK', 'THREADS', 'YOUTUBE', 'X');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AutoCommentStatus') THEN
    CREATE TYPE "AutoCommentStatus" AS ENUM ('SENDING', 'SENT', 'SKIPPED', 'FAILED');
  END IF;
END
$$;

-- ------------------------------------------------------------------ 1. Workspace

CREATE TABLE IF NOT EXISTS "Workspace" (
  "id"            TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "nama"          TEXT         NOT NULL DEFAULT '',
  "slug"          TEXT,
  "postizEnabled" BOOLEAN      NOT NULL DEFAULT false,
  "tiktokDirect"  BOOLEAN      NOT NULL DEFAULT false,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_slug_key" ON "Workspace" ("slug") WHERE "slug" IS NOT NULL;

-- ------------------------------------------------------------------ 2. Outlet & SocialAccount (Pemetaan Penerbit)

CREATE TABLE IF NOT EXISTS "Outlet" (
  "id"          TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "workspaceId" TEXT,
  "nama"        TEXT         NOT NULL DEFAULT '',
  "kode"        TEXT         NOT NULL DEFAULT '',
  "cluster"     TEXT         NOT NULL DEFAULT 'Threads',
  "warna"       TEXT         NOT NULL DEFAULT '#ea580c',
  "isActive"    BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Outlet_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Outlet_workspaceId_idx" ON "Outlet" ("workspaceId");
CREATE UNIQUE INDEX IF NOT EXISTS "Outlet_workspaceId_kode_key"
  ON "Outlet" ("workspaceId", "kode") WHERE "kode" <> '';

-- ------------------------------------------------------------------ 3. ThreadsAccount

CREATE TABLE IF NOT EXISTS "ThreadsAccount" (
  "id"               TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "workspaceId"      TEXT,
  "threadsUserId"    TEXT         NOT NULL DEFAULT '',
  "username"         TEXT,
  "displayName"      TEXT         NOT NULL DEFAULT '',
  "avatarUrl"        TEXT,
  "accessToken"      TEXT         NOT NULL DEFAULT '',
  "accessExpiresAt"  TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "scopes"           TEXT[]       DEFAULT ARRAY[]::TEXT[],
  "needsReconnect"   BOOLEAN      NOT NULL DEFAULT false,
  "connectedAt"      TIMESTAMP(3),
  "insightsSyncedAt" TIMESTAMP(3),
  "insightsError"    TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ThreadsAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ThreadsAccount_threadsUserId_key"
  ON "ThreadsAccount" ("threadsUserId") WHERE "threadsUserId" <> '';
CREATE INDEX IF NOT EXISTS "ThreadsAccount_workspaceId_idx" ON "ThreadsAccount" ("workspaceId");
CREATE INDEX IF NOT EXISTS "ThreadsAccount_username_idx" ON "ThreadsAccount" ("username");

CREATE TABLE IF NOT EXISTS "SocialAccount" (
  "id"                 TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "outletId"           TEXT,
  "platform"           "Platform"   NOT NULL DEFAULT 'THREADS',
  "handle"             TEXT         NOT NULL DEFAULT '',
  "threadsAccountId"   TEXT,
  "isConnected"        BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SocialAccount_threadsAccountId_key"
  ON "SocialAccount" ("threadsAccountId") WHERE "threadsAccountId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "SocialAccount_outletId_idx"
  ON "SocialAccount" ("outletId");

-- ------------------------------------------------------------------ 4. Metrik Threads (ThreadsPostStat & ThreadsAccountDaily)

CREATE TABLE IF NOT EXISTS "ThreadsPostStat" (
  "id"               TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "threadsAccountId" TEXT,
  "mediaId"          TEXT          UNIQUE,
  "mediaType"        TEXT         NOT NULL DEFAULT 'TEXT',
  "text"             TEXT         NOT NULL DEFAULT '',
  "permalink"        TEXT,
  "isQuote"          BOOLEAN      NOT NULL DEFAULT false,
  "postedAt"         TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "views"            INTEGER      NOT NULL DEFAULT 0,
  "likes"            INTEGER      NOT NULL DEFAULT 0,
  "replies"          INTEGER      NOT NULL DEFAULT 0,
  "reposts"          INTEGER      NOT NULL DEFAULT 0,
  "quotes"           INTEGER      NOT NULL DEFAULT 0,
  "shares"           INTEGER      NOT NULL DEFAULT 0,
  "metricsUpdatedAt" TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ThreadsPostStat_pkey" PRIMARY KEY ("id")
) WITH (fillfactor = 90);

CREATE INDEX IF NOT EXISTS "ThreadsPostStat_threadsAccountId_postedAt_idx"
  ON "ThreadsPostStat" ("threadsAccountId", "postedAt" DESC);
CREATE INDEX IF NOT EXISTS "ThreadsPostStat_threadsAccountId_views_idx"
  ON "ThreadsPostStat" ("threadsAccountId", "views" DESC);
CREATE INDEX IF NOT EXISTS "ThreadsPostStat_postedAt_id_idx"
  ON "ThreadsPostStat" ("postedAt" DESC, "id" ASC);
CREATE INDEX IF NOT EXISTS "ThreadsPostStat_views_id_idx"
  ON "ThreadsPostStat" ("views" DESC, "id" ASC);

CREATE TABLE IF NOT EXISTS "ThreadsAccountDaily" (
  "id"               TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "threadsAccountId" TEXT,
  "date"             DATE,
  "followers"        INTEGER      DEFAULT 0,
  "views"            INTEGER      NOT NULL DEFAULT 0,
  "likes"            INTEGER      NOT NULL DEFAULT 0,
  "replies"          INTEGER      NOT NULL DEFAULT 0,
  "reposts"          INTEGER      NOT NULL DEFAULT 0,
  "quotes"           INTEGER      NOT NULL DEFAULT 0,
  "clicks"           INTEGER      NOT NULL DEFAULT 0,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ThreadsAccountDaily_pkey" PRIMARY KEY ("id")
) WITH (fillfactor = 90);

CREATE UNIQUE INDEX IF NOT EXISTS "ThreadsAccountDaily_threadsAccountId_date_key"
  ON "ThreadsAccountDaily" ("threadsAccountId", "date");
CREATE INDEX IF NOT EXISTS "ThreadsAccountDaily_date_idx"
  ON "ThreadsAccountDaily" ("date" DESC);

-- ------------------------------------------------------------------ 5. Antrean Posting (ScheduledPost & PostDispatch)

CREATE TABLE IF NOT EXISTS "ScheduledPost" (
  "id"                TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "workspaceId"       TEXT,
  "judul"             TEXT         DEFAULT '',
  "caption"           TEXT         DEFAULT '',
  "hashtags"          TEXT[]       DEFAULT ARRAY[]::TEXT[],
  "videoUrl"          TEXT         DEFAULT '',
  "videoPath"         TEXT,
  "mediaType"         TEXT         DEFAULT 'TEXT',
  "placement"         TEXT         DEFAULT 'FEED',
  "mediaUrls"         TEXT[]       DEFAULT ARRAY[]::TEXT[],
  "mediaPaths"        TEXT[]       DEFAULT ARRAY[]::TEXT[],
  "thumbnailPath"     TEXT,
  "thumbnailUrl"      TEXT,
  "targetType"        "TargetType" DEFAULT 'SATU_OUTLET',
  "targetCluster"     TEXT,
  "tayangPada"        TIMESTAMP(3),
  "status"            "PostStatus" DEFAULT 'MENUNGGU',
  "source"            TEXT,
  "draftGroupId"      TEXT,
  "draftBatchId"      TEXT,
  "draftBrief"        TEXT,
  "draftRemindedAt"   TIMESTAMP(3),
  "publishNotifiedAt" TIMESTAMP(3),
  "tiktokSettings"    JSONB,
  "autoDmSettings"    JSONB,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScheduledPost_pkey" PRIMARY KEY ("id")
) WITH (
  fillfactor = 85,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);

CREATE INDEX IF NOT EXISTS "ScheduledPost_workspaceId_idx" ON "ScheduledPost" ("workspaceId");
CREATE INDEX IF NOT EXISTS "ScheduledPost_source_status_idx" ON "ScheduledPost" ("source", "status");
CREATE INDEX IF NOT EXISTS "ScheduledPost_source_tayangPada_idx" ON "ScheduledPost" ("source", "tayangPada" DESC);
CREATE INDEX IF NOT EXISTS "ScheduledPost_draftGroupId_idx"
  ON "ScheduledPost" ("draftGroupId") WHERE "draftGroupId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "ScheduledPost_draftBatchId_idx"
  ON "ScheduledPost" ("draftBatchId") WHERE "draftBatchId" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "PostDispatch" (
  "id"                  TEXT             NOT NULL DEFAULT gen_random_uuid()::text,
  "postId"              TEXT             REFERENCES "ScheduledPost"("id") ON DELETE CASCADE,
  "outletId"            TEXT,
  "socialAccountId"     TEXT,
  "publisher"           TEXT             DEFAULT 'THREADS',
  "status"              "DispatchStatus" DEFAULT 'MENUNGGU',
  "pesanError"          TEXT,
  "releaseUrl"          TEXT,
  "platformPostId"      TEXT,
  "platformContainerId" TEXT,
  "attempts"            INTEGER          DEFAULT 0,
  "lockedAt"            TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3)     DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3)     DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PostDispatch_pkey" PRIMARY KEY ("id")
) WITH (
  fillfactor = 85,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);

CREATE INDEX IF NOT EXISTS "PostDispatch_postId_idx" ON "PostDispatch" ("postId");
CREATE INDEX IF NOT EXISTS "PostDispatch_socialAccountId_idx" ON "PostDispatch" ("socialAccountId");
CREATE INDEX IF NOT EXISTS "PostDispatch_platformPostId_idx"
  ON "PostDispatch" ("platformPostId") WHERE "platformPostId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "PostDispatch_pub_queue_idx"
  ON "PostDispatch" ("publisher", "status", "lockedAt")
  WHERE "publisher" = 'THREADS' AND "status" = 'MENUNGGU';

-- ------------------------------------------------------------------ 6. Profil Persona Buzzer (AutoCommentSetting)

CREATE TABLE IF NOT EXISTS "AutoCommentSetting" (
  "id"               TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "workspaceId"      TEXT         NOT NULL,
  "threadsAccountId" TEXT         NOT NULL,
  "enabled"          BOOLEAN      NOT NULL DEFAULT false,
  "slots"            TEXT[]       DEFAULT ARRAY[]::TEXT[],
  "keywordSource"    TEXT         NOT NULL DEFAULT 'POOL',
  "personaName"      TEXT         NOT NULL DEFAULT '',
  "personaStyle"     TEXT         NOT NULL DEFAULT '',
  "lastSlotKey"      TEXT,
  "lastRunAt"        TIMESTAMP(3),
  "lastRunNote"      TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutoCommentSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AutoCommentSetting_threadsAccountId_key"
  ON "AutoCommentSetting" ("threadsAccountId");
CREATE INDEX IF NOT EXISTS "AutoCommentSetting_workspaceId_idx"
  ON "AutoCommentSetting" ("workspaceId");

-- ------------------------------------------------------------------ 7. Pengguna Dashboard (DashboardUser)

CREATE TABLE IF NOT EXISTS "DashboardUser" (
  "id"                  TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "username"            TEXT         NOT NULL,
  "email"               TEXT,
  "name"                TEXT,
  "passwordHash"        TEXT         NOT NULL,
  "isActive"            BOOLEAN      NOT NULL DEFAULT true,
  "lastLoginAt"         TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DashboardUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DashboardUser_username_key" ON "DashboardUser" ("username");
CREATE INDEX IF NOT EXISTS "DashboardUser_email_lower_idx"
  ON "DashboardUser" (lower("email")) WHERE "email" IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "Workspace", "Outlet", "SocialAccount", "ThreadsAccount",
  "ThreadsPostStat", "ThreadsAccountDaily", "ScheduledPost",
  "PostDispatch", "AutoCommentSetting", "DashboardUser"
TO service_role;

-- ------------------------------------------------------------------ 8. Fungsi Agregasi Metrik Harian & Postingan

CREATE OR REPLACE FUNCTION dash_daily_by_date(
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL,
  p_ids  text[] DEFAULT NULL
)
RETURNS TABLE(
  date date,
  views bigint,
  likes bigint,
  replies bigint,
  reposts bigint,
  quotes bigint,
  followers bigint,
  followers_count bigint
)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT d."date",
         COALESCE(SUM(d.views), 0)::bigint,
         COALESCE(SUM(d.likes), 0)::bigint,
         COALESCE(SUM(d.replies), 0)::bigint,
         COALESCE(SUM(d.reposts), 0)::bigint,
         COALESCE(SUM(d.quotes), 0)::bigint,
         COALESCE(SUM(d.followers), 0)::bigint,
         COUNT(d.followers)::bigint
  FROM "ThreadsAccountDaily" d
  WHERE (p_from IS NULL OR d."date" >= p_from)
    AND (p_to   IS NULL OR d."date" <= p_to)
    AND (p_ids  IS NULL OR d."threadsAccountId" = ANY (p_ids))
  GROUP BY d."date"
  ORDER BY d."date" ASC;
$$;

CREATE OR REPLACE FUNCTION dash_daily_by_account(
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL,
  p_ids  text[] DEFAULT NULL
)
RETURNS TABLE(
  "threadsAccountId" text,
  views bigint,
  likes bigint,
  replies bigint,
  reposts bigint,
  quotes bigint
)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT d."threadsAccountId",
         COALESCE(SUM(d.views), 0)::bigint,
         COALESCE(SUM(d.likes), 0)::bigint,
         COALESCE(SUM(d.replies), 0)::bigint,
         COALESCE(SUM(d.reposts), 0)::bigint,
         COALESCE(SUM(d.quotes), 0)::bigint
  FROM "ThreadsAccountDaily" d
  WHERE (p_from IS NULL OR d."date" >= p_from)
    AND (p_to   IS NULL OR d."date" <= p_to)
    AND (p_ids  IS NULL OR d."threadsAccountId" = ANY (p_ids))
  GROUP BY d."threadsAccountId";
$$;

CREATE OR REPLACE FUNCTION dash_daily_max_date(p_ids text[] DEFAULT NULL)
RETURNS date
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT MAX(d."date")
  FROM "ThreadsAccountDaily" d
  WHERE (p_ids IS NULL OR d."threadsAccountId" = ANY (p_ids));
$$;

CREATE OR REPLACE FUNCTION dash_latest_followers(
  p_to  date DEFAULT NULL,
  p_ids text[] DEFAULT NULL
)
RETURNS TABLE(
  "threadsAccountId" text,
  followers integer,
  date date
)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT DISTINCT ON (d."threadsAccountId")
         d."threadsAccountId", d.followers, d."date"
  FROM "ThreadsAccountDaily" d
  WHERE d.followers IS NOT NULL
    AND (p_to  IS NULL OR d."date" <= p_to)
    AND (p_ids IS NULL OR d."threadsAccountId" = ANY (p_ids))
  ORDER BY d."threadsAccountId", d."date" DESC;
$$;

CREATE OR REPLACE FUNCTION dash_posts_by_account(
  p_from timestamp DEFAULT NULL,
  p_to   timestamp DEFAULT NULL,
  p_ids  text[] DEFAULT NULL
)
RETURNS TABLE(
  "threadsAccountId" text,
  posts bigint
)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT p."threadsAccountId", COUNT(*)::bigint
  FROM "ThreadsPostStat" p
  WHERE (p_from IS NULL OR p."postedAt" >= p_from)
    AND (p_to   IS NULL OR p."postedAt" <  p_to)
    AND (p_ids  IS NULL OR p."threadsAccountId" = ANY (p_ids))
  GROUP BY p."threadsAccountId";
$$;

CREATE OR REPLACE FUNCTION dash_posts_by_media(
  p_from timestamp DEFAULT NULL,
  p_to   timestamp DEFAULT NULL,
  p_ids  text[] DEFAULT NULL
)
RETURNS TABLE(
  "mediaType" text,
  posts bigint,
  avg_views double precision,
  views bigint,
  likes bigint,
  replies bigint
)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT p."mediaType",
         COUNT(*)::bigint,
         COALESCE(AVG(p.views), 0)::double precision,
         COALESCE(SUM(p.views), 0)::bigint,
         COALESCE(SUM(p.likes), 0)::bigint,
         COALESCE(SUM(p.replies), 0)::bigint
  FROM "ThreadsPostStat" p
  WHERE (p_from IS NULL OR p."postedAt" >= p_from)
    AND (p_to   IS NULL OR p."postedAt" <  p_to)
    AND (p_ids  IS NULL OR p."threadsAccountId" = ANY (p_ids))
  GROUP BY p."mediaType";
$$;

GRANT EXECUTE ON FUNCTION
  dash_daily_by_date(date, date, text[]),
  dash_daily_by_account(date, date, text[]),
  dash_daily_max_date(text[]),
  dash_latest_followers(date, text[]),
  dash_posts_by_account(timestamp, timestamp, text[]),
  dash_posts_by_media(timestamp, timestamp, text[])
TO service_role;

