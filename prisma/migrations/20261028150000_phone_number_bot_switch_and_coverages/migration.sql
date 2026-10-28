-- A number's own bot switch and its view of the organization's coverages.
-- The defaults keep every existing number as it is: switched on and offering
-- the organization's coverages.
ALTER TABLE `PhoneNumber`
    ADD COLUMN `botEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `coverageSettings` JSON NULL;

-- The number a bot switch flip was for; null = the organization-wide switch.
ALTER TABLE `BotStatusChange` ADD COLUMN `phoneNumberId` INTEGER NULL;
CREATE INDEX `BotStatusChange_phoneNumberId_idx` ON `BotStatusChange`(`phoneNumberId`);
ALTER TABLE `BotStatusChange` ADD CONSTRAINT `BotStatusChange_phoneNumberId_fkey` FOREIGN KEY (`phoneNumberId`) REFERENCES `PhoneNumber`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
