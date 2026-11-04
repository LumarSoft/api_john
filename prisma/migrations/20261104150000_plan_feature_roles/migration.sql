-- Plan function roles (2026-11-04): besides the plan, the owner can turn each
-- function on or off for administrators and SuperAdmins. No row = both roles,
-- so nothing changes until the owner turns one off. Additive.

CREATE TABLE `PlanFeatureRole` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `feature` VARCHAR(60) NOT NULL,
    `admin` BOOLEAN NOT NULL DEFAULT true,
    `superAdmin` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `PlanFeatureRole_feature_key`(`feature`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
