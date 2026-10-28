-- Ne jamais réutiliser les positions de livraison pour la découverte publique.
CREATE TABLE "driver_discovery_positions" (
  "driver_id" UUID NOT NULL PRIMARY KEY,
  "latitude" DECIMAL(10,7) NOT NULL,
  "longitude" DECIMAL(10,7) NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "driver_discovery_positions_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "driver_discovery_latitude_range" CHECK ("latitude" BETWEEN -90 AND 90),
  CONSTRAINT "driver_discovery_longitude_range" CHECK ("longitude" BETWEEN -180 AND 180)
);
