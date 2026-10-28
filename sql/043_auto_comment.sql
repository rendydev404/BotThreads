-- =============================================================================
-- Auto Komentar (src/lib/auto-comment.ts): akun Threads mencari posting publik terbaru lewat kata kunci
-- (threads_keyword_search) dan meninggalkan paling banyak SATU komentar singkat yang relevan dan tidak
-- berjualan (threads_manage_replies), pada jam yang dipilih pemilik akun. Tanpa persona: komentar ditulis
-- sebagai akun itu sendiri.
--
--   BtAutoCommentConfig   aturan per workspace (saklar, jeda, cooldown penulis, umur posting, blokir)
--   BtAutoCommentSetting  pengaturan per akun (mode, jam bebas "HH:MM" WIB, kata kunci, batas harian)
--   BtAutoCommentRun      satu baris per (akun, hari WIB, jam): jam yang sama tidak pernah jalan dua kali
--   BtAutoCommentTarget   semua kandidat yang ditemukan/dilewati/didraf/dikirim/gagal (log + antrean tinjau)
--
-- Batas anti-spam LINTAS SEMUA WORKSPACE BotThreads (database bersama) ditegakkan di sini, atomik:
--   * satu posting target hanya pernah menerima satu auto komentar dari akun BotThreads mana pun
--     (unique index parsial pada "mediaId");
--   * penulis yang sudah menerima auto komentar tidak disasar lagi selama cooldown (min 14 hari);
--   * jeda antar-komentar per workspace (min 10 menit) dan per akun (min 30 menit);
--   * batas harian per akun (draf menunggu + terkirim hari ini, WIB).
-- Klaim memakai advisory lock per workspace dan per penulis, jadi dua tick/permintaan serentak tidak
-- bisa sama-sama lolos.
--
-- ADITIF dan idempoten. Prasyarat: sql/005_autopilot.sql (AutopilotConfig, DashboardAuditLog).
-- Jalankan MANUAL di SQL Editor Supabase.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "BtAutoCommentConfig" (
  "workspaceId"     text PRIMARY KEY,
  aktif             boolean NOT NULL DEFAULT false,
  "gapMinutes"      integer NOT NULL DEFAULT 15 CHECK ("gapMinutes" BETWEEN 10 AND 1440),
  "cooldownDays"    integer NOT NULL DEFAULT 30 CHECK ("cooldownDays" BETWEEN 14 AND 365),
  "maxPostAgeHours" integer NOT NULL DEFAULT 24 CHECK ("maxPostAgeHours" BETWEEN 1 AND 72),
  "blockList"       text[] NOT NULL DEFAULT '{}' CHECK (cardinality("blockList") <= 500),
  "updatedBy"       text,
  "updatedAt"       timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS "BtAutoCommentSetting" (
  "accountId"   text PRIMARY KEY,
  "workspaceId" text NOT NULL,
  mode          text NOT NULL DEFAULT 'MATI' CHECK (mode IN ('MATI', 'TINJAU', 'OTOMATIS')),
  slots         text[] NOT NULL DEFAULT '{}' CHECK (cardinality(slots) <= 12),
  keywords      text[] NOT NULL DEFAULT '{}' CHECK (cardinality(keywords) <= 20),
  "dailyCap"    integer NOT NULL DEFAULT 3 CHECK ("dailyCap" BETWEEN 1 AND 12),
  "lastRunAt"   timestamp(3),
  "lastNote"    text,
  "updatedBy"   text,
  "updatedAt"   timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
-- Tick: hanya akun yang menyala.
CREATE INDEX IF NOT EXISTS "BtAutoCommentSetting_on_idx" ON "BtAutoCommentSetting" ("workspaceId") WHERE mode <> 'MATI';

CREATE TABLE IF NOT EXISTS "BtAutoCommentRun" (
  "accountId"   text NOT NULL,
  "dayKey"      date NOT NULL,
  slot          text NOT NULL,
  "workspaceId" text NOT NULL,
  status        text NOT NULL DEFAULT 'BERJALAN' CHECK (status IN ('BERJALAN', 'SELESAI')),
  note          text,
  hitung        jsonb,
  "startedAt"   timestamp(3) NOT NULL,
  "finishedAt"  timestamp(3),
  PRIMARY KEY ("accountId", "dayKey", slot)
);

CREATE TABLE IF NOT EXISTS "BtAutoCommentTarget" (
  id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspaceId"    text NOT NULL,
  "accountId"      text NOT NULL,
  "mediaId"        text NOT NULL,
  "authorUsername" text NOT NULL,
  excerpt          text NOT NULL DEFAULT '' CHECK (char_length(excerpt) <= 300),
  permalink        text,
  "postedAt"       timestamp(3),
  keyword          text,
  slot             text,
  status           text NOT NULL CHECK (status IN ('DILEWATI', 'DRAF', 'DITOLAK', 'MENGIRIM', 'TERKIRIM', 'GAGAL')),
  reason           text,
  "replyText"      text CHECK (char_length("replyText") <= 500),
  "replyId"        text,
  "replyPermalink" text,
  "reviewedBy"     text,
  "reviewedAt"     timestamp(3),
  -- Waktu draf dibuat atau komentar diklaim untuk dikirim: dasar batas harian, jeda, dan cooldown.
  "claimedAt"      timestamp(3),
  "sentAt"         timestamp(3),
  "createdAt"      timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "updatedAt"      timestamp(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);
-- Satu akun mencatat satu posting sekali (dilewati pun tidak dicatat ulang tiap jam).
CREATE UNIQUE INDEX IF NOT EXISTS "BtAutoCommentTarget_akun_media_key" ON "BtAutoCommentTarget" ("accountId", "mediaId");
-- Satu posting target hanya pernah menerima satu auto komentar dari SEMUA akun BotThreads.
CREATE UNIQUE INDEX IF NOT EXISTS "BtAutoCommentTarget_media_key" ON "BtAutoCommentTarget" ("mediaId")
  WHERE status IN ('DRAF', 'MENGIRIM', 'TERKIRIM', 'GAGAL');
-- Cooldown penulis lintas workspace.
CREATE INDEX IF NOT EXISTS "BtAutoCommentTarget_penulis_idx" ON "BtAutoCommentTarget" ("authorUsername", "claimedAt")
  WHERE status IN ('DRAF', 'MENGIRIM', 'TERKIRIM', 'GAGAL');
-- Batas harian dan jeda per akun.
CREATE INDEX IF NOT EXISTS "BtAutoCommentTarget_akun_klaim_idx" ON "BtAutoCommentTarget" ("accountId", "claimedAt")
  WHERE status IN ('DRAF', 'MENGIRIM', 'TERKIRIM');
-- Jeda per workspace.
CREATE INDEX IF NOT EXISTS "BtAutoCommentTarget_ws_kirim_idx" ON "BtAutoCommentTarget" ("workspaceId", "claimedAt")
  WHERE status IN ('MENGIRIM', 'TERKIRIM');
-- Antrean tinjau.
CREATE INDEX IF NOT EXISTS "BtAutoCommentTarget_draf_idx" ON "BtAutoCommentTarget" ("workspaceId", "createdAt")
  WHERE status = 'DRAF';
-- Pemulihan kiriman yang macet.
CREATE INDEX IF NOT EXISTS "BtAutoCommentTarget_kirim_idx" ON "BtAutoCommentTarget" ("claimedAt") WHERE status = 'MENGIRIM';
-- Riwayat (keyset terbaru dulu) dan contoh komentar terakhir akun.
CREATE INDEX IF NOT EXISTS "BtAutoCommentTarget_ws_idx" ON "BtAutoCommentTarget" ("workspaceId", "createdAt" DESC, id DESC);
CREATE INDEX IF NOT EXISTS "BtAutoCommentTarget_terkirim_idx" ON "BtAutoCommentTarget" ("accountId", "sentAt" DESC)
  WHERE status = 'TERKIRIM';

ALTER TABLE "BtAutoCommentConfig"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BtAutoCommentSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BtAutoCommentRun"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BtAutoCommentTarget"  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "BtAutoCommentConfig", "BtAutoCommentSetting", "BtAutoCommentRun", "BtAutoCommentTarget" FROM anon, authenticated;

-- ------------------------------------------------------------------ baca

-- Keadaan akun untuk mesin dan dashboard. p_account_ids NULL = semua akun yang menyala di workspace yang
-- saklarnya menyala (dipakai tick; sekaligus memulihkan kiriman MENGIRIM yang macet > 10 menit menjadi GAGAL,
-- karena tidak diketahui apakah komentarnya sudah terkirim, jadi tidak pernah dicoba ulang).
-- p_days = hari WIB (hari ini, kemarin) untuk daftar jam yang sudah dijalankan.
CREATE OR REPLACE FUNCTION dash_acmt_load(p_account_ids text[], p_days date[], p_day_start timestamp, p_now timestamp)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_out jsonb;
BEGIN
  IF p_account_ids IS NULL THEN
    UPDATE "BtAutoCommentTarget" SET status = 'GAGAL', reason = 'Pengiriman terputus; tidak dicoba ulang supaya tidak dobel.',
      "updatedAt" = p_now
    WHERE status = 'MENGIRIM' AND "claimedAt" < p_now - interval '10 minutes';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'accountId', s."accountId", 'workspaceId', s."workspaceId", 'mode', s.mode, 'slots', to_jsonb(s.slots),
      'keywords', to_jsonb(s.keywords), 'dailyCap', s."dailyCap", 'lastRunAt', s."lastRunAt", 'lastNote', s."lastNote",
      'config', jsonb_build_object('aktif', COALESCE(c.aktif, false), 'gapMinutes', COALESCE(c."gapMinutes", 15),
        'cooldownDays', COALESCE(c."cooldownDays", 30), 'maxPostAgeHours', COALESCE(c."maxPostAgeHours", 24),
        'blockList', to_jsonb(COALESCE(c."blockList", '{}'::text[]))),
      'brief', ac.brief, 'voiceStyle', ac."voiceStyle",
      'used', (SELECT count(*) FROM "BtAutoCommentTarget" t
               WHERE t."accountId" = s."accountId" AND t.status IN ('DRAF', 'MENGIRIM', 'TERKIRIM') AND t."claimedAt" >= p_day_start),
      'lastAt', (SELECT t."claimedAt" FROM "BtAutoCommentTarget" t
                 WHERE t."accountId" = s."accountId" AND t.status IN ('MENGIRIM', 'TERKIRIM')
                 ORDER BY t."claimedAt" DESC LIMIT 1),
      'wsLastAt', (SELECT t."claimedAt" FROM "BtAutoCommentTarget" t
                   WHERE t."workspaceId" = s."workspaceId" AND t.status IN ('MENGIRIM', 'TERKIRIM')
                   ORDER BY t."claimedAt" DESC LIMIT 1),
      'doneSlots', COALESCE((SELECT jsonb_agg(to_char(r."dayKey", 'YYYY-MM-DD') || '|' || r.slot) FROM "BtAutoCommentRun" r
                             WHERE r."accountId" = s."accountId" AND r."dayKey" = ANY(p_days)), '[]'::jsonb),
      'recent', COALESCE((SELECT jsonb_agg(x."replyText") FROM (
                   SELECT t."replyText" FROM "BtAutoCommentTarget" t
                   WHERE t."accountId" = s."accountId" AND t.status = 'TERKIRIM'
                   ORDER BY t."sentAt" DESC LIMIT 5) x), '[]'::jsonb))), '[]'::jsonb)
  INTO v_out
  FROM "BtAutoCommentSetting" s
  LEFT JOIN "BtAutoCommentConfig" c ON c."workspaceId" = s."workspaceId"
  LEFT JOIN "AutopilotConfig" ac ON ac."accountId" = s."accountId"
  WHERE CASE WHEN p_account_ids IS NULL THEN s.mode <> 'MATI' AND c.aktif
             ELSE s."accountId" = ANY(p_account_ids) END;
  RETURN v_out;
END
$$;

-- Saringan kandidat dalam satu panggilan (tanpa N+1): posting yang sudah dicatat akun ini atau sudah
-- dikomentari akun BotThreads mana pun, penulis yang masih cooldown, dan penulis yang adalah akun BotThreads.
CREATE OR REPLACE FUNCTION dash_acmt_seen(p_account text, p_media_ids text[], p_authors text[], p_since timestamp)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'media', COALESCE((SELECT jsonb_agg(DISTINCT t."mediaId") FROM "BtAutoCommentTarget" t
                       WHERE t."mediaId" = ANY(p_media_ids)
                         AND (t."accountId" = p_account OR t.status IN ('DRAF', 'MENGIRIM', 'TERKIRIM', 'GAGAL'))), '[]'::jsonb),
    'authors', COALESCE((SELECT jsonb_agg(DISTINCT t."authorUsername") FROM "BtAutoCommentTarget" t
                         WHERE t."authorUsername" = ANY(p_authors) AND t.status IN ('DRAF', 'MENGIRIM', 'TERKIRIM', 'GAGAL')
                           AND t."claimedAt" > p_since), '[]'::jsonb),
    -- ThreadsAccount kecil (satu baris per akun terhubung); lower() supaya cocok dengan username pencarian.
    'bots', COALESCE((SELECT jsonb_agg(DISTINCT lower(a.username)) FROM "ThreadsAccount" a
                      WHERE lower(a.username) = ANY(p_authors)), '[]'::jsonb))
$$;

-- Ringkasan dashboard: aturan workspace, akun (dash_acmt_load), antrean tinjau, dan hitungan 7 hari.
CREATE OR REPLACE FUNCTION dash_acmt_overview(p_workspace text, p_account_ids text[], p_days date[], p_day_start timestamp,
  p_now timestamp, p_queue_limit integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN jsonb_build_object(
    'config', (SELECT jsonb_build_object('aktif', c.aktif, 'gapMinutes', c."gapMinutes", 'cooldownDays', c."cooldownDays",
                 'maxPostAgeHours', c."maxPostAgeHours", 'blockList', to_jsonb(c."blockList"), 'updatedAt', c."updatedAt")
               FROM "BtAutoCommentConfig" c WHERE c."workspaceId" = p_workspace),
    'accounts', dash_acmt_load(COALESCE(p_account_ids, '{}'::text[]), p_days, p_day_start, p_now),
    'queue', COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q."createdAt", q.id) FROM (
               SELECT t.id, t."accountId", t."mediaId", t."authorUsername", t.excerpt, t.permalink, t."postedAt", t.keyword,
                      t.slot, t."replyText", t."createdAt"
               FROM "BtAutoCommentTarget" t
               WHERE t."workspaceId" = p_workspace AND t.status = 'DRAF' AND t."accountId" = ANY(p_account_ids)
               ORDER BY t."createdAt", t.id
               LIMIT LEAST(GREATEST(COALESCE(p_queue_limit, 50), 1), 100)) q), '[]'::jsonb),
    'counts', (SELECT jsonb_build_object(
                 'terkirim7', count(*) FILTER (WHERE t.status = 'TERKIRIM'),
                 'draf', count(*) FILTER (WHERE t.status = 'DRAF'),
                 'dilewati7', count(*) FILTER (WHERE t.status = 'DILEWATI'),
                 'gagal7', count(*) FILTER (WHERE t.status = 'GAGAL'))
               FROM "BtAutoCommentTarget" t
               WHERE t."workspaceId" = p_workspace AND t."accountId" = ANY(p_account_ids)
                 AND t."createdAt" >= p_now - interval '7 days'));
END
$$;

-- Riwayat terbaru dulu dengan keyset (createdAt, id). p_status NULL = semua status.
CREATE OR REPLACE FUNCTION dash_acmt_history(p_workspace text, p_account_ids text[], p_status text, p_before_at timestamp,
  p_before_id text, p_limit integer)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY h."createdAt" DESC, h.id DESC), '[]'::jsonb) FROM (
    SELECT t.id, t."accountId", t."mediaId", t."authorUsername", t.excerpt, t.permalink, t."postedAt", t.keyword, t.slot,
           t.status, t.reason, t."replyText", t."replyId", t."replyPermalink", t."sentAt", t."createdAt"
    FROM "BtAutoCommentTarget" t
    WHERE t."workspaceId" = p_workspace AND t."accountId" = ANY(p_account_ids)
      AND (p_status IS NULL OR t.status = p_status)
      AND (p_before_at IS NULL OR (t."createdAt", t.id) < (p_before_at, p_before_id))
    ORDER BY t."createdAt" DESC, t.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100)) h
$$;

-- ------------------------------------------------------------------ tulis: jam, log

-- Klaim satu jam untuk satu hari WIB. false = jam ini sudah dijalankan (oleh tick lain atau sebelumnya).
CREATE OR REPLACE FUNCTION dash_acmt_slot_claim(p_account text, p_workspace text, p_day date, p_slot text, p_now timestamp)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF p_slot !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'jam tidak valid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO "BtAutoCommentRun" ("accountId", "dayKey", slot, "workspaceId", "startedAt")
  VALUES (p_account, p_day, p_slot, p_workspace, p_now)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END
$$;

-- Selesai satu putaran (jam terjadwal atau "Jalankan sekarang" bila p_slot NULL): catatan terakhir akun.
CREATE OR REPLACE FUNCTION dash_acmt_run_done(p_account text, p_day date, p_slot text, p_note text, p_counts jsonb, p_now timestamp)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_slot IS NOT NULL THEN
    UPDATE "BtAutoCommentRun" SET status = 'SELESAI', note = LEFT(p_note, 500), hitung = p_counts, "finishedAt" = p_now
    WHERE "accountId" = p_account AND "dayKey" = p_day AND slot = p_slot;
  END IF;
  UPDATE "BtAutoCommentSetting" SET "lastRunAt" = p_now, "lastNote" = LEFT(p_note, 500) WHERE "accountId" = p_account;
END
$$;

-- Kandidat yang dilewati (filter atau AI). Sudah tercatat untuk akun yang sama = diabaikan.
CREATE OR REPLACE FUNCTION dash_acmt_log(p_items jsonb, p_now timestamp)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  INSERT INTO "BtAutoCommentTarget" ("workspaceId", "accountId", "mediaId", "authorUsername", excerpt, permalink, "postedAt",
    keyword, slot, status, reason, "createdAt", "updatedAt")
  SELECT i->>'workspaceId', i->>'accountId', i->>'mediaId', lower(i->>'authorUsername'), LEFT(COALESCE(i->>'excerpt', ''), 300),
         i->>'permalink', NULLIF(i->>'postedAt', '')::timestamp, LEFT(i->>'keyword', 60), i->>'slot', 'DILEWATI',
         LEFT(i->>'reason', 300), p_now, p_now
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) i
  WHERE COALESCE(i->>'mediaId', '') <> '' AND COALESCE(i->>'accountId', '') <> ''
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- ------------------------------------------------------------------ tulis: klaim draf/kirim (atomik)

-- Klaim satu target: p_status 'DRAF' (mode TINJAU) atau 'MENGIRIM' (mode OTOMATIS, langsung dikirim).
-- Semua batas diperiksa di bawah advisory lock per workspace dan per penulis. Hasil: {ok, id} atau {ok:false, reason}.
CREATE OR REPLACE FUNCTION dash_acmt_claim(p_item jsonb, p_status text, p_day_start timestamp, p_account_gap integer, p_now timestamp)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_account text := p_item->>'accountId';
  v_media   text := p_item->>'mediaId';
  v_author  text := lower(p_item->>'authorUsername');
  v_text    text := p_item->>'replyText';
  s "BtAutoCommentSetting"%ROWTYPE;
  c "BtAutoCommentConfig"%ROWTYPE;
  v_id text;
BEGIN
  IF p_status NOT IN ('DRAF', 'MENGIRIM') THEN
    RAISE EXCEPTION 'status tidak valid' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_media, '') = '' OR COALESCE(v_author, '') = '' OR COALESCE(v_text, '') = '' OR char_length(v_text) > 280 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'TIDAK_VALID');
  END IF;
  SELECT * INTO s FROM "BtAutoCommentSetting" WHERE "accountId" = v_account;
  IF NOT FOUND OR s."workspaceId" <> p_item->>'workspaceId' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'MATI');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('acmt-ws:' || s."workspaceId"));
  PERFORM pg_advisory_xact_lock(hashtext('acmt-author:' || v_author));
  SELECT * INTO c FROM "BtAutoCommentConfig" WHERE "workspaceId" = s."workspaceId";
  IF NOT FOUND OR NOT c.aktif OR s.mode = 'MATI' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'MATI');
  END IF;
  IF p_status = 'MENGIRIM' AND s.mode <> 'OTOMATIS' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BUKAN_OTOMATIS');
  END IF;
  IF (SELECT count(*) FROM "BtAutoCommentTarget" t WHERE t."accountId" = v_account
        AND t.status IN ('DRAF', 'MENGIRIM', 'TERKIRIM') AND t."claimedAt" >= p_day_start) >= s."dailyCap" THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BATAS_HARIAN');
  END IF;
  IF p_status = 'MENGIRIM' THEN
    IF EXISTS (SELECT 1 FROM "BtAutoCommentTarget" t WHERE t."accountId" = v_account AND t.status IN ('MENGIRIM', 'TERKIRIM')
                 AND t."claimedAt" > p_now - make_interval(mins => GREATEST(COALESCE(p_account_gap, 30), 30))) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'JEDA_AKUN');
    END IF;
    IF EXISTS (SELECT 1 FROM "BtAutoCommentTarget" t WHERE t."workspaceId" = s."workspaceId" AND t.status IN ('MENGIRIM', 'TERKIRIM')
                 AND t."claimedAt" > p_now - make_interval(mins => GREATEST(c."gapMinutes", 10))) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'JEDA_WORKSPACE');
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM "BtAutoCommentTarget" t WHERE t."authorUsername" = v_author
               AND t.status IN ('DRAF', 'MENGIRIM', 'TERKIRIM', 'GAGAL')
               AND t."claimedAt" > p_now - make_interval(days => GREATEST(c."cooldownDays", 14))) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'COOLDOWN_PENULIS');
  END IF;
  IF EXISTS (SELECT 1 FROM "BtAutoCommentTarget" t WHERE t."mediaId" = v_media
               AND t.status IN ('DRAF', 'MENGIRIM', 'TERKIRIM', 'GAGAL')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'SUDAH_DIKOMENTARI');
  END IF;

  INSERT INTO "BtAutoCommentTarget" ("workspaceId", "accountId", "mediaId", "authorUsername", excerpt, permalink, "postedAt",
    keyword, slot, status, "replyText", "claimedAt", "createdAt", "updatedAt")
  VALUES (s."workspaceId", v_account, v_media, v_author, LEFT(COALESCE(p_item->>'excerpt', ''), 300), p_item->>'permalink',
    NULLIF(p_item->>'postedAt', '')::timestamp, LEFT(p_item->>'keyword', 60), p_item->>'slot', p_status, v_text, p_now, p_now, p_now)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'SUDAH_DIKOMENTARI');
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END
$$;

-- Setujui draf (Editor+): DRAF -> MENGIRIM dengan teks final, setelah batas harian (tanpa menghitung draf ini
-- dua kali), jeda akun, dan jeda workspace diperiksa ulang. Akun dibatasi p_account_ids (lingkup pengguna).
CREATE OR REPLACE FUNCTION dash_acmt_approve(p_id text, p_account_ids text[], p_text text, p_user text, p_day_start timestamp,
  p_account_gap integer, p_now timestamp)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t "BtAutoCommentTarget"%ROWTYPE;
  s "BtAutoCommentSetting"%ROWTYPE;
  c "BtAutoCommentConfig"%ROWTYPE;
BEGIN
  IF COALESCE(p_text, '') = '' OR char_length(p_text) > 280 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'TIDAK_VALID');
  END IF;
  SELECT * INTO t FROM "BtAutoCommentTarget" WHERE id = p_id AND "accountId" = ANY(p_account_ids);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'TIDAK_DITEMUKAN'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('acmt-ws:' || t."workspaceId"));
  SELECT * INTO t FROM "BtAutoCommentTarget" WHERE id = p_id FOR UPDATE;
  IF t.status <> 'DRAF' THEN RETURN jsonb_build_object('ok', false, 'reason', 'BUKAN_DRAF'); END IF;
  SELECT * INTO s FROM "BtAutoCommentSetting" WHERE "accountId" = t."accountId";
  SELECT * INTO c FROM "BtAutoCommentConfig" WHERE "workspaceId" = t."workspaceId";
  IF s."accountId" IS NULL OR c."workspaceId" IS NULL OR NOT c.aktif OR s.mode = 'MATI' OR s."workspaceId" <> t."workspaceId" THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'MATI');
  END IF;
  IF (SELECT count(*) FROM "BtAutoCommentTarget" x WHERE x."accountId" = t."accountId" AND x.id <> t.id
        AND x.status IN ('DRAF', 'MENGIRIM', 'TERKIRIM') AND x."claimedAt" >= p_day_start) >= s."dailyCap" THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BATAS_HARIAN');
  END IF;
  IF EXISTS (SELECT 1 FROM "BtAutoCommentTarget" x WHERE x."accountId" = t."accountId" AND x.status IN ('MENGIRIM', 'TERKIRIM')
               AND x."claimedAt" > p_now - make_interval(mins => GREATEST(COALESCE(p_account_gap, 30), 30))) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'JEDA_AKUN');
  END IF;
  IF EXISTS (SELECT 1 FROM "BtAutoCommentTarget" x WHERE x."workspaceId" = t."workspaceId" AND x.status IN ('MENGIRIM', 'TERKIRIM')
               AND x."claimedAt" > p_now - make_interval(mins => GREATEST(c."gapMinutes", 10))) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'JEDA_WORKSPACE');
  END IF;
  UPDATE "BtAutoCommentTarget" SET status = 'MENGIRIM', "replyText" = p_text, "reviewedBy" = p_user, "reviewedAt" = p_now,
    "claimedAt" = p_now, "updatedAt" = p_now
  WHERE id = p_id;
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (t."workspaceId", p_user, 'AUTO_KOMENTAR_SETUJU', p_id, jsonb_build_object('accountId', t."accountId"), p_now);
  RETURN jsonb_build_object('ok', true, 'id', t.id, 'accountId', t."accountId", 'workspaceId', t."workspaceId",
    'mediaId', t."mediaId", 'replyText', p_text);
END
$$;

CREATE OR REPLACE FUNCTION dash_acmt_reject(p_id text, p_account_ids text[], p_user text, p_now timestamp)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ws text;
BEGIN
  UPDATE "BtAutoCommentTarget" SET status = 'DITOLAK', reason = 'Ditolak saat ditinjau.', "reviewedBy" = p_user,
    "reviewedAt" = p_now, "updatedAt" = p_now
  WHERE id = p_id AND status = 'DRAF' AND "accountId" = ANY(p_account_ids)
  RETURNING "workspaceId" INTO v_ws;
  IF v_ws IS NULL THEN RETURN false; END IF;
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (v_ws, p_user, 'AUTO_KOMENTAR_TOLAK', p_id, '{}'::jsonb, p_now);
  RETURN true;
END
$$;

-- Hasil kiriman: TERKIRIM {replyId, permalink} atau GAGAL {error}. Hanya dari MENGIRIM.
CREATE OR REPLACE FUNCTION dash_acmt_done(p_id text, p_status text, p_reply_id text, p_permalink text, p_error text, p_now timestamp)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF p_status NOT IN ('TERKIRIM', 'GAGAL') THEN
    RAISE EXCEPTION 'status tidak valid' USING ERRCODE = '22023';
  END IF;
  UPDATE "BtAutoCommentTarget" SET status = p_status, "replyId" = COALESCE(p_reply_id, "replyId"),
    "replyPermalink" = COALESCE(p_permalink, "replyPermalink"), reason = LEFT(p_error, 300),
    "sentAt" = CASE WHEN p_status = 'TERKIRIM' THEN p_now ELSE "sentAt" END, "updatedAt" = p_now
  WHERE id = p_id AND status = 'MENGIRIM';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END
$$;

-- ------------------------------------------------------------------ pengaturan (divalidasi di server; CHECK menahan sisanya)

CREATE OR REPLACE FUNCTION dash_acmt_config_set(p_workspace text, p_cfg jsonb, p_user text, p_now timestamp)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO "BtAutoCommentConfig" ("workspaceId", aktif, "gapMinutes", "cooldownDays", "maxPostAgeHours", "blockList", "updatedBy", "updatedAt")
  VALUES (p_workspace, (p_cfg->>'aktif')::boolean, (p_cfg->>'gapMinutes')::int, (p_cfg->>'cooldownDays')::int,
    (p_cfg->>'maxPostAgeHours')::int, ARRAY(SELECT jsonb_array_elements_text(p_cfg->'blockList')), p_user, p_now)
  ON CONFLICT ("workspaceId") DO UPDATE SET aktif = EXCLUDED.aktif, "gapMinutes" = EXCLUDED."gapMinutes",
    "cooldownDays" = EXCLUDED."cooldownDays", "maxPostAgeHours" = EXCLUDED."maxPostAgeHours", "blockList" = EXCLUDED."blockList",
    "updatedBy" = p_user, "updatedAt" = p_now;
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (p_workspace, p_user, 'AUTO_KOMENTAR_ATURAN', p_workspace, p_cfg - 'blockList', p_now);
END
$$;

CREATE OR REPLACE FUNCTION dash_acmt_setting_set(p_account text, p_workspace text, p_set jsonb, p_user text, p_now timestamp)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO "BtAutoCommentSetting" ("accountId", "workspaceId", mode, slots, keywords, "dailyCap", "updatedBy", "updatedAt")
  VALUES (p_account, p_workspace, p_set->>'mode', ARRAY(SELECT jsonb_array_elements_text(p_set->'slots')),
    ARRAY(SELECT jsonb_array_elements_text(p_set->'keywords')), (p_set->>'dailyCap')::int, p_user, p_now)
  ON CONFLICT ("accountId") DO UPDATE SET "workspaceId" = EXCLUDED."workspaceId", mode = EXCLUDED.mode, slots = EXCLUDED.slots,
    keywords = EXCLUDED.keywords, "dailyCap" = EXCLUDED."dailyCap", "updatedBy" = p_user, "updatedAt" = p_now;
  INSERT INTO "DashboardAuditLog" ("workspaceId", actor, action, target, detail, "createdAt")
  VALUES (p_workspace, p_user, 'AUTO_KOMENTAR_AKUN', p_account, jsonb_build_object('mode', p_set->>'mode'), p_now);
END
$$;

-- ------------------------------------------------------------------ hak akses: hanya service_role

REVOKE ALL ON FUNCTION dash_acmt_load(text[], date[], timestamp, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_acmt_load(text[], date[], timestamp, timestamp) TO service_role;
REVOKE ALL ON FUNCTION dash_acmt_seen(text, text[], text[], timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_acmt_seen(text, text[], text[], timestamp) TO service_role;
REVOKE ALL ON FUNCTION dash_acmt_overview(text, text[], date[], timestamp, timestamp, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_acmt_overview(text, text[], date[], timestamp, timestamp, integer) TO service_role;
REVOKE ALL ON FUNCTION dash_acmt_history(text, text[], text, timestamp, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_acmt_history(text, text[], text, timestamp, text, integer) TO service_role;
REVOKE ALL ON FUNCTION dash_acmt_slot_claim(text, text, date, text, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_acmt_slot_claim(text, text, date, text, timestamp) TO service_role;
REVOKE ALL ON FUNCTION dash_acmt_run_done(text, date, text, text, jsonb, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_acmt_run_done(text, date, text, text, jsonb, timestamp) TO service_role;
REVOKE ALL ON FUNCTION dash_acmt_log(jsonb, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_acmt_log(jsonb, timestamp) TO service_role;
REVOKE ALL ON FUNCTION dash_acmt_claim(jsonb, text, timestamp, integer, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_acmt_claim(jsonb, text, timestamp, integer, timestamp) TO service_role;
REVOKE ALL ON FUNCTION dash_acmt_approve(text, text[], text, text, timestamp, integer, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_acmt_approve(text, text[], text, text, timestamp, integer, timestamp) TO service_role;
REVOKE ALL ON FUNCTION dash_acmt_reject(text, text[], text, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_acmt_reject(text, text[], text, timestamp) TO service_role;
REVOKE ALL ON FUNCTION dash_acmt_done(text, text, text, text, text, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_acmt_done(text, text, text, text, text, timestamp) TO service_role;
REVOKE ALL ON FUNCTION dash_acmt_config_set(text, jsonb, text, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_acmt_config_set(text, jsonb, text, timestamp) TO service_role;
REVOKE ALL ON FUNCTION dash_acmt_setting_set(text, text, jsonb, text, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_acmt_setting_set(text, text, jsonb, text, timestamp) TO service_role;

NOTIFY pgrst, 'reload schema';
