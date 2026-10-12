-- Claim columns move to English. RENAME COLUMN only changes metadata: the data
-- stays in place and the foreign key on policyId follows the column.
SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION';
SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE `Claim`
  RENAME COLUMN `tipo` TO `type`,
  RENAME COLUMN `descripcion` TO `description`,
  RENAME COLUMN `fecha` TO `occurredAt`,
  RENAME COLUMN `estado` TO `status`,
  RENAME COLUMN `nroSiniestroCompania` TO `insurerClaimNumber`,
  RENAME COLUMN `adjuntos` TO `attachments`,
  RENAME COLUMN `polizaId` TO `policyId`;

-- Status values follow the other enums (pending / in_progress / resolved):
-- widen the enum, translate every row, then drop the Spanish values.
ALTER TABLE `Claim` MODIFY `status` ENUM('pendiente', 'en_proceso', 'resuelto', 'pending', 'in_progress', 'resolved') NOT NULL DEFAULT 'pendiente';
UPDATE `Claim` SET `status` = CASE `status` WHEN 'pendiente' THEN 'pending' WHEN 'en_proceso' THEN 'in_progress' WHEN 'resuelto' THEN 'resolved' ELSE `status` END;
ALTER TABLE `Claim` MODIFY `status` ENUM('pending', 'in_progress', 'resolved') NOT NULL DEFAULT 'pending';

-- The foreign key keeps its old name after the column rename; give it the new one.
ALTER TABLE `Claim` DROP FOREIGN KEY `Claim_polizaId_fkey`;
ALTER TABLE `Claim` ADD CONSTRAINT `Claim_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `Policy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;
