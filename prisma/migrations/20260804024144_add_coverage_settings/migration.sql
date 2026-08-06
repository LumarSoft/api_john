-- CreateTable
CREATE TABLE `CoverageSetting` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(10) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `tagline` VARCHAR(160) NULL,
    `benefits` JSON NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isConfigured` BOOLEAN NOT NULL DEFAULT false,
    `highlighted` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `yearFrom` INTEGER NULL,
    `yearTo` INTEGER NULL,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `producerId` INTEGER NOT NULL,

    INDEX `CoverageSetting_producerId_isActive_idx`(`producerId`, `isActive`),
    UNIQUE INDEX `CoverageSetting_producerId_code_key`(`producerId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CoverageSetting` ADD CONSTRAINT `CoverageSetting_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
