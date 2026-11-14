-- ─────────────────────────────────────────────────────────────────────
-- Migration 2026-11-18 — Déclarations douanières (SCP-040).
--
-- Table `parcel_customs` : déclaration structurée pour expéditions
-- internationales. Relation 1:1 avec `parcels` (un colis = une déclaration).
--
-- Aucun colis existant n'est migré automatiquement : la déclaration est créée
-- à la demande via l'endpoint dédié. Nullable côté Parcel.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "parcel_customs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "parcel_id" UUID NOT NULL,
  -- Pays origine / destination au format ISO-3166-1 alpha-2 (ex. "SN", "FR").
  "origin_country" TEXT NOT NULL,
  "destination_country" TEXT NOT NULL,
  "contents_description" TEXT NOT NULL,
  -- Code HS (Harmonized System) 4 à 10 chiffres. Nullable : certains colis
  -- de faible valeur peuvent être exemptés selon le pays.
  "hs_code" TEXT,
  "declared_value" DECIMAL(14, 2) NOT NULL,
  "declared_currency" TEXT NOT NULL DEFAULT 'XOF',
  "weight_kg" DECIMAL(10, 2),
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "category" TEXT,
  -- commercial | gift | sample | personal | return (CHECK en base).
  "purpose" TEXT NOT NULL DEFAULT 'personal',
  "is_dangerous" BOOLEAN NOT NULL DEFAULT false,
  "documents_urls" JSONB NOT NULL DEFAULT '[]',
  "signed_at" TIMESTAMPTZ,
  "signed_by_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "parcel_customs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "parcel_customs_parcel_id_key" UNIQUE ("parcel_id"),
  CONSTRAINT "parcel_customs_purpose_check" CHECK ("purpose" IN ('commercial', 'gift', 'sample', 'personal', 'return'))
);

CREATE INDEX IF NOT EXISTS "parcel_customs_destination_idx"
  ON "parcel_customs" ("destination_country");

CREATE INDEX IF NOT EXISTS "parcel_customs_origin_idx"
  ON "parcel_customs" ("origin_country");

ALTER TABLE "parcel_customs"
  ADD CONSTRAINT "parcel_customs_parcel_id_fkey"
  FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "parcel_customs"
  ADD CONSTRAINT "parcel_customs_signed_by_id_fkey"
  FOREIGN KEY ("signed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
