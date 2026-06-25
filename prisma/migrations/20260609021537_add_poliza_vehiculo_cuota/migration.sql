-- CreateTable
CREATE TABLE `Poliza` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `certificado` VARCHAR(191) NOT NULL,
    `suplemento` INTEGER NOT NULL DEFAULT 0,
    `company` VARCHAR(191) NOT NULL,
    `riskType` ENUM('auto', 'home', 'life', 'commercial', 'other') NOT NULL DEFAULT 'other',
    `status` VARCHAR(191) NOT NULL,
    `vigenciaDesde` DATETIME(3) NULL,
    `vigenciaHasta` DATETIME(3) NULL,
    `premio` DECIMAL(12, 2) NULL,
    `paymentMethod` VARCHAR(191) NULL,
    `rawData` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `clientId` INTEGER NOT NULL,
    `producerId` INTEGER NOT NULL,

    UNIQUE INDEX `Poliza_certificado_producerId_key`(`certificado`, `producerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Vehiculo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dominio` VARCHAR(191) NULL,
    `marca` VARCHAR(191) NULL,
    `modelo` VARCHAR(191) NULL,
    `subModelo` VARCHAR(191) NULL,
    `anio` INTEGER NULL,
    `tipo` VARCHAR(191) NULL,
    `uso` VARCHAR(191) NULL,
    `cobertura` VARCHAR(191) NULL,
    `sumaAsegurada` DECIMAL(14, 2) NULL,
    `ceroKm` BOOLEAN NOT NULL DEFAULT false,
    `chasis` VARCHAR(191) NULL,
    `motor` VARCHAR(191) NULL,
    `deletedAt` DATETIME(3) NULL,
    `polizaId` INTEGER NOT NULL,

    UNIQUE INDEX `Vehiculo_polizaId_key`(`polizaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Cuota` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `numeroCuota` INTEGER NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `dueDate` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `deletedAt` DATETIME(3) NULL,
    `polizaId` INTEGER NOT NULL,

    UNIQUE INDEX `Cuota_polizaId_numeroCuota_key`(`polizaId`, `numeroCuota`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Poliza` ADD CONSTRAINT `Poliza_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Poliza` ADD CONSTRAINT `Poliza_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Vehiculo` ADD CONSTRAINT `Vehiculo_polizaId_fkey` FOREIGN KEY (`polizaId`) REFERENCES `Poliza`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Cuota` ADD CONSTRAINT `Cuota_polizaId_fkey` FOREIGN KEY (`polizaId`) REFERENCES `Poliza`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
