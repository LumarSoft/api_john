-- Provisional quotes (2026-11-09): an organization that is still waiting for its
-- Triunfo web-service user can quote auto and moto with the default
-- organization's account while the owner allows it. Only quotes: cartera and
-- documents keep waiting for its own credentials.
-- Additive: the previous API ignores the new column.

-- AlterTable
ALTER TABLE `Producer` ADD COLUMN `triunfoQuoteFallback` BOOLEAN NOT NULL DEFAULT false;
