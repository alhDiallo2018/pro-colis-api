-- Rotation des refresh tokens.
--
-- `jti` est l'identifiant public porte par le JWT : il permet de retrouver la
-- session en une requete indexee, la ou l'ancien code comparait le hash bcrypt
-- de chaque ligne du compte. Nullable, car les jetons deja en circulation ne le
-- portent pas : ils continuent d'etre valides par l'ancien chemin jusqu'a leur
-- expiration naturelle.
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "jti" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_jti_key" ON "refresh_tokens"("jti");
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");
CREATE INDEX IF NOT EXISTS "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");
