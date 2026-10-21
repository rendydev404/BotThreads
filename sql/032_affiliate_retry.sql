-- =============================================================================
-- Shopee Affiliate: kirim ulang balasan link yang gagal dari tab Affiliate.
--
-- ADITIF dan idempoten. Prasyarat: sql/019_affiliate.sql.
-- Balasan GAGAL kembali MENUNGGU dengan percobaan dari nol; publisher (dash_aff_reply_due) mengambilnya
-- di putaran berikutnya. Hanya slot <= 2 hari: lebih lama dari itu antrean membatalkannya.
-- =============================================================================

CREATE OR REPLACE FUNCTION dash_aff_reply_retry(p_id text, p_workspace text, p_account_ids text[], p_now timestamp)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH x AS (
    UPDATE "AffiliateUse" SET status = 'MENUNGGU', attempts = 0, error = NULL, "nextAt" = NULL, "updatedAt" = p_now
    WHERE id = p_id AND "workspaceId" = p_workspace
      AND (p_account_ids IS NULL OR "accountId" = ANY(p_account_ids))
      AND status = 'GAGAL' AND "slotAt" >= p_now - interval '2 days'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM x)
$$;

REVOKE ALL ON FUNCTION dash_aff_reply_retry(text, text, text[], timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dash_aff_reply_retry(text, text, text[], timestamp) TO service_role;
