-- =============================================================================
-- Statistik postingan per akun untuk asisten AI (median, rata-rata, maksimum, post sepi).
--
-- ADITIF dan idempoten. Jalankan MANUAL di SQL Editor Supabase (project nhpatcbdylkhpsifyhjb).
-- Prasyarat: sql/003_dashboard_rpc.sql sudah dijalankan.
--
-- Tanpa fungsi ini asisten tetap jalan: aplikasi jatuh ke perhitungan di server (src/lib/chat-insights.ts)
-- dengan membaca baris ThreadsPostStat per halaman, jadi fungsi ini hanya soal hemat bandwidth.
-- Keamanan sama dengan fungsi dash_* lain: SECURITY DEFINER, search_path dikunci, hanya service_role.
-- =============================================================================

CREATE OR REPLACE FUNCTION dash_account_post_stats(p_ids text[], p_from timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT s."threadsAccountId" AS aid,
           COUNT(*)::int AS n,
           COALESCE(SUM(s.views), 0)::float8 AS views,
           ROUND(AVG(s.views))::int AS avg,
           ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY s.views))::int AS median,
           MAX(s.views)::int AS max,
           COUNT(*) FILTER (WHERE s.views <= 1)::int AS low
    FROM "ThreadsPostStat" s
    WHERE (p_ids IS NULL OR s."threadsAccountId" = ANY(p_ids))
      AND s."postedAt" >= p_from
    GROUP BY s."threadsAccountId"
  ) t
$$;

REVOKE ALL ON FUNCTION dash_account_post_stats(text[], timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_account_post_stats(text[], timestamp) TO service_role;

NOTIFY pgrst, 'reload schema';
