-- Per-organization bot profile (how the bot names the org, grúa and claims
-- lines, transfer account, where to pay cash). A nullable JSON column, so
-- adding it does not rebuild the table.
ALTER TABLE `Producer` ADD COLUMN `botProfile` JSON NULL;

-- CreateTable
CREATE TABLE `TriunfoCredential` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `producerId` INTEGER NOT NULL,
    `productor` VARCHAR(20) NOT NULL,
    `username` VARCHAR(100) NOT NULL,
    `password` TEXT NOT NULL,
    `verifiedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `TriunfoCredential_producerId_key`(`producerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TriunfoCredential` ADD CONSTRAINT `TriunfoCredential_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- JPMG keeps saying exactly what the bot said until now: these are the values
-- that were written in the bot's code (and its TOW_TRUCK_PHONE setting).
-- Triunfo credentials are not copied: JPMG keeps using the TRIUNFO_* settings.
UPDATE `Producer`
SET `botProfile` = JSON_OBJECT(
    'orgName', 'John Pellegrini Management Group',
    'orgShortName', 'JPMG',
    'orgLegalName', 'John Pellegrini Management Group SRL',
    'towTruckPhone', '3415690470',
    'claimsPhone', '0810-666-0302',
    'cashPaymentPlaces', 'Rapipago, Pago Fácil o Santa Fe Servicios',
    'transferAlias', 'TRUENO.VUELO.DELTA',
    'transferCbu', '0070081820000004432793',
    'transferHolder', 'Triunfo Coop. de Seguros Ltda. (CUIT 30-50006577-6)',
    'transferBank', 'Banco Galicia'
)
WHERE `slug` = 'john' AND `botProfile` IS NULL;
