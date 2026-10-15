-- =============================================================================
-- Radar tren, bank ide, dan knowledge base autopilot (PRD-AI-AUTOPILOT-MULTIUSER.md, Fase 2).
--
-- ADITIF dan idempoten. Jalankan MANUAL di SQL Editor Supabase oleh pemilik.
-- Prasyarat: sql/005_autopilot.sql sudah dijalankan.
--
-- Keamanan sama dengan fungsi dash_* lain: SECURITY DEFINER, search_path dikunci, EXECUTE hanya untuk
-- service_role. Tabel baru ber-RLS tanpa policy dan dicabut dari anon/authenticated.
--
-- Sumber sinyal (kolom TrendSignal.source):
--   JARINGAN        postingan jaringan sendiri yang jauh di atas kebiasaan akunnya (dihitung di sini)
--   GTRENDS         tren pencarian Indonesia (diambil server dashboard)
--   MOMEN           momen kalender (bawaan + tabel ContentMoment)
--   MANUAL          inspirasi yang ditempel pengguna
--   WEB             ringkasan tren berbasis pencarian web (disiapkan, belum diisi)
--   THREADS_SEARCH  pencarian kata kunci Threads resmi (diisi pengumpul di SukaPost setelah izin lolos)
-- workspaceId NULL berarti sinyal global (boleh dipakai semua workspace).
-- =============================================================================

-- ------------------------------------------------------------------ tabel

CREATE TABLE IF NOT EXISTS "TrendSignal" (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspaceId" text,
  source        text NOT NULL CHECK (source IN ('JARINGAN', 'GTRENDS', 'WEB', 'THREADS_SEARCH', 'MOMEN', 'MANUAL')),
  title         text NOT NULL,
  summary       text,
  url           text,
  rank          smallint,
  score         real NOT NULL DEFAULT 0.5 CHECK (score BETWEEN 0 AND 1),
  "accountId"   text,                                    -- JARINGAN: akun asal postingan
  raw           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Kunci unik isi: sumber + pengenal isi (+ workspace), supaya pengambilan ulang tidak menggandakan.
  hash          text NOT NULL,
  "capturedAt"  timestamp(3) NOT NULL,
  "expiresAt"   timestamp(3) NOT NULL,
  "createdBy"   text,
  CONSTRAINT "TrendSignal_hash_key" UNIQUE (hash)
);
CREATE INDEX IF NOT EXISTS "TrendSignal_expiresAt_idx" ON "TrendSignal" ("expiresAt");
CREATE INDEX IF NOT EXISTS "TrendSignal_daftar_idx" ON "TrendSignal" ("capturedAt" DESC, id DESC);

CREATE TABLE IF NOT EXISTS "ContentMoment" (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspaceId" text NOT NULL,
  nama          text NOT NULL,
  mulai         date NOT NULL,
  selesai       date NOT NULL,
  catatan       text,
  "updatedBy"   text,
  "updatedAt"   timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  CONSTRAINT "ContentMoment_rentang_check" CHECK (selesai >= mulai)
);
CREATE INDEX IF NOT EXISTS "ContentMoment_ws_mulai_idx" ON "ContentMoment" ("workspaceId", mulai);

CREATE TABLE IF NOT EXISTS "ContentIdea" (
  id            text PRIMARY KEY,
  "workspaceId" text NOT NULL,
  "accountId"   text NOT NULL,
  topik         text NOT NULL,
  "topicKey"    text NOT NULL,                           -- topik dinormalkan (anti-ulang)
  sudut         text,
  "formulaHook" text,
  pilar         text,
  "signalIds"   text[] NOT NULL DEFAULT '{}',
  score         real NOT NULL DEFAULT 0,
  "scoreDetail" jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'BARU' CHECK (status IN ('BARU', 'DIPAKAI', 'DITOLAK', 'KEDALUWARSA')),
  "pinnedBy"    text,
  "usedBySlot"  text,
  "expiresAt"   timestamp(3) NOT NULL,
  "createdAt"   timestamp(3) NOT NULL,
  "updatedAt"   timestamp(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "ContentIdea_pilih_idx" ON "ContentIdea" ("accountId", status, score DESC, id);
CREATE INDEX IF NOT EXISTS "ContentIdea_ws_daftar_idx" ON "ContentIdea" ("workspaceId", "createdAt" DESC, id DESC);

CREATE TABLE IF NOT EXISTS "KnowledgeBase" (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspaceId"   text NOT NULL,
  "accountId"     text,                                  -- NULL = berlaku untuk seluruh akun workspace
  jenis           text NOT NULL CHECK (jenis IN ('FAKTA', 'PRODUK', 'PROMO', 'LARANGAN')),
  judul           text NOT NULL,
  isi             text NOT NULL,
  "berlakuSampai" date,
  "updatedBy"     text,
  "updatedAt"     timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS "KnowledgeBase_ws_akun_idx" ON "KnowledgeBase" ("workspaceId", "accountId");

ALTER TABLE "TrendSignal"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContentMoment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContentIdea"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeBase" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "TrendSignal", "ContentMoment", "ContentIdea", "KnowledgeBase" FROM anon, authenticated;

-- ------------------------------------------------------------------ sinyal

-- Keadaan radar untuk tick: kapan tiap sumber terakhir diambil dan stok ide BARU per akun.
CREATE OR REPLACE FUNCTION dash_radar_state(p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'lastCapture', (
      SELECT COALESCE(jsonb_object_agg(t.source, t.at), '{}'::jsonb) FROM (
        SELECT source, MAX("capturedAt") AS at FROM "TrendSignal" GROUP BY source
      ) t),
    'ideaCounts', (
      SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) FROM (
        SELECT "accountId", COUNT(*)::int AS baru
        FROM "ContentIdea" WHERE status = 'BARU' AND "expiresAt" > p_now
        GROUP BY "accountId"
      ) c)
  )
$$;

-- p_items: [{workspaceId?, source, title, summary?, url?, rank?, score, accountId?, raw?, hash, expiresAt, createdBy?}].
-- Sinyal dengan hash yang sama diperbarui (skor, peringkat, masa berlaku), bukan digandakan.
CREATE OR REPLACE FUNCTION dash_radar_upsert(p_items jsonb, p_now timestamp) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'items tidak valid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO "TrendSignal" ("workspaceId", source, title, summary, url, rank, score, "accountId", raw, hash,
                             "capturedAt", "expiresAt", "createdBy")
  SELECT NULLIF(it->>'workspaceId', ''), it->>'source', LEFT(it->>'title', 300), LEFT(it->>'summary', 600),
         LEFT(it->>'url', 500), (it->>'rank')::smallint, LEAST(1, GREATEST(0, (it->>'score')::real)),
         NULLIF(it->>'accountId', ''), COALESCE(it->'raw', '{}'::jsonb), it->>'hash',
         p_now, (it->>'expiresAt')::timestamp, it->>'createdBy'
  FROM jsonb_array_elements(p_items) it
  ON CONFLICT (hash) DO UPDATE SET
    title = EXCLUDED.title, summary = EXCLUDED.summary, url = EXCLUDED.url, rank = EXCLUDED.rank,
    score = EXCLUDED.score, raw = EXCLUDED.raw, "capturedAt" = EXCLUDED."capturedAt", "expiresAt" = EXCLUDED."expiresAt";
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- Pemenang jaringan: postingan 14 hari terakhir dengan views >= 2x median 30 hari akunnya (dan minimal
-- 200 views), dari akun yang punya cukup data. Skor = seberapa jauh di atas median (penuh pada 6x).
CREATE OR REPLACE FUNCTION dash_radar_sync_winners(p_now timestamp) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  WITH med AS (
    SELECT s."threadsAccountId" AS aid,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY s.views) AS m
    FROM "ThreadsPostStat" s
    WHERE s."postedAt" >= p_now - interval '30 days' AND s."isQuote" = false
    GROUP BY s."threadsAccountId"
    HAVING COUNT(*) >= 5
  ), win AS (
    SELECT s."mediaId", s."threadsAccountId" AS aid, s.text, s.permalink, s.views, s.likes, s.replies, s.reposts,
           s."postedAt", med.m, ta."workspaceId", ta.username
    FROM "ThreadsPostStat" s
    JOIN med ON med.aid = s."threadsAccountId"
    JOIN "ThreadsAccount" ta ON ta.id = s."threadsAccountId"
    WHERE s."postedAt" >= p_now - interval '14 days' AND s."isQuote" = false
      AND char_length(s.text) >= 40 AND s.views >= GREATEST(2 * med.m, 200)
    ORDER BY s.views / GREATEST(med.m, 1) DESC
    LIMIT 60
  )
  INSERT INTO "TrendSignal" ("workspaceId", source, title, summary, url, score, "accountId", raw, hash, "capturedAt", "expiresAt")
  SELECT dash_ap_tenant_of(w."workspaceId"), 'JARINGAN', LEFT(regexp_replace(w.text, '\s+', ' ', 'g'), 280),
         'Postingan @' || COALESCE(w.username, '?') || ': ' || w.views || ' views, '
           || ROUND((w.views / GREATEST(w.m, 1))::numeric, 1) || 'x median akunnya.',
         w.permalink,
         LEAST(1, GREATEST(0.2, (w.views / GREATEST(w.m, 1)) / 6.0))::real,
         w.aid,
         jsonb_build_object('views', w.views, 'likes', w.likes, 'replies', w.replies, 'reposts', w.reposts,
                            'median', ROUND(w.m::numeric), 'postedAt', w."postedAt"),
         'JARINGAN:' || w."mediaId", p_now, w."postedAt" + interval '14 days'
  FROM win w
  ON CONFLICT (hash) DO UPDATE SET
    summary = EXCLUDED.summary, score = EXCLUDED.score, raw = EXCLUDED.raw, "capturedAt" = EXCLUDED."capturedAt";
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- Momen kalender milik workspace yang sedang berjalan atau mulai dalam 3 hari menjadi sinyal MOMEN.
CREATE OR REPLACE FUNCTION dash_radar_sync_moments(p_now timestamp, p_today date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  INSERT INTO "TrendSignal" ("workspaceId", source, title, summary, score, raw, hash, "capturedAt", "expiresAt")
  SELECT m."workspaceId", 'MOMEN', m.nama, m.catatan, 0.6,
         jsonb_build_object('mulai', m.mulai, 'selesai', m.selesai),
         'MOMEN:' || m.id, p_now, (m.selesai + 1)::timestamp
  FROM "ContentMoment" m
  WHERE m.selesai >= p_today AND m.mulai <= p_today + 3
  ON CONFLICT (hash) DO UPDATE SET
    title = EXCLUDED.title, summary = EXCLUDED.summary, raw = EXCLUDED.raw,
    "capturedAt" = EXCLUDED."capturedAt", "expiresAt" = EXCLUDED."expiresAt";
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- Sinyal aktif (belum kedaluwarsa): global + milik workspace. Paginasi kursor (capturedAt, id) menurun.
CREATE OR REPLACE FUNCTION dash_radar_signals(
  p_workspace text, p_sources text[], p_now timestamp, p_cursor_at timestamp, p_cursor_id text, p_limit int
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT s.id, s."workspaceId", s.source, s.title, s.summary, s.url, s.rank, s.score, s."accountId",
           s."capturedAt", s."expiresAt", s."createdBy"
    FROM "TrendSignal" s
    WHERE s."expiresAt" > p_now
      AND (s."workspaceId" IS NULL OR p_workspace IS NULL OR s."workspaceId" = p_workspace)
      AND (p_sources IS NULL OR s.source = ANY(p_sources))
      AND (p_cursor_at IS NULL OR (s."capturedAt", s.id) < (p_cursor_at, p_cursor_id))
    ORDER BY s."capturedAt" DESC, s.id DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 200) + 1
  ) t
$$;

-- Hapus sinyal buatan pengguna (MANUAL) milik workspace.
CREATE OR REPLACE FUNCTION dash_radar_signal_delete(p_id text, p_workspace text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM "TrendSignal" s
  WHERE s.id = p_id AND s.source = 'MANUAL' AND (p_workspace IS NULL OR s."workspaceId" = p_workspace);
  RETURN FOUND;
END
$$;

-- Bersih-bersih: sinyal kedaluwarsa > 30 hari dihapus, ide lewat masa berlaku ditandai, ide lama dibuang.
CREATE OR REPLACE FUNCTION dash_radar_prune(p_now timestamp) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  DELETE FROM "TrendSignal" WHERE "expiresAt" < p_now - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE "ContentIdea" SET status = 'KEDALUWARSA', "updatedAt" = p_now WHERE status = 'BARU' AND "expiresAt" <= p_now;
  DELETE FROM "ContentIdea" WHERE "createdAt" < p_now - interval '60 days';
  RETURN n;
END
$$;

-- ------------------------------------------------------------------ momen kalender

CREATE OR REPLACE FUNCTION dash_moment_list(p_workspace text, p_from date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT id, "workspaceId", nama, mulai, selesai, catatan, "updatedAt"
    FROM "ContentMoment"
    WHERE (p_workspace IS NULL OR "workspaceId" = p_workspace) AND selesai >= p_from
    ORDER BY mulai ASC, id ASC
    LIMIT 200
  ) t
$$;

CREATE OR REPLACE FUNCTION dash_moment_upsert(p_item jsonb, p_user text, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id text := NULLIF(p_item->>'id', '');
BEGIN
  IF v_id IS NULL THEN
    INSERT INTO "ContentMoment" ("workspaceId", nama, mulai, selesai, catatan, "updatedBy", "updatedAt")
    VALUES (p_item->>'workspaceId', p_item->>'nama', (p_item->>'mulai')::date, (p_item->>'selesai')::date,
            NULLIF(p_item->>'catatan', ''), p_user, p_now)
    RETURNING id INTO v_id;
  ELSE
    UPDATE "ContentMoment" SET nama = p_item->>'nama', mulai = (p_item->>'mulai')::date,
           selesai = (p_item->>'selesai')::date, catatan = NULLIF(p_item->>'catatan', ''),
           "updatedBy" = p_user, "updatedAt" = p_now
    WHERE id = v_id AND "workspaceId" = p_item->>'workspaceId';
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION dash_moment_delete(p_id text, p_workspace text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM "TrendSignal" WHERE hash = 'MOMEN:' || p_id AND (p_workspace IS NULL OR "workspaceId" = p_workspace);
  DELETE FROM "ContentMoment" WHERE id = p_id AND (p_workspace IS NULL OR "workspaceId" = p_workspace);
  RETURN FOUND;
END
$$;

-- ------------------------------------------------------------------ ide

-- Bahan anti-ulang untuk penyusunan ide: 50 postingan terakhir per akun (dipotong) dan topik ide yang masih hidup.
CREATE OR REPLACE FUNCTION dash_idea_context(p_ids text[], p_now timestamp) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'recents', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM (
        SELECT aid, text FROM (
          SELECT s."threadsAccountId" AS aid, LEFT(regexp_replace(s.text, '\s+', ' ', 'g'), 160) AS text,
                 ROW_NUMBER() OVER (PARTITION BY s."threadsAccountId" ORDER BY s."postedAt" DESC) AS rn
          FROM "ThreadsPostStat" s
          WHERE s."threadsAccountId" = ANY(p_ids) AND char_length(s.text) >= 10
            AND s."postedAt" >= p_now - interval '60 days'
        ) y WHERE rn <= 50
      ) x),
    'ideas', (
      SELECT COALESCE(jsonb_agg(to_jsonb(i)), '[]'::jsonb) FROM (
        SELECT "accountId" AS aid, "topicKey", topik, status
        FROM "ContentIdea"
        WHERE "accountId" = ANY(p_ids)
          AND ((status = 'BARU' AND "expiresAt" > p_now) OR (status = 'DIPAKAI' AND "updatedAt" >= p_now - interval '30 days'))
      ) i)
  )
$$;

-- p_items: [{id, workspaceId, accountId, topik, topicKey, sudut, formulaHook, pilar, signalIds[], score, scoreDetail, expiresAt}]
CREATE OR REPLACE FUNCTION dash_idea_insert(p_items jsonb, p_now timestamp) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'items tidak valid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO "ContentIdea" (id, "workspaceId", "accountId", topik, "topicKey", sudut, "formulaHook", pilar,
                             "signalIds", score, "scoreDetail", "expiresAt", "createdAt", "updatedAt")
  SELECT it->>'id', it->>'workspaceId', it->>'accountId', LEFT(it->>'topik', 240), LEFT(it->>'topicKey', 240),
         NULLIF(it->>'sudut', ''), NULLIF(it->>'formulaHook', ''), NULLIF(it->>'pilar', ''),
         ARRAY(SELECT jsonb_array_elements_text(COALESCE(it->'signalIds', '[]'::jsonb))),
         (it->>'score')::real, COALESCE(it->'scoreDetail', '{}'::jsonb), (it->>'expiresAt')::timestamp, p_now, p_now
  FROM jsonb_array_elements(p_items) it
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- Ide terbaik yang masih BARU untuk beberapa akun sekaligus (disematkan dulu, lalu skor), maks p_per per akun.
CREATE OR REPLACE FUNCTION dash_idea_candidates(p_ids text[], p_now timestamp, p_per int) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."accountId", t.rn), '[]'::jsonb) FROM (
    SELECT i.id, i."accountId", i.topik, i."topicKey", i.sudut, i."formulaHook", i.pilar, i."signalIds", i.score,
           (i."pinnedBy" IS NOT NULL) AS pinned,
           ROW_NUMBER() OVER (PARTITION BY i."accountId"
                              ORDER BY (i."pinnedBy" IS NOT NULL) DESC, i.score DESC, i.id) AS rn
    FROM "ContentIdea" i
    WHERE i."accountId" = ANY(p_ids) AND i.status = 'BARU' AND i."expiresAt" > p_now
  ) t WHERE t.rn <= LEAST(GREATEST(p_per, 1), 20)
$$;

-- Daftar ide untuk UI, paginasi kursor (createdAt, id) menurun; menyertakan judul sinyal rujukan.
CREATE OR REPLACE FUNCTION dash_idea_list(
  p_workspace text, p_account_ids text[], p_statuses text[], p_cursor_at timestamp, p_cursor_id text, p_limit int
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT i.id, i."accountId", i.topik, i.sudut, i."formulaHook", i.pilar, i.score, i."scoreDetail", i.status,
           (i."pinnedBy" IS NOT NULL) AS pinned, i."usedBySlot", i."expiresAt", i."createdAt",
           (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'source', s.source, 'title', LEFT(s.title, 120))), '[]'::jsonb)
            FROM "TrendSignal" s WHERE s.id = ANY(i."signalIds")) AS signals
    FROM "ContentIdea" i
    WHERE (p_workspace IS NULL OR i."workspaceId" = p_workspace)
      AND (p_account_ids IS NULL OR i."accountId" = ANY(p_account_ids))
      AND i.status = ANY(p_statuses)
      AND (p_cursor_at IS NULL OR (i."createdAt", i.id) < (p_cursor_at, p_cursor_id))
    ORDER BY i."createdAt" DESC, i.id DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 50) + 1
  ) t
$$;

-- Ubah ide secara bersyarat: p_patch boleh memuat status, pinned (boolean), usedBySlot, actor.
CREATE OR REPLACE FUNCTION dash_idea_update(
  p_id text, p_workspace text, p_account_ids text[], p_from text[], p_patch jsonb, p_now timestamp
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pt jsonb := COALESCE(p_patch, '{}'::jsonb);
BEGIN
  UPDATE "ContentIdea" i SET
    status = COALESCE(pt->>'status', i.status),
    "pinnedBy" = CASE WHEN pt ? 'pinned'
                      THEN CASE WHEN (pt->>'pinned')::boolean THEN COALESCE(pt->>'actor', 'pengguna') ELSE NULL END
                      ELSE i."pinnedBy" END,
    "usedBySlot" = CASE WHEN pt ? 'usedBySlot' THEN pt->>'usedBySlot' ELSE i."usedBySlot" END,
    "updatedAt" = p_now
  WHERE i.id = p_id AND i.status = ANY(p_from)
    AND (p_workspace IS NULL OR i."workspaceId" = p_workspace)
    AND (p_account_ids IS NULL OR i."accountId" = ANY(p_account_ids));
  RETURN FOUND;
END
$$;

-- ------------------------------------------------------------------ knowledge base

CREATE OR REPLACE FUNCTION dash_kb_list(p_workspace text, p_account_ids text[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT id, "workspaceId", "accountId", jenis, judul, isi, "berlakuSampai", "updatedAt"
    FROM "KnowledgeBase"
    WHERE (p_workspace IS NULL OR "workspaceId" = p_workspace)
      AND (p_account_ids IS NULL OR "accountId" IS NULL OR "accountId" = ANY(p_account_ids))
    ORDER BY ("accountId" IS NOT NULL), jenis, judul, id
    LIMIT 500
  ) t
$$;

-- Butir yang berlaku hari ini untuk akun-akun tertentu (butir workspace + butir akun), dipakai tick.
CREATE OR REPLACE FUNCTION dash_kb_active(p_ids text[], p_today date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT k."workspaceId", k."accountId", k.jenis, k.judul, LEFT(k.isi, 600) AS isi
    FROM "KnowledgeBase" k
    WHERE (k."berlakuSampai" IS NULL OR k."berlakuSampai" >= p_today)
      AND (k."accountId" = ANY(p_ids)
           OR (k."accountId" IS NULL AND k."workspaceId" IN (
                 SELECT DISTINCT c."workspaceId" FROM "AutopilotConfig" c WHERE c."accountId" = ANY(p_ids))))
    ORDER BY k.jenis, k.id
    LIMIT 400
  ) t
$$;

-- p_account_ids: lingkup akun pengguna (NULL = semua). Butir yang sudah ada hanya bisa diubah bila
-- berada dalam lingkup itu (butir tingkat workspace hanya oleh pengguna tanpa pembatasan akun).
CREATE OR REPLACE FUNCTION dash_kb_upsert(p_item jsonb, p_account_ids text[], p_user text, p_now timestamp) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id text := NULLIF(p_item->>'id', '');
BEGIN
  IF v_id IS NULL THEN
    INSERT INTO "KnowledgeBase" ("workspaceId", "accountId", jenis, judul, isi, "berlakuSampai", "updatedBy", "updatedAt")
    VALUES (p_item->>'workspaceId', NULLIF(p_item->>'accountId', ''), p_item->>'jenis', p_item->>'judul',
            p_item->>'isi', NULLIF(p_item->>'berlakuSampai', '')::date, p_user, p_now)
    RETURNING id INTO v_id;
  ELSE
    UPDATE "KnowledgeBase" SET "accountId" = NULLIF(p_item->>'accountId', ''), jenis = p_item->>'jenis',
           judul = p_item->>'judul', isi = p_item->>'isi',
           "berlakuSampai" = NULLIF(p_item->>'berlakuSampai', '')::date, "updatedBy" = p_user, "updatedAt" = p_now
    WHERE id = v_id AND "workspaceId" = p_item->>'workspaceId'
      AND (p_account_ids IS NULL OR "accountId" = ANY(p_account_ids));
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (p_item->>'workspaceId', p_user, 'KNOWLEDGE_SIMPAN', v_id,
          jsonb_build_object('jenis', p_item->>'jenis', 'judul', p_item->>'judul'), p_now);
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION dash_kb_delete(p_id text, p_workspace text, p_account_ids text[], p_user text, p_now timestamp)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ws text;
BEGIN
  DELETE FROM "KnowledgeBase"
  WHERE id = p_id AND (p_workspace IS NULL OR "workspaceId" = p_workspace)
    AND (p_account_ids IS NULL OR "accountId" = ANY(p_account_ids))
  RETURNING "workspaceId" INTO v_ws;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (v_ws, p_user, 'KNOWLEDGE_HAPUS', p_id, '{}'::jsonb, p_now);
  RETURN TRUE;
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
      AND (p.proname LIKE 'dash\_radar\_%' OR p.proname LIKE 'dash\_idea\_%'
           OR p.proname LIKE 'dash\_kb\_%' OR p.proname LIKE 'dash\_moment\_%')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
