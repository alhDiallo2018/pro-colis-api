-- Vérification d'identité chauffeur (KYC) : drapeau dénormalisé validé par un admin.
ALTER TABLE "users" ADD COLUMN "is_verified" BOOLEAN NOT NULL DEFAULT false;
