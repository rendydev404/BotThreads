-- =============================================================================
-- Korpus gaya Threads ("otak gaya", fase A): contoh postingan nyata yang ditiru RITME dan LAYOUT-nya
-- (bukan kalimatnya) oleh penulis AI. Sumbernya hanya yang sah dipakai:
--   1. postingan akun itu sendiri dan akun lain di WORKSPACE (tenant) yang sama, dari "ThreadsPostStat"
--      (diisi pengumpul insight, src/lib/threads-insights.ts) beserta metriknya;
--   2. contoh yang ditempel manual pemilik akun ("Contoh gaya"), tabel "StyleExample" di bawah.
-- Ketat per workspace: fungsi di sini TIDAK PERNAH mengembalikan postingan atau contoh workspace lain.
--
-- Workspace = tenant dashboard (id workspace pemimpin kelompok, sql/005 "DashboardWorkspaceGroup"), sama
-- dengan RequestCtx.workspaceId dan PublishAccount.tenantId. Workspace auto-suka yang tidak berkelompok
-- adalah tenant sendiri.
--
-- 1. "StyleExample": contoh gaya manual per workspace; "accountId" NULL = berlaku untuk semua akun workspace.
-- 2. dash_style_candidates: kandidat contoh untuk satu akun dalam SATU perjalanan:
--    postingan akun sendiri (OWN) + akun lain se-workspace (WORKSPACE) sejak p_since, bukan kutipan/repost,
--    teks tidak kosong, dengan metrik dan median views/replies PENULISNYA pada periode itu (dihitung sekali
--    per penulis dengan percentile_cont, tanpa N+1), lalu dipangkas di SQL ke p_limit terbaik menurut
--    views relatif terhadap median penulis (tiap penulis maks sepertiga kuota supaya satu akun besar tidak
--    memenuhi semuanya). Ditambah contoh manual workspace itu untuk akun ini atau seluruh workspace.
-- 3. dash_style_example_list / _add / _delete: CRUD contoh manual, selalu dibatasi workspace.
--
-- Indeks: akun workspace lewat "ThreadsAccount"("workspaceId") (indeks Prisma) dan
-- "DashboardWorkspaceGroup"_group_idx; postingan lewat "ThreadsPostStat"("threadsAccountId", "postedAt")
-- (indeks Prisma) dengan kondisi threadsAccountId = ANY(akun workspace) AND postedAt >= p_since.
-- Satu indeks baru: "StyleExample"("workspaceId", "accountId").
--
-- ADITIF dan idempoten. Prasyarat: tabel "ThreadsAccount", "ThreadsPostStat", sql/005_autopilot.sql.
-- Jalankan MANUAL di SQL Editor Supabase.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "StyleExample" (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspaceId" text NOT NULL,
  "accountId"   text REFERENCES "ThreadsAccount"(id) ON UPDATE CASCADE ON DELETE CASCADE,
  text          text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 1000),
  format        text NOT NULL CHECK (format IN ('CERITA', 'OPINI', 'TIPS_LIST', 'PERTANYAAN', 'INFO', 'CURHAT', 'PROMO')),
  note          text CHECK (note IS NULL OR char_length(note) <= 200),
  "createdBy"   text,
  "createdAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "StyleExample_ws_account_idx" ON "StyleExample" ("workspaceId", "accountId");

-- Hanya lewat fungsi di bawah (service role); tanpa policy = tertutup untuk anon/authenticated.
ALTER TABLE "StyleExample" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "StyleExample" FROM anon, authenticated;

-- ------------------------------------------------------------------ kandidat korpus

-- Balasan: { posts: [{id, aid, handle, source, text, views, likes, replies, reposts, medViews, medReplies,
-- postedAt}], manual: [{id, accountId, text, format, note, createdAt}] }. posts urut views relatif menurun.
-- Postingan 2 hari terakhir dilewati: metriknya belum matang, jadi tidak adil dibandingkan median.
CREATE OR REPLACE FUNCTION dash_style_candidates(p_workspace text, p_account text, p_since timestamp, p_limit int DEFAULT 150)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH ws AS (
    -- Workspace anggota tenant ini, plus tenant itu sendiri bila tidak tergabung ke kelompok lain.
    SELECT g."workspaceId" AS id FROM "DashboardWorkspaceGroup" g WHERE g."groupId" = p_workspace
    UNION
    SELECT p_workspace WHERE NOT EXISTS (
      SELECT 1 FROM "DashboardWorkspaceGroup" g WHERE g."workspaceId" = p_workspace AND g."groupId" <> p_workspace)
  ),
  acc AS (
    SELECT a.id, a.username FROM "ThreadsAccount" a WHERE a."workspaceId" IN (SELECT id FROM ws)
  ),
  p AS (
    SELECT s.id, s."threadsAccountId" AS aid, s.text, s.views, s.likes, s.replies, s.reposts, s."postedAt"
    FROM "ThreadsPostStat" s
    WHERE s."threadsAccountId" = ANY (ARRAY(SELECT id FROM acc))
      AND s."postedAt" >= p_since
      AND s."postedAt" < (now() AT TIME ZONE 'UTC') - interval '2 days'
      AND s."isQuote" = false AND s."mediaType" <> 'REPOST_FACADE'
  ),
  med AS (
    SELECT aid,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY views)::float8 AS mv,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY replies)::float8 AS mr
    FROM p GROUP BY aid
  ),
  scored AS (
    SELECT p.*, med.mv, med.mr,
           ln((GREATEST(p.views, 0) + 1) / (med.mv + 1)) + 0.5 * ln((GREATEST(p.replies, 0) + 1) / (med.mr + 1)) AS rel
    FROM p JOIN med USING (aid)
    WHERE char_length(btrim(p.text)) >= 20
  ),
  capped AS (
    SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.aid ORDER BY s.rel DESC, s.id) AS rn FROM scored s
  ),
  top AS (
    SELECT c.* FROM capped c
    WHERE c.rn <= GREATEST(CEIL(LEAST(GREATEST(COALESCE(p_limit, 150), 1), 300) / 3.0), 10)
    ORDER BY c.rel DESC, c.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 150), 1), 300)
  )
  SELECT jsonb_build_object(
    'posts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', t.id, 'aid', t.aid, 'handle', acc.username,
               'source', CASE WHEN t.aid = p_account THEN 'OWN' ELSE 'WORKSPACE' END,
               'text', t.text, 'views', t.views, 'likes', t.likes, 'replies', t.replies, 'reposts', t.reposts,
               'medViews', t.mv, 'medReplies', t.mr, 'postedAt', t."postedAt"
             ) ORDER BY t.rel DESC, t.id), '[]'::jsonb)
      FROM top t JOIN acc ON acc.id = t.aid),
    'manual', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', e.id, 'accountId', e."accountId", 'text', e.text, 'format', e.format, 'note', e.note,
               'createdAt', e."createdAt"
             ) ORDER BY e."createdAt" DESC, e.id), '[]'::jsonb)
      FROM (
        SELECT * FROM "StyleExample" e
        WHERE e."workspaceId" = p_workspace AND (e."accountId" IS NULL OR e."accountId" = p_account)
        ORDER BY e."createdAt" DESC, e.id LIMIT 50
      ) e)
  )
$$;

REVOKE ALL ON FUNCTION dash_style_candidates(text, text, timestamp, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_style_candidates(text, text, timestamp, int) TO service_role;

-- ------------------------------------------------------------------ contoh manual (CRUD)

-- Daftar contoh workspace. p_account NULL = semua contoh workspace; berisi id akun = contoh akun itu
-- ditambah yang berlaku untuk semua akun. Maks 200, terbaru dulu.
CREATE OR REPLACE FUNCTION dash_style_example_list(p_workspace text, p_account text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e."createdAt" DESC, e.id), '[]'::jsonb) FROM (
    SELECT e.id, e."accountId", e.text, e.format, e.note, e."createdBy", e."createdAt"
    FROM "StyleExample" e
    WHERE e."workspaceId" = p_workspace
      AND (p_account IS NULL OR e."accountId" IS NULL OR e."accountId" = p_account)
    ORDER BY e."createdAt" DESC, e.id
    LIMIT 200
  ) e
$$;

-- Tambah satu contoh. Akun (bila diisi) wajib milik workspace ini; maks 200 contoh per workspace.
-- Balasan: baris baru (jsonb). Galat 22023 = masukan tidak valid, 54000 = kuota contoh penuh.
CREATE OR REPLACE FUNCTION dash_style_example_add(
  p_workspace text, p_account text, p_text text, p_format text, p_note text, p_user text, p_now timestamp
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  IF p_workspace IS NULL OR p_text IS NULL OR char_length(btrim(p_text)) < 1 OR char_length(p_text) > 1000 THEN
    RAISE EXCEPTION 'contoh gaya tidak valid' USING ERRCODE = '22023';
  END IF;
  IF p_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ThreadsAccount" a
    WHERE a.id = p_account
      AND COALESCE((SELECT g."groupId" FROM "DashboardWorkspaceGroup" g WHERE g."workspaceId" = a."workspaceId"), a."workspaceId") = p_workspace
  ) THEN
    RAISE EXCEPTION 'akun bukan milik workspace ini' USING ERRCODE = '22023';
  END IF;
  -- Kunci per workspace supaya batas jumlah tidak bocor oleh dua permintaan serentak.
  PERFORM pg_advisory_xact_lock(hashtext('style_example:' || p_workspace));
  IF (SELECT count(*) FROM "StyleExample" e WHERE e."workspaceId" = p_workspace) >= 200 THEN
    RAISE EXCEPTION 'contoh gaya sudah 200, hapus sebagian dulu' USING ERRCODE = '54000';
  END IF;
  INSERT INTO "StyleExample" ("workspaceId", "accountId", text, format, note, "createdBy", "createdAt")
  VALUES (p_workspace, p_account, p_text, p_format, NULLIF(btrim(COALESCE(p_note, '')), ''), p_user, COALESCE(p_now, now() AT TIME ZONE 'UTC'))
  RETURNING jsonb_build_object('id', id, 'accountId', "accountId", 'text', text, 'format', format, 'note', note,
                               'createdBy', "createdBy", 'createdAt', "createdAt")
  INTO v;
  RETURN v;
END
$$;

REVOKE ALL ON FUNCTION dash_style_example_list(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_style_example_list(text, text) TO service_role;
REVOKE ALL ON FUNCTION dash_style_example_add(text, text, text, text, text, text, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_style_example_add(text, text, text, text, text, text, timestamp) TO service_role;

-- Hapus satu contoh milik workspace ini. Balasan: "accountId" contoh yang dihapus dibungkus jsonb
-- ({"accountId": ...}) supaya pemanggil bisa memeriksa lingkup, atau NULL bila tidak ditemukan.
-- p_accounts (opsional) membatasi penghapusan ke contoh akun-akun itu saja (pengguna berlingkup akun);
-- contoh untuk semua akun (accountId NULL) hanya terhapus bila p_accounts NULL.
CREATE OR REPLACE FUNCTION dash_style_example_delete(p_workspace text, p_id text, p_accounts text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH d AS (
    DELETE FROM "StyleExample" e
    WHERE e.id = p_id AND e."workspaceId" = p_workspace
      AND (p_accounts IS NULL OR e."accountId" = ANY (p_accounts))
    RETURNING e."accountId"
  )
  SELECT jsonb_build_object('accountId', d."accountId") FROM d
$$;

REVOKE ALL ON FUNCTION dash_style_example_delete(text, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_style_example_delete(text, text, text[]) TO service_role;

NOTIFY pgrst, 'reload schema';
