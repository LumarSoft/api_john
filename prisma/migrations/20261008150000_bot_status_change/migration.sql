-- Audit trail of the organization-wide bot switch: who turned the bot on/off and when.
CREATE TABLE `BotStatusChange` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `botEnabled` BOOLEAN NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,
    `producerId` INTEGER NOT NULL,
    `userId` INTEGER NULL,

    INDEX `BotStatusChange_producerId_createdAt_idx`(`producerId`, `createdAt`),
    INDEX `BotStatusChange_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `BotStatusChange` ADD CONSTRAINT `BotStatusChange_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BotStatusChange` ADD CONSTRAINT `BotStatusChange_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
