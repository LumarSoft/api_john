-- Repair only the verified historical test notification. Do not infer links
-- for any other notification or change read/attention state.
UPDATE `Novedad` n
JOIN `Siniestro` s ON s.`id` = 2
  AND s.`clientId` = n.`clientId`
  AND s.`producerId` = n.`producerId`
  AND s.`descripcion` = n.`body`
  AND s.`deletedAt` IS NULL
  AND s.`createdAt` BETWEEN DATE_SUB(n.`createdAt`, INTERVAL 5 SECOND) AND n.`createdAt`
SET n.`refId` = s.`id`
WHERE n.`id` = 3 AND n.`type` = 'siniestro' AND n.`refId` = 0
  AND n.`clientId` = 1 AND n.`body` = 'Choqué un árbol'
  AND n.`createdAt` = '2026-09-17 23:38:52.637' AND n.`deletedAt` IS NULL;
