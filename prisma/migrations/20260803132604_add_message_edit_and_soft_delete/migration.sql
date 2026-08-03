-- Edition et suppression logique des messages.
-- Les deux colonnes sont nullables : aucun remplissage n'est necessaire pour
-- les messages deja envoyes, qui restent donc ni edites ni supprimes.
ALTER TABLE "messages" ADD COLUMN     "deleted_at" TIMESTAMPTZ,
ADD COLUMN     "edited_at" TIMESTAMPTZ;
