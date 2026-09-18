-- CreateEnum
CREATE TYPE "ClientDebtStatus" AS ENUM ('pending', 'paid');

-- CreateTable
CREATE TABLE "client_penalty_debts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "parcel_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "remaining" DECIMAL(12,2) NOT NULL,
    "status" "ClientDebtStatus" NOT NULL DEFAULT 'pending',
    "reference" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "settled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "client_penalty_debts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_penalty_debts_reference_key" ON "client_penalty_debts"("reference");

-- CreateIndex
CREATE INDEX "client_penalty_debts_user_id_status_idx" ON "client_penalty_debts"("user_id", "status");

-- CreateIndex
CREATE INDEX "client_penalty_debts_parcel_id_idx" ON "client_penalty_debts"("parcel_id");

-- AddForeignKey
ALTER TABLE "client_penalty_debts" ADD CONSTRAINT "client_penalty_debts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_penalty_debts" ADD CONSTRAINT "client_penalty_debts_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
