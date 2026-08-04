-- Persisted third-party auth tokens (Triunfo JWT).
-- Triunfo returns the same JWT while it is valid and warned that repeatedly
-- calling getTokenRest can get the IP blocked, so the token must survive
-- restarts and be shared across instances.
CREATE TABLE `IntegrationToken` (
  `id`        INTEGER      NOT NULL AUTO_INCREMENT,
  `key`       VARCHAR(191) NOT NULL,
  `token`     TEXT         NOT NULL,
  `expiresAt` DATETIME(3)  NOT NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3)  NOT NULL,
  UNIQUE INDEX `IntegrationToken_key_key`(`key`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Marks the last successful cartera sync per producer code. NULL means the code
-- was never synced, so the next run uses the 6-month backfill window instead of
-- the 3-month incremental one. Additive and nullable: safe on existing rows.
ALTER TABLE `ProducerCode` ADD COLUMN `lastCarteraSyncAt` DATETIME(3) NULL;
