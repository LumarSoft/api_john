-- Office people customers write to by name; a nullable column, so adding it
-- does not rebuild the table.
ALTER TABLE `Producer` ADD COLUMN `staffNames` VARCHAR(255) NULL;
