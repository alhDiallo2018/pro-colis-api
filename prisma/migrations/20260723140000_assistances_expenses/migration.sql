-- Journal des assistances (mail / chat / appel) + registre des dépenses.

-- CreateTable: assistances
CREATE TABLE "assistances" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "user_id" UUID,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'chat',
    "subject" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "handled_by" UUID,
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "assistances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assistances_code_key" ON "assistances"("code");
CREATE INDEX "assistances_status_idx" ON "assistances"("status");
CREATE INDEX "assistances_channel_idx" ON "assistances"("channel");
CREATE INDEX "assistances_created_at_idx" ON "assistances"("created_at");

ALTER TABLE "assistances" ADD CONSTRAINT "assistances_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "assistances" ADD CONSTRAINT "assistances_handled_by_fkey"
    FOREIGN KEY ("handled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: expenses
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'autre',
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "description" TEXT,
    "proof_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'paid',
    "spent_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "expenses_reference_key" ON "expenses"("reference");
CREATE INDEX "expenses_status_idx" ON "expenses"("status");
CREATE INDEX "expenses_category_idx" ON "expenses"("category");
CREATE INDEX "expenses_spent_at_idx" ON "expenses"("spent_at");

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
