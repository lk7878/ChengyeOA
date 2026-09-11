-- SPEC-011 finance operations expand: InvoiceRequest / RefundRequest / CostEntry +
-- Payment void columns. DDL idiom mirrors 20260730120000_negotiation_contract_payment_expand.

-- AlterTable
ALTER TABLE "payment" ADD COLUMN "voidedBy" TEXT,
ADD COLUMN "voidedAt" TIMESTAMP(3),
ADD COLUMN "voidReason" TEXT;

-- CreateTable
CREATE TABLE "invoice_request" (
    "id" TEXT NOT NULL,
    "requestNo" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalComment" TEXT,
    "invoiceNo" TEXT,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_request_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "refund_request" (
    "id" TEXT NOT NULL,
    "requestNo" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "paymentId" TEXT,
    "planId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalComment" TEXT,
    "executedBy" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_request_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cost_entry" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "channelId" TEXT,
    "caseId" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_request_requestNo_key" ON "invoice_request"("requestNo");
CREATE INDEX "invoice_request_contractId_idx" ON "invoice_request"("contractId");
CREATE INDEX "invoice_request_customerId_idx" ON "invoice_request"("customerId");
CREATE INDEX "invoice_request_status_idx" ON "invoice_request"("status");
CREATE UNIQUE INDEX "refund_request_requestNo_key" ON "refund_request"("requestNo");
CREATE INDEX "refund_request_contractId_idx" ON "refund_request"("contractId");
CREATE INDEX "refund_request_paymentId_idx" ON "refund_request"("paymentId");
CREATE INDEX "refund_request_planId_idx" ON "refund_request"("planId");
CREATE INDEX "refund_request_status_idx" ON "refund_request"("status");
CREATE INDEX "cost_entry_category_idx" ON "cost_entry"("category");
CREATE INDEX "cost_entry_channelId_idx" ON "cost_entry"("channelId");
CREATE INDEX "cost_entry_caseId_idx" ON "cost_entry"("caseId");

-- AddForeignKey（FK 命名惯式：<table>_<column>_fkey；必填关系 RESTRICT、可选关系 SET NULL，与 expand 迁移先例一致）
ALTER TABLE "invoice_request" ADD CONSTRAINT "invoice_request_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_request" ADD CONSTRAINT "invoice_request_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_planId_fkey" FOREIGN KEY ("planId") REFERENCES "payment_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cost_entry" ADD CONSTRAINT "cost_entry_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cost_entry" ADD CONSTRAINT "cost_entry_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "case"("id") ON DELETE SET NULL ON UPDATE CASCADE;
