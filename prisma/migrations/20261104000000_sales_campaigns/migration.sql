-- Sales campaigns (2026-11-04): Nico's proposal. Each organization turns on
-- campaigns that find in its portfolio who to offer something to; the office
-- picks who to write to and the message goes out with the organization's own
-- Meta template. Quote keeps the bot chat it came from, for the follow-up.
-- Additive: the previous API ignores the new tables and columns.

-- AlterTable
ALTER TABLE `Quote` ADD COLUMN `conversationId` INTEGER NULL,
    ADD COLUMN `vehicleLabel` VARCHAR(160) NULL;

-- CreateTable
CREATE TABLE `SalesCampaign` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` ENUM('COVERAGE_UPGRADE', 'QUOTE_FOLLOWUP', 'RENEWAL', 'WINBACK', 'CROSS_SELL') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `discountPercent` INTEGER NOT NULL DEFAULT 15,
    `body` TEXT NOT NULL,
    `settings` JSON NULL,
    `templateVersion` INTEGER NOT NULL DEFAULT 0,
    `templates` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `producerId` INTEGER NOT NULL,
    `updatedById` INTEGER NULL,

    UNIQUE INDEX `SalesCampaign_producerId_kind_key`(`producerId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesCampaignMessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `status` ENUM('SENDING', 'SENT', 'FAILED', 'MARKED') NOT NULL DEFAULT 'SENDING',
    `phone` VARCHAR(40) NULL,
    `waId` VARCHAR(20) NULL,
    `discountPercent` INTEGER NULL,
    `error` VARCHAR(500) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `campaignId` INTEGER NOT NULL,
    `producerId` INTEGER NOT NULL,
    `producerCodeId` INTEGER NULL,
    `clientId` INTEGER NULL,
    `policyId` INTEGER NULL,
    `quoteId` INTEGER NULL,
    `conversationId` INTEGER NULL,
    `sentById` INTEGER NULL,

    INDEX `SalesCampaignMessage_campaignId_createdAt_idx`(`campaignId`, `createdAt`),
    INDEX `SalesCampaignMessage_producerId_waId_idx`(`producerId`, `waId`),
    INDEX `SalesCampaignMessage_policyId_idx`(`policyId`),
    INDEX `SalesCampaignMessage_quoteId_idx`(`quoteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesCampaignOptOut` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `waId` VARCHAR(20) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,
    `producerId` INTEGER NOT NULL,
    `createdById` INTEGER NULL,

    UNIQUE INDEX `SalesCampaignOptOut_producerId_waId_key`(`producerId`, `waId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Quote_conversationId_idx` ON `Quote`(`conversationId`);

-- AddForeignKey
ALTER TABLE `Quote` ADD CONSTRAINT `Quote_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesCampaign` ADD CONSTRAINT `SalesCampaign_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesCampaign` ADD CONSTRAINT `SalesCampaign_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesCampaignMessage` ADD CONSTRAINT `SalesCampaignMessage_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `SalesCampaign`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesCampaignMessage` ADD CONSTRAINT `SalesCampaignMessage_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesCampaignMessage` ADD CONSTRAINT `SalesCampaignMessage_producerCodeId_fkey` FOREIGN KEY (`producerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesCampaignMessage` ADD CONSTRAINT `SalesCampaignMessage_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesCampaignMessage` ADD CONSTRAINT `SalesCampaignMessage_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `Policy`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesCampaignMessage` ADD CONSTRAINT `SalesCampaignMessage_quoteId_fkey` FOREIGN KEY (`quoteId`) REFERENCES `Quote`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesCampaignMessage` ADD CONSTRAINT `SalesCampaignMessage_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesCampaignMessage` ADD CONSTRAINT `SalesCampaignMessage_sentById_fkey` FOREIGN KEY (`sentById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesCampaignOptOut` ADD CONSTRAINT `SalesCampaignOptOut_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesCampaignOptOut` ADD CONSTRAINT `SalesCampaignOptOut_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

