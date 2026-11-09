-- The WhatsApp number a matter (Notification), a lead (ContactLead) and a quote
-- (Quote) came through, as the Meta id stored on Conversation.phoneNumberId, so
-- the panel can show each branch only what came through its own number.
-- Null = not from a chat (web, panel) or older than this column.
ALTER TABLE `Notification` ADD COLUMN `phoneNumberId` VARCHAR(191) NULL;
CREATE INDEX `Notification_producerId_phoneNumberId_idx` ON `Notification`(`producerId`, `phoneNumberId`);
ALTER TABLE `ContactLead` ADD COLUMN `phoneNumberId` VARCHAR(191) NULL;
CREATE INDEX `ContactLead_producerId_phoneNumberId_idx` ON `ContactLead`(`producerId`, `phoneNumberId`);
ALTER TABLE `Quote` ADD COLUMN `phoneNumberId` VARCHAR(191) NULL;
CREATE INDEX `Quote_producerId_phoneNumberId_idx` ON `Quote`(`producerId`, `phoneNumberId`);

-- Backfill from the chats that are still linked: leads keep their conversation,
-- chat matters (handoff, baja) point at it through refId, lead matters at the lead.
UPDATE `ContactLead` l JOIN `Conversation` c ON c.`id` = l.`conversationId`
  SET l.`phoneNumberId` = c.`phoneNumberId`
  WHERE l.`conversationId` IS NOT NULL;
UPDATE `Notification` n JOIN `Conversation` c ON c.`id` = n.`refId`
  SET n.`phoneNumberId` = c.`phoneNumberId`
  WHERE n.`type` IN ('handoff', 'baja_poliza');
UPDATE `Notification` n JOIN `ContactLead` l ON l.`id` = n.`refId`
  SET n.`phoneNumberId` = l.`phoneNumberId`
  WHERE n.`type` = 'lead';
