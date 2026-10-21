-- =============================================================================
-- Perbaikan CHECK porsi eksplorasi & promo di "AutopilotConfig".
--
-- Kolomnya bertipe real, sedangkan batasnya dibandingkan dengan 0.3 double precision. real 0.3 bernilai
-- 0.300000011920929 sehingga SELALU lebih besar dari 0.3 double: nilai 30% (batas yang diizinkan UI dan
-- validasi server) ditolak database dengan galat 23514. Batas kini dibandingkan sebagai real.
-- ADITIF terhadap data (baris lama sudah memenuhi batas baru) dan idempoten.
-- =============================================================================

ALTER TABLE "AutopilotConfig" DROP CONSTRAINT IF EXISTS "AutopilotConfig_exploreRate_check";
ALTER TABLE "AutopilotConfig" ADD CONSTRAINT "AutopilotConfig_exploreRate_check"
  CHECK ("exploreRate" >= 0::real AND "exploreRate" <= 0.3::real);

ALTER TABLE "AutopilotConfig" DROP CONSTRAINT IF EXISTS "AutopilotConfig_promoRatio_check";
ALTER TABLE "AutopilotConfig" ADD CONSTRAINT "AutopilotConfig_promoRatio_check"
  CHECK ("promoRatio" >= 0::real AND "promoRatio" <= 0.3::real);
