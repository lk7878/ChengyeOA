-- AlterTable
ALTER TABLE "sop_task_access" ADD COLUMN     "employmentStamp" TEXT;

-- CreateTable
CREATE TABLE "satisfaction_assessment" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "score" INTEGER,
    "scale" TEXT NOT NULL DEFAULT 'HUNDRED_V1',
    "source" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "evidenceFileId" TEXT,
    "evidenceHash" TEXT,
    "assessedAt" TIMESTAMP(3) NOT NULL,
    "correctionOfId" TEXT,
    "correctionReason" TEXT,
    "number" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "satisfaction_assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "special_analysis" (
    "name" TEXT NOT NULL DEFAULT '低满意度专项分析',
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "content" TEXT NOT NULL DEFAULT '',
    "conclusion" TEXT NOT NULL DEFAULT '',
    "currentCloseId" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "special_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_revision" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "conclusion" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_close_request" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "analysisVersion" INTEGER NOT NULL,
    "contentSnapshot" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "approvalInstanceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_close_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sop_reminder_emission" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "taskVersion" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sop_reminder_emission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "satisfaction_assessment_correctionOfId_key" ON "satisfaction_assessment"("correctionOfId");

-- CreateIndex
CREATE INDEX "satisfaction_assessment_caseId_createdAt_idx" ON "satisfaction_assessment"("caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "special_analysis_assessmentId_key" ON "special_analysis"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "special_analysis_currentCloseId_key" ON "special_analysis"("currentCloseId");

-- CreateIndex
CREATE INDEX "special_analysis_caseId_status_idx" ON "special_analysis"("caseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_revision_analysisId_number_key" ON "analysis_revision"("analysisId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_close_request_approvalInstanceId_key" ON "analysis_close_request"("approvalInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "sop_reminder_emission_taskId_taskVersion_kind_recipientId_key" ON "sop_reminder_emission"("taskId", "taskVersion", "kind", "recipientId");

-- AddForeignKey
ALTER TABLE "satisfaction_assessment" ADD CONSTRAINT "satisfaction_assessment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "satisfaction_assessment" ADD CONSTRAINT "satisfaction_assessment_evidenceFileId_fkey" FOREIGN KEY ("evidenceFileId") REFERENCES "case_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "satisfaction_assessment" ADD CONSTRAINT "satisfaction_assessment_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "satisfaction_assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "satisfaction_assessment" ADD CONSTRAINT "satisfaction_assessment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "special_analysis" ADD CONSTRAINT "special_analysis_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "satisfaction_assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "special_analysis" ADD CONSTRAINT "special_analysis_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "special_analysis" ADD CONSTRAINT "special_analysis_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "special_analysis" ADD CONSTRAINT "special_analysis_currentCloseId_fkey" FOREIGN KEY ("currentCloseId") REFERENCES "analysis_close_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_revision" ADD CONSTRAINT "analysis_revision_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "special_analysis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_revision" ADD CONSTRAINT "analysis_revision_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_close_request" ADD CONSTRAINT "analysis_close_request_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "special_analysis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_close_request" ADD CONSTRAINT "analysis_close_request_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_close_request" ADD CONSTRAINT "analysis_close_request_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_close_request" ADD CONSTRAINT "analysis_close_request_approvalInstanceId_fkey" FOREIGN KEY ("approvalInstanceId") REFERENCES "approval_instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_reminder_emission" ADD CONSTRAINT "sop_reminder_emission_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "case_task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_reminder_emission" ADD CONSTRAINT "sop_reminder_emission_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:quality.assessment.read','quality.assessment.read','查看百分制评估','ACTION','case','read','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:quality.assessment.record','quality.assessment.record','记录百分制评估','ACTION','case','record','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:quality.analysis.read','quality.analysis.read','查看专项分析','ACTION','case','read','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:quality.analysis.manage','quality.analysis.manage','维护专项分析','ACTION','case','manage','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:quality.analysis.close','quality.analysis.close','申请关闭专项分析','ACTION','case','close','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:quality.analysis.decide','quality.analysis.decide','审核专项关闭','ACTION','case','decide','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:quality.metric.read','quality.metric.read','查看质量指标','ACTION','case','read','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO event_subscription (id,code,"eventType","eventVersion","handlerCode",status,"updatedAt") VALUES ('subscription:quality-assessment-analysis-v1','quality-assessment-analysis-v1','quality.assessment.recorded',1,'QUALITY_ASSESSMENT_ANALYSIS','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO event_subscription (id,code,"eventType","eventVersion","handlerCode",status,"updatedAt") VALUES ('subscription:sop-reminder-notification-v1','sop-reminder-notification-v1','sop.reminder.due',1,'SOP_REMINDER_NOTIFICATION','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO event_subscription (id,code,"eventType","eventVersion","handlerCode",status,"updatedAt") VALUES ('subscription:sop-change-notification-v1','sop-change-notification-v1','sop.task.changed',1,'SOP_CHANGE_NOTIFICATION','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO event_subscription (id,code,"eventType","eventVersion","handlerCode",status,"updatedAt") VALUES ('subscription:quality-change-notification-v1','quality-change-notification-v1','quality.changed',1,'QUALITY_CHANGE_NOTIFICATION','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;

ALTER TABLE satisfaction_assessment ADD CONSTRAINT assessment_valid CHECK (number>0 AND scale='HUNDRED_V1' AND (score IS NULL OR score BETWEEN 0 AND 100) AND ("correctionOfId" IS NULL OR length("correctionReason")>0));
ALTER TABLE special_analysis ADD CONSTRAINT special_analysis_valid CHECK (version>0 AND status IN ('OPEN','ANALYZING','PENDING_CLOSE','CLOSED'));
ALTER TABLE analysis_revision ADD CONSTRAINT analysis_revision_valid CHECK (number>0);
ALTER TABLE analysis_close_request ADD CONSTRAINT analysis_close_valid CHECK ("analysisVersion">0 AND length("contentHash")=64 AND status IN ('PENDING','APPROVED','RETURNED','CANCELLED'));
ALTER TABLE sop_reminder_emission ADD CONSTRAINT sop_reminder_valid CHECK ("taskVersion">0 AND kind IN ('BEFORE','DUE'));
