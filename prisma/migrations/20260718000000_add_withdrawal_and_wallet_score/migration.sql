-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');

-- AlterTable Wallet
ALTER TABLE "wallets" ADD COLUMN "pending_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "total_withdrawn" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "total_commissions_paid" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable ScoreTransaction
ALTER TABLE "score_transactions" ADD COLUMN "source" TEXT,
ADD COLUMN "performed_by" UUID;

-- CreateTable Withdrawal
CREATE TABLE "withdrawals" (
    "id" UUID NOT NULL,
    "wallet_user_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'wave',
    "phone" TEXT,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'pending',
    "reference" TEXT,
    "failure_reason" TEXT,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_by" UUID,
    "processed_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_reference_key" ON "withdrawals"("reference");

-- CreateIndex
CREATE INDEX "withdrawals_wallet_user_id_created_at_idx" ON "withdrawals"("wallet_user_id", "created_at");

-- CreateIndex
CREATE INDEX "withdrawals_status_idx" ON "withdrawals"("status");

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_wallet_user_id_fkey" FOREIGN KEY ("wallet_user_id") REFERENCES "wallets"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey for ScoreTransaction performed_by
ALTER TABLE "score_transactions" ADD CONSTRAINT "score_transactions_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
