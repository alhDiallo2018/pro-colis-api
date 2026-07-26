-- Rôles support technique / support commercial, et les tables métier associées.
--
-- `support` est ajouté ici bien qu'il figure depuis longtemps dans
-- schema.prisma : il n'avait jamais été migré (l'enum en base ne contenait que
-- client / driver / admin / super_admin). Sans cet ajout, chaque `migrate diff`
-- ultérieur continuerait de le réclamer.
--
-- Généré via `prisma migrate diff`, puis élagué : le diff embarquait aussi
-- 7 `ALTER COLUMN "updated_at" DROP DEFAULT` correspondant à une dérive
-- pré-existante et sans rapport avec les rôles support. Les inclure aurait
-- modifié silencieusement des tables tierces (assistances, wallets, zones…).

-- CreateEnum
CREATE TYPE "TicketChannel" AS ENUM ('in_app', 'phone', 'email');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('low', 'normal', 'high', 'critical');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('open', 'pending', 'in_progress', 'resolved');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('sev1', 'sev2', 'sev3');

-- CreateEnum
CREATE TYPE "LeadKind" AS ENUM ('garage', 'business_client', 'driver_fleet');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('contacted', 'qualified', 'negotiation', 'signed');

-- AlterEnum
-- PostgreSQL 12+ accepte plusieurs ADD VALUE dans une transaction tant que les
-- nouvelles valeurs ne sont pas utilisées dans cette même transaction — ce qui
-- est le cas ici (aucun INSERT/UPDATE sur users).
ALTER TYPE "UserRole" ADD VALUE 'support';
ALTER TYPE "UserRole" ADD VALUE 'support_technique';
ALTER TYPE "UserRole" ADD VALUE 'support_commercial';

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "requester_id" UUID,
    "assignee_id" UUID,
    "channel" "TicketChannel" NOT NULL DEFAULT 'in_app',
    "priority" "TicketPriority" NOT NULL DEFAULT 'normal',
    "status" "TicketStatus" NOT NULL DEFAULT 'open',
    "sla_due_at" TIMESTAMPTZ,
    "first_response_at" TIMESTAMPTZ,
    "resolved_at" TIMESTAMPTZ,
    "satisfaction_score" INTEGER,
    "category" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_incidents" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "mitigated" BOOLEAN NOT NULL DEFAULT false,
    "impacted_users" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_leads" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "kind" "LeadKind" NOT NULL DEFAULT 'business_client',
    "stage" "LeadStage" NOT NULL DEFAULT 'contacted',
    "monthly_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "next_follow_up_at" DATE,
    "owner_id" UUID,
    "signed_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "commercial_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_objectives" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "period" DATE NOT NULL,
    "target_amount" DECIMAL(12,2) NOT NULL,
    "territory" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "commercial_objectives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_reference_key" ON "support_tickets"("reference");

-- CreateIndex
CREATE INDEX "support_tickets_status_idx" ON "support_tickets"("status");

-- CreateIndex
CREATE INDEX "support_tickets_assignee_id_idx" ON "support_tickets"("assignee_id");

-- CreateIndex
CREATE INDEX "support_tickets_sla_due_at_idx" ON "support_tickets"("sla_due_at");

-- CreateIndex
CREATE INDEX "platform_incidents_resolved_at_idx" ON "platform_incidents"("resolved_at");

-- CreateIndex
CREATE INDEX "commercial_leads_owner_id_idx" ON "commercial_leads"("owner_id");

-- CreateIndex
CREATE INDEX "commercial_leads_next_follow_up_at_idx" ON "commercial_leads"("next_follow_up_at");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_objectives_owner_id_period_key" ON "commercial_objectives"("owner_id", "period");

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_incidents" ADD CONSTRAINT "platform_incidents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_leads" ADD CONSTRAINT "commercial_leads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_objectives" ADD CONSTRAINT "commercial_objectives_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
