ALTER TABLE `UsageMonthly`
  ADD COLUMN `openaiCalls` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `openaiCachedInputTokens` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `metaMessages` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `metaBillableMessages` INTEGER NOT NULL DEFAULT 0;
CREATE TABLE `UsageEvent` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `eventId` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(20) NOT NULL,
  `phoneNumberId` INTEGER NOT NULL,
  `period` VARCHAR(7) NOT NULL,
  `category` VARCHAR(40) NOT NULL,
  `billable` BOOLEAN NOT NULL,
  `costUsd` DECIMAL(12,6) NOT NULL,
  `deliveredAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `UsageEvent_phoneNumberId_eventId_key` (`phoneNumberId`, `eventId`),
  INDEX `UsageEvent_phoneNumberId_period_idx` (`phoneNumberId`, `period`),
  PRIMARY KEY (`id`),
  CONSTRAINT `UsageEvent_phoneNumberId_fkey` FOREIGN KEY (`phoneNumberId`) REFERENCES `PhoneNumber` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
