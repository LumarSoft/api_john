-- Statuses become enums with the exact values already stored, Poliza.status is
-- renamed to what it really holds (Triunfo's last movement) and Client.email
-- becomes optional, dropping the synthetic "<dni>@cliente.local" addresses.

-- Production runs without strict mode, where a value outside an ENUM would be
-- silently stored as ''. Strict mode makes the conversion fail instead.
SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION';

ALTER TABLE `Cuota` MODIFY `status` ENUM('pending', 'paid', 'overdue', 'rejected') NOT NULL DEFAULT 'pending';
ALTER TABLE `Siniestro` MODIFY `estado` ENUM('pendiente', 'en_proceso', 'resuelto') NOT NULL DEFAULT 'pendiente';
ALTER TABLE `Novedad` MODIFY `status` ENUM('pending', 'in_progress', 'resolved') NOT NULL DEFAULT 'pending';
ALTER TABLE `Solicitud` MODIFY `status` ENUM('NEW', 'CONTACTED', 'CLOSED') NOT NULL DEFAULT 'NEW';
ALTER TABLE `ContactLead` MODIFY `status` ENUM('NEW', 'CONTACTED', 'CLOSED') NOT NULL DEFAULT 'NEW';
ALTER TABLE `Conversation` MODIFY `status` ENUM('open', 'pending', 'closed') NOT NULL DEFAULT 'open';

ALTER TABLE `Poliza` RENAME COLUMN `status` TO `movimiento`;

ALTER TABLE `Client` MODIFY `email` VARCHAR(191) NULL;
UPDATE `Client` SET `email` = NULL WHERE `email` LIKE '%@cliente.local';
