-- Billing v3 (2026-10-30): one catalog of message plans for the whole platform,
-- edited only by the OWNER, and a plan assigned to each number by the SuperAdmin.
-- Additive: nothing is dropped, so the previous API keeps working against this
-- database (its per-organization rows are left as they are and the new code
-- never reads them).

-- 1. A plan of the platform's catalog belongs to no organization.
ALTER TABLE `TokenPlan` DROP FOREIGN KEY `TokenPlan_producerId_fkey`;
ALTER TABLE `TokenPlan`
  ADD COLUMN `isTrial` BOOLEAN NOT NULL DEFAULT false,
  MODIFY `producerId` INTEGER NULL;
ALTER TABLE `TokenPlan` ADD CONSTRAINT `TokenPlan_producerId_fkey` FOREIGN KEY (`producerId`) REFERENCES `Producer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX `TokenPlan_isActive_sortOrder_idx` ON `TokenPlan`(`isActive`, `sortOrder`);

-- 2. The plan each number is on (null = the smallest paid plan of the catalog), and
--    when it last moved up a plan on its own.
ALTER TABLE `PhoneNumber`
  ADD COLUMN `planId` INTEGER NULL,
  ADD COLUMN `planUpgradedAt` DATETIME(3) NULL;
CREATE INDEX `PhoneNumber_planId_idx` ON `PhoneNumber`(`planId`);
ALTER TABLE `PhoneNumber` ADD CONSTRAINT `PhoneNumber_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `TokenPlan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. The platform's first catalog; the OWNER edits it from Facturación → Planes.
--    Prueba is the free first month of a new account's number.
INSERT INTO `TokenPlan` (`name`, `tokens`, `priceUsd`, `isTrial`, `isActive`, `sortOrder`, `updatedAt`, `producerId`)
VALUES
  ('Prueba', 100, 0.00, true, true, 0, NOW(3), NULL),
  ('Inicial', 500, 25.00, false, true, 1, NOW(3), NULL),
  ('Profesional', 1000, 50.00, false, true, 2, NOW(3), NULL);

-- 4. Numbers that had the free first-month tokens of the previous billing keep
--    their trial as the Prueba plan; every other number starts on the smallest
--    paid plan (planId null).
UPDATE `PhoneNumber` n
  JOIN `TokenPlan` t ON t.`isTrial` = true AND t.`producerId` IS NULL AND t.`deletedAt` IS NULL
  SET n.`planId` = t.`id`
  WHERE n.`trialTokens` > 0 AND n.`deletedAt` IS NULL;
