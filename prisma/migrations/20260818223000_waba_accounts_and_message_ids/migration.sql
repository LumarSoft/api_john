-- Embedded Signup stores one encrypted customer token per WABA. PhoneNumber is
-- linked to it so the bot can resolve the correct token for each tenant.
CREATE TABLE `WabaAccount` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `wabaId` VARCHAR(64) NOT NULL,
    `producerId` INTEGER NOT NULL,
    `accessToken` TEXT NOT NULL,
    `tokenExpiresAt` DATETIME(3) NULL,
    `isCoexistence` BOOLEAN NOT NULL DEFAULT false,
    `disconnectedAt` DATETIME(3) NULL,
    `disconnectReason` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WabaAccount_wabaId_key`(`wabaId`),
    INDEX `WabaAccount_producerId_idx`(`producerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PhoneNumber` ADD COLUMN `wabaAccountId` INTEGER NULL;
CREATE INDEX `PhoneNumber_wabaAccountId_idx` ON `PhoneNumber`(`wabaAccountId`);

-- Nullable keeps all existing transcript rows valid. New Coexistence echoes use
-- the wamid to make webhook delivery idempotent.
ALTER TABLE `Message` ADD COLUMN `waMessageId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `Message_waMessageId_key` ON `Message`(`waMessageId`);

ALTER TABLE `WabaAccount` ADD CONSTRAINT `WabaAccount_producerId_fkey`
  FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PhoneNumber` ADD CONSTRAINT `PhoneNumber_wabaAccountId_fkey`
  FOREIGN KEY (`wabaAccountId`) REFERENCES `WabaAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
