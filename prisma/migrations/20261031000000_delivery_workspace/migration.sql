CREATE TABLE "route_alerts" (
 "id" UUID NOT NULL, "user_id" UUID NOT NULL, "departure_zone_id" UUID NOT NULL,
 "arrival_zone_id" UUID NOT NULL, "expires_at" TIMESTAMPTZ NOT NULL,
 "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "route_alerts_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "route_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "route_alerts_user_id_departure_zone_id_arrival_zone_id_key" ON "route_alerts"("user_id","departure_zone_id","arrival_zone_id");
CREATE INDEX "route_alerts_expires_at_idx" ON "route_alerts"("expires_at");
CREATE TABLE "shipment_drafts" (
 "id" UUID NOT NULL, "user_id" UUID NOT NULL, "label" TEXT NOT NULL, "data" JSONB NOT NULL,
 "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "shipment_drafts_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "shipment_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "shipment_drafts_user_id_created_at_idx" ON "shipment_drafts"("user_id","created_at");
CREATE TABLE "route_alert_deliveries" (
 "alert_id" UUID NOT NULL, "advertisement_id" UUID NOT NULL,
 CONSTRAINT "route_alert_deliveries_pkey" PRIMARY KEY ("alert_id", "advertisement_id"),
 CONSTRAINT "route_alert_deliveries_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "route_alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "route_alert_deliveries_advertisement_id_fkey" FOREIGN KEY ("advertisement_id") REFERENCES "advertisements"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
