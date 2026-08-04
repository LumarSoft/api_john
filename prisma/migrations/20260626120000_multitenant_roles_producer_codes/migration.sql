-- Multi-tenant hierarchy: Organization (Producer) → ProducerCode → cartera.
-- Adds roles (SUPERADMIN/ADMIN), producer codes, code-level scoping columns and
-- phone-number billing attribution. Additive & non-destructive.
--
-- NOTE on `User.role`: the column is converted VARCHAR → ENUM. Existing rows hold
-- 'admin'/'empleado', which are NOT valid enum members, so we normalize them to
-- 'ADMIN' BEFORE the ALTER to avoid "Data truncated for column 'role'". The actual
-- SuperAdmin is promoted later by the seed (or manually).

-- ── 0. Normalize legacy role values, then convert to enum ──────────────────
UPDATE `User` SET `role` = 'ADMIN' WHERE `role` IS NULL OR `role` NOT IN ('SUPERADMIN', 'ADMIN');
ALTER TABLE `User` MODIFY `role` ENUM('SUPERADMIN', 'ADMIN') NOT NULL DEFAULT 'ADMIN';

-- ── 1. Organization master code ───────────────────────────────────────────
ALTER TABLE `Producer` ADD COLUMN `masterCode` VARCHAR(20) NULL;

-- ── 2. ProducerCode (Triunfo agent code) ──────────────────────────────────
CREATE TABLE `ProducerCode` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(20) NOT NULL,
    `holderName` VARCHAR(191) NULL,
    `isMaster` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `triunfoUsuario` VARCHAR(191) NULL,
    `triunfoPassword` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `producerId` INTEGER NOT NULL,

    UNIQUE INDEX `ProducerCode_producerId_code_key`(`producerId`, `code`),
    INDEX `ProducerCode_producerId_isActive_idx`(`producerId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── 3. UserProducerCode (visibility grants) ───────────────────────────────
CREATE TABLE `UserProducerCode` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `producerCodeId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `UserProducerCode_userId_producerCodeId_key`(`userId`, `producerCodeId`),
    INDEX `UserProducerCode_producerCodeId_idx`(`producerCodeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── 4. PhoneNumberProducerCode (number serves N codes) ────────────────────
CREATE TABLE `PhoneNumberProducerCode` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `phoneNumberId` INTEGER NOT NULL,
    `producerCodeId` INTEGER NOT NULL,

    UNIQUE INDEX `PhoneNumberProducerCode_phoneNumberId_producerCodeId_key`(`phoneNumberId`, `producerCodeId`),
    INDEX `PhoneNumberProducerCode_producerCodeId_idx`(`producerCodeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── 5. PhoneNumber billing attribution ────────────────────────────────────
ALTER TABLE `PhoneNumber` ADD COLUMN `responsibleProducerCodeId` INTEGER NULL;
CREATE INDEX `PhoneNumber_responsibleProducerCodeId_idx` ON `PhoneNumber`(`responsibleProducerCodeId`);

-- ── 6. Code-level scoping columns on cartera/derived entities ──────────────
ALTER TABLE `Client` ADD COLUMN `producerCodeId` INTEGER NULL;
CREATE INDEX `Client_producerCodeId_idx` ON `Client`(`producerCodeId`);

ALTER TABLE `Poliza` ADD COLUMN `producerCodeId` INTEGER NULL;
CREATE INDEX `Poliza_producerCodeId_idx` ON `Poliza`(`producerCodeId`);

ALTER TABLE `Cotizacion` ADD COLUMN `producerCodeId` INTEGER NULL;
CREATE INDEX `Cotizacion_producerCodeId_idx` ON `Cotizacion`(`producerCodeId`);

ALTER TABLE `Siniestro` ADD COLUMN `producerCodeId` INTEGER NULL;
CREATE INDEX `Siniestro_producerCodeId_idx` ON `Siniestro`(`producerCodeId`);

ALTER TABLE `ContactLead` ADD COLUMN `producerCodeId` INTEGER NULL;
CREATE INDEX `ContactLead_producerCodeId_idx` ON `ContactLead`(`producerCodeId`);

ALTER TABLE `Conversation` ADD COLUMN `producerCodeId` INTEGER NULL;
CREATE INDEX `Conversation_producerCodeId_idx` ON `Conversation`(`producerCodeId`);

ALTER TABLE `Novedad` ADD COLUMN `producerCodeId` INTEGER NULL;
CREATE INDEX `Novedad_producerCodeId_idx` ON `Novedad`(`producerCodeId`);

-- ── 7. Foreign keys ───────────────────────────────────────────────────────
ALTER TABLE `ProducerCode` ADD CONSTRAINT `ProducerCode_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `UserProducerCode` ADD CONSTRAINT `UserProducerCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `UserProducerCode` ADD CONSTRAINT `UserProducerCode_producerCodeId_fkey` FOREIGN KEY (`producerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PhoneNumberProducerCode` ADD CONSTRAINT `PhoneNumberProducerCode_phoneNumberId_fkey` FOREIGN KEY (`phoneNumberId`) REFERENCES `PhoneNumber`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PhoneNumberProducerCode` ADD CONSTRAINT `PhoneNumberProducerCode_producerCodeId_fkey` FOREIGN KEY (`producerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PhoneNumber` ADD CONSTRAINT `PhoneNumber_responsibleProducerCodeId_fkey` FOREIGN KEY (`responsibleProducerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Client` ADD CONSTRAINT `Client_producerCodeId_fkey` FOREIGN KEY (`producerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Poliza` ADD CONSTRAINT `Poliza_producerCodeId_fkey` FOREIGN KEY (`producerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Cotizacion` ADD CONSTRAINT `Cotizacion_producerCodeId_fkey` FOREIGN KEY (`producerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Siniestro` ADD CONSTRAINT `Siniestro_producerCodeId_fkey` FOREIGN KEY (`producerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ContactLead` ADD CONSTRAINT `ContactLead_producerCodeId_fkey` FOREIGN KEY (`producerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_producerCodeId_fkey` FOREIGN KEY (`producerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Novedad` ADD CONSTRAINT `Novedad_producerCodeId_fkey` FOREIGN KEY (`producerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
