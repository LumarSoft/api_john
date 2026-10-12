-- Policy, Vehicle and Installment columns move to English. RENAME COLUMN only
-- changes metadata: the data stays in place and foreign keys follow the column.
SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION';
SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE `Policy`
  RENAME COLUMN `certificado` TO `certificateNumber`,
  RENAME COLUMN `suplemento` TO `endorsementNumber`,
  RENAME COLUMN `movimiento` TO `lastMovement`,
  RENAME COLUMN `vigenciaDesde` TO `validFrom`,
  RENAME COLUMN `vigenciaHasta` TO `validTo`,
  RENAME COLUMN `premio` TO `premium`;

ALTER TABLE `Vehicle`
  RENAME COLUMN `dominio` TO `licensePlate`,
  RENAME COLUMN `marca` TO `brand`,
  RENAME COLUMN `modelo` TO `model`,
  RENAME COLUMN `subModelo` TO `version`,
  RENAME COLUMN `anio` TO `year`,
  RENAME COLUMN `marcaIA` TO `infoautoBrandCode`,
  RENAME COLUMN `modeloIA` TO `infoautoModelCode`,
  RENAME COLUMN `tipo` TO `type`,
  RENAME COLUMN `uso` TO `usage`,
  RENAME COLUMN `cobertura` TO `coverage`,
  RENAME COLUMN `sumaAsegurada` TO `sumInsured`,
  RENAME COLUMN `ceroKm` TO `isZeroKm`,
  RENAME COLUMN `chasis` TO `chassisNumber`,
  RENAME COLUMN `motor` TO `engineNumber`,
  RENAME COLUMN `polizaId` TO `policyId`;

ALTER TABLE `Installment`
  RENAME COLUMN `numeroCuota` TO `number`,
  RENAME COLUMN `polizaId` TO `policyId`;

-- Foreign keys and unique indexes keep their old names after the column renames; give them the new ones.
ALTER TABLE `Installment` DROP FOREIGN KEY `Installment_polizaId_fkey`;
ALTER TABLE `Vehicle` DROP FOREIGN KEY `Vehicle_polizaId_fkey`;
ALTER TABLE `Vehicle` ADD CONSTRAINT `Vehicle_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `Policy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Installment` ADD CONSTRAINT `Installment_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `Policy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Installment` RENAME INDEX `Installment_polizaId_numeroCuota_key` TO `Installment_policyId_number_key`;
ALTER TABLE `Policy` RENAME INDEX `Policy_certificado_producerId_key` TO `Policy_certificateNumber_producerId_key`;
ALTER TABLE `Vehicle` RENAME INDEX `Vehicle_polizaId_key` TO `Vehicle_policyId_key`;

SET FOREIGN_KEY_CHECKS = 1;
