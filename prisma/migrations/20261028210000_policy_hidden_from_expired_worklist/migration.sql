-- A policy the office took out of the "pólizas vencidas" worklist by hand,
-- because it will not be renewed (vehicle sold, insured elsewhere…). The
-- cartera sync never writes these columns, so the choice survives novedades.
ALTER TABLE `Policy`
  ADD COLUMN `hiddenAt` DATETIME(3) NULL,
  ADD COLUMN `hiddenReason` VARCHAR(191) NULL,
  ADD COLUMN `hiddenById` INTEGER NULL;

ALTER TABLE `Policy` ADD CONSTRAINT `Policy_hiddenById_fkey` FOREIGN KEY (`hiddenById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
