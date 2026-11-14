-- ─────────────────────────────────────────────────────────────────────
-- Migration 2026-11-16 — Expéditions groupées (B2B / e-commerce).
--
-- 1. Crée `shipment_batches` : regroupement commercial de N colis sous
--    une même entité (un merchant expédie 20 colis en une opération,
--    ou un B2B consolide ses envois d'une journée).
-- 2. Ajoute `parcels.batch_id` nullable (FK vers shipment_batches).
--    Préserve les colis isolés existants.
--
-- Idempotence : IF NOT EXISTS partout.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "shipment_batches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "creator_id" UUID NOT NULL,
  "api_key_id" TEXT,
  "reference" TEXT,
  "label" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "total_parcels" INTEGER NOT NULL DEFAULT 0,
  "total_weight_kg" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "total_amount" DECIMAL(14, 2),
  "currency" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "closed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "shipment_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shipment_batches_status_check" CHECK ("status" IN ('draft', 'open', 'closed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS "shipment_batches_creator_id_idx"
  ON "shipment_batches" ("creator_id");

CREATE INDEX IF NOT EXISTS "shipment_batches_status_idx"
  ON "shipment_batches" ("status");

CREATE INDEX IF NOT EXISTS "shipment_batches_reference_idx"
  ON "shipment_batches" ("reference");

ALTER TABLE "shipment_batches"
  ADD CONSTRAINT "shipment_batches_creator_id_fkey"
  FOREIGN KEY ("creator_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Lien parcel → batch (nullable, additif, non destructif pour l'existant).
ALTER TABLE "parcels"
  ADD COLUMN IF NOT EXISTS "batch_id" UUID;

CREATE INDEX IF NOT EXISTS "parcels_batch_id_idx"
  ON "parcels" ("batch_id");

ALTER TABLE "parcels"
  ADD CONSTRAINT "parcels_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "shipment_batches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
