-- Cost tracking (OpenAI tokens + Meta conversations) per phone number per month,
-- plus a per-number monthly budget cap used to disable the paid LLM when crossed.

-- ── PhoneNumber budget fields ──────────────────────────────────────────────
ALTER TABLE `PhoneNumber` ADD COLUMN `monthlyBudgetUsd` DECIMAL(10, 2) NULL;
ALTER TABLE `PhoneNumber` ADD COLUMN `budgetExceededAt` DATETIME(3) NULL;

-- ── UsageMonthly aggregate ─────────────────────────────────────────────────
CREATE TABLE `UsageMonthly` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `period` VARCHAR(7) NOT NULL,
    `openaiInputTokens` INTEGER NOT NULL DEFAULT 0,
    `openaiOutputTokens` INTEGER NOT NULL DEFAULT 0,
    `openaiCostUsd` DECIMAL(12, 6) NOT NULL DEFAULT 0,
    `metaConversations` INTEGER NOT NULL DEFAULT 0,
    `metaCostUsd` DECIMAL(12, 6) NOT NULL DEFAULT 0,
    `totalCostUsd` DECIMAL(12, 6) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `producerId` INTEGER NOT NULL,
    `producerCodeId` INTEGER NULL,
    `phoneNumberId` INTEGER NOT NULL,

    UNIQUE INDEX `UsageMonthly_period_phoneNumberId_key`(`period`, `phoneNumberId`),
    INDEX `UsageMonthly_producerId_period_idx`(`producerId`, `period`),
    INDEX `UsageMonthly_producerCodeId_period_idx`(`producerCodeId`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `UsageMonthly` ADD CONSTRAINT `UsageMonthly_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `UsageMonthly` ADD CONSTRAINT `UsageMonthly_producerCodeId_fkey` FOREIGN KEY (`producerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `UsageMonthly` ADD CONSTRAINT `UsageMonthly_phoneNumberId_fkey` FOREIGN KEY (`phoneNumberId`) REFERENCES `PhoneNumber`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
