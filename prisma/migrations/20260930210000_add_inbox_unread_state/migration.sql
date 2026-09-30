ALTER TABLE `Conversation`
  ADD COLUMN `unreadCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `lastReadAt` DATETIME(3) NULL;

CREATE INDEX `Conversation_producerId_lastMessageAt_idx`
  ON `Conversation`(`producerId`, `lastMessageAt`);
