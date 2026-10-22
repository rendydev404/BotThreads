-- =============================================================================
-- Loop belajar autopilot: FORMAT dan LAYOUT postingan ikut dipelajari, dan skor hasil memberi bobot balasan
-- (yang paling didorong Threads). Fase A "otak gaya Threads".
--
-- ADITIF dan idempoten. Jalankan MANUAL di SQL Editor Supabase oleh pemilik.
-- Prasyarat: sql/007_autopilot_learning.sql sudah dijalankan.
--
-- Yang berubah:
--   * "ContentOutcome" + kolom format (PostFormat), layout (LayoutFeatures, jsonb), "medianReplies".
--     Format dan layout dihitung di TypeScript (detectFormat/layoutFeatures di src/lib/style-types.ts):
--     dash_learn_label_pending memberi postingan yang belum dilabeli, dash_learn_label_set menyimpannya.
--   * dash_learn_sync (menggantikan versi sql/007): skor = ln((views+1)/(median views+1))
--     + 0,5 * ln((replies+1)/(median replies+1)), dibatasi -2..2 (sama dengan engagementScore).
--   * dash_learn_stats (menggantikan versi sql/007): 4 dimensi lama tetap sama, ditambah format, panjang,
--     baris, daftar, dan pembuka.
--   * Hasil 60 hari terakhir dihitung ulang sekali dengan rumus baru (lihat bagian "isi ulang skor").
--
-- Keamanan sama dengan fungsi dash_* lain: SECURITY DEFINER, search_path dikunci, EXECUTE hanya untuk
-- service_role.
-- =============================================================================

-- ------------------------------------------------------------------ kolom

ALTER TABLE "ContentOutcome" ADD COLUMN IF NOT EXISTS format text;
-- LayoutFeatures: {chars, lines, paragraphs, avgLineChars, isList, startsLowercase, emojiCount, endsQuestion}.
-- NULL = belum dilabeli; teks kosong tetap dilabeli (chars 0, format NULL) supaya tidak diambil ulang.
ALTER TABLE "ContentOutcome" ADD COLUMN IF NOT EXISTS layout jsonb;
-- Median balasan 30 hari akun saat diukur (pembanding balasan, sama seperti baseline untuk views).
ALTER TABLE "ContentOutcome" ADD COLUMN IF NOT EXISTS "medianReplies" real NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContentOutcome_format_check') THEN
    ALTER TABLE "ContentOutcome" ADD CONSTRAINT "ContentOutcome_format_check"
      CHECK (format IS NULL OR format IN ('CERITA', 'OPINI', 'TIPS_LIST', 'PERTANYAAN', 'INFO', 'CURHAT', 'PROMO'));
  END IF;
END
$$;

-- Antrean pelabelan kecil: hanya baris yang belum dilabeli, terbaru dulu.
CREATE INDEX IF NOT EXISTS "ContentOutcome_belum_label_idx" ON "ContentOutcome" ("postedAt" DESC) WHERE layout IS NULL;

-- ------------------------------------------------------------------ isi ulang skor (sekali)

-- Hasil 60 hari terakhir (jendela dash_learn_stats) dihitung ulang dengan rumus berbobot balasan. Median
-- balasan diambil dari jendela yang sama dengan baseline views saat hasil itu diukur ("diukurPada").
-- Idempoten: hanya baris yang median balasannya masih 0; mengulang memberi hasil yang sama.
-- Posting <= 14 hari juga dihitung ulang oleh dash_learn_sync berikutnya.
UPDATE "ContentOutcome" o
SET "medianReplies" = m.mr,
    score = GREATEST(-2, LEAST(2,
              ln((GREATEST(o.views, 0) + 1)::float8 / (GREATEST(o.baseline, 0) + 1))
              + 0.5 * ln((GREATEST(o.replies, 0) + 1)::float8 / (m.mr + 1))))::real
FROM (
  SELECT x."postId",
         COALESCE((
           SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s.replies)
           FROM "ThreadsPostStat" s
           WHERE s."threadsAccountId" = x."accountId"
             AND s."postedAt" >= x."diukurPada" - interval '30 days' AND s."postedAt" < x."diukurPada" - interval '1 day'
             AND s."isQuote" = false
           HAVING COUNT(*) >= 5
         ), 0)::real AS mr
  FROM "ContentOutcome" x
  WHERE x."postedAt" >= (now() AT TIME ZONE 'UTC') - interval '60 days' AND x."medianReplies" = 0
) m
WHERE o."postId" = m."postId";

-- ------------------------------------------------------------------ belajar

-- Catat/perbarui hasil posting autopilot 14 hari terakhir dari statistik Threads, dan kembalikan
-- posting yang BARU saja memenuhi syarat viral (untuk notifikasi dan ide lanjutan).
-- Viral (tetap berdasar views): views >= max(3x median 30 hari akun, 1.000), selama posting berumur <= 4 hari.
-- Skor berbobot balasan: ln((views+1)/(median views+1)) + 0,5 * ln((replies+1)/(median replies+1)), -2..2.
CREATE OR REPLACE FUNCTION dash_learn_sync(p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  WITH med AS (
    SELECT s."threadsAccountId" AS aid,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY s.views) AS m,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY s.replies) AS mr
    FROM "ThreadsPostStat" s
    WHERE s."postedAt" >= p_now - interval '30 days' AND s."postedAt" < p_now - interval '1 day'
      AND s."isQuote" = false
    GROUP BY s."threadsAccountId"
    HAVING COUNT(*) >= 5
  ), src AS (
    SELECT sl."postId", sl.id AS "slotId", sl."workspaceId", sl."accountId", sl.hour, sl.kind,
           i."formulaHook", COALESCE(sl.draft->>'pillar', i.pilar) AS pilar,
           (sl."ideaId" IS NOT NULL) AS "pakaiIde", COALESCE((sl.draft->>'promo')::boolean, false) AS promo,
           st."postedAt", st.views, st.likes, st.replies, st.reposts, st.text, st.permalink,
           COALESCE(med.m, 0)::real AS baseline,
           COALESCE(med.mr, 0)::real AS "medianReplies",
           ta.username
    FROM "AutopilotSlot" sl
    JOIN "PostDispatch" d ON d."postId" = sl."postId" AND d.publisher = 'THREADS' AND d.status = 'TERBIT'
    JOIN "ThreadsPostStat" st ON st."mediaId" = d."platformPostId"
    JOIN "ThreadsAccount" ta ON ta.id = sl."accountId"
    LEFT JOIN "ContentIdea" i ON i.id = sl."ideaId"
    LEFT JOIN med ON med.aid = sl."accountId"
    WHERE sl.status = 'TERBIT' AND sl."postId" IS NOT NULL AND sl."slotAt" >= p_now - interval '14 days'
  ), prev AS (
    SELECT o."postId" FROM "ContentOutcome" o WHERE o."isViral" AND o."postId" IN (SELECT "postId" FROM src)
  ), up AS (
    INSERT INTO "ContentOutcome" ("postId", "slotId", "workspaceId", "accountId", "formulaHook", pilar, "jamLokal",
                                  "jenisSlot", "pakaiIde", promo, "postedAt", views, likes, replies, reposts,
                                  baseline, "medianReplies", score, "isViral", "diukurPada")
    SELECT s."postId", s."slotId", s."workspaceId", s."accountId", s."formulaHook", s.pilar, s.hour, s.kind,
           s."pakaiIde", s.promo, s."postedAt", s.views, s.likes, s.replies, s.reposts, s.baseline, s."medianReplies",
           GREATEST(-2, LEAST(2,
             ln((GREATEST(s.views, 0) + 1)::float8 / (s.baseline + 1))
             + 0.5 * ln((GREATEST(s.replies, 0) + 1)::float8 / (s."medianReplies" + 1))))::real,
           (s.baseline > 0 AND s.views >= GREATEST(3 * s.baseline, 1000) AND s."postedAt" >= p_now - interval '4 days'),
           p_now
    FROM src s
    ON CONFLICT ("postId") DO UPDATE SET
      views = EXCLUDED.views, likes = EXCLUDED.likes, replies = EXCLUDED.replies, reposts = EXCLUDED.reposts,
      baseline = EXCLUDED.baseline, "medianReplies" = EXCLUDED."medianReplies", score = EXCLUDED.score,
      -- Sekali viral tetap viral (tidak dicabut saat posting menua).
      "isViral" = "ContentOutcome"."isViral" OR EXCLUDED."isViral",
      "diukurPada" = EXCLUDED."diukurPada"
    RETURNING "postId", "isViral"
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'postId', s."postId", 'slotId', s."slotId", 'workspaceId', s."workspaceId", 'accountId', s."accountId",
           'username', s.username, 'views', s.views, 'baseline', ROUND(s.baseline::numeric),
           'text', LEFT(regexp_replace(s.text, '\s+', ' ', 'g'), 200), 'permalink', s.permalink,
           'formulaHook', s."formulaHook", 'pilar', s.pilar)), '[]'::jsonb)
  INTO v
  FROM up
  JOIN src s ON s."postId" = up."postId"
  WHERE up."isViral" AND up."postId" NOT IN (SELECT "postId" FROM prev);
  RETURN v;
END
$$;

-- Rata-rata skor per akun per dimensi (60 hari), beserta rata-rata jaringan sebagai pembanding.
-- Baris: {aid (NULL = jaringan), dim, val, n, avg}.
-- Dimensi lama (tidak berubah): formulaHook, pilar, jam, jenisSlot.
-- Dimensi gaya (dari label format/layout): format (PostFormat), panjang (pendek <120 | sedang 120-280 |
-- panjang >280 karakter), baris (1 | 2-4 | 5+ baris tidak kosong), daftar (ya | tidak),
-- pembuka (kecil | kapital: huruf pertama). Postingan bertekst kosong tidak masuk dimensi layout.
CREATE OR REPLACE FUNCTION dash_learn_stats(p_ids text[], p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH base AS (
    SELECT o."accountId" AS aid, o.score, o."formulaHook", o.pilar, o."jamLokal", o."jenisSlot", o.format,
           CASE WHEN (o.layout->>'chars')::int > 0 THEN o.layout END AS lay
    FROM "ContentOutcome" o
    WHERE o."postedAt" >= p_now - interval '60 days' AND o."postedAt" < p_now - interval '1 day'
      AND o."workspaceId" IN (SELECT DISTINCT c."workspaceId" FROM "AutopilotConfig" c WHERE c."accountId" = ANY(p_ids))
  ), long AS (
    SELECT aid, 'formulaHook' AS dim, "formulaHook" AS val, score FROM base WHERE "formulaHook" IS NOT NULL
    UNION ALL SELECT aid, 'pilar', pilar, score FROM base WHERE pilar IS NOT NULL
    UNION ALL SELECT aid, 'jam', "jamLokal"::text, score FROM base
    UNION ALL SELECT aid, 'jenisSlot', "jenisSlot", score FROM base
    UNION ALL SELECT aid, 'format', format, score FROM base WHERE format IS NOT NULL
    UNION ALL SELECT aid, 'panjang',
                     CASE WHEN (lay->>'chars')::int < 120 THEN 'pendek'
                          WHEN (lay->>'chars')::int <= 280 THEN 'sedang' ELSE 'panjang' END, score
              FROM base WHERE lay IS NOT NULL
    UNION ALL SELECT aid, 'baris',
                     CASE WHEN (lay->>'lines')::int <= 1 THEN '1'
                          WHEN (lay->>'lines')::int <= 4 THEN '2-4' ELSE '5+' END, score
              FROM base WHERE lay IS NOT NULL
    UNION ALL SELECT aid, 'daftar', CASE WHEN (lay->>'isList')::boolean THEN 'ya' ELSE 'tidak' END, score
              FROM base WHERE lay IS NOT NULL
    UNION ALL SELECT aid, 'pembuka', CASE WHEN (lay->>'startsLowercase')::boolean THEN 'kecil' ELSE 'kapital' END, score
              FROM base WHERE lay IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT aid, dim, val, COUNT(*)::int AS n, AVG(score)::real AS avg
    FROM long WHERE aid = ANY(p_ids) GROUP BY aid, dim, val
    UNION ALL
    SELECT NULL, dim, val, COUNT(*)::int, AVG(score)::real FROM long GROUP BY dim, val
  ) t
$$;

-- ------------------------------------------------------------------ pelabelan format/layout

-- Hasil (60 hari) yang belum dilabeli, terbaru dulu, paling banyak p_limit (1..200): [{id, text}].
-- Teks = caption antrean posting (yang diterbitkan), cadangan teks draf slot. Lewat kunci primer saja.
CREATE OR REPLACE FUNCTION dash_learn_label_pending(p_limit int, p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t."postId", 'text', t.text) ORDER BY t."postedAt" DESC, t."postId"), '[]'::jsonb)
  FROM (
    SELECT o."postId", o."postedAt",
           LEFT(COALESCE(NULLIF(btrim(p.caption), ''), sl.draft->>'text', ''), 2000) AS text
    FROM "ContentOutcome" o
    LEFT JOIN "ScheduledPost" p ON p.id = o."postId"
    LEFT JOIN "AutopilotSlot" sl ON sl.id = o."slotId"
    WHERE o.layout IS NULL AND o."postedAt" >= p_now - interval '60 days'
    ORDER BY o."postedAt" DESC, o."postId"
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  ) t
$$;

-- Simpan label: p_items = [{id, format (PostFormat|null), layout (LayoutFeatures)}], paling banyak 200.
-- Hanya mengisi baris yang belum dilabeli (idempoten; label yang sudah ada tidak ditimpa).
-- Mengembalikan jumlah baris yang diisi.
CREATE OR REPLACE FUNCTION dash_learn_label_set(p_items jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'items tidak valid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) it
    WHERE jsonb_typeof(it->'layout') IS DISTINCT FROM 'object'
       OR jsonb_typeof(it->'layout'->'chars') IS DISTINCT FROM 'number'
       OR jsonb_typeof(it->'layout'->'lines') IS DISTINCT FROM 'number'
       OR jsonb_typeof(it->'layout'->'isList') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(it->'layout'->'startsLowercase') IS DISTINCT FROM 'boolean'
  ) THEN
    RAISE EXCEPTION 'layout tidak valid' USING ERRCODE = '22023';
  END IF;
  UPDATE "ContentOutcome" o
  SET format = NULLIF(it->>'format', ''), layout = it->'layout'
  FROM jsonb_array_elements(p_items) it
  WHERE o."postId" = it->>'id' AND o.layout IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- ------------------------------------------------------------------ hak akses

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'dash\_learn\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
