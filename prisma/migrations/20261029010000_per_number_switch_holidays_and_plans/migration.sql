-- 1. The bot switch is per number only. An organization whose switch was off
--    passes that state to each of its numbers before the column goes away.
UPDATE `PhoneNumber` n
  JOIN `Producer` p ON p.`id` = n.`producerId`
  SET n.`botEnabled` = false
  WHERE p.`botEnabled` = false;

ALTER TABLE `Producer` DROP COLUMN `botEnabled`;

-- 2. Nobody assigns a plan to a number any more: each month a number is placed
--    on the smallest plan of the catalog that covers the tokens it sent.
ALTER TABLE `PhoneNumber` DROP FOREIGN KEY `PhoneNumber_tokenPlanId_fkey`;
ALTER TABLE `PhoneNumber` DROP COLUMN `tokenPlanId`;

-- 3. Holidays and closures belong to a number: a branch's closure never closes
--    the others. Every organization-wide closure (national holidays included,
--    and the ones an admin had removed, so the sync does not bring them back)
--    is copied into each number of its organization, then retired.
ALTER TABLE `BusinessClosure` ADD COLUMN `phoneNumberId` INTEGER NULL;
CREATE INDEX `BusinessClosure_phoneNumberId_startDate_endDate_idx` ON `BusinessClosure`(`phoneNumberId`, `startDate`, `endDate`);
ALTER TABLE `BusinessClosure` ADD CONSTRAINT `BusinessClosure_phoneNumberId_fkey` FOREIGN KEY (`phoneNumberId`) REFERENCES `PhoneNumber`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO `BusinessClosure` (`startDate`, `endDate`, `reason`, `source`, `createdAt`, `updatedAt`, `deletedAt`, `producerId`, `phoneNumberId`)
SELECT c.`startDate`, c.`endDate`, c.`reason`, c.`source`, c.`createdAt`, NOW(3), c.`deletedAt`, c.`producerId`, n.`id`
  FROM `BusinessClosure` c
  JOIN `PhoneNumber` n ON n.`producerId` = c.`producerId` AND n.`deletedAt` IS NULL
  WHERE c.`phoneNumberId` IS NULL;

UPDATE `BusinessClosure` SET `deletedAt` = COALESCE(`deletedAt`, NOW(3)) WHERE `phoneNumberId` IS NULL;
