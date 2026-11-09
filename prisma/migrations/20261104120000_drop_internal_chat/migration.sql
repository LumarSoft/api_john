-- Drop the internal chat (2026-11-04): the office wanted an AI assistant,
-- not a chat between users. In production it had two empty chats and no
-- messages when it was removed.

-- DropForeignKey
ALTER TABLE `InternalChat` DROP FOREIGN KEY `InternalChat_producerId_fkey`;

-- DropForeignKey
ALTER TABLE `InternalChatMember` DROP FOREIGN KEY `InternalChatMember_chatId_fkey`;

-- DropForeignKey
ALTER TABLE `InternalChatMember` DROP FOREIGN KEY `InternalChatMember_userId_fkey`;

-- DropForeignKey
ALTER TABLE `InternalChatMessage` DROP FOREIGN KEY `InternalChatMessage_chatId_fkey`;

-- DropForeignKey
ALTER TABLE `InternalChatMessage` DROP FOREIGN KEY `InternalChatMessage_senderId_fkey`;

-- DropTable
DROP TABLE `InternalChat`;

-- DropTable
DROP TABLE `InternalChatMember`;

-- DropTable
DROP TABLE `InternalChatMessage`;

