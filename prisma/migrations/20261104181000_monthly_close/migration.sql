-- Monthly close (2026-11-04): on the 1st of each month the API freezes the
-- previous month of every number (MonthlyCloseService): the plan it was billed
-- on, its messages, what it was billed, Lumarsoft's per-message cost and the
-- partner settlement, with that day's rates. The owner's screens read closed
-- months from here instead of recomputing them with today's plans. The
-- settlement columns stay NULL when the PARTNER_* terms are not configured.
-- Additive: the previous API ignores the table.

CREATE TABLE `MonthlyClose` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `period` VARCHAR(7) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `isActive` BOOLEAN NOT NULL,
    `inService` BOOLEAN NOT NULL,
    `firstMonth` BOOLEAN NOT NULL,
    `planId` INTEGER NULL,
    `planName` VARCHAR(80) NOT NULL,
    `planMessages` INTEGER NOT NULL,
    `planPriceUsd` DECIMAL(10, 2) NOT NULL,
    `planExtraBlocks` INTEGER NOT NULL DEFAULT 0,
    `trial` BOOLEAN NOT NULL DEFAULT false,
    `upgraded` BOOLEAN NOT NULL DEFAULT false,
    `prorated` BOOLEAN NOT NULL DEFAULT false,
    `messages` INTEGER NOT NULL DEFAULT 0,
    `templateMessages` INTEGER NOT NULL DEFAULT 0,
    `consumedMessages` INTEGER NOT NULL DEFAULT 0,
    `metaBillableMessages` INTEGER NOT NULL DEFAULT 0,
    `metaCostUsd` DECIMAL(12, 6) NOT NULL DEFAULT 0,
    `openaiCostUsd` DECIMAL(12, 6) NOT NULL DEFAULT 0,
    `billedUsd` DECIMAL(12, 2) NOT NULL,
    `costPerMessageUsd` DECIMAL(10, 4) NULL,
    `serviceCostUsd` DECIMAL(12, 2) NULL,
    `remainderUsd` DECIMAL(12, 2) NULL,
    `partnerShare` DECIMAL(5, 4) NULL,
    `partnerShareUsd` DECIMAL(12, 2) NULL,
    `ownerShareUsd` DECIMAL(12, 2) NULL,
    `backfilled` BOOLEAN NOT NULL DEFAULT false,
    `closedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `phoneNumberId` INTEGER NOT NULL,
    `producerId` INTEGER NOT NULL,
    `producerCodeId` INTEGER NULL,

    INDEX `MonthlyClose_period_producerId_idx`(`period`, `producerId`),
    UNIQUE INDEX `MonthlyClose_period_phoneNumberId_key`(`period`, `phoneNumberId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MonthlyClose` ADD CONSTRAINT `MonthlyClose_phoneNumberId_fkey` FOREIGN KEY (`phoneNumberId`) REFERENCES `PhoneNumber`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MonthlyClose` ADD CONSTRAINT `MonthlyClose_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MonthlyClose` ADD CONSTRAINT `MonthlyClose_producerCodeId_fkey` FOREIGN KEY (`producerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
