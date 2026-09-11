-- SPEC-010 negotiation/contract/payment expansion
-- Adds negotiation / contract-template / contract-number-sequence / payment-plan /
-- analysis-engagement tables; rebuilds the prototype contract & payment tables
-- (destructive column replacement — prototype data is disposable; production data
-- migration is handled by a later deployment SPEC); makes case.lawyerId nullable.
-- Test-database oriented: NOT NULL columns without defaults are added directly because
-- the test database is reset to an empty state before each rehearsal.

-- =============================================
-- Negotiation (谈案记录)
-- =============================================
CREATE TABLE "negotiation" (
    "id" TEXT NOT NULL,
    "negotiationNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "leadId" TEXT,
    "appointmentId" TEXT,
    "negotiatorEmployeeId" TEXT NOT NULL,
    "quotedAmount" DECIMAL(18,2),
    "customerConcerns" TEXT,
    "competitorInfo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEGOTIATING',
    "unsignedReason" TEXT,
    "signedAt" TIMESTAMP(3),
    "remark" TEXT,
    "branchId" TEXT,
    "professionalTeamId" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "negotiation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "negotiation_negotiationNo_key" ON "negotiation"("negotiationNo");
CREATE INDEX "negotiation_customerId_idx" ON "negotiation"("customerId");
CREATE INDEX "negotiation_status_idx" ON "negotiation"("status");
CREATE INDEX "negotiation_negotiatorEmployeeId_idx" ON "negotiation"("negotiatorEmployeeId");
CREATE INDEX "negotiation_branchId_createdAt_idx" ON "negotiation"("branchId", "createdAt");

ALTER TABLE "negotiation"
  ADD CONSTRAINT "negotiation_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "negotiation_negotiatorEmployeeId_fkey"
    FOREIGN KEY ("negotiatorEmployeeId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================
-- ContractTemplate (合同模板)
-- =============================================
CREATE TABLE "contract_template" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "contractType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_template_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contract_template_code_key" ON "contract_template"("code");

-- =============================================
-- ContractNumberSequence (合同编号序列)
-- =============================================
CREATE TABLE "contract_number_sequence" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "lastSerial" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "contract_number_sequence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contract_number_sequence_scopeKey_key" ON "contract_number_sequence"("scopeKey");

-- =============================================
-- PaymentPlan (收款计划)
-- =============================================
CREATE TABLE "payment_plan" (
    "id" TEXT NOT NULL,
    "planNo" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "period" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "receivedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_plan_planNo_key" ON "payment_plan"("planNo");
CREATE INDEX "payment_plan_contractId_period_idx" ON "payment_plan"("contractId", "period");
CREATE INDEX "payment_plan_status_dueDate_idx" ON "payment_plan"("status", "dueDate");

ALTER TABLE "payment_plan"
  ADD CONSTRAINT "payment_plan_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================
-- AnalysisEngagement (案件分析委托)
-- =============================================
CREATE TABLE "analysis_engagement" (
    "id" TEXT NOT NULL,
    "engagementNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_engagement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "analysis_engagement_engagementNo_key" ON "analysis_engagement"("engagementNo");
CREATE UNIQUE INDEX "analysis_engagement_contractId_key" ON "analysis_engagement"("contractId");
CREATE INDEX "analysis_engagement_customerId_idx" ON "analysis_engagement"("customerId");

ALTER TABLE "analysis_engagement"
  ADD CONSTRAINT "analysis_engagement_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "analysis_engagement_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================
-- Contract: rebuild prototype columns
-- (drop legacy type/paidAmount semantics, add negotiation/esign/audit fields)
-- =============================================
ALTER TABLE "contract"
  ADD COLUMN "contractType" TEXT NOT NULL,
  ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'CUSTOMER',
  ADD COLUMN "sourceId" TEXT,
  ADD COLUMN "negotiationId" TEXT,
  ADD COLUMN "parentContractId" TEXT,
  ADD COLUMN "templateCode" TEXT,
  ADD COLUMN "templateVersion" INTEGER,
  ADD COLUMN "branchId" TEXT,
  ADD COLUMN "professionalTeamId" TEXT,
  ADD COLUMN "receivedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "submittedBy" TEXT,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "approvalComment" TEXT,
  ADD COLUMN "esignLinkId" TEXT,
  ADD COLUMN "esignSerialNo" TEXT,
  ADD COLUMN "esignStatus" TEXT,
  ADD COLUMN "esignCallbackPayload" JSONB,
  ADD COLUMN "effectiveDate" TIMESTAMP(3),
  ADD COLUMN "terminatedAt" TIMESTAMP(3),
  ADD COLUMN "terminateReason" TEXT,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidReason" TEXT,
  ADD COLUMN "updatedBy" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  DROP COLUMN "type",
  DROP COLUMN "paidAmount";

CREATE INDEX "contract_contractType_status_idx" ON "contract"("contractType", "status");
CREATE INDEX "contract_branchId_createdAt_idx" ON "contract"("branchId", "createdAt");
CREATE INDEX "contract_professionalTeamId_idx" ON "contract"("professionalTeamId");

ALTER TABLE "contract"
  ADD CONSTRAINT "contract_negotiationId_fkey"
    FOREIGN KEY ("negotiationId") REFERENCES "negotiation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "contract_parentContractId_fkey"
    FOREIGN KEY ("parentContractId") REFERENCES "contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================
-- Payment: rebuild prototype columns
-- (contractId becomes NOT NULL, receivable semantics move to payment_plan,
--  add paymentNo/confirmation/audit fields)
-- =============================================
ALTER TABLE "payment" DROP CONSTRAINT "payment_contractId_fkey";

ALTER TABLE "payment"
  ADD COLUMN "paymentNo" TEXT NOT NULL,
  ADD COLUMN "paymentPlanId" TEXT,
  ADD COLUMN "method" TEXT,
  ADD COLUMN "account" TEXT,
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "confirmedBy" TEXT,
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "createdBy" TEXT NOT NULL,
  ADD COLUMN "updatedBy" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  DROP COLUMN "contractId",
  DROP COLUMN "receivedAmount",
  DROP COLUMN "dueDate",
  DROP COLUMN "receivedDate",
  DROP COLUMN "paymentMethod",
  DROP COLUMN "paymentAccount";

ALTER TABLE "payment" ADD COLUMN "contractId" TEXT NOT NULL;
ALTER TABLE "payment" ALTER COLUMN "amount" DROP DEFAULT;

CREATE UNIQUE INDEX "payment_paymentNo_key" ON "payment"("paymentNo");
CREATE INDEX "payment_contractId_idx" ON "payment"("contractId");
CREATE INDEX "payment_paymentPlanId_idx" ON "payment"("paymentPlanId");
CREATE INDEX "payment_customerId_idx" ON "payment"("customerId");

ALTER TABLE "payment"
  ADD CONSTRAINT "payment_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payment_paymentPlanId_fkey"
    FOREIGN KEY ("paymentPlanId") REFERENCES "payment_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================
-- Case: lawyerId becomes nullable (lawyer assignable after acceptance);
-- FK delete behavior follows Prisma's SetNull default for optional relations
-- (aligns with SPEC-009 expand precedent for optional FKs).
-- =============================================
ALTER TABLE "case" ALTER COLUMN "lawyerId" DROP NOT NULL;
ALTER TABLE "case" DROP CONSTRAINT "case_lawyerId_fkey";
ALTER TABLE "case" ADD CONSTRAINT "case_lawyerId_fkey"
  FOREIGN KEY ("lawyerId") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
