ALTER TABLE `Conversation`
  ADD COLUMN `clientLinkedAt` DATETIME(3) NULL,
  ADD COLUMN `contactName` VARCHAR(191) NULL;
