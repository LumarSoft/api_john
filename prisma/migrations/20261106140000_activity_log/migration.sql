-- CreateTable
CREATE TABLE `ActivityLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,
    `userId` INTEGER NULL,
    `producerId` INTEGER NULL,
    `method` VARCHAR(8) NOT NULL,
    `path` VARCHAR(255) NOT NULL,
    `statusCode` SMALLINT NOT NULL,
    `ip` VARCHAR(45) NOT NULL,
    `userAgent` VARCHAR(255) NULL,
    `fields` VARCHAR(255) NULL,
    `loginEmail` VARCHAR(191) NULL,

    INDEX `ActivityLog_createdAt_idx`(`createdAt`),
    INDEX `ActivityLog_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `ActivityLog_producerId_createdAt_idx`(`producerId`, `createdAt`),
    INDEX `ActivityLog_ip_createdAt_idx`(`ip`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ActivityLog` ADD CONSTRAINT `ActivityLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityLog` ADD CONSTRAINT `ActivityLog_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

