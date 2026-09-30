-- Organization-wide emergency switch for every automated WhatsApp response.
-- Existing organizations remain enabled; the admin can turn the bot off and on.
ALTER TABLE `Producer` ADD COLUMN `botEnabled` BOOLEAN NOT NULL DEFAULT true;
