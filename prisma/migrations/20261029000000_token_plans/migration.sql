-- Token plans an organization offers its numbers (Facturación): a size in
-- tokens, costing the organization the platform's fixed unit price (USD 0.05:
-- 500 = USD 25, 1.000 = USD 50) and sold to its productores at priceUsd, which
-- the SuperAdmin sets and can never be below that cost.
CREATE TABLE `TokenPlan` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(60) NOT NULL,
    `tokens` INTEGER NOT NULL,
    `priceUsd` DECIMAL(10, 2) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `producerId` INTEGER NOT NULL,

    INDEX `TokenPlan_producerId_isActive_sortOrder_idx`(`producerId`, `isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TokenPlan` ADD CONSTRAINT `TokenPlan_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- The plan each number is on (null = the organization's smallest) and the free
-- tokens of a new account's first month ("Prueba"; 0 for every number that
-- exists today, since no current account is new).
ALTER TABLE `PhoneNumber`
  ADD COLUMN `tokenPlanId` INTEGER NULL,
  ADD COLUMN `trialTokens` INTEGER NOT NULL DEFAULT 0;

ALTER TABLE `PhoneNumber` ADD CONSTRAINT `PhoneNumber_tokenPlanId_fkey` FOREIGN KEY (`tokenPlanId`) REFERENCES `TokenPlan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Every organization starts with the same catalog: 500 and 1.000 tokens at
-- USD 0.05 each, sold at cost until the SuperAdmin sets its own prices. Past
-- 1.000 the month is billed in blocks of 1.000.
INSERT INTO `TokenPlan` (`name`, `tokens`, `priceUsd`, `isActive`, `sortOrder`, `updatedAt`, `producerId`)
SELECT 'Inicial', 500, 25.00, true, 0, NOW(3), p.`id` FROM `Producer` p WHERE p.`deletedAt` IS NULL;
INSERT INTO `TokenPlan` (`name`, `tokens`, `priceUsd`, `isActive`, `sortOrder`, `updatedAt`, `producerId`)
SELECT 'Profesional', 1000, 50.00, true, 1, NOW(3), p.`id` FROM `Producer` p WHERE p.`deletedAt` IS NULL;
