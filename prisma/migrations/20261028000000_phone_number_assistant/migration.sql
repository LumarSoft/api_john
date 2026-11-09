-- A number's own assistant: name, office people, weekly hours and the bot
-- profile fields it changes. Nullable columns: every existing number keeps
-- using its organization's values, and adding them does not rebuild the table.
ALTER TABLE `PhoneNumber`
    ADD COLUMN `botName` VARCHAR(60) NULL,
    ADD COLUMN `staffNames` VARCHAR(255) NULL,
    ADD COLUMN `businessHours` JSON NULL,
    ADD COLUMN `botProfile` JSON NULL;
