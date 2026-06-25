-- AlterTable
ALTER TABLE `Conversation` ADD COLUMN `sessionStartedAt` DATETIME(3) NULL,
    ADD COLUMN `lastMessageAt` DATETIME(3) NULL,
    ADD COLUMN `warnedAt` DATETIME(3) NULL,
    ADD COLUMN `phoneNumberId` VARCHAR(191) NULL;
