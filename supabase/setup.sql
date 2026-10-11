-- =====================================================================
-- Bot_Dashboard — setup akses Supabase REST (jalankan SEKALI)
-- Supabase Dashboard > SQL Editor > New query > paste semua > Run
--
-- Aman dijalankan ulang. Tidak mengubah / menghapus data apa pun:
--   1. Memberi role API "service_role" akses ke tabel dashboard.
--   2. Membuat fungsi agregasi read-only (STABLE) untuk dashboard,
--      karena REST Supabase tidak mengizinkan SUM/GROUP BY.
-- Fungsi hanya bisa dipanggil service_role (bukan anon/authenticated).
-- =====================================================================

-- ---------- 1. Akses tabel ----------
GRANT USAGE ON SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."DashboardUser",
  public."Workspace",
  public."ThreadsAccount",
  public."ThreadsAccountDaily",
  public."ThreadsPostStat",
  public."AnalyticsReportLog",
  public."AutoCommentConfig",
  public."AutoCommentSetting",
  public."AutoCommentKeyword",
  public."AutoCommentTarget"
TO service_role;

-- ---------- 2. Fungsi agregasi ----------
-- Konvensi parameter: NULL = tanpa filter.
--   p_ids   : daftar ThreadsAccount.id
--   p_from/p_to (date)      : rentang tanggal harian, inklusif
--   p_from/p_to (timestamp) : rentang postedAt, [p_from, p_to)

-- Total harian per tanggal (grafik, total periode, followers per tanggal)
CREATE OR REPLACE FUNCTION public.dash_daily_by_date(
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL,
  p_ids  text[] DEFAULT NULL
)
RETURNS TABLE (
  date date, views bigint, likes bigint, replies bigint, reposts bigint,
  quotes bigint, followers bigint, followers_count bigint
)
LANGUAGE sql STABLE SET search_path = public AS $$
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

-- Total harian per akun (peringkat)
CREATE OR REPLACE FUNCTION public.dash_daily_by_account(
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL,
  p_ids  text[] DEFAULT NULL
)
RETURNS TABLE (
  "threadsAccountId" text, views bigint, likes bigint, replies bigint,
  reposts bigint, quotes bigint
)
LANGUAGE sql STABLE SET search_path = public AS $$
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

-- Tanggal data harian terakhir
CREATE OR REPLACE FUNCTION public.dash_daily_max_date(p_ids text[] DEFAULT NULL)
RETURNS date
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT MAX(d."date") FROM "ThreadsAccountDaily" d
  WHERE (p_ids IS NULL OR d."threadsAccountId" = ANY (p_ids));
$$;

-- Followers terakhir (non-null) tiap akun, pada/sebelum p_to
CREATE OR REPLACE FUNCTION public.dash_latest_followers(
  p_to  date DEFAULT NULL,
  p_ids text[] DEFAULT NULL
)
RETURNS TABLE ("threadsAccountId" text, followers integer, date date)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT DISTINCT ON (d."threadsAccountId")
         d."threadsAccountId", d.followers, d."date"
  FROM "ThreadsAccountDaily" d
  WHERE d.followers IS NOT NULL
    AND (p_to  IS NULL OR d."date" <= p_to)
    AND (p_ids IS NULL OR d."threadsAccountId" = ANY (p_ids))
  ORDER BY d."threadsAccountId", d."date" DESC;
$$;

-- Jumlah postingan per akun
CREATE OR REPLACE FUNCTION public.dash_posts_by_account(
  p_from timestamp DEFAULT NULL,
  p_to   timestamp DEFAULT NULL,
  p_ids  text[] DEFAULT NULL
)
RETURNS TABLE ("threadsAccountId" text, posts bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p."threadsAccountId", COUNT(*)::bigint
  FROM "ThreadsPostStat" p
  WHERE (p_from IS NULL OR p."postedAt" >= p_from)
    AND (p_to   IS NULL OR p."postedAt" <  p_to)
    AND (p_ids  IS NULL OR p."threadsAccountId" = ANY (p_ids))
  GROUP BY p."threadsAccountId";
$$;

-- Statistik postingan per jenis media (juga dipakai untuk total keseluruhan)
CREATE OR REPLACE FUNCTION public.dash_posts_by_media(
  p_from timestamp DEFAULT NULL,
  p_to   timestamp DEFAULT NULL,
  p_ids  text[] DEFAULT NULL
)
RETURNS TABLE (
  "mediaType" text, posts bigint, avg_views double precision,
  views bigint, likes bigint, replies bigint
)
LANGUAGE sql STABLE SET search_path = public AS $$
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

-- ---------- 3. Hak eksekusi: hanya service_role ----------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'dash_daily_by_date(date,date,text[])',
    'dash_daily_by_account(date,date,text[])',
    'dash_daily_max_date(text[])',
    'dash_latest_followers(date,text[])',
    'dash_posts_by_account(timestamp,timestamp,text[])',
    'dash_posts_by_media(timestamp,timestamp,text[])'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

-- Muat ulang cache skema REST agar fungsi baru langsung terlihat
NOTIFY pgrst, 'reload schema';

SELECT 'OK: setup Bot_Dashboard selesai' AS status;
