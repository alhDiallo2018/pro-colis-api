-- Suivi de la moderation : conserver qui a masque un message et pourquoi.
-- Le motif etait deja trace dans l'audit, mais pas lisible directement sur le
-- message : la console de moderation ne pouvait pas afficher le motif d'un
-- message deja masque sans croiser deux tables.
ALTER TABLE "messages" ADD COLUMN     "deleted_by" UUID,
ADD COLUMN     "deleted_reason" TEXT;
