-- Zones de couverture (remplacent progressivement les garages comme unité géographique),
-- table de liaison chauffeurs/zones et tokens push des appareils.

-- CreateEnum
CREATE TYPE "ZoneType" AS ENUM ('CIRCLE', 'POLYGON');

-- CreateTable zones
CREATE TABLE "zones" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT,
    "place_id" TEXT,
    "type" "ZoneType" NOT NULL DEFAULT 'CIRCLE',
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "radius_km" DECIMAL(8,2),
    "boundary" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "parent_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable zone_drivers
CREATE TABLE "zone_drivers" (
    "zone_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "zone_drivers_pkey" PRIMARY KEY ("zone_id", "driver_id")
);

-- CreateTable device_tokens
CREATE TABLE "device_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zones_place_id_key" ON "zones"("place_id");
CREATE INDEX "zones_is_active_idx" ON "zones"("is_active");
CREATE INDEX "zones_parent_id_idx" ON "zones"("parent_id");
CREATE INDEX "zone_drivers_driver_id_idx" ON "zone_drivers"("driver_id");
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");
CREATE INDEX "device_tokens_user_id_idx" ON "device_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "zone_drivers" ADD CONSTRAINT "zone_drivers_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "zone_drivers" ADD CONSTRAINT "zone_drivers_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
