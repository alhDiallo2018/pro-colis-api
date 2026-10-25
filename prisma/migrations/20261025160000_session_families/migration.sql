-- Chaque session historique devient sa propre famille sans invalider ses JWT.
ALTER TABLE "refresh_tokens" ADD COLUMN "family_id" UUID DEFAULT gen_random_uuid();
UPDATE "refresh_tokens" SET "family_id" = "id";
ALTER TABLE "refresh_tokens" ALTER COLUMN "family_id" SET NOT NULL;
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");
-- Defense complementaire au verrou transactionnel : un seul successeur actif.
CREATE UNIQUE INDEX "refresh_tokens_active_family_key"
ON "refresh_tokens"("family_id") WHERE "revoked_at" IS NULL;
