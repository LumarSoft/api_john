-- "Mejoras": what changed in the platform, written for the office. Drafts until published.
-- AlterTable
ALTER TABLE `User` ADD COLUMN `lastImprovementsVisitAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `Improvement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(140) NOT NULL,
    `summary` VARCHAR(500) NOT NULL,
    `beforeText` TEXT NULL,
    `afterText` TEXT NULL,
    `example` TEXT NULL,
    `area` ENUM('BOT', 'BANDEJA', 'COTIZADOR', 'PANEL', 'PORTAL') NOT NULL,
    `releasedOn` DATE NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `producerId` INTEGER NULL,

    INDEX `Improvement_producerId_publishedAt_idx`(`producerId`, `publishedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Improvement` ADD CONSTRAINT `Improvement_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

