-- Marks closures loaded automatically from the national holiday calendar.
-- AlterTable
ALTER TABLE `BusinessClosure` ADD COLUMN `source` VARCHAR(16) NULL;

-- CreateIndex
CREATE INDEX `BusinessClosure_source_startDate_idx` ON `BusinessClosure`(`source`, `startDate`);

