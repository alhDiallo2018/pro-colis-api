-- ─────────────────────────────────────────────────────────────────────
-- Migration 2026-11-23 — Confirmations manuelles d'arrêt navette (Phase 2).
--
-- Un chauffeur confirme au niveau du colis la prise en charge (pickup) à
-- l'arrêt d'embarquement et la remise (dropoff) à l'arrêt de descente. Deux
-- confirmations max par offre : contrainte UNIQUE (offer_id, type).
--
-- `type` restreint à {'pickup','dropoff'} via CHECK. `stop_order` est figé
-- à l'écriture pour tracer l'arrêt réellement confirmé si l'offre évolue.
--
-- Idempotence : IF NOT EXISTS partout.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "shuttle_stop_confirmations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "advertisement_id" UUID NOT NULL,
  "offer_id" UUID NOT NULL,
  "driver_id" UUID NOT NULL,
  "stop_order" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "latitude" DECIMAL(10, 7),
  "longitude" DECIMAL(10, 7),
  "note" TEXT,
  "confirmed_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "shuttle_stop_confirmations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shuttle_stop_confirmations_offer_id_type_key" UNIQUE ("offer_id", "type"),
  CONSTRAINT "shuttle_stop_confirmations_type_check" CHECK ("type" IN ('pickup', 'dropoff'))
);

CREATE INDEX IF NOT EXISTS "shuttle_stop_confirmations_advertisement_id_idx"
  ON "shuttle_stop_confirmations" ("advertisement_id");

CREATE INDEX IF NOT EXISTS "shuttle_stop_confirmations_driver_id_idx"
  ON "shuttle_stop_confirmations" ("driver_id");

ALTER TABLE "shuttle_stop_confirmations"
  ADD CONSTRAINT "shuttle_stop_confirmations_advertisement_id_fkey"
  FOREIGN KEY ("advertisement_id") REFERENCES "advertisements"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shuttle_stop_confirmations"
  ADD CONSTRAINT "shuttle_stop_confirmations_offer_id_fkey"
  FOREIGN KEY ("offer_id") REFERENCES "advertisement_offers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shuttle_stop_confirmations"
  ADD CONSTRAINT "shuttle_stop_confirmations_driver_id_fkey"
  FOREIGN KEY ("driver_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
