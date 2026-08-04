-- ============================================================================
--  RESET DE DATOS — deja solo la base del seed y fuerza un backfill completo
-- ============================================================================
--
--  Vacía las tablas de datos operativos y CONSERVA la estructura de la
--  organización (Producer, ProducerCode, User, PhoneNumber y sus join tables),
--  para no perder los admins ni los números de WhatsApp dados de alta a mano.
--
--  DESTRUCTIVO E IRREVERSIBLE. Hacer backup antes:
--    mysqldump -h 200.58.106.236 -u Lumar -p johnpellegrini_dev \
--      > backup-$(date +%F-%H%M).sql
--
--  Uso:
--    mysql -h 200.58.106.236 -u Lumar -p johnpellegrini_dev < reset-cartera.sql
--
--  Después:
--    npx prisma db seed          # repone la data base (idempotente)
--    curl -X POST .../admin/cartera-sync   (o reiniciar el API)
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ── Cartera: la reescribe el sync de Triunfo ────────────────────────────────
TRUNCATE TABLE `Cuota`;
TRUNCATE TABLE `Vehiculo`;
TRUNCATE TABLE `Poliza`;
TRUNCATE TABLE `Client`;

-- ── Datos operativos: NO se recuperan de Triunfo ────────────────────────────
-- Siniestro en particular solo existe acá: Triunfo no expone estado de siniestros.
TRUNCATE TABLE `Siniestro`;
TRUNCATE TABLE `Message`;
TRUNCATE TABLE `Conversation`;
TRUNCATE TABLE `Cotizacion`;
TRUNCATE TABLE `ContactLead`;
TRUNCATE TABLE `Solicitud`;
TRUNCATE TABLE `Novedad`;

SET FOREIGN_KEY_CHECKS = 1;

-- ── Forzar backfill de 6 meses en la próxima corrida ────────────────────────
-- Sin esto, los códigos ya sincronizados usarían la ventana incremental de
-- 3 meses y la cartera quedaría a medias.
UPDATE `ProducerCode` SET `lastCarteraSyncAt` = NULL;

-- ── Verificación ────────────────────────────────────────────────────────────
SELECT 'Client'      AS tabla, COUNT(*) AS filas FROM `Client`
UNION ALL SELECT 'Poliza',      COUNT(*) FROM `Poliza`
UNION ALL SELECT 'Vehiculo',    COUNT(*) FROM `Vehiculo`
UNION ALL SELECT 'Cuota',       COUNT(*) FROM `Cuota`
UNION ALL SELECT 'Siniestro',   COUNT(*) FROM `Siniestro`
UNION ALL SELECT 'Conversation',COUNT(*) FROM `Conversation`
UNION ALL SELECT 'Message',     COUNT(*) FROM `Message`
UNION ALL SELECT '--- se conservan ---', NULL
UNION ALL SELECT 'Producer',    COUNT(*) FROM `Producer`
UNION ALL SELECT 'ProducerCode',COUNT(*) FROM `ProducerCode`
UNION ALL SELECT 'User',        COUNT(*) FROM `User`
UNION ALL SELECT 'PhoneNumber', COUNT(*) FROM `PhoneNumber`;
