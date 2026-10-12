-- The seven tables still named in Spanish move to English, like the rest of the
-- schema. RENAME TABLE only touches metadata: no rows move, and the foreign keys
-- and indexes follow the table. The statements below just bring the constraint
-- and index names in line with the new table names (MySQL cannot rename a foreign
-- key, so those are dropped and added back under the new name).
-- Columns and relation names keep their names, so the API's JSON does not change.

RENAME TABLE `Poliza` TO `Policy`, `Cuota` TO `Installment`, `Vehiculo` TO `Vehicle`, `Siniestro` TO `Claim`, `Novedad` TO `Notification`, `Cotizacion` TO `Quote`, `Solicitud` TO `QuoteRequest`;

-- DropForeignKey
ALTER TABLE `Claim` DROP FOREIGN KEY `Siniestro_clientId_fkey`;

-- DropForeignKey
ALTER TABLE `Claim` DROP FOREIGN KEY `Siniestro_polizaId_fkey`;

-- DropForeignKey
ALTER TABLE `Claim` DROP FOREIGN KEY `Siniestro_producerCodeId_fkey`;

-- DropForeignKey
ALTER TABLE `Claim` DROP FOREIGN KEY `Siniestro_producerId_fkey`;

-- DropForeignKey
ALTER TABLE `Installment` DROP FOREIGN KEY `Cuota_polizaId_fkey`;

-- DropForeignKey
ALTER TABLE `Notification` DROP FOREIGN KEY `Novedad_clientId_fkey`;

-- DropForeignKey
ALTER TABLE `Notification` DROP FOREIGN KEY `Novedad_producerCodeId_fkey`;

-- DropForeignKey
ALTER TABLE `Notification` DROP FOREIGN KEY `Novedad_producerId_fkey`;

-- DropForeignKey
ALTER TABLE `Policy` DROP FOREIGN KEY `Poliza_clientId_fkey`;

-- DropForeignKey
ALTER TABLE `Policy` DROP FOREIGN KEY `Poliza_producerCodeId_fkey`;

-- DropForeignKey
ALTER TABLE `Policy` DROP FOREIGN KEY `Poliza_producerId_fkey`;

-- DropForeignKey
ALTER TABLE `Quote` DROP FOREIGN KEY `Cotizacion_producerCodeId_fkey`;

-- DropForeignKey
ALTER TABLE `Quote` DROP FOREIGN KEY `Cotizacion_producerId_fkey`;

-- DropForeignKey
ALTER TABLE `Quote` DROP FOREIGN KEY `Cotizacion_userId_fkey`;

-- DropForeignKey
ALTER TABLE `QuoteRequest` DROP FOREIGN KEY `Solicitud_cotizacionId_fkey`;

-- DropForeignKey
ALTER TABLE `Vehicle` DROP FOREIGN KEY `Vehiculo_polizaId_fkey`;

-- AddForeignKey
ALTER TABLE `Policy` ADD CONSTRAINT `Policy_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Policy` ADD CONSTRAINT `Policy_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Policy` ADD CONSTRAINT `Policy_producerCodeId_fkey` FOREIGN KEY (`producerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Vehicle` ADD CONSTRAINT `Vehicle_polizaId_fkey` FOREIGN KEY (`polizaId`) REFERENCES `Policy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Installment` ADD CONSTRAINT `Installment_polizaId_fkey` FOREIGN KEY (`polizaId`) REFERENCES `Policy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Claim` ADD CONSTRAINT `Claim_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Claim` ADD CONSTRAINT `Claim_polizaId_fkey` FOREIGN KEY (`polizaId`) REFERENCES `Policy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Claim` ADD CONSTRAINT `Claim_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Claim` ADD CONSTRAINT `Claim_producerCodeId_fkey` FOREIGN KEY (`producerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_producerCodeId_fkey` FOREIGN KEY (`producerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Quote` ADD CONSTRAINT `Quote_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Quote` ADD CONSTRAINT `Quote_producerCodeId_fkey` FOREIGN KEY (`producerCodeId`) REFERENCES `ProducerCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Quote` ADD CONSTRAINT `Quote_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuoteRequest` ADD CONSTRAINT `QuoteRequest_cotizacionId_fkey` FOREIGN KEY (`cotizacionId`) REFERENCES `Quote`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `Claim` RENAME INDEX `Siniestro_producerCodeId_idx` TO `Claim_producerCodeId_idx`;

-- RenameIndex
ALTER TABLE `Installment` RENAME INDEX `Cuota_polizaId_numeroCuota_key` TO `Installment_polizaId_numeroCuota_key`;

-- RenameIndex
ALTER TABLE `Notification` RENAME INDEX `Novedad_clientId_idx` TO `Notification_clientId_idx`;

-- RenameIndex
ALTER TABLE `Notification` RENAME INDEX `Novedad_producerCodeId_idx` TO `Notification_producerCodeId_idx`;

-- RenameIndex
ALTER TABLE `Notification` RENAME INDEX `Novedad_producerId_readAt_idx` TO `Notification_producerId_readAt_idx`;

-- RenameIndex
ALTER TABLE `Notification` RENAME INDEX `Novedad_producerId_status_category_createdAt_idx` TO `Notification_producerId_status_category_createdAt_idx`;

-- RenameIndex
ALTER TABLE `Notification` RENAME INDEX `Novedad_producerId_type_createdAt_idx` TO `Notification_producerId_type_createdAt_idx`;

-- RenameIndex
ALTER TABLE `Policy` RENAME INDEX `Poliza_certificado_producerId_key` TO `Policy_certificado_producerId_key`;

-- RenameIndex
ALTER TABLE `Policy` RENAME INDEX `Poliza_producerCodeId_idx` TO `Policy_producerCodeId_idx`;

-- RenameIndex
ALTER TABLE `Quote` RENAME INDEX `Cotizacion_producerCodeId_idx` TO `Quote_producerCodeId_idx`;

-- RenameIndex
ALTER TABLE `Quote` RENAME INDEX `Cotizacion_quoteNumber_key` TO `Quote_quoteNumber_key`;

-- RenameIndex
ALTER TABLE `QuoteRequest` RENAME INDEX `Solicitud_cotizacionId_key` TO `QuoteRequest_cotizacionId_key`;

-- RenameIndex
ALTER TABLE `Vehicle` RENAME INDEX `Vehiculo_polizaId_key` TO `Vehicle_polizaId_key`;

