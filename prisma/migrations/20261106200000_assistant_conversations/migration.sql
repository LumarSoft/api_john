-- CreateTable
CREATE TABLE `AssistantConversation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(120) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `producerId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,

    INDEX `AssistantConversation_userId_producerId_updatedAt_idx`(`userId`, `producerId`, `updatedAt`),
    INDEX `AssistantConversation_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantMessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `role` ENUM('USER', 'ASSISTANT') NOT NULL,
    `content` TEXT NOT NULL,
    `blocks` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,
    `conversationId` INTEGER NOT NULL,

    INDEX `AssistantMessage_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssistantAction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(60) NOT NULL,
    `payload` JSON NOT NULL,
    `preview` JSON NOT NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'CANCELLED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `result` JSON NULL,
    `error` VARCHAR(500) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `executedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `conversationId` INTEGER NOT NULL,
    `producerId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,

    INDEX `AssistantAction_conversationId_idx`(`conversationId`),
    INDEX `AssistantAction_userId_status_idx`(`userId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AssistantConversation` ADD CONSTRAINT `AssistantConversation_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantConversation` ADD CONSTRAINT `AssistantConversation_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantMessage` ADD CONSTRAINT `AssistantMessage_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `AssistantConversation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantAction` ADD CONSTRAINT `AssistantAction_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `AssistantConversation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantAction` ADD CONSTRAINT `AssistantAction_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssistantAction` ADD CONSTRAINT `AssistantAction_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

