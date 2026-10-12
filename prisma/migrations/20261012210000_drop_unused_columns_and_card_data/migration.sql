-- Columns nothing reads or writes (all empty in production when this was written):
-- legacy per-number prices, per-code Triunfo credentials and the card data of quote
-- requests, which the web form stopped collecting.
-- Guard: stop before dropping anything if one of these columns holds data. The
-- fallback statement names a column that does not exist, so it fails to prepare
-- and the migration aborts with nothing dropped.
SET @filled = (SELECT COUNT(*) FROM `ProducerCode` WHERE `triunfoUsuario` IS NOT NULL OR `triunfoPassword` IS NOT NULL)
  + (SELECT COUNT(*) FROM `PhoneNumber` WHERE `monthlyBasePriceUsd` IS NOT NULL OR `monthlyMaxPriceUsd` IS NOT NULL OR `billingMarkup` IS NOT NULL)
  + (SELECT COUNT(*) FROM `Solicitud` WHERE `cardCompany` IS NOT NULL OR `cardNumber` IS NOT NULL OR `cardExpiry` IS NOT NULL OR `cardHolder` IS NOT NULL);
SET @sql = IF(@filled = 0, 'DO 0', 'SELECT `columns_to_drop_are_not_empty` FROM `Solicitud`');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- AlterTable
ALTER TABLE `ProducerCode` DROP COLUMN `triunfoPassword`,
    DROP COLUMN `triunfoUsuario`;

-- AlterTable
ALTER TABLE `PhoneNumber` DROP COLUMN `billingMarkup`,
    DROP COLUMN `monthlyBasePriceUsd`,
    DROP COLUMN `monthlyMaxPriceUsd`;

-- AlterTable
ALTER TABLE `Solicitud` DROP COLUMN `cardCompany`,
    DROP COLUMN `cardExpiry`,
    DROP COLUMN `cardHolder`,
    DROP COLUMN `cardNumber`;

