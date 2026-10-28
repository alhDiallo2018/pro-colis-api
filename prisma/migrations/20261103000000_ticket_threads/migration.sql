ALTER TABLE "support_chat_entries" ADD COLUMN "ticket_id" UUID;
ALTER TABLE "support_chat_entries" ADD CONSTRAINT "support_chat_entries_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "support_chat_entries_ticket_id_idx" ON "support_chat_entries"("ticket_id");
