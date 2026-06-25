-- AlterTable: add 'moto' value to RiskType enum on Poliza
ALTER TABLE `Poliza` MODIFY COLUMN `riskType` ENUM('auto', 'moto', 'home', 'life', 'commercial', 'other') NOT NULL DEFAULT 'other';
