CREATE TABLE "route_templates" (
 "id" UUID NOT NULL PRIMARY KEY,
 "driver_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "fingerprint" TEXT NOT NULL,
 "name" TEXT NOT NULL,
 "data" JSONB NOT NULL,
 "archived_at" TIMESTAMPTZ,
 "last_used_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX "route_templates_driver_id_fingerprint_key" ON "route_templates"("driver_id", "fingerprint");
CREATE INDEX "route_templates_driver_id_archived_at_idx" ON "route_templates"("driver_id", "archived_at");
CREATE TABLE "route_schedule_batches" (
 "id" UUID NOT NULL PRIMARY KEY,
 "driver_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "request_id" UUID NOT NULL,
 "payload_hash" TEXT NOT NULL,
 "advertisement_ids" JSONB NOT NULL,
 "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "route_schedule_batches_driver_id_request_id_key" ON "route_schedule_batches"("driver_id", "request_id");
