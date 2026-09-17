-- Le suivi public lit la derniere position d'un colis via
-- `parcel_id` + `created_at DESC`. Sans cet index, chaque requete de tracking
-- parcourt toutes les positions du chauffeur pour retrouver la plus recente.
CREATE INDEX IF NOT EXISTS "driver_locations_parcel_id_created_at_idx" ON "driver_locations"("parcel_id", "created_at");
