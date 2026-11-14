-- ─────────────────────────────────────────────────────────────────────
-- Migration 2026-11-14 — Détection d'arrivée aux arrêts de navette.
--
-- 1. Enrichit `journey_live` d'un ring buffer `recent_positions` (JSON) qui
--    accumule les dernières N positions GPS. Permet au détecteur de confirmer
--    une arrivée par consécutivité sans créer de table d'historique dédiée.
--    Nullable : les sessions existantes ont `[]` par défaut (NOT NULL + default).
-- 2. Crée `journey_stop_events` : journal immuable des arrêts atteints par
--    trajet. L'unique (advertisement_id, stop_order) interdit les duplicatas
--    et garantit qu'un arrêt n'est marqué atteint qu'une fois par trajet.
--
-- Idempotence : IF NOT EXISTS partout.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE "journey_live"
  ADD COLUMN IF NOT EXISTS "recent_positions" JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS "journey_stop_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "advertisement_id" UUID NOT NULL,
  "driver_id" UUID NOT NULL,
  "vehicle_id" UUID NOT NULL,
  "transit_line_id" UUID,
  "stop_order" INTEGER NOT NULL,
  "stop_label" TEXT,
  "zone_id" UUID,
  "distance_meters" INTEGER NOT NULL,
  "radius_meters" INTEGER NOT NULL,
  "reached_at" TIMESTAMPTZ NOT NULL,
  "confirmed_by" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "journey_stop_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "journey_stop_events_advertisement_id_stop_order_key" UNIQUE ("advertisement_id", "stop_order")
);

CREATE INDEX IF NOT EXISTS "journey_stop_events_advertisement_id_idx"
  ON "journey_stop_events" ("advertisement_id");

CREATE INDEX IF NOT EXISTS "journey_stop_events_driver_id_idx"
  ON "journey_stop_events" ("driver_id");

CREATE INDEX IF NOT EXISTS "journey_stop_events_reached_at_idx"
  ON "journey_stop_events" ("reached_at");

ALTER TABLE "journey_stop_events"
  ADD CONSTRAINT "journey_stop_events_advertisement_id_fkey"
  FOREIGN KEY ("advertisement_id") REFERENCES "advertisements"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "journey_stop_events"
  ADD CONSTRAINT "journey_stop_events_driver_id_fkey"
  FOREIGN KEY ("driver_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
