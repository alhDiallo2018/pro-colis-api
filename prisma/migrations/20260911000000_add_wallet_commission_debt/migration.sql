-- AlterTable Wallet
ALTER TABLE "wallets" ADD COLUMN "commission_debt" DECIMAL(12,2) NOT NULL DEFAULT 0;
