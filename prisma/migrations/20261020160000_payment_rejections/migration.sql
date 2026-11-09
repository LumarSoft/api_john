-- CreateTable
CREATE TABLE `PaymentRejectionImport` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fileName` VARCHAR(255) NOT NULL,
    `periodLabel` VARCHAR(120) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `producerId` INTEGER NOT NULL,
    `createdById` INTEGER NOT NULL,

    INDEX `PaymentRejectionImport_producerId_createdAt_idx`(`producerId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentRejection` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `rowNumber` INTEGER NOT NULL,
    `holderName` VARCHAR(160) NOT NULL,
    `branch` INTEGER NULL,
    `certificateNumber` VARCHAR(20) NOT NULL,
    `endorsementNumber` INTEGER NULL,
    `installmentNumber` INTEGER NOT NULL,
    `dueDate` DATE NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `entity` VARCHAR(80) NOT NULL,
    `channel` ENUM('ACCOUNT', 'CARD') NOT NULL,
    `accountLast4` VARCHAR(4) NULL,
    `reason` VARCHAR(120) NOT NULL,
    `stillPending` BOOLEAN NOT NULL,
    `phone` VARCHAR(40) NULL,
    `waId` VARCHAR(20) NULL,
    `status` ENUM('READY', 'SKIPPED', 'SENDING', 'SENT', 'FAILED', 'MARKED') NOT NULL DEFAULT 'READY',
    `skipReason` VARCHAR(40) NULL,
    `error` VARCHAR(500) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `importId` INTEGER NOT NULL,
    `producerId` INTEGER NOT NULL,
    `producerCodeId` INTEGER NULL,
    `policyId` INTEGER NULL,
    `clientId` INTEGER NULL,
    `conversationId` INTEGER NULL,
    `sentById` INTEGER NULL,

    INDEX `PaymentRejection_importId_rowNumber_idx`(`importId`, `rowNumber`),
    INDEX `PaymentRejection_producerId_certificateNumber_installmentNum_idx`(`producerId`, `certificateNumber`, `installmentNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PaymentRejectionImport` ADD CONSTRAINT `PaymentRejectionImport_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentRejectionImport` ADD CONSTRAINT `PaymentRejectionImport_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentRejection` ADD CONSTRAINT `PaymentRejection_importId_fkey` FOREIGN KEY (`importId`) REFERENCES `PaymentRejectionImport`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentRejection` ADD CONSTRAINT `PaymentRejection_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentRejection` ADD CONSTRAINT `PaymentRejection_producerCodeId_fkey` FOREIGN KEY (`producerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentRejection` ADD CONSTRAINT `PaymentRejection_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `Policy`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentRejection` ADD CONSTRAINT `PaymentRejection_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentRejection` ADD CONSTRAINT `PaymentRejection_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentRejection` ADD CONSTRAINT `PaymentRejection_sentById_fkey` FOREIGN KEY (`sentById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

