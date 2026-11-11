-- ─────────────────────────────────────────────────────────────────────
-- Migration 2026-11-12 — Fiabilité webhooks + métriques pilote.
--
-- 1. Crée `webhook_deliveries` : queue persistante des envois sortants.
--    Un worker interne la scanne pour appliquer les retries exponentiels.
-- 2. Crée `whatsapp_dispatches` : trace les envois WhatsApp (sent/delivered/
--    read) pour alimenter le dashboard pilote et préparer le callback Meta.
-- 3. Crée `anomaly_events` : journal des anomalies détectées par
--    `anomaly-detector`. Alimente `getPilotMetrics`.
--
-- Idempotence : IF NOT EXISTS partout pour pouvoir rejouer sans erreur.
-- ─────────────────────────────────────────────────────────────────────

-- 1. Queue de livraison webhook sortant.
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "partner_key_id" TEXT NOT NULL,
  "partner_name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "secret" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INT NOT NULL DEFAULT 0,
  "max_attempts" INT NOT NULL DEFAULT 6,
  "last_status_code" INT,
  "last_error" TEXT,
  "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "delivered_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "webhook_deliveries_status_next_attempt_at_idx"
  ON "webhook_deliveries"("status", "next_attempt_at");

CREATE INDEX IF NOT EXISTS "webhook_deliveries_partner_key_id_idx"
  ON "webhook_deliveries"("partner_key_id");

-- 2. Envois WhatsApp instrumentés.
CREATE TABLE IF NOT EXISTS "whatsapp_dispatches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "message_id" TEXT,
  "phone" TEXT NOT NULL,
  "template_name" TEXT NOT NULL,
  "parcel_id" UUID,
  "status" TEXT NOT NULL DEFAULT 'sent',
  "sent_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "delivered_at" TIMESTAMPTZ,
  "read_at" TIMESTAMPTZ,
  "failed_at" TIMESTAMPTZ,
  "error_reason" TEXT,
  CONSTRAINT "whatsapp_dispatches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_dispatches_message_id_key"
  ON "whatsapp_dispatches"("message_id")
  WHERE "message_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "whatsapp_dispatches_status_idx"
  ON "whatsapp_dispatches"("status");

CREATE INDEX IF NOT EXISTS "whatsapp_dispatches_parcel_id_idx"
  ON "whatsapp_dispatches"("parcel_id");

-- 3. Journal des anomalies détectées (gpsSilence, prolongedStop, routeDeviation).
CREATE TABLE IF NOT EXISTS "anomaly_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "parcel_id" UUID,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'info',
  "details" JSONB,
  "detected_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "anomaly_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "anomaly_events_type_detected_at_idx"
  ON "anomaly_events"("type", "detected_at");

CREATE INDEX IF NOT EXISTS "anomaly_events_parcel_id_idx"
  ON "anomaly_events"("parcel_id");
