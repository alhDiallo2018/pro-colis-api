-- Correct the WhatsApp message_id unique index.
-- The previous migration created a partial unique index.
-- IF NOT EXISTS does not replace an existing index.

DROP INDEX IF EXISTS "whatsapp_dispatches_message_id_key";

CREATE UNIQUE INDEX "whatsapp_dispatches_message_id_key"
ON "whatsapp_dispatches"("message_id");
