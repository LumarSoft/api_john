-- Triunfo errors and credential health (2026-11-01): every failed call to Triunfo grouped by fingerprint, and
-- whether each organization's credentials are being accepted, so an outage is announced. Additive.
-- CreateTable
CREATE TABLE `TriunfoAuthStatus` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `producerId` INTEGER NOT NULL,
    `failingSince` DATETIME(3) NULL,
    `failureMessage` VARCHAR(500) NULL,
    `lastAlertAt` DATETIME(3) NULL,
    `notificationId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `TriunfoAuthStatus_producerId_key`(`producerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TriunfoError` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `producerId` INTEGER NOT NULL,
    `operation` VARCHAR(40) NOT NULL,
    `kind` ENUM('CREDENTIALS_REJECTED', 'REJECTED', 'UNEXPECTED_RESPONSE', 'HTTP_ERROR', 'TIMEOUT', 'NETWORK') NOT NULL,
    `httpStatus` INTEGER NULL,
    `message` VARCHAR(500) NOT NULL,
    `sample` TEXT NULL,
    `fingerprint` CHAR(64) NOT NULL,
    `occurrences` INTEGER NOT NULL DEFAULT 1,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `TriunfoError_fingerprint_key`(`fingerprint`),
    INDEX `TriunfoError_producerId_lastSeenAt_idx`(`producerId`, `lastSeenAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TriunfoAuthStatus` ADD CONSTRAINT `TriunfoAuthStatus_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TriunfoError` ADD CONSTRAINT `TriunfoError_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

