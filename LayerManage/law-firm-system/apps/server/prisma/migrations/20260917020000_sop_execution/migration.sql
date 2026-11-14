-- AlterTable
ALTER TABLE "case_task" ADD COLUMN     "assigneeUserId" TEXT,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "nodeCode" TEXT,
ADD COLUMN     "nodeSnapshot" JSONB,
ADD COLUMN     "sopInstanceId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "sop_instance" ADD COLUMN     "batchKey" TEXT NOT NULL DEFAULT 'PRIMARY';

-- CreateTable
CREATE TABLE "sop_task_access" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "principalUserId" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "canExecute" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sop_task_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sop_task_access_principalUserId_revokedAt_validUntil_idx" ON "sop_task_access"("principalUserId", "revokedAt", "validUntil");

-- CreateIndex
CREATE INDEX "case_task_assigneeUserId_status_dueDate_idx" ON "case_task"("assigneeUserId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "case_task_createdBy_idx" ON "case_task"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "case_task_sopInstanceId_nodeCode_key" ON "case_task"("sopInstanceId", "nodeCode");

-- CreateIndex
CREATE UNIQUE INDEX "sop_instance_caseId_templateVersionId_batchKey_key" ON "sop_instance"("caseId", "templateVersionId", "batchKey");

-- AddForeignKey
ALTER TABLE "case_task" ADD CONSTRAINT "case_task_sopInstanceId_fkey" FOREIGN KEY ("sopInstanceId") REFERENCES "sop_instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_task" ADD CONSTRAINT "case_task_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_task_access" ADD CONSTRAINT "sop_task_access_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "case_task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_task_access" ADD CONSTRAINT "sop_task_access_principalUserId_fkey" FOREIGN KEY ("principalUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_task_access" ADD CONSTRAINT "sop_task_access_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "case_task" ADD CONSTRAINT "case_task_sop_shape" CHECK (("sopInstanceId" IS NULL AND "nodeCode" IS NULL AND "nodeSnapshot" IS NULL) OR ("sopInstanceId" IS NOT NULL AND "nodeCode" IS NOT NULL AND "nodeSnapshot" IS NOT NULL AND "createdBy" IS NOT NULL));
ALTER TABLE "case_task" ADD CONSTRAINT "case_task_version_positive" CHECK (version > 0);
CREATE UNIQUE INDEX "sop_task_access_active" ON "sop_task_access" ("taskId", "principalUserId") WHERE "revokedAt" IS NULL;
ALTER TABLE "sop_task_access" ADD CONSTRAINT "sop_task_access_dates" CHECK (("validUntil" IS NULL OR "validUntil" > "validFrom") AND (("revokedAt" IS NULL AND "revokeReason" IS NULL) OR ("revokedAt" IS NOT NULL AND length(btrim("revokeReason")) > 0)));
INSERT INTO "permission" (id,code,name,type,resource,action,"riskLevel",path,status,"updatedAt") VALUES ('permission:menu.sop_tasks', 'menu.sop_tasks', 'SOP任务', 'MENU', 'menu', 'view', 'LOW', '/sop/tasks', 'ENABLED', CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO "permission" (id,code,name,type,resource,action,"riskLevel",path,status,"updatedAt") VALUES ('permission:sop.instance.read', 'sop.instance.read', '查看SOP流程', 'ACTION', 'sop_instance', 'read', 'LOW', NULL, 'ENABLED', CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO "permission" (id,code,name,type,resource,action,"riskLevel",path,status,"updatedAt") VALUES ('permission:sop.instance.start', 'sop.instance.start', '启动SOP流程', 'ACTION', 'sop_instance', 'start', 'MEDIUM', NULL, 'ENABLED', CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO "permission" (id,code,name,type,resource,action,"riskLevel",path,status,"updatedAt") VALUES ('permission:sop.instance.manage', 'sop.instance.manage', '管理SOP流程', 'ACTION', 'sop_instance', 'manage', 'MEDIUM', NULL, 'ENABLED', CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO "permission" (id,code,name,type,resource,action,"riskLevel",path,status,"updatedAt") VALUES ('permission:sop.task.read', 'sop.task.read', '查看SOP任务', 'ACTION', 'sop_task', 'read', 'LOW', NULL, 'ENABLED', CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO "permission" (id,code,name,type,resource,action,"riskLevel",path,status,"updatedAt") VALUES ('permission:sop.task.execute', 'sop.task.execute', '执行SOP任务', 'ACTION', 'sop_task', 'execute', 'MEDIUM', NULL, 'ENABLED', CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO "permission" (id,code,name,type,resource,action,"riskLevel",path,status,"updatedAt") VALUES ('permission:sop.task.manage', 'sop.task.manage', '分派管理SOP任务', 'ACTION', 'sop_task', 'manage', 'MEDIUM', NULL, 'ENABLED', CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
