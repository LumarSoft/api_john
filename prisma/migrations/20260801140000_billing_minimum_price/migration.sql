-- Billing: separates what a number COSTS (measured) from what the client is
-- INVOICED (a commercial rule with a monthly floor).
--
-- The floor exists because the service is sold with a minimum monthly fee per
-- number; the measured cost columns are left untouched so the margin per number
-- stays visible.

-- Minimum monthly fee per number. NULL → DEFAULT_MONTHLY_PRICE_USD (50).
ALTER TABLE `PhoneNumber` ADD COLUMN `monthlyBasePriceUsd` DECIMAL(10, 2) NULL;

-- Multiplier over the real cost; billed when cost x markup beats the floor.
-- NULL → DEFAULT_BILLING_MARKUP (3).
ALTER TABLE `PhoneNumber` ADD COLUMN `billingMarkup` DECIMAL(6, 2) NULL;

-- Amount invoiced for the number in the period: max(base, cost x markup).
ALTER TABLE `UsageMonthly` ADD COLUMN `billedUsd` DECIMAL(12, 2) NOT NULL DEFAULT 0;

-- Back-fill existing rows to the default floor so no period shows as unbilled.
UPDATE `UsageMonthly` SET `billedUsd` = 50.00 WHERE `billedUsd` = 0;

-- Plan ceiling: the client is never invoiced above this for a number.
-- NULL -> DEFAULT_MONTHLY_MAX_PRICE_USD (70).
ALTER TABLE `PhoneNumber` ADD COLUMN `monthlyMaxPriceUsd` DECIMAL(10, 2) NULL;
