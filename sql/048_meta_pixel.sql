-- Meta Pixel untuk iklan situs BotThreads (src/lib/meta-pixel.ts, /admin/pixel).
-- Disimpan di baris tunggal "PlatformIntegration" sebagai { enabled, pixelId, accessToken, testEventCode }.
-- Hanya super admin yang boleh mengubah (sama dengan kunci integrasi lain); setiap perubahan tercatat di log audit
-- tanpa menyalin nilai token.

ALTER TABLE "PlatformIntegration" ADD COLUMN IF NOT EXISTS "metaPixel" jsonb NOT NULL DEFAULT '{}'::jsonb;
INSERT INTO "PlatformIntegration" (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION dash_pixel_config() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT "metaPixel" FROM "PlatformIntegration" WHERE id = 1), '{}'::jsonb)
$$;

-- p_patch: kunci yang diubah saja; nilai "" menghapus kunci itu.
CREATE OR REPLACE FUNCTION dash_pixel_config_set(p_actor text, p_patch jsonb, p_now timestamp) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_p jsonb := COALESCE(p_patch, '{}'::jsonb);
BEGIN
  IF NOT dash_sa_is(p_actor) THEN RETURN NULL; END IF;
  UPDATE "PlatformIntegration" SET
    "metaPixel" = (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each("metaPixel" || v_p) e(k, v) WHERE v <> '""'::jsonb),
    "updatedBy" = p_actor, "updatedAt" = p_now
  WHERE id = 1;
  PERFORM dash_sa_log(p_actor, 'PIXEL_SIMPAN', 'SISTEM', 'meta-pixel', jsonb_build_object(
    'keys', (SELECT COALESCE(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(v_p) k)), p_now);
  RETURN dash_pixel_config();
END
$$;

REVOKE ALL ON FUNCTION dash_pixel_config() FROM PUBLIC;
REVOKE ALL ON FUNCTION dash_pixel_config_set(text, jsonb, timestamp) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION dash_pixel_config() TO service_role;
    GRANT EXECUTE ON FUNCTION dash_pixel_config_set(text, jsonb, timestamp) TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
