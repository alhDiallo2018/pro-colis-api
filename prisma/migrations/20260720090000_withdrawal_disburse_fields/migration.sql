-- Champs de suivi du déboursement PayDunya (API PUSH) sur les retraits.
ALTER TABLE "withdrawals" ADD COLUMN "disburse_token" TEXT;
ALTER TABLE "withdrawals" ADD COLUMN "transaction_id" TEXT;
ALTER TABLE "withdrawals" ADD COLUMN "provider_ref" TEXT;
CREATE UNIQUE INDEX "withdrawals_disburse_token_key" ON "withdrawals"("disburse_token");
