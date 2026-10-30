-- The Meta business portfolio behind each WhatsApp account (2026-10-30): its name, the portfolio that owns it and
-- whether that portfolio is verified, read from Graph at onboarding and once a day. Additive.
ALTER TABLE `WabaAccount`
  ADD COLUMN `wabaName` VARCHAR(255) NULL,
  ADD COLUMN `businessId` VARCHAR(64) NULL,
  ADD COLUMN `businessName` VARCHAR(255) NULL,
  ADD COLUMN `businessVerification` VARCHAR(32) NULL,
  ADD COLUMN `portfolioCheckedAt` DATETIME(3) NULL;
