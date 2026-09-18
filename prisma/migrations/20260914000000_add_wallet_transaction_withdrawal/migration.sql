-- AlterTable WalletTransaction
-- Rattache une transaction wallet a son retrait d'origine : garantit qu'un
-- retrait metier ne produit qu'une seule transaction de type `withdrawal`,
-- mise a jour au fil du cycle de vie (pending -> processing -> completed/failed/cancelled).
ALTER TABLE "wallet_transactions" ADD COLUMN "withdrawal_id" UUID;

-- CreateIndex
CREATE INDEX "wallet_transactions_withdrawal_id_idx" ON "wallet_transactions"("withdrawal_id");

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_withdrawal_id_fkey" FOREIGN KEY ("withdrawal_id") REFERENCES "withdrawals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
