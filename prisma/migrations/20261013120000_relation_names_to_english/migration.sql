-- The last two Spanish columns move to English (the rest of this change only
-- renames Prisma relations, which do not exist in the database). RENAME COLUMN
-- only changes metadata: the data stays in place and foreign keys follow the column.
SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION';
SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE `QuoteRequest` RENAME COLUMN `cotizacionId` TO `quoteId`;
ALTER TABLE `User` RENAME COLUMN `lastNovedadesVisitAt` TO `lastNotificationsVisitAt`;

-- The foreign key and unique index keep their old names after the column rename; give them the new ones.
ALTER TABLE `QuoteRequest` DROP FOREIGN KEY `QuoteRequest_cotizacionId_fkey`;
ALTER TABLE `QuoteRequest` ADD CONSTRAINT `QuoteRequest_quoteId_fkey` FOREIGN KEY (`quoteId`) REFERENCES `Quote`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `QuoteRequest` RENAME INDEX `QuoteRequest_cotizacionId_key` TO `QuoteRequest_quoteId_key`;

SET FOREIGN_KEY_CHECKS = 1;
