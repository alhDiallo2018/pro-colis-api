CREATE TABLE "journey_live" (
  "id" UUID NOT NULL,
  "advertisement_id" UUID NOT NULL,
  "driver_id" UUID NOT NULL,
  "vehicle_id" UUID NOT NULL,
  "latitude" DECIMAL(10,7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  "longitude" DECIMAL(10,7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  "accuracy_meters" DOUBLE PRECISION NOT NULL CHECK (accuracy_meters BETWEEN 0 AND 1000),
  "captured_at" TIMESTAMPTZ NOT NULL,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "journey_live_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "journey_live_advertisement_id_fkey" FOREIGN KEY ("advertisement_id") REFERENCES "advertisements"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "journey_live_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "journey_live_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "journey_live_advertisement_id_key" ON "journey_live"("advertisement_id");
CREATE UNIQUE INDEX "journey_live_driver_id_key" ON "journey_live"("driver_id");
CREATE UNIQUE INDEX "journey_live_vehicle_id_key" ON "journey_live"("vehicle_id");
