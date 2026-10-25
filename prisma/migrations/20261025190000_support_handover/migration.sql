-- CreateTable
CREATE TABLE "support_chat_conversations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "department" TEXT NOT NULL DEFAULT 'general',
    "status" TEXT NOT NULL DEFAULT 'open',
    "assigned_to_id" UUID,
    "assigned_at" TIMESTAMPTZ,
    "last_message_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "support_chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_chat_entries" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID,
    "sender_name" TEXT NOT NULL,
    "from_support" BOOLEAN NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "audio_url" TEXT,
    "photo_url" TEXT,
    "video_url" TEXT,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "support_chat_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_presences" (
    "user_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "family_id" UUID,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_presences_pkey" PRIMARY KEY ("user_id","connection_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_chat_conversations_user_id_key" ON "support_chat_conversations"("user_id");

-- CreateIndex
CREATE INDEX "support_chat_conversations_status_assigned_to_id_idx" ON "support_chat_conversations"("status", "assigned_to_id");

-- CreateIndex
CREATE INDEX "support_chat_entries_conversation_id_created_at_idx" ON "support_chat_entries"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "support_presences_last_seen_at_idx" ON "support_presences"("last_seen_at");

-- AddForeignKey
ALTER TABLE "support_chat_conversations" ADD CONSTRAINT "support_chat_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_chat_conversations" ADD CONSTRAINT "support_chat_conversations_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_chat_entries" ADD CONSTRAINT "support_chat_entries_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "support_chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_chat_entries" ADD CONSTRAINT "support_chat_entries_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_presences" ADD CONSTRAINT "support_presences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Reprise des anciens fils directs. Les lignes d'origine sont conservees pour
-- les anciens clients ; les copies gardent leur identifiant, auteur et medias.
WITH legacy AS (
 SELECT CASE WHEN s.role::text IN ('support','support_technique','support_commercial','super_admin','admin')
   THEN m.receiver_id ELSE m.sender_id END AS user_id, m.created_at
 FROM messages m JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.receiver_id
 WHERE m.parcel_id IS NULL AND
 ((s.role::text IN ('support','support_technique','support_commercial','super_admin','admin')) <>
  (r.role::text IN ('support','support_technique','support_commercial','super_admin','admin')))
)
INSERT INTO support_chat_conversations(id,user_id,created_at,updated_at,last_message_at)
SELECT gen_random_uuid(),user_id,MIN(created_at),NOW(),MAX(created_at) FROM legacy GROUP BY user_id;
INSERT INTO support_chat_entries(id,conversation_id,sender_id,sender_name,from_support,body,audio_url,photo_url,video_url,read_at,created_at,edited_at,deleted_at)
SELECT m.id,c.id,COALESCE(m.handled_by,m.sender_id),COALESCE(h.full_name,s.full_name),
 s.role::text IN ('support','support_technique','support_commercial','super_admin','admin'),
 m.body,m.audio_url,m.photo_url,m.video_url,m.read_at,m.created_at,m.edited_at,m.deleted_at
FROM messages m JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.receiver_id
LEFT JOIN users h ON h.id=m.handled_by
JOIN support_chat_conversations c ON c.user_id=CASE
 WHEN s.role::text IN ('support','support_technique','support_commercial','super_admin','admin') THEN m.receiver_id ELSE m.sender_id END
WHERE m.parcel_id IS NULL AND
 ((s.role::text IN ('support','support_technique','support_commercial','super_admin','admin')) <>
  (r.role::text IN ('support','support_technique','support_commercial','super_admin','admin')));
