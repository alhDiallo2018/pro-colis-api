-- Statuts manquants du flux de proposition directe : le code les ecrivait deja
-- alors que le type ne les contenait pas (creation de colis en 500).
ALTER TYPE "ParcelStatus" ADD VALUE IF NOT EXISTS 'proposal_sent';
ALTER TYPE "ParcelStatus" ADD VALUE IF NOT EXISTS 'negotiating';

-- Qui a emis la derniere offre : sert a n'afficher "Accepter" que chez la
-- partie qui n'a pas propose le dernier prix.
ALTER TABLE "parcels" ADD COLUMN "last_offer_by" "NegotiationRole";
ALTER TABLE "bids" ADD COLUMN "last_offer_by" "NegotiationRole";

-- Reprise de l'existant : la derniere contre-offre echangee fait foi, sinon
-- l'offre initiale vient toujours du chauffeur.
UPDATE "bids" b
SET "last_offer_by" = m."from_user_role"::"NegotiationRole"
FROM (
  SELECT DISTINCT ON ("bid_id") "bid_id", "from_user_role"
  FROM "negotiation_messages"
  WHERE "bid_id" IS NOT NULL AND "from_user_role" IN ('client', 'driver')
  ORDER BY "bid_id", "created_at" DESC
) m
WHERE m."bid_id" = b."id";

UPDATE "bids" SET "last_offer_by" = 'driver' WHERE "last_offer_by" IS NULL;
