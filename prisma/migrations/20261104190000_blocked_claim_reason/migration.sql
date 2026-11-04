-- Blocked claims (2026-11-04): the bot refuses to file a claim when the client has
-- no policy in force or the policy has a rejected payment / overdue installments,
-- and hands the chat to the office. The handoff now says why, so the panel can
-- badge it ("denuncia frenada") and the monthly balance can count it.
-- Additive: the previous API ignores the new column.

-- AlterTable
ALTER TABLE `Notification` ADD COLUMN `blockedClaimReason` ENUM('NO_POLICY', 'REJECTED_PAYMENT', 'OVERDUE_INSTALLMENTS') NULL;

-- Backfill: the bot has worded these reasons the same way since 2026-10-05
-- ("Denuncia de siniestro no registrada: …"), see src/novedades/blocked-claim.ts.
UPDATE `Notification`
SET `blockedClaimReason` = CASE
    WHEN `body` LIKE '%cobro rechazado%' THEN 'REJECTED_PAYMENT'
    WHEN `body` LIKE '%saldo vencido%' THEN 'OVERDUE_INSTALLMENTS'
    ELSE 'NO_POLICY'
  END
WHERE `type` = 'handoff'
  AND `body` LIKE '%Denuncia de siniestro no registrada:%'
  AND (`body` LIKE '%cobro rechazado%' OR `body` LIKE '%saldo vencido%' OR `body` LIKE '%no tiene p_lizas vigentes%');
