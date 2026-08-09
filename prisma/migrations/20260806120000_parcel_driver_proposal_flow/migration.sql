-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('pending', 'accepted', 'rejected', 'countered', 'expired');

-- CreateEnum
CREATE TYPE "NegotiationRole" AS ENUM ('client', 'driver');

-- AlterTable
-- `driver_id` devient `assigned_driver_id` : le chauffeur retenu. On renomme au
-- lieu de recreer la colonne pour conserver les affectations existantes (le
-- diff Prisma proposerait un DROP + ADD, qui les perdrait).
ALTER TABLE "parcels" RENAME COLUMN "driver_id" TO "assigned_driver_id";
ALTER TABLE "parcels" RENAME CONSTRAINT "parcels_driver_id_fkey" TO "parcels_assigned_driver_id_fkey";
ALTER INDEX "parcels_driver_id_idx" RENAME TO "parcels_assigned_driver_id_idx";

-- AlterTable
ALTER TABLE "parcels" ADD COLUMN     "proposed_driver_id" UUID,
ADD COLUMN     "proposal_status" "ProposalStatus",
ADD COLUMN     "proposal_price" DECIMAL(12,2),
ADD COLUMN     "proposal_expires_at" TIMESTAMPTZ,
ADD COLUMN     "last_counter_price" DECIMAL(12,2),
ADD COLUMN     "negotiation_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "bids" ADD COLUMN     "is_direct_proposal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parent_proposal_id" UUID;

-- AlterTable
ALTER TABLE "negotiation_messages" ADD COLUMN     "is_counter_offer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parcel_id" UUID;

-- CreateIndex
CREATE INDEX "parcels_proposed_driver_id_idx" ON "parcels"("proposed_driver_id");

-- AddForeignKey
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_proposed_driver_id_fkey" FOREIGN KEY ("proposed_driver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_parent_proposal_id_fkey" FOREIGN KEY ("parent_proposal_id") REFERENCES "bids"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negotiation_messages" ADD CONSTRAINT "negotiation_messages_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
