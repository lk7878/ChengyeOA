-- CreateTable
CREATE TABLE "quality_sampling_policy" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "professionalTeamId" TEXT,
    "mode" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "stratified" BOOLEAN NOT NULL DEFAULT false,
    "checklist" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_sampling_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_sampling_run" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "scopeHash" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "batchKey" TEXT NOT NULL,
    "reason" TEXT,
    "seed" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'HASH_SORT_V1',
    "candidateSnapshot" JSONB NOT NULL,
    "candidateHash" TEXT NOT NULL,
    "exclusions" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_sampling_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_sampling_item" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "checklist" JSONB NOT NULL,
    "inspectorUserId" TEXT,
    "resultHash" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_sampling_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_issue" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "checkCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "assigneeUserId" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_revision" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_attachment" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,

    CONSTRAINT "issue_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quality_sampling_policy_code_number_key" ON "quality_sampling_policy"("code", "number");

-- CreateIndex
CREATE UNIQUE INDEX "quality_sampling_run_policyId_scopeHash_month_batchKey_key" ON "quality_sampling_run"("policyId", "scopeHash", "month", "batchKey");

-- CreateIndex
CREATE UNIQUE INDEX "quality_sampling_item_runId_caseId_key" ON "quality_sampling_item"("runId", "caseId");

-- CreateIndex
CREATE INDEX "quality_issue_caseId_status_idx" ON "quality_issue"("caseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quality_issue_inspectionId_checkCode_key" ON "quality_issue"("inspectionId", "checkCode");

-- CreateIndex
CREATE UNIQUE INDEX "issue_revision_issueId_number_key" ON "issue_revision"("issueId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "issue_attachment_revisionId_fileId_key" ON "issue_attachment"("revisionId", "fileId");

-- AddForeignKey
ALTER TABLE "quality_sampling_policy" ADD CONSTRAINT "quality_sampling_policy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_sampling_policy" ADD CONSTRAINT "quality_sampling_policy_professionalTeamId_fkey" FOREIGN KEY ("professionalTeamId") REFERENCES "professional_team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_sampling_policy" ADD CONSTRAINT "quality_sampling_policy_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_sampling_run" ADD CONSTRAINT "quality_sampling_run_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "quality_sampling_policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_sampling_run" ADD CONSTRAINT "quality_sampling_run_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_sampling_item" ADD CONSTRAINT "quality_sampling_item_runId_fkey" FOREIGN KEY ("runId") REFERENCES "quality_sampling_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_sampling_item" ADD CONSTRAINT "quality_sampling_item_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_sampling_item" ADD CONSTRAINT "quality_sampling_item_inspectorUserId_fkey" FOREIGN KEY ("inspectorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_sampling_item" ADD CONSTRAINT "quality_sampling_item_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_issue" ADD CONSTRAINT "quality_issue_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_issue" ADD CONSTRAINT "quality_issue_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "quality_sampling_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_issue" ADD CONSTRAINT "quality_issue_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_issue" ADD CONSTRAINT "quality_issue_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_revision" ADD CONSTRAINT "issue_revision_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "quality_issue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_revision" ADD CONSTRAINT "issue_revision_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_attachment" ADD CONSTRAINT "issue_attachment_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "issue_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_attachment" ADD CONSTRAINT "issue_attachment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "case_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:menu.quality','menu.quality','质量管理','MENU','menu','read','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:quality.sample.read','quality.sample.read','查看抽检批次','ACTION','case','read','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:quality.sample.manage','quality.sample.manage','配置执行抽检','ACTION','case','manage','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:quality.inspection.read','quality.inspection.read','查看二级检查','ACTION','case','read','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:quality.inspection.record','quality.inspection.record','记录二级检查','ACTION','case','record','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:quality.issue.read','quality.issue.read','查看质检问题','ACTION','case','read','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:quality.issue.manage','quality.issue.manage','分派质检问题','ACTION','case','manage','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:quality.issue.resolve','quality.issue.resolve','提交整改','ACTION','case','resolve','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:quality.issue.verify','quality.issue.verify','复核整改','ACTION','case','verify','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
ALTER TABLE quality_sampling_policy ADD CONSTRAINT quality_policy_valid CHECK (number>0 AND ((mode='COUNT' AND amount BETWEEN 1 AND 10000) OR (mode='RATIO' AND amount BETWEEN 1 AND 100)));
ALTER TABLE quality_sampling_item ADD CONSTRAINT quality_item_valid CHECK (version>0 AND status IN ('PENDING','RECORDED'));
ALTER TABLE quality_issue ADD CONSTRAINT quality_issue_valid CHECK (version>0 AND status IN ('OPEN','IN_PROGRESS','PENDING_VERIFY','CLOSED','CANCELLED'));
ALTER TABLE issue_revision ADD CONSTRAINT quality_revision_valid CHECK (number>0 AND action IN ('ASSIGN','START','SUBMIT','VERIFY','RETURN','CANCEL'));
ALTER TABLE issue_attachment ADD CONSTRAINT quality_attachment_valid CHECK (length(sha256)=64 AND "fileSize">=0);
