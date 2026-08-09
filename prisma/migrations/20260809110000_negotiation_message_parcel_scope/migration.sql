-- Une contre-offre de proposition directe n'a pas d'enchere derriere elle : le
-- fil est rattache au colis. bid_id devient donc optionnel.
ALTER TABLE "negotiation_messages" ALTER COLUMN "bid_id" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "negotiation_messages_parcel_id_idx" ON "negotiation_messages"("parcel_id");
