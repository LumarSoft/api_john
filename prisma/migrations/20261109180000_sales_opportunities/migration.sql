-- Sales opportunities (2026-11-09): each client a campaign writes to becomes an
-- opportunity the office follows — assigned to someone, moved forward by the
-- system when it can tell (the customer answered, a quote, a new policy) and
-- closed by the office as won or lost — so the campaigns can be measured.
-- Additive: the previous API ignores the new table.

-- CreateTable
CREATE TABLE `SalesOpportunity` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `targetKey` VARCHAR(40) NOT NULL,
    `status` ENUM('NEW', 'CONTACTED', 'REPLIED', 'QUOTED', 'WON', 'LOST') NOT NULL DEFAULT 'NEW',
    `contactedAt` DATETIME(3) NULL,
    `repliedAt` DATETIME(3) NULL,
    `quotedAt` DATETIME(3) NULL,
    `wonAt` DATETIME(3) NULL,
    `lostAt` DATETIME(3) NULL,
    `lostReason` ENUM('PRICE', 'OTHER_INSURER', 'NO_ANSWER', 'SOLD_ASSET', 'OTHER') NULL,
    `note` TEXT NULL,
    `wonPremium` DECIMAL(12, 2) NULL,
    `assignedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `campaignId` INTEGER NOT NULL,
    `producerId` INTEGER NOT NULL,
    `producerCodeId` INTEGER NULL,
    `clientId` INTEGER NULL,
    `policyId` INTEGER NULL,
    `quoteId` INTEGER NULL,
    `wonQuoteId` INTEGER NULL,
    `wonPolicyId` INTEGER NULL,
    `assignedToId` INTEGER NULL,
    `updatedById` INTEGER NULL,

    INDEX `SalesOpportunity_producerId_status_idx`(`producerId`, `status`),
    INDEX `SalesOpportunity_assignedToId_idx`(`assignedToId`),
    INDEX `SalesOpportunity_clientId_idx`(`clientId`),
    UNIQUE INDEX `SalesOpportunity_campaignId_targetKey_key`(`campaignId`, `targetKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SalesOpportunity` ADD CONSTRAINT `SalesOpportunity_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `SalesCampaign`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOpportunity` ADD CONSTRAINT `SalesOpportunity_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOpportunity` ADD CONSTRAINT `SalesOpportunity_producerCodeId_fkey` FOREIGN KEY (`producerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOpportunity` ADD CONSTRAINT `SalesOpportunity_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOpportunity` ADD CONSTRAINT `SalesOpportunity_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `Policy`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOpportunity` ADD CONSTRAINT `SalesOpportunity_quoteId_fkey` FOREIGN KEY (`quoteId`) REFERENCES `Quote`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOpportunity` ADD CONSTRAINT `SalesOpportunity_wonQuoteId_fkey` FOREIGN KEY (`wonQuoteId`) REFERENCES `Quote`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOpportunity` ADD CONSTRAINT `SalesOpportunity_wonPolicyId_fkey` FOREIGN KEY (`wonPolicyId`) REFERENCES `Policy`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOpportunity` ADD CONSTRAINT `SalesOpportunity_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOpportunity` ADD CONSTRAINT `SalesOpportunity_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
