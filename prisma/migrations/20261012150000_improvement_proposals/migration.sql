-- Proposals the organization users send to Lumar from "Mejoras".
-- CreateTable
CREATE TABLE `ImprovementProposal` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(140) NOT NULL,
    `description` TEXT NOT NULL,
    `status` ENUM('NEW', 'REVIEWING', 'PLANNED', 'DONE', 'DISCARDED') NOT NULL DEFAULT 'NEW',
    `response` TEXT NULL,
    `respondedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `producerId` INTEGER NOT NULL,
    `authorId` INTEGER NULL,

    INDEX `ImprovementProposal_producerId_createdAt_idx`(`producerId`, `createdAt`),
    INDEX `ImprovementProposal_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ImprovementProposal` ADD CONSTRAINT `ImprovementProposal_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImprovementProposal` ADD CONSTRAINT `ImprovementProposal_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

