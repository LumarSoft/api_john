-- A WhatsApp notice that a policy ran out, sent from the cobranzas "pólizas
-- vencidas" worklist with the Meta template POLICY_EXPIRY_TEMPLATE, or MARKED
-- when the office told the client by other means. One row per attempt.
CREATE TABLE `PolicyExpiryNotice` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `status` ENUM('SENDING', 'SENT', 'FAILED', 'MARKED') NOT NULL DEFAULT 'SENDING',
    `phone` VARCHAR(40) NULL,
    `waId` VARCHAR(20) NULL,
    `error` VARCHAR(500) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `producerId` INTEGER NOT NULL,
    `producerCodeId` INTEGER NULL,
    `policyId` INTEGER NOT NULL,
    `clientId` INTEGER NOT NULL,
    `conversationId` INTEGER NULL,
    `sentById` INTEGER NULL,

    INDEX `PolicyExpiryNotice_policyId_createdAt_idx`(`policyId`, `createdAt`),
    INDEX `PolicyExpiryNotice_producerId_status_idx`(`producerId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PolicyExpiryNotice` ADD CONSTRAINT `PolicyExpiryNotice_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PolicyExpiryNotice` ADD CONSTRAINT `PolicyExpiryNotice_producerCodeId_fkey` FOREIGN KEY (`producerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `PolicyExpiryNotice` ADD CONSTRAINT `PolicyExpiryNotice_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `Policy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PolicyExpiryNotice` ADD CONSTRAINT `PolicyExpiryNotice_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PolicyExpiryNotice` ADD CONSTRAINT `PolicyExpiryNotice_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `PolicyExpiryNotice` ADD CONSTRAINT `PolicyExpiryNotice_sentById_fkey` FOREIGN KEY (`sentById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
