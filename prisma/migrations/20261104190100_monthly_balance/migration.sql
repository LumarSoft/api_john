-- Monthly balance (2026-11-04): the month-end numbers of each organization, one
-- row per producer code per month, so the office can see how it grows month by
-- month (Balance mensual). Written on the 1st for the month that just closed;
-- the last months are rebuilt from dated records with the month-end state left
-- null. Additive: the previous API ignores the new table.

-- CreateTable
CREATE TABLE `MonthlyBalance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `period` VARCHAR(7) NOT NULL,
    `backfilled` BOOLEAN NOT NULL DEFAULT false,
    `snapshotAt` DATETIME(3) NOT NULL,
    `policiesInForce` INTEGER NULL,
    `policiesNew` INTEGER NULL,
    `policiesLost` INTEGER NULL,
    `premiumInForce` DECIMAL(16, 2) NULL,
    `debtAmount` DECIMAL(16, 2) NULL,
    `installmentsOverdue` INTEGER NULL,
    `installmentsRejected` INTEGER NULL,
    `claimsFiled` INTEGER NULL,
    `claimsOpen` INTEGER NULL,
    `claimsBlockedNoPolicy` INTEGER NULL,
    `claimsBlockedRejectedPayment` INTEGER NULL,
    `claimsBlockedOverdue` INTEGER NULL,
    `quotesBot` INTEGER NULL,
    `quotesWeb` INTEGER NULL,
    `quoteRequests` INTEGER NULL,
    `contactLeads` INTEGER NULL,
    `requestsClosed` INTEGER NULL,
    `handoffs` INTEGER NULL,
    `conversationsNew` INTEGER NULL,
    `messagesSent` INTEGER NULL,
    `rejectionNoticesSent` INTEGER NULL,
    `expiryNoticesSent` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `producerId` INTEGER NOT NULL,
    `producerCodeId` INTEGER NOT NULL,

    INDEX `MonthlyBalance_producerId_period_idx`(`producerId`, `period`),
    INDEX `MonthlyBalance_producerCodeId_idx`(`producerCodeId`),
    UNIQUE INDEX `MonthlyBalance_producerId_producerCodeId_period_key`(`producerId`, `producerCodeId`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MonthlyBalance` ADD CONSTRAINT `MonthlyBalance_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MonthlyBalance` ADD CONSTRAINT `MonthlyBalance_producerCodeId_fkey` FOREIGN KEY (`producerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
