-- Verrou anti self-validation sur les offres d'annonce : on trace qui a
-- posé le dernier prix pour interdire au même acteur d'accepter ou de
-- recontrer sans attendre la réponse de l'autre côté.
ALTER TABLE "advertisement_offers"
  ADD COLUMN "last_offer_by" "NegotiationRole";

-- Les offres existantes en création viennent toutes du client.
UPDATE "advertisement_offers"
  SET "last_offer_by" = 'client'
  WHERE "last_offer_by" IS NULL AND "status" = 'pending';

-- Les offres déjà contrées : on ne peut pas reconstituer l'historique,
-- on laisse NULL et le handler retombe sur une heuristique.
