-- CreateTable
CREATE TABLE `Solicitud` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cotizacionId` INTEGER NOT NULL,
    `selectedCoverage` VARCHAR(191) NOT NULL,
    `coverageStartDate` DATETIME(3) NOT NULL,
    `applicantType` VARCHAR(191) NOT NULL,
    `applicantFirstName` VARCHAR(191) NOT NULL,
    `applicantLastName` VARCHAR(191) NULL,
    `applicantEmail` VARCHAR(191) NOT NULL,
    `applicantPhone` VARCHAR(191) NOT NULL,
    `applicantBirthDate` DATETIME(3) NULL,
    `applicantDocType` VARCHAR(191) NOT NULL,
    `applicantDocNumber` VARCHAR(191) NOT NULL,
    `applicantAddress` VARCHAR(191) NOT NULL,
    `paymentMethod` VARCHAR(191) NOT NULL,
    `cardCompany` VARCHAR(191) NULL,
    `cardNumber` VARCHAR(191) NULL,
    `cardExpiry` VARCHAR(191) NULL,
    `cardHolder` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Solicitud_cotizacionId_key`(`cotizacionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Solicitud` ADD CONSTRAINT `Solicitud_cotizacionId_fkey` FOREIGN KEY (`cotizacionId`) REFERENCES `Cotizacion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
