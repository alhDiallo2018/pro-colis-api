-- ─────────────────────────────────────────────────────────────────────
-- Migration 2026-11-13 — Affectation d'arrêts sur AdvertisementOffer.
--
-- Ajoute `boarding_stop_order` et `drop_off_stop_order` (INT nullable) à
-- `advertisement_offers`. Ces colonnes indiquent, pour une réservation
-- sur un trajet associé à une `transit_line`, l'arrêt d'embarquement du
-- colis et son arrêt de descente. Elles référencent logiquement
-- `transit_line_stops.(transit_line_id, order)` via `advertisements.transit_line_id`.
-- La validation est applicative (voir `src/utils/transit-offer-stops.js`).
--
-- Nullable pour préserver les offres sur annonces libres sans ligne.
-- Idempotence : IF NOT EXISTS partout.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE "advertisement_offers"
  ADD COLUMN IF NOT EXISTS "boarding_stop_order"  INTEGER,
  ADD COLUMN IF NOT EXISTS "drop_off_stop_order"  INTEGER;

CREATE INDEX IF NOT EXISTS "advertisement_offers_boarding_stop_order_idx"
  ON "advertisement_offers" ("boarding_stop_order");

CREATE INDEX IF NOT EXISTS "advertisement_offers_drop_off_stop_order_idx"
  ON "advertisement_offers" ("drop_off_stop_order");
