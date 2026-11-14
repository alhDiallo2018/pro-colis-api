-- ─────────────────────────────────────────────────────────────────────
-- Migration 2026-11-15 — Correspondances inter-véhicules.
--
-- Table `parcel_handovers` : trace d'un transfert de responsabilité d'un
-- chauffeur sortant vers un chauffeur entrant sur un colis donné.
--
-- Cycle de vie :
--   pending_pickup → completed  (succès)
--   pending_pickup → cancelled  (annulation)
--
-- Contraintes :
--   - Un seul handover ACTIF (pending_pickup) par colis à un instant T.
--     Contrainte unique partielle (expression) : impossible en standard
--     Postgres sans `CREATE UNIQUE INDEX ... WHERE` → utiliser un index
--     unique partiel (supporté par Prisma depuis @@unique([field], where:)).
--     Fallback applicatif dans handover.service pour les versions Prisma
--     plus anciennes.
--   - from_driver != to_driver (empêche un self-handover).
--
-- Idempotence : IF NOT EXISTS partout.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "parcel_handovers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "parcel_id" UUID NOT NULL,
  "from_driver_id" UUID NOT NULL,
  "to_driver_id" UUID NOT NULL,
  "from_advertisement_id" UUID,
  "to_advertisement_id" UUID,
  "latitude" DECIMAL(10, 7),
  "longitude" DECIMAL(10, 7),
  "initiated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "confirmed_at" TIMESTAMPTZ,
  "cancelled_at" TIMESTAMPTZ,
  "status" TEXT NOT NULL DEFAULT 'pending_pickup',
  "pickup_pin_hash" TEXT NOT NULL,
  "pickup_qr_token_hash" TEXT NOT NULL,
  "pickup_pin_last4" TEXT,
  "pickup_proof_type" TEXT,
  "cancellation_reason" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "parcel_handovers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "parcel_handovers_distinct_drivers" CHECK ("from_driver_id" <> "to_driver_id"),
  CONSTRAINT "parcel_handovers_status_check" CHECK ("status" IN ('pending_pickup', 'completed', 'cancelled'))
);

-- Un seul handover actif par colis : index partiel.
CREATE UNIQUE INDEX IF NOT EXISTS "parcel_handovers_active_unique"
  ON "parcel_handovers" ("parcel_id")
  WHERE "status" = 'pending_pickup';

CREATE INDEX IF NOT EXISTS "parcel_handovers_parcel_id_idx"
  ON "parcel_handovers" ("parcel_id");

CREATE INDEX IF NOT EXISTS "parcel_handovers_to_driver_id_idx"
  ON "parcel_handovers" ("to_driver_id");

CREATE INDEX IF NOT EXISTS "parcel_handovers_from_driver_id_idx"
  ON "parcel_handovers" ("from_driver_id");

CREATE INDEX IF NOT EXISTS "parcel_handovers_status_idx"
  ON "parcel_handovers" ("status");

ALTER TABLE "parcel_handovers"
  ADD CONSTRAINT "parcel_handovers_parcel_id_fkey"
  FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "parcel_handovers"
  ADD CONSTRAINT "parcel_handovers_from_driver_id_fkey"
  FOREIGN KEY ("from_driver_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "parcel_handovers"
  ADD CONSTRAINT "parcel_handovers_to_driver_id_fkey"
  FOREIGN KEY ("to_driver_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "parcel_handovers"
  ADD CONSTRAINT "parcel_handovers_from_advertisement_id_fkey"
  FOREIGN KEY ("from_advertisement_id") REFERENCES "advertisements"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "parcel_handovers"
  ADD CONSTRAINT "parcel_handovers_to_advertisement_id_fkey"
  FOREIGN KEY ("to_advertisement_id") REFERENCES "advertisements"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
