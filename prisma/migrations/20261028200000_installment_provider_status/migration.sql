-- Triunfo's own cuota state ("PENDIENTE", "PAGADA", "ANULADA", "EN
-- PRELIQUIDACIÓN"…). The sync only knew PAGADA and RECHAZADA, so an ANULADA
-- cuota (3,075 in production) and one EN PRELIQUIDACIÓN (2,336: already sent
-- to the bank) were stored as overdue or pending and counted as debt.
ALTER TABLE `Installment` ADD COLUMN `providerStatus` VARCHAR(191) NULL;

-- Backfill from the cuotas Triunfo sent with each policy's last novedad.
UPDATE `Installment` i
  JOIN (
    SELECT p.`id` AS policyId, c.num AS number, c.estado AS estado
    FROM `Policy` p,
      JSON_TABLE(p.`rawData`, '$.SDTCuota[*]'
        COLUMNS (num INT PATH '$.NumeroCuota', estado VARCHAR(191) PATH '$.Estado')) c
  ) r ON r.policyId = i.`policyId` AND r.number = i.`number`
  SET i.`providerStatus` = r.estado;

-- An ANULADA cuota does not exist for the platform.
UPDATE `Installment` SET `deletedAt` = NOW()
  WHERE `deletedAt` IS NULL AND `providerStatus` = 'ANULADA';

-- A cuota sent to the bank is pending, not overdue, until Triunfo says paid or rejected.
UPDATE `Installment` SET `status` = 'pending'
  WHERE `deletedAt` IS NULL AND `status` = 'overdue' AND `providerStatus` LIKE 'EN PRELIQ%';

-- A pending cuota whose due date went by without any novedad is overdue.
UPDATE `Installment` SET `status` = 'overdue'
  WHERE `deletedAt` IS NULL AND `status` = 'pending' AND `dueDate` < CURDATE()
    AND (`providerStatus` IS NULL OR `providerStatus` NOT LIKE 'EN PRELIQ%');
