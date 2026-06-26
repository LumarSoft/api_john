-- Adds the platform OWNER role (Lumar). The owner logs into the same admin panel
-- as a super-superadmin: behaves as SUPERADMIN everywhere and can additionally
-- provision new organizations. Additive & non-destructive: existing OWNER-less
-- rows keep their value; only the set of allowed enum members grows.

ALTER TABLE `User`
  MODIFY `role` ENUM('OWNER', 'SUPERADMIN', 'ADMIN') NOT NULL DEFAULT 'ADMIN';
