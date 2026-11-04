-- Plan features (2026-11-03): the panel functions each message plan includes,
-- turned on and off by the owner in Facturación → Planes. NULL (every plan
-- today) includes every function, so nothing changes until someone turns one
-- off. Additive: the previous API ignores the column.

ALTER TABLE `TokenPlan` ADD COLUMN `features` JSON NULL;
