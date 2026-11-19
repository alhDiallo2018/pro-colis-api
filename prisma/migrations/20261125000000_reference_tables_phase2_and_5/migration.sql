-- DropForeignKey
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "journey_stop_events" DROP CONSTRAINT "journey_stop_events_advertisement_id_fkey";

-- DropForeignKey
ALTER TABLE "journey_stop_events" DROP CONSTRAINT "journey_stop_events_driver_id_fkey";

-- DropForeignKey
ALTER TABLE "referrals" DROP CONSTRAINT "referrals_referree_id_fkey";

-- DropForeignKey
ALTER TABLE "referrals" DROP CONSTRAINT "referrals_referrer_id_fkey";

-- DropForeignKey
ALTER TABLE "shuttle_schedules" DROP CONSTRAINT "shuttle_schedules_operator_user_id_fkey";

-- DropForeignKey
ALTER TABLE "shuttle_schedules" DROP CONSTRAINT "shuttle_schedules_transit_line_id_fkey";

-- DropForeignKey
ALTER TABLE "shuttle_vehicles" DROP CONSTRAINT "shuttle_vehicles_operator_user_id_fkey";

-- DropForeignKey
ALTER TABLE "transit_lines" DROP CONSTRAINT "transit_lines_operator_user_id_fkey";

-- DropIndex
DROP INDEX "parcels_batch_id_idx";

-- AlterTable
ALTER TABLE "anomaly_events" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "api_keys" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "fraud_alerts" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "flags" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "insurance_subscriptions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "journey_stop_events" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "parcel_customs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "parcel_handovers" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "referrals" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "shipment_batches" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "shuttle_schedules" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "shuttle_stop_confirmations" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "shuttle_vehicles" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "transit_lines" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "webhook_deliveries" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "whatsapp_dispatches" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "vehicle_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "max_weight_kg" DOUBLE PRECISION,
    "max_volume_m3" DOUBLE PRECISION,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vehicle_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "applies_to" TEXT NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcel_categories" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "icon" TEXT,
    "max_weight_kg" DOUBLE PRECISION,
    "is_fragile" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "parcel_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_method_options" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "provider" TEXT,
    "channel" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payment_method_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_status_options" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "driver_status_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_severity_levels" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT,
    "sla_hours" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "incident_severity_levels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_types_code_key" ON "vehicle_types"("code");

-- CreateIndex
CREATE INDEX "vehicle_types_category_idx" ON "vehicle_types"("category");

-- CreateIndex
CREATE INDEX "vehicle_types_is_active_idx" ON "vehicle_types"("is_active");

-- CreateIndex
CREATE INDEX "vehicle_types_sort_order_idx" ON "vehicle_types"("sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "document_types_code_key" ON "document_types"("code");

-- CreateIndex
CREATE INDEX "document_types_applies_to_idx" ON "document_types"("applies_to");

-- CreateIndex
CREATE INDEX "document_types_is_active_idx" ON "document_types"("is_active");

-- CreateIndex
CREATE INDEX "document_types_sort_order_idx" ON "document_types"("sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_code_key" ON "expense_categories"("code");

-- CreateIndex
CREATE INDEX "expense_categories_is_active_idx" ON "expense_categories"("is_active");

-- CreateIndex
CREATE INDEX "expense_categories_sort_order_idx" ON "expense_categories"("sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "parcel_categories_code_key" ON "parcel_categories"("code");

-- CreateIndex
CREATE INDEX "parcel_categories_is_active_idx" ON "parcel_categories"("is_active");

-- CreateIndex
CREATE INDEX "parcel_categories_sort_order_idx" ON "parcel_categories"("sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "payment_method_options_code_key" ON "payment_method_options"("code");

-- CreateIndex
CREATE INDEX "payment_method_options_channel_idx" ON "payment_method_options"("channel");

-- CreateIndex
CREATE INDEX "payment_method_options_is_active_idx" ON "payment_method_options"("is_active");

-- CreateIndex
CREATE INDEX "payment_method_options_sort_order_idx" ON "payment_method_options"("sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "driver_status_options_code_key" ON "driver_status_options"("code");

-- CreateIndex
CREATE INDEX "driver_status_options_is_active_idx" ON "driver_status_options"("is_active");

-- CreateIndex
CREATE INDEX "driver_status_options_sort_order_idx" ON "driver_status_options"("sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "incident_severity_levels_code_key" ON "incident_severity_levels"("code");

-- CreateIndex
CREATE INDEX "incident_severity_levels_is_active_idx" ON "incident_severity_levels"("is_active");

-- CreateIndex
CREATE INDEX "incident_severity_levels_sort_order_idx" ON "incident_severity_levels"("sort_order");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_dispatches_message_id_key" ON "whatsapp_dispatches"("message_id");

-- RenameForeignKey
ALTER TABLE "transit_line_stops" RENAME CONSTRAINT "transit_line_stops_line_fkey" TO "transit_line_stops_transit_line_id_fkey";

-- RenameForeignKey
ALTER TABLE "transit_line_stops" RENAME CONSTRAINT "transit_line_stops_zone_fkey" TO "transit_line_stops_zone_id_fkey";

-- AddForeignKey
ALTER TABLE "transit_lines" ADD CONSTRAINT "transit_lines_operator_user_id_fkey" FOREIGN KEY ("operator_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shuttle_vehicles" ADD CONSTRAINT "shuttle_vehicles_operator_user_id_fkey" FOREIGN KEY ("operator_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shuttle_schedules" ADD CONSTRAINT "shuttle_schedules_operator_user_id_fkey" FOREIGN KEY ("operator_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shuttle_schedules" ADD CONSTRAINT "shuttle_schedules_transit_line_id_fkey" FOREIGN KEY ("transit_line_id") REFERENCES "transit_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referree_id_fkey" FOREIGN KEY ("referree_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "parcel_customs_destination_idx" RENAME TO "parcel_customs_destination_country_idx";

-- RenameIndex
ALTER INDEX "parcel_customs_origin_idx" RENAME TO "parcel_customs_origin_country_idx";

