-- AlterTable
ALTER TABLE `Solicitud` ADD COLUMN `notes` TEXT NULL,
    ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'NEW';

-- CreateTable
CREATE TABLE `ContactLead` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productType` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'NEW',
    `contactName` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `payload` JSON NOT NULL,
    `selectedPlanId` INTEGER NULL,
    `notes` TEXT NULL,
    `conversationId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `producerId` INTEGER NOT NULL,

    INDEX `ContactLead_producerId_status_createdAt_idx`(`producerId`, `status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductPlan` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productType` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `monthlyPrice` DECIMAL(12, 2) NOT NULL,
    `description` VARCHAR(191) NULL,
    `coverageItems` JSON NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `producerId` INTEGER NOT NULL,

    INDEX `ProductPlan_producerId_productType_isActive_idx`(`producerId`, `productType`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ContactLead` ADD CONSTRAINT `ContactLead_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContactLead` ADD CONSTRAINT `ContactLead_selectedPlanId_fkey` FOREIGN KEY (`selectedPlanId`) REFERENCES `ProductPlan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductPlan` ADD CONSTRAINT `ProductPlan_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
