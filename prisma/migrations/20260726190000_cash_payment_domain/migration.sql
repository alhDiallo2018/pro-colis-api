-- Les enums rendent le canal et le jalon d'encaissement filtrables sans
-- multiplier les variantes textuelles entre le web, le mobile et l'API.
CREATE TYPE "PaymentChannel" AS ENUM ('cash', 'platform');
CREATE TYPE "CashCollectionPoint" AS ENUM ('sender_pickup', 'receiver_delivery');

ALTER TABLE "parcels"
  ADD COLUMN "payment_channel" "PaymentChannel",
  ADD COLUMN "accepted_payment_channels" "PaymentChannel"[] NOT NULL DEFAULT ARRAY[]::"PaymentChannel"[],
  ADD COLUMN "cash_collection_point" "CashCollectionPoint",
  ADD COLUMN "cash_collected_amount" DECIMAL(12,2),
  ADD COLUMN "cash_collected_at" TIMESTAMPTZ;

-- Les anciens colis espèces utilisaient seulement payment_method. Cette
-- reprise préserve leur comportement sans inventer de point d'encaissement.
UPDATE "parcels"
SET "payment_channel" = CASE
  WHEN "payment_method" = 'cash' THEN 'cash'::"PaymentChannel"
  WHEN "payment_method" IS NOT NULL THEN 'platform'::"PaymentChannel"
  ELSE NULL
END;
