-- Mejora de coberturas (2026-11-10): the coverage the vehicle had when the
-- opportunity opened, so a later, better coverage counts as the sale even when
-- both are coverages the campaign lists (C2 → C2 Full → D3).
-- Additive and nullable: the previous API ignores the column.

-- AlterTable
ALTER TABLE `SalesOpportunity` ADD COLUMN `coverageAtContact` VARCHAR(20) NULL;
