-- Ouverture du self-service clés API aux expéditeurs pro. Un business
-- shipper peut lister, créer, faire tourner et désactiver SES clés sans
-- passer par un super admin. Les clés historiques (créées par le super
-- admin pour des partenaires e-commerce) restent avec `created_by_id`
-- NULL : elles ne tombent dans aucune boîte shipper, donc hors de portée
-- des endpoints `/business-shipper/api-keys/*`.
--
-- ON DELETE CASCADE : si un compte shipper est supprimé, ses clés doivent
-- disparaître (on ne peut plus s'y authentifier, et l'audit garde
-- l'historique). Pour une clé "partenaire" créée par un admin (créateur
-- NULL), aucun risque de perte.

ALTER TABLE "api_keys"
  ADD COLUMN "created_by_id" UUID REFERENCES "users"("id") ON DELETE CASCADE;

CREATE INDEX "api_keys_created_by_id_idx" ON "api_keys" ("created_by_id");
