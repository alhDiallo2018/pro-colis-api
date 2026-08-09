-- La table de negociation avait ete creee hors migration (db push) : elle
-- existe en base de developpement mais aucune migration ne la construisait,
-- donc toute base repartant de zero (tests, CI, nouvel environnement) cassait.
-- Ce fichier rattrape la creation sans toucher aux bases deja pourvues ; les
-- colonnes parcel_id / is_counter_offer sont ajoutees par la migration
-- 20260806120000 qui suit.
CREATE TABLE IF NOT EXISTS "negotiation_messages" (
    "id" UUID NOT NULL,
    "bid_id" UUID NOT NULL,
    "from_user_id" UUID NOT NULL,
    "from_user_role" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "negotiation_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "negotiation_messages_bid_id_fkey" FOREIGN KEY ("bid_id") REFERENCES "bids"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "negotiation_messages_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "negotiation_messages_bid_id_idx" ON "negotiation_messages"("bid_id");
CREATE INDEX IF NOT EXISTS "negotiation_messages_from_user_id_idx" ON "negotiation_messages"("from_user_id");
CREATE INDEX IF NOT EXISTS "negotiation_messages_created_at_idx" ON "negotiation_messages"("created_at");
