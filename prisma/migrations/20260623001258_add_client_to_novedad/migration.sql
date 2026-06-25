-- AlterTable
ALTER TABLE `Novedad` ADD COLUMN `clientId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `Novedad_clientId_idx` ON `Novedad`(`clientId`);

-- AddForeignKey
ALTER TABLE `Novedad` ADD CONSTRAINT `Novedad_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
