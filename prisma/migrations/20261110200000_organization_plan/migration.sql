-- The plan the owner puts an organization on: what an organization with no
-- number yet has (its panel functions) and the plan its new numbers start on.
-- Null keeps today's behaviour: the trial plan for a new account, else the
-- smallest paid plan. Additive: no existing row changes.
ALTER TABLE `Producer` ADD COLUMN `planId` INTEGER NULL;
CREATE INDEX `Producer_planId_idx` ON `Producer`(`planId`);
ALTER TABLE `Producer` ADD CONSTRAINT `Producer_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `TokenPlan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
