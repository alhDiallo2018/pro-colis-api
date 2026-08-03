-- Rattache colis et annonces au référentiel `zones`.
--
-- Le mobile sélectionne désormais des zones (14 régions + 46 départements),
-- alors que `parcels`/`advertisements` ne référençaient que `garages` — deux
-- référentiels sans identifiant commun. La création échouait donc en 422
-- (`Argument departure_garage_id is missing`).
--
-- Les colonnes garage sont conservées, le temps que les écrans garage-admin
-- migrent : elles filtrent encore les colis par garage de rattachement.
-- `departure_garage_id` passe nullable, un client créant un colis sans garage.

-- La contrainte est recréée plus bas en SET NULL, cohérente avec la colonne
-- devenue nullable.
ALTER TABLE "parcels" DROP CONSTRAINT "parcels_departure_garage_id_fkey";

-- AlterTable
ALTER TABLE "advertisements" ADD COLUMN     "arrival_zone_id" UUID,
ADD COLUMN     "departure_zone_id" UUID;

-- AlterTable
ALTER TABLE "parcels" ADD COLUMN     "arrival_zone_id" UUID,
ADD COLUMN     "departure_zone_id" UUID,
ALTER COLUMN "departure_garage_id" DROP NOT NULL;

-- Backfill : chaque garage est rapproché de la zone de même ville. Le
-- rapprochement passe par `place_id` (`sn-dept:<ville-sans-accent>`) car les
-- villes des garages sont saisies sans accent (« Thies » vs zone « Thiès »).
-- Une ville sans zone correspondante laisse la colonne à NULL plutôt que de
-- faire échouer la migration.
UPDATE "parcels" p
SET "departure_zone_id" = z."id"
FROM "garages" g
JOIN "zones" z
  ON z."place_id" = 'sn-dept:' || lower(translate(g."city",
       'àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ', 'aaaeeeeiioouucAAAEEEEIIOOUUUC'))
WHERE p."departure_garage_id" = g."id" AND p."departure_zone_id" IS NULL;

UPDATE "parcels" p
SET "arrival_zone_id" = z."id"
FROM "garages" g
JOIN "zones" z
  ON z."place_id" = 'sn-dept:' || lower(translate(g."city",
       'àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ', 'aaaeeeeiioouucAAAEEEEIIOOUUUC'))
WHERE p."arrival_garage_id" = g."id" AND p."arrival_zone_id" IS NULL;

UPDATE "advertisements" a
SET "departure_zone_id" = z."id"
FROM "garages" g
JOIN "zones" z
  ON z."place_id" = 'sn-dept:' || lower(translate(g."city",
       'àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ', 'aaaeeeeiioouucAAAEEEEIIOOUUUC'))
WHERE a."departure_garage_id" = g."id" AND a."departure_zone_id" IS NULL;

UPDATE "advertisements" a
SET "arrival_zone_id" = z."id"
FROM "garages" g
JOIN "zones" z
  ON z."place_id" = 'sn-dept:' || lower(translate(g."city",
       'àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ', 'aaaeeeeiioouucAAAEEEEIIOOUUUC'))
WHERE a."arrival_garage_id" = g."id" AND a."arrival_zone_id" IS NULL;

-- AddForeignKey
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_departure_garage_id_fkey" FOREIGN KEY ("departure_garage_id") REFERENCES "garages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_departure_zone_id_fkey" FOREIGN KEY ("departure_zone_id") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_arrival_zone_id_fkey" FOREIGN KEY ("arrival_zone_id") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisements" ADD CONSTRAINT "advertisements_departure_zone_id_fkey" FOREIGN KEY ("departure_zone_id") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisements" ADD CONSTRAINT "advertisements_arrival_zone_id_fkey" FOREIGN KEY ("arrival_zone_id") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
