-- ─────────────────────────────────────────────────────────────────────
-- Migration P3 — Infrastructure parrainage / assurance / clés API.
--
-- 1. Ajoute deux colonnes sur `users` : `whatsapp_opt_in` (notifications
--    WhatsApp au niveau utilisateur) et `referral_code` (code personnel
--    unique dérivable côté code).
-- 2. Crée `referrals` : association parrain → filleul (unique sur filleul).
-- 3. Crée `insurance_subscriptions` : trace d'une prime souscrite pour un
--    colis (unique sur parcel_id).
-- 4. Crée `api_keys` : clés partenaires e-commerce + secret haché.
--
-- Idempotence : chaque instruction utilise IF NOT EXISTS pour pouvoir être
-- rejouée sans erreur sur une DB déjà migrée partiellement.
-- ─────────────────────────────────────────────────────────────────────

-- 1. Colonnes sur users.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "whatsapp_opt_in" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "referral_code" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_referral_code_key"
  ON "users"("referral_code");

-- 2. Table referrals.
CREATE TABLE IF NOT EXISTS "referrals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "referrer_id" UUID NOT NULL,
  "referree_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "referrer_bonus_xof" DECIMAL(12, 2),
  "referree_bonus_xof" DECIMAL(12, 2),
  "triggered_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "referrals_referree_id_key"
  ON "referrals"("referree_id");

CREATE INDEX IF NOT EXISTS "referrals_referrer_id_idx"
  ON "referrals"("referrer_id");

CREATE INDEX IF NOT EXISTS "referrals_status_idx"
  ON "referrals"("status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'referrals_referrer_id_fkey'
  ) THEN
    ALTER TABLE "referrals"
      ADD CONSTRAINT "referrals_referrer_id_fkey"
      FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'referrals_referree_id_fkey'
  ) THEN
    ALTER TABLE "referrals"
      ADD CONSTRAINT "referrals_referree_id_fkey"
      FOREIGN KEY ("referree_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- 3. Table insurance_subscriptions.
CREATE TABLE IF NOT EXISTS "insurance_subscriptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "parcel_id" UUID NOT NULL,
  "premium_xof" DECIMAL(12, 2) NOT NULL,
  "coverage_xof" DECIMAL(12, 2) NOT NULL,
  "declared_value_xof" DECIMAL(12, 2) NOT NULL,
  "parcel_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "exclusions" JSONB,
  "subscribed_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "cancelled_at" TIMESTAMPTZ,
  "claimed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "insurance_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "insurance_subscriptions_parcel_id_key"
  ON "insurance_subscriptions"("parcel_id");

CREATE INDEX IF NOT EXISTS "insurance_subscriptions_status_idx"
  ON "insurance_subscriptions"("status");

-- 4. Table api_keys.
CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key_id" TEXT NOT NULL,
  "key_hash" TEXT NOT NULL,
  "partner_name" TEXT NOT NULL,
  "webhook_url" TEXT,
  "webhook_secret" TEXT,
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "active" BOOLEAN NOT NULL DEFAULT true,
  "last_used_at" TIMESTAMPTZ,
  "rotated_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_id_key"
  ON "api_keys"("key_id");

CREATE INDEX IF NOT EXISTS "api_keys_active_idx"
  ON "api_keys"("active");
