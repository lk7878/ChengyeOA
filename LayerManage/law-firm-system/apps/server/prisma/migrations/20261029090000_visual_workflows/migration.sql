-- CreateTable
CREATE TABLE "workflow_definition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_instance" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "definitionVersion" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    "selections" JSONB NOT NULL,
    "applicantId" TEXT NOT NULL,
    "currentNode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "visit" INTEGER NOT NULL DEFAULT 1,
    "targetRecordId" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'NONE',
    "syncError" TEXT,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "workflow_instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_task" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "visit" INTEGER NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "position" INTEGER NOT NULL DEFAULT 0,
    "remark" TEXT,
    "dueAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_log" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "remark" TEXT,
    "changes" JSONB,
    "requestKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_delivery" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_file" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_file_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_instance_requestKey_key" ON "workflow_instance"("requestKey");

-- CreateIndex
CREATE INDEX "workflow_instance_applicantId_createdAt_idx" ON "workflow_instance"("applicantId", "createdAt");

-- CreateIndex
CREATE INDEX "workflow_instance_status_updatedAt_idx" ON "workflow_instance"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "workflow_task_assigneeId_status_idx" ON "workflow_task"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "workflow_task_status_dueAt_idx" ON "workflow_task"("status", "dueAt");

-- CreateIndex
CREATE INDEX "workflow_task_instanceId_nodeId_visit_idx" ON "workflow_task"("instanceId", "nodeId", "visit");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_log_requestKey_key" ON "workflow_log"("requestKey");

-- CreateIndex
CREATE INDEX "workflow_log_instanceId_createdAt_idx" ON "workflow_log"("instanceId", "createdAt");

-- CreateIndex
CREATE INDEX "workflow_delivery_status_nextAt_idx" ON "workflow_delivery"("status", "nextAt");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_delivery_instanceId_hook_key" ON "workflow_delivery"("instanceId", "hook");

-- CreateIndex
CREATE INDEX "workflow_file_ownerId_createdAt_idx" ON "workflow_file"("ownerId", "createdAt");

-- AddForeignKey
ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "workflow_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_task" ADD CONSTRAINT "workflow_task_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "workflow_instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_log" ADD CONSTRAINT "workflow_log_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "workflow_instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_delivery" ADD CONSTRAINT "workflow_delivery_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "workflow_instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
