-- Shuttle Operator CRUD : rattache les TransitLine à un opérateur User
-- (role `shuttle_operator`) et ajoute deux tables (véhicules et horaires).
-- Les lignes seedées historiques (catalogue public DDD/AFTU) restent avec
-- operator_user_id NULL et donc non modifiables par l'espace opérateur.

ALTER TABLE "transit_lines"
  ADD COLUMN "operator_user_id" UUID;

ALTER TABLE "transit_lines"
  ADD CONSTRAINT "transit_lines_operator_user_id_fkey"
  FOREIGN KEY ("operator_user_id") REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX "transit_lines_operator_user_id_idx"
  ON "transit_lines"("operator_user_id");

-- Véhicules collectifs rattachés à un opérateur.
CREATE TABLE "shuttle_vehicles" (
  "id"               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "operator_user_id" UUID        NOT NULL,
  "plate_number"     TEXT        NOT NULL,
  "model"            TEXT        NOT NULL,
  "type"             TEXT        NOT NULL,
  "capacity"         INTEGER     NOT NULL DEFAULT 0,
  "status"           TEXT        NOT NULL DEFAULT 'available',
  "notes"            TEXT,
  "deleted_at"       TIMESTAMPTZ,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "shuttle_vehicles_operator_user_id_fkey"
    FOREIGN KEY ("operator_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "shuttle_vehicles_operator_user_id_plate_number_key"
    UNIQUE ("operator_user_id", "plate_number")
);

CREATE INDEX "shuttle_vehicles_operator_user_id_idx"
  ON "shuttle_vehicles"("operator_user_id");
CREATE INDEX "shuttle_vehicles_status_idx"
  ON "shuttle_vehicles"("status");

-- Plages de service récurrentes : jours de la semaine (0 dim → 6 sam) et
-- heure locale de départ. activeUntil nullable = plage ouverte.
CREATE TABLE "shuttle_schedules" (
  "id"               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "operator_user_id" UUID        NOT NULL,
  "transit_line_id"  UUID        NOT NULL,
  "days_of_week"     INTEGER[]   NOT NULL,
  "departure_time"   TEXT        NOT NULL,
  "active_from"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "active_until"     TIMESTAMPTZ,
  "notes"            TEXT,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "shuttle_schedules_operator_user_id_fkey"
    FOREIGN KEY ("operator_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "shuttle_schedules_transit_line_id_fkey"
    FOREIGN KEY ("transit_line_id") REFERENCES "transit_lines"("id") ON DELETE CASCADE
);

CREATE INDEX "shuttle_schedules_operator_user_id_idx"
  ON "shuttle_schedules"("operator_user_id");
CREATE INDEX "shuttle_schedules_transit_line_id_idx"
  ON "shuttle_schedules"("transit_line_id");
