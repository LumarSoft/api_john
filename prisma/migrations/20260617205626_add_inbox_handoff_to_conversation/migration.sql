-- AlterTable
ALTER TABLE `Conversation` ADD COLUMN `assignedToUserId` INTEGER NULL,
    ADD COLUMN `botPaused` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `handedOverAt` DATETIME(3) NULL,
    ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'open';

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_assignedToUserId_fkey` FOREIGN KEY (`assignedToUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
