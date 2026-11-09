-- The organization's logo (Polisend panel): a WebP under /uploads/logos.
-- Additive: null keeps the organization's initials.
ALTER TABLE `Producer` ADD COLUMN `logoUrl` VARCHAR(255) NULL;
