-- Which motorcycle coverages are offered, apart from the car ones: the codes are
-- the same letters but the products are not. Null keeps today's behaviour: the
-- organization offers the whole moto catalog and a number offers what the
-- organization does.
ALTER TABLE `Producer` ADD COLUMN `motoCoverageSettings` JSON NULL;
ALTER TABLE `PhoneNumber` ADD COLUMN `motoCoverageSettings` JSON NULL;
