-- Which insurers each organization's bot quotes with (Configuración → Aseguradoras).
ALTER TABLE `Producer`
  ADD COLUMN `triunfoQuotesEnabled` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `sancorQuotesEnabled` BOOLEAN NOT NULL DEFAULT false;
