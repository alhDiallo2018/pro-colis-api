-- Expiration des sessions sur inactivite.
--
-- `last_used_at` est rafraichi par chaque requete authentifiee : c'est lui qui
-- mesure l'inactivite reelle, la date d'emission du jeton ne disant rien de ce
-- que l'utilisateur a fait depuis.
--
-- `revoked_reason` separe une revocation par rotation d'une fermeture pour
-- inactivite ou deconnexion. Sans cette distinction, un timeout serait pris
-- pour un rejeu de jeton vole et couperait tous les appareils du compte.
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "last_used_at" TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "revoked_reason" TEXT;
