-- CreateTable
CREATE TABLE "sop_template" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "professionalTeamId" TEXT NOT NULL,
    "caseType" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "activeVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sop_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sop_template_version" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "publishedOperationId" TEXT,
    "disabledOperationId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sop_template_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sop_instance" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sop_instance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sop_template_code_key" ON "sop_template"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sop_template_activeVersionId_key" ON "sop_template"("activeVersionId");

-- CreateIndex
CREATE INDEX "sop_template_organizationId_professionalTeamId_idx" ON "sop_template"("organizationId", "professionalTeamId");

-- CreateIndex
CREATE INDEX "sop_template_createdBy_idx" ON "sop_template"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "sop_template_version_publishedOperationId_key" ON "sop_template_version"("publishedOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "sop_template_version_disabledOperationId_key" ON "sop_template_version"("disabledOperationId");

-- CreateIndex
CREATE INDEX "sop_template_version_status_idx" ON "sop_template_version"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sop_template_version_templateId_number_key" ON "sop_template_version"("templateId", "number");

-- CreateIndex
CREATE INDEX "sop_instance_caseId_idx" ON "sop_instance"("caseId");

-- AddForeignKey
ALTER TABLE "sop_template" ADD CONSTRAINT "sop_template_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_template" ADD CONSTRAINT "sop_template_professionalTeamId_fkey" FOREIGN KEY ("professionalTeamId") REFERENCES "professional_team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_template" ADD CONSTRAINT "sop_template_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "sop_template_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_template_version" ADD CONSTRAINT "sop_template_version_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "sop_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_instance" ADD CONSTRAINT "sop_instance_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_instance" ADD CONSTRAINT "sop_instance_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "sop_template_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "sop_template_version" ADD CONSTRAINT "sop_version_state" CHECK ("status" IN ('DRAFT','PUBLISHED','DISABLED') AND "number" > 0 AND "version" > 0);
ALTER TABLE "sop_instance" ADD CONSTRAINT "sop_instance_state" CHECK ("status" IN ('ACTIVE','PAUSED','COMPLETED','CANCELLED') AND "version" > 0);
INSERT INTO "permission" ("id","code","name","type","resource","action","riskLevel","path","status","updatedAt") VALUES
('permission:menu.sop_templates','menu.sop_templates','SOP模板','MENU','menu','view','LOW','/admin/sop-templates','ENABLED',CURRENT_TIMESTAMP),
('permission:sop.template.read','sop.template.read','查看SOP模板','ACTION','sop_template','read','LOW',NULL,'ENABLED',CURRENT_TIMESTAMP),
('permission:sop.template.manage','sop.template.manage','维护SOP模板草稿','ACTION','sop_template','manage','MEDIUM',NULL,'ENABLED',CURRENT_TIMESTAMP),
('permission:sop.template.publish','sop.template.publish','申请发布停用SOP模板','ACTION','sop_template','publish','HIGH',NULL,'ENABLED',CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
