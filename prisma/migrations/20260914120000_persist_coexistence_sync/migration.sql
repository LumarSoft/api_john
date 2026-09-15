-- Persist the two one-way data streams delivered by WhatsApp Coexistence:
-- historical messages and the WhatsApp Business app address book.
ALTER TABLE `PhoneNumber`
  ADD COLUMN `historyLastSyncedAt` DATETIME(3) NULL,
  ADD COLUMN `contactsLastSyncedAt` DATETIME(3) NULL;

ALTER TABLE `Message`
  ADD COLUMN `source` VARCHAR(20) NOT NULL DEFAULT 'live',
  ADD COLUMN `rawData` JSON NULL;

CREATE INDEX `Message_source_createdAt_idx` ON `Message`(`source`, `createdAt`);

CREATE TABLE `WhatsAppContact` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `phone` VARCHAR(32) NOT NULL,
    `waId` VARCHAR(32) NULL,
    `fullName` VARCHAR(191) NULL,
    `firstName` VARCHAR(120) NULL,
    `lastAction` VARCHAR(20) NULL,
    `sourceUpdatedAt` DATETIME(3) NULL,
    `rawData` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `phoneNumberId` INTEGER NOT NULL,

    UNIQUE INDEX `WhatsAppContact_phoneNumberId_phone_key`(`phoneNumberId`, `phone`),
    INDEX `WhatsAppContact_phoneNumberId_deletedAt_idx`(`phoneNumberId`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WhatsAppContact` ADD CONSTRAINT `WhatsAppContact_phoneNumberId_fkey`
  FOREIGN KEY (`phoneNumberId`) REFERENCES `PhoneNumber`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
