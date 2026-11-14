-- AlterTable
ALTER TABLE "cost_entry" ADD COLUMN     "sourceApprovalId" TEXT;

-- CreateTable
CREATE TABLE "approval_sync_rule" (
    "definitionId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_sync_rule_pkey" PRIMARY KEY ("definitionId")
);

-- CreateTable
CREATE TABLE "approval_sync_record" (
    "instanceId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "targetId" TEXT,
    "reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_sync_record_pkey" PRIMARY KEY ("instanceId")
);

-- CreateTable
CREATE TABLE "payroll_batch" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "instanceId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_batch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_sync_record_target_status_idx" ON "approval_sync_record"("target", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_batch_instanceId_key" ON "payroll_batch"("instanceId");

-- CreateIndex
CREATE INDEX "payroll_batch_ownerUserId_createdAt_idx" ON "payroll_batch"("ownerUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "cost_entry_sourceApprovalId_key" ON "cost_entry"("sourceApprovalId");

-- AddForeignKey
ALTER TABLE "cost_entry" ADD CONSTRAINT "cost_entry_sourceApprovalId_fkey" FOREIGN KEY ("sourceApprovalId") REFERENCES "approval_instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_sync_rule" ADD CONSTRAINT "approval_sync_rule_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "approval_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_sync_record" ADD CONSTRAINT "approval_sync_record_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "approval_instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_batch" ADD CONSTRAINT "payroll_batch_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "approval_attachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_batch" ADD CONSTRAINT "payroll_batch_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "approval_instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


INSERT INTO approval_definition (id, code, name, "businessType", "formSchema", "approverRule", version, status, "createdBy", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'PAYROLL', '工资发放审批', 'PAYROLL', '{"fields":[{"key":"period","label":"工资月份","type":"text","required":true}]}', '{"type":"ROLE","roleCodes":["FINANCE"]}', 1, 'ACTIVE', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (code) DO NOTHING;
ALTER TABLE approval_sync_rule ADD CONSTRAINT approval_sync_rule_target_check CHECK (target IN ('COST','LEAVE','SEAL','CONTRACT_CHANGE','CUSTOM'));
ALTER TABLE approval_sync_record ADD CONSTRAINT approval_sync_status_check CHECK (status IN ('SYNCED','FAILED','PENDING_CONFIG'));
