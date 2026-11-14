-- CreateTable
CREATE TABLE "collab_workspace" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collab_workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_member" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "principalType" TEXT NOT NULL DEFAULT 'USER',
    "principalId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'READER',
    "canCreate" BOOLEAN NOT NULL DEFAULT false,
    "rowScope" TEXT NOT NULL DEFAULT 'ALL',
    "hiddenFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "readonlyFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "collab_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_base" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "collab_base_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_table" (
    "id" TEXT NOT NULL,
    "baseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'CUSTOM',
    "position" INTEGER NOT NULL DEFAULT 0,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collab_table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_field" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'TEXT',
    "options" JSONB NOT NULL DEFAULT '{}',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "defaultValue" JSONB,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "collab_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_view" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'GRID',
    "ownerId" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "collab_view_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_record" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collab_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_relation" (
    "id" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "targetRecordId" TEXT NOT NULL,

    CONSTRAINT "collab_relation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_revision" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collab_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_mutation" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collab_mutation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_event" (
    "id" BIGSERIAL NOT NULL,
    "baseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collab_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_presence" (
    "id" TEXT NOT NULL,
    "baseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collab_presence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_comment" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collab_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_attachment" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collab_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_rule" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "trigger" TEXT NOT NULL,
    "condition" JSONB NOT NULL DEFAULT '{}',
    "action" JSONB NOT NULL,

    CONSTRAINT "collab_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_run" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "recordVersion" INTEGER NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collab_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_preference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "viewId" TEXT NOT NULL,

    CONSTRAINT "collab_preference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "collab_workspace_organizationId_idx" ON "collab_workspace"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "collab_member_workspaceId_principalType_principalId_key" ON "collab_member"("workspaceId", "principalType", "principalId");

-- CreateIndex
CREATE UNIQUE INDEX "collab_base_workspaceId_name_key" ON "collab_base"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "collab_table_baseId_name_key" ON "collab_table"("baseId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "collab_field_tableId_name_key" ON "collab_field"("tableId", "name");

-- CreateIndex
CREATE INDEX "collab_view_tableId_ownerId_idx" ON "collab_view"("tableId", "ownerId");

-- CreateIndex
CREATE INDEX "collab_record_tableId_archived_createdAt_id_idx" ON "collab_record"("tableId", "archived", "createdAt", "id");

-- CreateIndex
CREATE INDEX "collab_record_tableId_ownerId_idx" ON "collab_record"("tableId", "ownerId");

-- CreateIndex
CREATE INDEX "collab_relation_targetRecordId_idx" ON "collab_relation"("targetRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "collab_relation_fieldId_sourceRecordId_targetRecordId_key" ON "collab_relation"("fieldId", "sourceRecordId", "targetRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "collab_revision_recordId_version_key" ON "collab_revision"("recordId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "collab_mutation_actorId_key_key" ON "collab_mutation"("actorId", "key");

-- CreateIndex
CREATE INDEX "collab_event_baseId_id_idx" ON "collab_event"("baseId", "id");

-- CreateIndex
CREATE INDEX "collab_presence_baseId_seenAt_idx" ON "collab_presence"("baseId", "seenAt");

-- CreateIndex
CREATE UNIQUE INDEX "collab_presence_baseId_connectionId_key" ON "collab_presence"("baseId", "connectionId");

-- CreateIndex
CREATE INDEX "collab_comment_recordId_createdAt_idx" ON "collab_comment"("recordId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "collab_attachment_storageKey_key" ON "collab_attachment"("storageKey");

-- CreateIndex
CREATE INDEX "collab_attachment_tableId_idx" ON "collab_attachment"("tableId");

-- CreateIndex
CREATE UNIQUE INDEX "collab_run_ruleId_recordId_recordVersion_ruleVersion_key" ON "collab_run"("ruleId", "recordId", "recordVersion", "ruleVersion");

-- CreateIndex
CREATE UNIQUE INDEX "collab_preference_userId_tableId_key" ON "collab_preference"("userId", "tableId");

-- AddForeignKey
ALTER TABLE "collab_member" ADD CONSTRAINT "collab_member_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "collab_workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_base" ADD CONSTRAINT "collab_base_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "collab_workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_table" ADD CONSTRAINT "collab_table_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "collab_base"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_field" ADD CONSTRAINT "collab_field_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "collab_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_view" ADD CONSTRAINT "collab_view_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "collab_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_record" ADD CONSTRAINT "collab_record_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "collab_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_revision" ADD CONSTRAINT "collab_revision_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "collab_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_event" ADD CONSTRAINT "collab_event_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "collab_base"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_presence" ADD CONSTRAINT "collab_presence_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "collab_base"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_comment" ADD CONSTRAINT "collab_comment_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "collab_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_rule" ADD CONSTRAINT "collab_rule_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "collab_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_run" ADD CONSTRAINT "collab_run_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "collab_rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Relations deliberately reference existing business identities without modifying them.
ALTER TABLE collab_workspace ADD CONSTRAINT collab_workspace_org_fk FOREIGN KEY ("organizationId") REFERENCES organization(id) ON DELETE RESTRICT;
ALTER TABLE collab_workspace ADD CONSTRAINT collab_workspace_owner_fk FOREIGN KEY ("ownerId") REFERENCES "user"(id) ON DELETE RESTRICT;
ALTER TABLE collab_relation ADD CONSTRAINT collab_relation_field_fk FOREIGN KEY ("fieldId") REFERENCES collab_field(id) ON DELETE CASCADE;
ALTER TABLE collab_relation ADD CONSTRAINT collab_relation_source_fk FOREIGN KEY ("sourceRecordId") REFERENCES collab_record(id) ON DELETE CASCADE;
ALTER TABLE collab_relation ADD CONSTRAINT collab_relation_target_fk FOREIGN KEY ("targetRecordId") REFERENCES collab_record(id) ON DELETE RESTRICT;
CREATE INDEX collab_record_values_gin ON collab_record USING gin (values);

INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:workspace.create','workspace.create','创建多维协作工作区','ACTION','workspace','create','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
