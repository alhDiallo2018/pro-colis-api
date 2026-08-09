-- Le delai de 15 minutes pose a la creation n'etait applique par rien : aucune
-- tache n'expirait les propositions et aucun client ne l'affichait. Plutot que
-- de garder une echeance decorative, on retire la colonne. La valeur `expired`
-- de ProposalStatus reste disponible si une expiration reelle est ajoutee un
-- jour.
ALTER TABLE "parcels" DROP COLUMN IF EXISTS "proposal_expires_at";
