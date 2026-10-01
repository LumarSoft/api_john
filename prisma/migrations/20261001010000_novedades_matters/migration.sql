ALTER TABLE `Novedad` ADD COLUMN `category` VARCHAR(191) NOT NULL DEFAULT 'other', ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'pending', ADD COLUMN `resolvedAt` DATETIME(3) NULL;
ALTER TABLE `User` ADD COLUMN `lastNovedadesVisitAt` DATETIME(3) NULL;
UPDATE `Novedad` SET `category` = 'siniestro' WHERE `type` = 'siniestro';
UPDATE `Novedad` SET `category` = 'baja' WHERE `type` = 'baja_poliza';
CREATE INDEX `Novedad_producerId_status_category_createdAt_idx` ON `Novedad`(`producerId`, `status`, `category`, `createdAt`);

-- Existing open quote requests also belong to the morning queue.
INSERT INTO `Novedad` (`type`, `refId`, `title`, `body`, `category`, `status`, `createdAt`, `producerId`, `producerCodeId`)
SELECT 'lead', l.`id`, CONCAT('Solicitud de cotización · ', l.`contactName`), CONCAT('Solicita propuesta de ', l.`productType`, '. Contacto: ', l.`phone`, '. Pendiente de seguimiento por un asesor.'), 'cotizacion', IF(l.`status` = 'CONTACTED', 'in_progress', 'pending'), l.`createdAt`, l.`producerId`, l.`producerCodeId`
FROM `ContactLead` l WHERE l.`deletedAt` IS NULL AND l.`status` IN ('NEW', 'CONTACTED');
INSERT INTO `Novedad` (`type`, `refId`, `title`, `body`, `category`, `status`, `createdAt`, `producerId`, `producerCodeId`)
SELECT 'solicitud', s.`id`, CONCAT('Solicitud de cotización · ', s.`applicantFirstName`, ' ', COALESCE(s.`applicantLastName`, '')), CONCAT('Eligió cobertura ', s.`selectedCoverage`, '. Contacto: ', s.`applicantPhone`, '. Pendiente de gestionar contratación.'), 'cotizacion', IF(s.`status` = 'CONTACTED', 'in_progress', 'pending'), s.`createdAt`, c.`producerId`, c.`producerCodeId`
FROM `Solicitud` s JOIN `Cotizacion` c ON s.`cotizacionId` = c.`id` WHERE s.`deletedAt` IS NULL AND c.`deletedAt` IS NULL AND s.`status` IN ('NEW', 'CONTACTED');
