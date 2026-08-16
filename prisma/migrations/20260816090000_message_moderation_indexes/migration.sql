-- La console de moderation parcourt toute la table `messages` (recherche par
-- participant, par colis, par date). La table n'avait aucun index : chaque
-- ecran de moderation declenchait un seek sequentiel complet.
CREATE INDEX IF NOT EXISTS "messages_sender_id_idx" ON "messages"("sender_id");
CREATE INDEX IF NOT EXISTS "messages_receiver_id_idx" ON "messages"("receiver_id");
CREATE INDEX IF NOT EXISTS "messages_parcel_id_idx" ON "messages"("parcel_id");
CREATE INDEX IF NOT EXISTS "messages_created_at_idx" ON "messages"("created_at");
