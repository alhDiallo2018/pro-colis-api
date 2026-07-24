-- Préférences de notification par utilisateur (persistées côté serveur).
ALTER TABLE "users" ADD COLUMN "notification_preferences" JSONB;
