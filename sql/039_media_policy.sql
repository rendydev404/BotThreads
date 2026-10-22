-- =============================================================================
-- Kebijakan postingan bergambar per akun + pembersihan berkas gambar di bucket "threads-media".
--
-- ADITIF dan idempoten. Prasyarat: sql/005_autopilot.sql, sql/006_autopilot_radar.sql,
-- sql/033_idea_preview.sql, sql/036_threads_media.sql. Jalankan MANUAL di SQL Editor Supabase.
--
-- 1. Pengaturan "Postingan bergambar" di "AutopilotConfig": "mediaMode" (MATI | OTOMATIS, bawaan OTOMATIS)
--    dan "mediaMaxPersen" (0-100, bawaan 30) = porsi maksimal postingan bergambar akun itu. Baris lama
--    langsung mendapat nilai bawaan (ADD COLUMN ... DEFAULT, tanpa migrasi data).
--    dash_ap_state dan dash_ap_config_upsert (sql/005) diganti supaya membaca/menulis kedua kolom.
-- 2. dash_media_policy: pengaturan + hitungan postingan dashboard akun (7 hari terakhir + yang akan datang),
--    untuk src/lib/media-policy.ts. Jalur sama dengan dash_schedule: SocialAccount -> PostDispatch -> ScheduledPost.
-- 3. dash_media_cleanup_claim / dash_media_cleanup_done: berkas gambar yang sudah tidak dipakai
--    (src/lib/media-cleanup.ts, dipanggil tiap putaran penerbit):
--    - posting dashboard (source DASHBOARD_AI) yang sudah selesai (SELESAI/GAGAL) lebih dari 3 hari:
--      berkas dihapus, lalu "mediaPaths" dikosongkan ("mediaUrls" tetap supaya riwayat tahu posting itu bergambar);
--    - ide yang tidak lagi dipakai (DITOLAK/KEDALUWARSA, BARU yang lewat expiresAt, atau DIPAKAI yang slotnya
--      sudah selesai > 3 hari, mis. posting dibatalkan) dengan preview->'media': berkas dihapus, lalu kunci
--      'media' dibuang dari preview.
--    Penjaga: path yang masih dipakai posting dashboard yang belum selesai, posting dashboard lain yang masih
--    memegang "mediaPaths", atau draf slot autopilot yang masih aktif TIDAK pernah ikut dihapus. Hanya path
--    berbentuk "<workspace>/ideas/..." (bucket threads-media) yang disentuh; posting auto-suka tidak disentuh.
--
-- Indeks: dua indeks parsial baru yang kecil (hanya baris yang masih memegang gambar), jadi klaim tiap menit
-- tidak memindai seluruh ScheduledPost/ContentIdea. Indeks di "ScheduledPost" (milik auto-suka) bersifat
-- aditif dan hanya memuat posting dashboard bergambar yang belum dibersihkan.
-- =============================================================================

-- ------------------------------------------------------------------ kolom pengaturan

ALTER TABLE "AutopilotConfig" ADD COLUMN IF NOT EXISTS "mediaMode" text NOT NULL DEFAULT 'OTOMATIS';
ALTER TABLE "AutopilotConfig" ADD COLUMN IF NOT EXISTS "mediaMaxPersen" smallint NOT NULL DEFAULT 30;

ALTER TABLE "AutopilotConfig" DROP CONSTRAINT IF EXISTS "AutopilotConfig_mediaMode_check";
ALTER TABLE "AutopilotConfig" ADD CONSTRAINT "AutopilotConfig_mediaMode_check" CHECK ("mediaMode" IN ('MATI', 'OTOMATIS'));
ALTER TABLE "AutopilotConfig" DROP CONSTRAINT IF EXISTS "AutopilotConfig_mediaMaxPersen_check";
ALTER TABLE "AutopilotConfig" ADD CONSTRAINT "AutopilotConfig_mediaMaxPersen_check" CHECK ("mediaMaxPersen" BETWEEN 0 AND 100);

-- ------------------------------------------------------------------ indeks pembersihan

-- Posting dashboard yang masih memegang berkas gambar (setelah dibersihkan barisnya keluar dari indeks).
CREATE INDEX IF NOT EXISTS "ScheduledPost_dash_media_idx" ON "ScheduledPost" ("tayangPada")
  WHERE source = 'DASHBOARD_AI' AND cardinality("mediaPaths") > 0;

-- Ide yang preview-nya masih memegang gambar (media null = sengaja tanpa gambar, tidak ikut).
CREATE INDEX IF NOT EXISTS "ContentIdea_media_idx" ON "ContentIdea" ("updatedAt")
  WHERE jsonb_typeof(preview->'media') = 'object';

-- ------------------------------------------------------------------ baca: sama dengan sql/005 + kolom gambar

CREATE OR REPLACE FUNCTION dash_ap_state(p_workspace text, p_from date, p_to date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'settings', (
      SELECT COALESCE(jsonb_agg(to_jsonb(w)), '[]'::jsonb) FROM (
        SELECT "workspaceId", "autopilotAktif" FROM "WorkspaceSettings"
        WHERE p_workspace IS NULL OR "workspaceId" = p_workspace
      ) w),
    'configs', (
      SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) FROM (
        SELECT "accountId", "workspaceId", mode, "postsPerDay", "slotStrategy", "fixedHours", "minGapMinutes",
               "activeDays", "exploreRate", pillars, "promoRatio", "voiceStyle", brief,
               "mediaMode", "mediaMaxPersen",
               "pausedReason", "pausedAt", "updatedAt"
        FROM "AutopilotConfig"
        WHERE p_workspace IS NULL OR "workspaceId" = p_workspace
      ) c),
    'slots', (
      SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s."slotAt", s.id), '[]'::jsonb) FROM (
        SELECT id, "workspaceId", "accountId", "dayKey", "slotIndex", "slotAt", hour, kind, status, reason,
               "skipReason", "lastError", "postId", attempt, "criticScore"
        FROM "AutopilotSlot"
        WHERE "dayKey" BETWEEN p_from AND p_to
          AND (p_workspace IS NULL OR "workspaceId" = p_workspace)
      ) s),
    'lastRun', (
      SELECT to_jsonb(r) FROM (
        SELECT "startedAt", "finishedAt", "durasiMs", hitung, error
        FROM "AutopilotRun" ORDER BY "startedAt" DESC LIMIT 1
      ) r),
    'stats7d', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
        SELECT "accountId",
               COUNT(*)::int AS hari,
               COUNT(*) FILTER (WHERE terbit >= 3)::int AS "hariPatuh",
               SUM(terbit)::int AS terbit, SUM(gagal)::int AS gagal, SUM(dilewati)::int AS dilewati
        FROM (
          SELECT "accountId", "dayKey",
                 COUNT(*) FILTER (WHERE status = 'TERBIT') AS terbit,
                 COUNT(*) FILTER (WHERE status = 'GAGAL') AS gagal,
                 COUNT(*) FILTER (WHERE status = 'DILEWATI') AS dilewati
          FROM "AutopilotSlot"
          WHERE "dayKey" >= p_from - 7 AND "dayKey" < p_from
            AND (p_workspace IS NULL OR "workspaceId" = p_workspace)
          GROUP BY "accountId", "dayKey"
        ) d
        GROUP BY "accountId"
      ) t)
  )
$$;

-- ------------------------------------------------------------------ tulis: sama dengan sql/005 + kolom gambar

-- Item tanpa "mediaMode"/"mediaMaxPersen" (pemanggil lama) memakai bawaan saat baris baru, dan
-- mempertahankan nilai tersimpan saat baris sudah ada.
CREATE OR REPLACE FUNCTION dash_ap_config_upsert(p_items jsonb, p_user text, p_now timestamp) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE it jsonb; n integer := 0;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'items tidak valid' USING ERRCODE = '22023';
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO "AutopilotConfig" AS c ("accountId", "workspaceId", mode, "postsPerDay", "slotStrategy", "fixedHours",
                                   "minGapMinutes", "activeDays", "exploreRate", pillars, "promoRatio",
                                   "voiceStyle", brief, "mediaMode", "mediaMaxPersen",
                                   "pausedReason", "pausedAt", "updatedBy", "updatedAt")
    VALUES (it->>'accountId', it->>'workspaceId', it->>'mode', (it->>'postsPerDay')::smallint, it->>'slotStrategy',
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(it->'fixedHours', '[]'::jsonb))::smallint),
            (it->>'minGapMinutes')::smallint,
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(it->'activeDays', '[]'::jsonb))::smallint),
            (it->>'exploreRate')::real, COALESCE(it->'pillars', '[]'::jsonb), (it->>'promoRatio')::real,
            NULLIF(it->>'voiceStyle', ''), NULLIF(it->>'brief', ''),
            COALESCE(NULLIF(it->>'mediaMode', ''), 'OTOMATIS'), COALESCE((it->>'mediaMaxPersen')::smallint, 30),
            NULL, NULL, p_user, p_now)
    ON CONFLICT ("accountId") DO UPDATE SET
      "workspaceId" = EXCLUDED."workspaceId", mode = EXCLUDED.mode, "postsPerDay" = EXCLUDED."postsPerDay",
      "slotStrategy" = EXCLUDED."slotStrategy", "fixedHours" = EXCLUDED."fixedHours",
      "minGapMinutes" = EXCLUDED."minGapMinutes", "activeDays" = EXCLUDED."activeDays",
      "exploreRate" = EXCLUDED."exploreRate", pillars = EXCLUDED.pillars, "promoRatio" = EXCLUDED."promoRatio",
      "voiceStyle" = EXCLUDED."voiceStyle", brief = EXCLUDED.brief,
      "mediaMode" = CASE WHEN NULLIF(it->>'mediaMode', '') IS NULL THEN c."mediaMode" ELSE EXCLUDED."mediaMode" END,
      "mediaMaxPersen" = CASE WHEN it->>'mediaMaxPersen' IS NULL THEN c."mediaMaxPersen" ELSE EXCLUDED."mediaMaxPersen" END,
      "pausedReason" = NULL, "pausedAt" = NULL, "updatedBy" = p_user, "updatedAt" = p_now;
    DELETE FROM "AutopilotSlot"
    WHERE "accountId" = it->>'accountId' AND status = 'DIRENCANAKAN' AND "slotAt" > p_now;
    INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
    VALUES (it->>'workspaceId', p_user, 'AUTOPILOT_CONFIG', it->>'accountId',
            jsonb_build_object('mode', it->>'mode', 'postsPerDay', it->'postsPerDay',
                               'slotStrategy', it->>'slotStrategy',
                               'mediaMode', it->>'mediaMode', 'mediaMaxPersen', it->'mediaMaxPersen'), p_now);
    n := n + 1;
  END LOOP;
  RETURN n;
END
$$;

-- ------------------------------------------------------------------ kebijakan gambar

-- Pengaturan gambar akun (bawaan bila belum pernah diatur) + jumlah posting dashboard akun itu yang
-- dijadwalkan sejak p_since (termasuk yang akan datang) dan berapa yang bergambar. Dispatch GAGAL tidak
-- dihitung (tidak pernah tayang). Pemindaian dibatasi akun (SocialAccount.threadsAccountId) lalu
-- PostDispatch per socialAccountId dan ScheduledPost per primary key, sama seperti dash_schedule.
CREATE OR REPLACE FUNCTION dash_media_policy(p_account_id text, p_since timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'mode', COALESCE(cfg."mediaMode", 'OTOMATIS'),
    'maxPersen', COALESCE(cfg."mediaMaxPersen", 30),
    'total', cnt.total,
    'gambar', cnt.gambar)
  FROM (SELECT 1) one
  LEFT JOIN "AutopilotConfig" cfg ON cfg."accountId" = p_account_id
  CROSS JOIN (
    SELECT COUNT(DISTINCT p.id)::int AS total,
           COUNT(DISTINCT p.id) FILTER (WHERE p."mediaType"::text IN ('IMAGE', 'CAROUSEL'))::int AS gambar
    FROM "SocialAccount" sa
    JOIN "PostDispatch" d ON d."socialAccountId" = sa.id AND d.publisher = 'THREADS'
                         AND d.status IN ('MENUNGGU', 'TERBIT')
    JOIN "ScheduledPost" p ON p.id = d."postId"
    WHERE sa."threadsAccountId" = p_account_id
      AND p.source = 'DASHBOARD_AI' AND p."tayangPada" >= p_since
  ) cnt
$$;

-- ------------------------------------------------------------------ pembersihan berkas

-- Path boleh dihapus: milik bucket threads-media (bentuk "<workspace>/ideas/...") dan tidak lagi dipegang
-- draf slot autopilot yang masih aktif maupun posting dashboard lain (selain p_self_post) yang masih
-- membutuhkannya. p_due_before NULL (pembersihan ide): posting dashboard apa pun yang masih memegang path
-- itu menghalangi (posting itu membersihkannya sendiri nanti). p_due_before terisi (pembersihan posting):
-- hanya posting yang belum jatuh tempo pembersihan (belum selesai, atau selesai < 3 hari) yang menghalangi.
CREATE OR REPLACE FUNCTION dash_media_path_free(p_path text, p_self_post text, p_due_before timestamp) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_path ~ '^[A-Za-z0-9_-]+/ideas/.+' AND position('..' IN p_path) = 0
    AND NOT EXISTS (
      SELECT 1 FROM "ScheduledPost" q
      WHERE q.source = 'DASHBOARD_AI' AND cardinality(q."mediaPaths") > 0
        AND q.id IS DISTINCT FROM p_self_post
        AND p_path = ANY(q."mediaPaths")
        AND (p_due_before IS NULL
             OR q.status::text NOT IN ('SELESAI', 'GAGAL')
             OR q."tayangPada" >= p_due_before
             OR COALESCE(q."updatedAt", q."tayangPada") >= p_due_before))
    AND NOT EXISTS (
      SELECT 1 FROM "AutopilotSlot" s
      WHERE s.status IN ('DIRENCANAKAN', 'MENULIS', 'MENUNGGU_TINJAU', 'TERANTRE')
        AND jsonb_typeof(s.draft->'media'->'items') = 'array'
        AND s.draft->'media'->'items' @> jsonb_build_array(jsonb_build_object('path', p_path)))
$$;

-- Ambil pekerjaan pembersihan, paling banyak p_limit path (minimal satu baris), posting dulu lalu ide.
-- Balasan: [{kind: 'POST'|'IDEA', id, paths: [path yang aman dihapus]}]. Baris dengan paths kosong tetap
-- dikembalikan supaya ditandai selesai (path-nya masih dipegang pihak lain yang nanti membersihkannya).
-- Tanpa kunci baris: menghapus berkas yang sudah terhapus tidak berbahaya, dan penandaan selesai bersyarat.
CREATE OR REPLACE FUNCTION dash_media_cleanup_claim(p_now timestamp, p_before timestamp, p_limit integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH lim AS (SELECT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50) AS n),
  post AS (
    -- Indeks parsial ScheduledPost_dash_media_idx (hanya posting dashboard yang masih memegang gambar).
    SELECT 1 AS ord, 'POST'::text AS kind, p.id, p."mediaPaths" AS paths, p."tayangPada" AS at
    FROM "ScheduledPost" p
    WHERE p.source = 'DASHBOARD_AI' AND cardinality(p."mediaPaths") > 0
      AND p."tayangPada" < p_before
      AND p.status::text IN ('SELESAI', 'GAGAL')
      AND COALESCE(p."updatedAt", p."tayangPada") < p_before
    ORDER BY p."tayangPada", p.id
    LIMIT (SELECT n FROM lim)
  ),
  idea AS (
    -- Indeks parsial ContentIdea_media_idx (hanya ide yang preview-nya masih memegang gambar).
    SELECT 2 AS ord, 'IDEA'::text AS kind, i.id,
           ARRAY(SELECT x->>'path'
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(i.preview->'media'->'items') = 'array'
                                                THEN i.preview->'media'->'items' ELSE '[]'::jsonb END) x
                 WHERE x->>'path' IS NOT NULL) AS paths,
           i."updatedAt" AS at
    FROM "ContentIdea" i
    WHERE jsonb_typeof(i.preview->'media') = 'object'
      AND (i.status IN ('DITOLAK', 'KEDALUWARSA')
           OR (i.status = 'BARU' AND i."expiresAt" <= p_now)
           -- Terpakai tetapi slotnya sudah selesai (mis. posting dibatalkan dan barisnya terhapus).
           OR (i.status = 'DIPAKAI' AND i."updatedAt" < p_before
               AND NOT EXISTS (SELECT 1 FROM "AutopilotSlot" s
                               WHERE s.id = i."usedBySlot"
                                 AND s.status IN ('DIRENCANAKAN', 'MENULIS', 'MENUNGGU_TINJAU', 'TERANTRE'))))
    ORDER BY i."updatedAt", i.id
    LIMIT (SELECT n FROM lim)
  ),
  jobs AS (
    SELECT j.ord, j.kind, j.id, j.at,
           ARRAY(SELECT DISTINCT x FROM unnest(j.paths) x
                 WHERE dash_media_path_free(x, CASE WHEN j.kind = 'POST' THEN j.id END,
                                            CASE WHEN j.kind = 'POST' THEN p_before END)) AS free,
           SUM(GREATEST(cardinality(j.paths), 1)) OVER (ORDER BY j.ord, j.at, j.id) AS running
    FROM (SELECT * FROM post UNION ALL SELECT * FROM idea) j
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'paths', to_jsonb(free)) ORDER BY ord, at, id),
                  '[]'::jsonb)
  FROM jobs
  WHERE running <= (SELECT n FROM lim) OR running = (SELECT MIN(running) FROM jobs)
$$;

-- Tandai selesai setelah berkas dihapus: posting -> "mediaPaths" dikosongkan (hanya posting dashboard yang
-- sudah selesai; "mediaUrls" tetap); ide -> kunci 'media' dibuang dari preview ("updatedAt" sengaja tidak
-- diubah: dipakai jendela anti-ulang topik). Ide BARU yang belum kedaluwarsa tidak disentuh.
-- Mengembalikan jumlah baris yang berubah.
CREATE OR REPLACE FUNCTION dash_media_cleanup_done(p_posts text[], p_ideas text[], p_now timestamp) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a integer := 0; b integer := 0;
BEGIN
  IF cardinality(p_posts) > 0 THEN
    UPDATE "ScheduledPost" p SET "mediaPaths" = '{}'::text[]
    WHERE p.id = ANY(p_posts) AND p.source = 'DASHBOARD_AI' AND p.status::text IN ('SELESAI', 'GAGAL')
      AND cardinality(p."mediaPaths") > 0;
    GET DIAGNOSTICS a = ROW_COUNT;
  END IF;
  IF cardinality(p_ideas) > 0 THEN
    UPDATE "ContentIdea" i SET preview = i.preview - 'media'
    WHERE i.id = ANY(p_ideas) AND jsonb_typeof(i.preview->'media') = 'object'
      AND NOT (i.status = 'BARU' AND i."expiresAt" > p_now);
    GET DIAGNOSTICS b = ROW_COUNT;
  END IF;
  RETURN a + b;
END
$$;

-- ------------------------------------------------------------------ hak akses

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('dash_ap_state', 'dash_ap_config_upsert', 'dash_media_policy', 'dash_media_path_free',
                        'dash_media_cleanup_claim', 'dash_media_cleanup_done')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
