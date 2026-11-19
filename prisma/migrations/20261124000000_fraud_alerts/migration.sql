-- ─────────────────────────────────────────────────────────────────────
-- Migration 2026-11-24 — Alertes fraude persistées.
--
-- Création de `fraud_alerts` : chaque ligne matérialise une alerte
-- calculée par le scoring (`src/utils/fraud-scoring.js`) jugée actionnable
-- (level medium|high). Les alertes sont « ouvertes » tant que
-- `resolved_at` est NULL. Un super-admin peut les clore via
-- POST /super-admin/fraud/alerts/:id/resolve.
--
-- Note sur le nommage : la consigne mentionne `20261120000000_fraud_alerts`
-- mais ce préfixe horodaté est déjà utilisé par `_api_key_owner`.
-- Pour conserver l'ordre lexicographique attendu par Prisma, on utilise
-- 2026-11-24. Idempotence : IF NOT EXISTS partout.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "fraud_alerts" (
  "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
  "user_id"        UUID        NOT NULL,
  "score"          INTEGER     NOT NULL,
  "level"          TEXT        NOT NULL,
  "flags"          TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes"          TEXT,
  "resolved_at"    TIMESTAMPTZ,
  "resolved_by_id" UUID,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "fraud_alerts_pkey" PRIMARY KEY ("id")
);

-- Foreign keys — DO NOT re-create if already present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fraud_alerts_user_id_fkey'
  ) THEN
    ALTER TABLE "fraud_alerts"
      ADD CONSTRAINT "fraud_alerts_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fraud_alerts_resolved_by_id_fkey'
  ) THEN
    ALTER TABLE "fraud_alerts"
      ADD CONSTRAINT "fraud_alerts_resolved_by_id_fkey"
      FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "fraud_alerts_user_id_idx"     ON "fraud_alerts" ("user_id");
CREATE INDEX IF NOT EXISTS "fraud_alerts_level_idx"       ON "fraud_alerts" ("level");
CREATE INDEX IF NOT EXISTS "fraud_alerts_resolved_at_idx" ON "fraud_alerts" ("resolved_at");
