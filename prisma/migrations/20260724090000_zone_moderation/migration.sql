-- Modération des zones : status (approved/pending/rejected) + source (manual/places/garage).
-- Les zones existantes restent "approved" et "manual" (valeurs par défaut).
ALTER TABLE "zones" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE "zones" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';

CREATE INDEX "zones_status_idx" ON "zones"("status");
