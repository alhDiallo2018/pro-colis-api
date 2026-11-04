-- Catalogue public des lignes DDD / AFTU. Partage par tous les chauffeurs.
CREATE TYPE "TransitOperator" AS ENUM ('ddd', 'aftu');
CREATE TYPE "TransitDirection" AS ENUM ('aller', 'retour');

CREATE TABLE "transit_lines" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "operator"    "TransitOperator" NOT NULL,
  "number"      TEXT NOT NULL,
  "direction"   "TransitDirection" NOT NULL,
  "name"        TEXT NOT NULL,
  "origin"      TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "source"      TEXT,
  "metadata"    JSONB NOT NULL DEFAULT '{}',
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMPTZ NOT NULL,
  CONSTRAINT "transit_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "transit_lines_operator_number_direction_key"
  ON "transit_lines"("operator", "number", "direction");
CREATE INDEX "transit_lines_operator_idx" ON "transit_lines"("operator");

CREATE TABLE "transit_line_stops" (
  "transit_line_id" UUID NOT NULL,
  "order"           INTEGER NOT NULL,
  "zone_id"         UUID NOT NULL,
  "label"           TEXT NOT NULL,
  CONSTRAINT "transit_line_stops_pkey" PRIMARY KEY ("transit_line_id", "order"),
  CONSTRAINT "transit_line_stops_line_fkey"
    FOREIGN KEY ("transit_line_id") REFERENCES "transit_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "transit_line_stops_zone_fkey"
    FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "transit_line_stops_zone_id_idx" ON "transit_line_stops"("zone_id");

ALTER TABLE "advertisements" ADD COLUMN "transit_line_id" UUID;
ALTER TABLE "advertisements" ADD CONSTRAINT "advertisements_transit_line_id_fkey"
  FOREIGN KEY ("transit_line_id") REFERENCES "transit_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "advertisements_transit_line_id_status_departure_at_idx"
  ON "advertisements"("transit_line_id", "status", "departure_at");
