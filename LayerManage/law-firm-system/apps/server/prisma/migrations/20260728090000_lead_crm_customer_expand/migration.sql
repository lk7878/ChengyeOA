-- SPEC-009 lead/CRM/customer master-data expansion
-- Additive expand (except Customer.idCard, which is L4-deferred and removed, and
-- Customer.leadId, which is renamed to sourceLeadId to preserve any existing rows).
-- Test-database oriented: NOT NULL columns without defaults are added directly because
-- the test database is reset to an empty state before each rehearsal. Production deployment
-- of these changes is handled by a later release SPEC.

-- =============================================
-- Channel: add unique business code
-- =============================================
ALTER TABLE "channel" ADD COLUMN "code" TEXT NOT NULL;
CREATE UNIQUE INDEX "channel_code_key" ON "channel"("code");

-- =============================================
-- Lead: expand audit, sourcing, pool, and relation fields
-- =============================================
ALTER TABLE "lead"
  ADD COLUMN "leadNo" TEXT NOT NULL,
  ADD COLUMN "phoneHash" TEXT NOT NULL,
  ADD COLUMN "wechatHash" TEXT,
  ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "campaignId" TEXT,
  ADD COLUMN "referralCustomerId" TEXT,
  ADD COLUMN "branchId" TEXT,
  ADD COLUMN "professionalTeamId" TEXT,
  ADD COLUMN "poolStatus" TEXT NOT NULL DEFAULT 'PUBLIC',
  ADD COLUMN "firstResponseSeconds" INTEGER,
  ADD COLUMN "assignedAt" TIMESTAMP(3),
  ADD COLUMN "createdBy" TEXT NOT NULL,
  ADD COLUMN "updatedBy" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "lead_leadNo_key" ON "lead"("leadNo");
CREATE INDEX "lead_phoneHash_idx" ON "lead"("phoneHash");
CREATE INDEX "lead_poolStatus_idx" ON "lead"("poolStatus");
CREATE INDEX "lead_campaignId_idx" ON "lead"("campaignId");
CREATE INDEX "lead_branchId_idx" ON "lead"("branchId");
CREATE INDEX "lead_professionalTeamId_idx" ON "lead"("professionalTeamId");

-- =============================================
-- Customer: drop FK + unique index, rename leadId -> sourceLeadId
-- (preserving data), drop L4-deferred idCard, add audit fields.
-- =============================================
ALTER TABLE "customer" DROP CONSTRAINT "customer_leadId_fkey";
DROP INDEX "customer_idCard_key";
ALTER TABLE "customer" DROP COLUMN "idCard";
ALTER TABLE "customer" RENAME COLUMN "leadId" TO "sourceLeadId";
ALTER INDEX "customer_leadId_key" RENAME TO "customer_sourceLeadId_key";

ALTER TABLE "customer"
  ADD COLUMN "customerNo" TEXT NOT NULL,
  ADD COLUMN "phoneHash" TEXT NOT NULL,
  ADD COLUMN "customerType" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
  ADD COLUMN "createdBy" TEXT NOT NULL,
  ADD COLUMN "updatedBy" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "customer_customerNo_key" ON "customer"("customerNo");
CREATE INDEX "customer_phoneHash_idx" ON "customer"("phoneHash");

-- =============================================
-- Campaign (channel-scoped lead acquisition campaigns)
-- =============================================
CREATE TABLE "campaign" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channelId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ENABLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaign_code_key" ON "campaign"("code");

-- =============================================
-- LeadPoolRecord (claim/assign/reassign/recycle audit trail)
-- =============================================
CREATE TABLE "lead_pool_record" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromEmployeeId" TEXT,
    "toEmployeeId" TEXT,
    "reason" TEXT,
    "operatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_pool_record_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_pool_record_leadId_createdAt_idx" ON "lead_pool_record"("leadId", "createdAt");

-- =============================================
-- Appointment (negotiation visits, with reschedule chain)
-- =============================================
CREATE TABLE "appointment" (
    "id" TEXT NOT NULL,
    "appointmentNo" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "channel" TEXT NOT NULL,
    "negotiatorEmployeeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rescheduledFromId" TEXT,
    "remark" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "appointment_appointmentNo_key" ON "appointment"("appointmentNo");
CREATE INDEX "appointment_leadId_scheduledAt_idx" ON "appointment"("leadId", "scheduledAt");
CREATE INDEX "appointment_status_scheduledAt_idx" ON "appointment"("status", "scheduledAt");

-- =============================================
-- Contact (customer contact persons, primary flag, soft delete)
-- =============================================
CREATE TABLE "contact" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "wechat" TEXT,
    "relation" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contact_customerId_idx" ON "contact"("customerId");
CREATE UNIQUE INDEX "contact_customerId_phoneHash_key" ON "contact"("customerId", "phoneHash");

-- =============================================
-- Foreign keys
-- =============================================
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "lead" ADD CONSTRAINT "lead_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "lead" ADD CONSTRAINT "lead_referralCustomerId_fkey"
  FOREIGN KEY ("referralCustomerId") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer" ADD CONSTRAINT "customer_sourceLeadId_fkey"
  FOREIGN KEY ("sourceLeadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "lead_pool_record" ADD CONSTRAINT "lead_pool_record_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "appointment" ADD CONSTRAINT "appointment_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "appointment" ADD CONSTRAINT "appointment_rescheduledFromId_fkey"
  FOREIGN KEY ("rescheduledFromId") REFERENCES "appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "contact" ADD CONSTRAINT "contact_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
