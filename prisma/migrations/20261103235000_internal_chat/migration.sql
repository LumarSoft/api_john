-- Internal chat between the panel users of an organization (2026-11-03): one team chat per organization and
-- one direct chat per pair, with how far each person has read. Additive.
-- CreateTable
CREATE TABLE `InternalChat` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` ENUM('TEAM', 'DIRECT') NOT NULL,
    `key` VARCHAR(40) NOT NULL,
    `lastMessageAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `producerId` INTEGER NOT NULL,

    UNIQUE INDEX `InternalChat_producerId_key_key`(`producerId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InternalChatMember` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `lastReadMessageId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `chatId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,

    INDEX `InternalChatMember_userId_idx`(`userId`),
    UNIQUE INDEX `InternalChatMember_chatId_userId_key`(`chatId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InternalChatMessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,
    `chatId` INTEGER NOT NULL,
    `senderId` INTEGER NOT NULL,

    INDEX `InternalChatMessage_chatId_id_idx`(`chatId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `InternalChat` ADD CONSTRAINT `InternalChat_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InternalChatMember` ADD CONSTRAINT `InternalChatMember_chatId_fkey` FOREIGN KEY (`chatId`) REFERENCES `InternalChat`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InternalChatMember` ADD CONSTRAINT `InternalChatMember_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InternalChatMessage` ADD CONSTRAINT `InternalChatMessage_chatId_fkey` FOREIGN KEY (`chatId`) REFERENCES `InternalChat`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InternalChatMessage` ADD CONSTRAINT `InternalChatMessage_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

