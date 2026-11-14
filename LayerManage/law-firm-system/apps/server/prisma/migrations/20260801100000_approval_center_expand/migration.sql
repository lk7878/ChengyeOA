-- SPEC-013 approval center expand: drop legacy approval, add
-- ApprovalDefinition / ApprovalInstance / ApprovalTask / CallbackAction.
-- DDL idiom mirrors SPEC-011/012 expand migrations (TEXT id PK no default,
-- TIMESTAMP(3), JSONB, separate CREATE INDEX, FK RESTRICT/CASCADE).

-- DropTable
DROP TABLE "approval";

-- CreateTable
CREATE TABLE "approval_definition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessType" TEXT NOT NULL,
    "formSchema" JSONB NOT NULL,
    "approverRule" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_definition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "approval_instance" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "definitionVersion" INTEGER NOT NULL,
    "businessType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "applicantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_instance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "approval_task" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "nodeName" TEXT NOT NULL DEFAULT '审批',
    "assigneeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "remark" TEXT,
    "processedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_task_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "callback_action" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "callbackKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESPONDED',
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "callback_action_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_definition_code_key" ON "approval_definition"("code");

CREATE INDEX "approval_instance_applicantId_idx" ON "approval_instance"("applicantId");
CREATE INDEX "approval_instance_businessType_status_idx" ON "approval_instance"("businessType", "status");

CREATE INDEX "approval_task_assigneeId_status_idx" ON "approval_task"("assigneeId", "status");

CREATE UNIQUE INDEX "callback_action_callbackKey_key" ON "callback_action"("callbackKey");
CREATE INDEX "callback_action_instanceId_idx" ON "callback_action"("instanceId");

-- AddForeignKey
ALTER TABLE "approval_instance" ADD CONSTRAINT "approval_instance_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "approval_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_task" ADD CONSTRAINT "approval_task_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "approval_instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
