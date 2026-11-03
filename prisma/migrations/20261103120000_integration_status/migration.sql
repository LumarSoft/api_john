-- Integration status (2026-11-03): the latest state of each external service the platform calls (Triunfo's web
-- services, InfoAuto's catalogs) and every stretch of time one of them failed, for the panel's Status section. Additive.
-- CreateTable
CREATE TABLE `IntegrationComponent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(60) NOT NULL,
    `lastSuccessAt` DATETIME(3) NULL,
    `lastFailureAt` DATETIME(3) NULL,
    `openIncidentId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `IntegrationComponent_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IntegrationIncident` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `componentId` INTEGER NOT NULL,
    `kind` ENUM('CREDENTIALS_REJECTED', 'UNEXPECTED_RESPONSE', 'HTTP_ERROR', 'TIMEOUT', 'NETWORK') NOT NULL,
    `httpStatus` INTEGER NULL,
    `message` VARCHAR(500) NOT NULL,
    `sample` TEXT NULL,
    `failures` INTEGER NOT NULL DEFAULT 1,
    `startedAt` DATETIME(3) NOT NULL,
    `lastFailureAt` DATETIME(3) NOT NULL,
    `endedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `IntegrationIncident_componentId_endedAt_idx`(`componentId`, `endedAt`),
    INDEX `IntegrationIncident_startedAt_idx`(`startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `IntegrationIncident` ADD CONSTRAINT `IntegrationIncident_componentId_fkey` FOREIGN KEY (`componentId`) REFERENCES `IntegrationComponent`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
