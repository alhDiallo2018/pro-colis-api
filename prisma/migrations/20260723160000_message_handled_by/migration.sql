-- Traçabilité support : agent réel ayant répondu (distinct du compte support partagé).
ALTER TABLE "messages" ADD COLUMN "handled_by" UUID;

ALTER TABLE "messages" ADD CONSTRAINT "messages_handled_by_fkey"
    FOREIGN KEY ("handled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
