CREATE TABLE "operation_requests" (
 "actor_id" UUID NOT NULL, "scope" TEXT NOT NULL, "request_id" UUID NOT NULL, "fingerprint" TEXT NOT NULL, "result" JSONB NOT NULL,
 "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("actor_id", "scope", "request_id"), FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "saved_recipients" (
 "id" UUID NOT NULL PRIMARY KEY, "user_id" UUID NOT NULL, "name" TEXT NOT NULL, "phone" TEXT NOT NULL, "email" TEXT, "address" TEXT,
 "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "saved_recipients_user_id_name_idx" ON "saved_recipients"("user_id", "name");
ALTER TABLE "shipment_drafts" ADD COLUMN "completed_parcel_id" UUID, ADD COLUMN "completed_at" TIMESTAMPTZ;
CREATE TABLE "journey_events" (
 "id" UUID NOT NULL PRIMARY KEY, "user_id" UUID NOT NULL, "attempt_id" UUID NOT NULL, "event" TEXT NOT NULL, "platform" TEXT NOT NULL,
 "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "journey_events_user_id_attempt_id_event_key" ON "journey_events"("user_id", "attempt_id", "event");
CREATE INDEX "journey_events_created_at_event_idx" ON "journey_events"("created_at", "event");
