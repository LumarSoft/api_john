-- Plan limit pause (2026-10-30): a number no longer moves up a plan on its own.
-- When its month's messages reach its plan, the assistant pauses until someone
-- chooses the next plan (or a block past the largest) or the month ends.
-- Additive: the previous API ignores these columns.

ALTER TABLE `PhoneNumber`
  ADD COLUMN `planPausedAt` DATETIME(3) NULL,
  ADD COLUMN `planPauseConfirmedAt` DATETIME(3) NULL,
  ADD COLUMN `extraBlocks` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `extraBlocksPeriod` VARCHAR(7) NULL;

-- Numbers already past their plan this month keep what they are billed on
-- today, so the deploy does not pause them: past the largest plan, that plan
-- plus the blocks that cover the month (of 1,000)... The month is Argentina's
-- (UTC-3), computed inline so it takes the column's collation.
SET @largestId = (
  SELECT `id` FROM `TokenPlan`
  WHERE `producerId` IS NULL AND `deletedAt` IS NULL AND `isActive` = true AND `isTrial` = false
  ORDER BY `tokens` DESC, `id` DESC LIMIT 1
);
SET @largest = (SELECT `tokens` FROM `TokenPlan` WHERE `id` = @largestId);

UPDATE `PhoneNumber` n
  JOIN `UsageMonthly` u ON u.`phoneNumberId` = n.`id` AND u.`period` = DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-03:00'), '%Y-%m')
  SET n.`planId` = @largestId,
      n.`extraBlocks` = GREATEST(1, CEIL((u.`metaMessages` - @largest) / 1000)),
      n.`extraBlocksPeriod` = DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-03:00'), '%Y-%m')
  WHERE n.`deletedAt` IS NULL AND @largestId IS NOT NULL AND u.`metaMessages` > @largest;

-- ...and inside the catalog, the smallest plan that covers the month.
UPDATE `PhoneNumber` n
  JOIN `UsageMonthly` u ON u.`phoneNumberId` = n.`id` AND u.`period` = DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-03:00'), '%Y-%m')
  SET n.`planId` = (
    SELECT t.`id` FROM `TokenPlan` t
    WHERE t.`producerId` IS NULL AND t.`deletedAt` IS NULL AND t.`isActive` = true AND t.`isTrial` = false
      AND t.`tokens` >= u.`metaMessages`
    ORDER BY t.`tokens` ASC, t.`id` ASC LIMIT 1
  )
  WHERE n.`deletedAt` IS NULL AND n.`extraBlocksPeriod` IS NULL AND u.`metaMessages` <= @largest
    AND u.`metaMessages` > COALESCE(
      (SELECT a.`tokens` FROM `TokenPlan` a WHERE a.`id` = n.`planId` AND a.`deletedAt` IS NULL),
      (SELECT MIN(s.`tokens`) FROM `TokenPlan` s
        WHERE s.`producerId` IS NULL AND s.`deletedAt` IS NULL AND s.`isActive` = true AND s.`isTrial` = false)
    );
