-- =============================================================================
-- Anti-duplikat gambar postingan per akun (src/lib/media-store.ts, dipakai src/lib/news-image.ts).
--
-- "MediaUse" mencatat gambar sumber (imageKey = sha1 URL gambar asal yang dinormalkan) yang pernah dipakai
-- satu akun, supaya foto berita yang sama tidak muncul lagi di akun itu dalam 30 hari.
-- - Kunci utama ("accountId", "imageKey") sekaligus indeks pencarian dash_media_used (accountId + ANY(keys)).
-- - dash_media_remember meng-upsert usedAt dan membuang catatan akun itu yang lebih tua dari 90 hari
--   (memakai awalan kunci utama), jadi tabel tidak tumbuh tanpa batas tanpa job pembersih.
--
-- ADITIF dan idempoten. Tanpa prasyarat.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "MediaUse" (
  "accountId" text NOT NULL,
  "imageKey" text NOT NULL,
  "usedAt" timestamp(3) NOT NULL,
  CONSTRAINT "MediaUse_pkey" PRIMARY KEY ("accountId", "imageKey")
);

ALTER TABLE "MediaUse" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "MediaUse" FROM anon, authenticated;

-- imageKey milik p_keys yang dipakai akun ini sejak p_since.
CREATE OR REPLACE FUNCTION dash_media_used(p_account text, p_keys text[], p_since timestamp) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(array_agg(m."imageKey" ORDER BY m."imageKey"), '{}'::text[])
  FROM "MediaUse" m
  WHERE m."accountId" = p_account
    AND m."imageKey" = ANY(p_keys)
    AND m."usedAt" >= p_since
$$;

-- Catat (atau perbarui) pemakaian gambar oleh akun ini; sekalian buang catatan lama akun yang sama.
CREATE OR REPLACE FUNCTION dash_media_remember(p_account text, p_keys text[], p_now timestamp) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM "MediaUse" WHERE "accountId" = p_account AND "usedAt" < p_now - interval '90 days';
  INSERT INTO "MediaUse" ("accountId", "imageKey", "usedAt")
  SELECT p_account, u.k, p_now
  FROM (SELECT DISTINCT k FROM unnest(p_keys) AS k WHERE k IS NOT NULL AND k <> '' LIMIT 50) u
  ON CONFLICT ("accountId", "imageKey") DO UPDATE SET "usedAt" = EXCLUDED."usedAt";
$$;

REVOKE ALL ON FUNCTION dash_media_used(text, text[], timestamp) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dash_media_remember(text, text[], timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_media_used(text, text[], timestamp) TO service_role;
GRANT EXECUTE ON FUNCTION dash_media_remember(text, text[], timestamp) TO service_role;

NOTIFY pgrst, 'reload schema';
