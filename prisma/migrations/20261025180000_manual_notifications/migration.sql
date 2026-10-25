CREATE TABLE "manual_message_dispatches" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "result" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "manual_message_dispatches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "manual_message_dispatches_actor_id_created_at_idx"
    ON "manual_message_dispatches"("actor_id", "created_at");
