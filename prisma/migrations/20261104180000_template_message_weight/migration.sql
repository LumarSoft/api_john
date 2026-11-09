-- Templates count double toward the plan (2026-11-04). A delivered message Meta
-- priced as a template (utility, marketing, authentication) consumes 2 messages
-- of the plan from COMMERCIAL_TEMPLATE_WEIGHT_FROM on (default 2026-12-01); a
-- reply inside the conversation consumes 1. The plan counts
-- metaMessages + templateExtraMessages. Additive: the previous API ignores both.

ALTER TABLE `UsageMonthly`
  ADD COLUMN `metaTemplateMessages` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `templateExtraMessages` INTEGER NOT NULL DEFAULT 0;

-- The raw template count of the months already recorded, from the per-message
-- events. templateExtraMessages stays 0: the weight starts after this deploy.
UPDATE `UsageMonthly` u
  JOIN (
    SELECT `phoneNumberId`, `period`, COUNT(*) AS `templates`
    FROM `UsageEvent`
    WHERE `provider` = 'meta' AND LOWER(`category`) NOT IN ('service', 'referral_conversion')
    GROUP BY `phoneNumberId`, `period`
  ) e ON e.`phoneNumberId` = u.`phoneNumberId` AND e.`period` = u.`period`
  SET u.`metaTemplateMessages` = e.`templates`;
