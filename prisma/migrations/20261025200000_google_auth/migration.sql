ALTER TABLE "users" ADD COLUMN "google_subject" TEXT;
CREATE UNIQUE INDEX "users_google_subject_key" ON "users"("google_subject");
CREATE TABLE "google_auth_challenges" (
  "id" UUID NOT NULL, "token_hash" TEXT NOT NULL, "google_subject" TEXT NOT NULL,
  "email" TEXT NOT NULL, "full_name" TEXT NOT NULL, "link_user_id" UUID,
  "phone" TEXT, "otp_hash" TEXT, "otp_sent_at" TIMESTAMPTZ,
  "attempts" INTEGER NOT NULL DEFAULT 0, "expires_at" TIMESTAMPTZ NOT NULL,
  "consumed_at" TIMESTAMPTZ, "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "google_auth_challenges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "google_auth_challenges_token_hash_key" ON "google_auth_challenges"("token_hash");
CREATE INDEX "google_auth_challenges_expires_at_idx" ON "google_auth_challenges"("expires_at");
