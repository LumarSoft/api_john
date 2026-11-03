-- AI explanation of each integration incident (2026-11-03): what is failing and whose fault it is, as the AI model
-- reads the failure, for the Status section. Additive.
-- AlterTable
ALTER TABLE `IntegrationIncident` ADD COLUMN `aiBlame` ENUM('PROVIDER', 'PLATFORM', 'UNKNOWN') NULL,
    ADD COLUMN `aiBlameReason` VARCHAR(300) NULL,
    ADD COLUMN `aiExplainedAt` DATETIME(3) NULL,
    ADD COLUMN `aiExplainedFor` VARCHAR(40) NULL,
    ADD COLUMN `aiExplanation` VARCHAR(600) NULL;
