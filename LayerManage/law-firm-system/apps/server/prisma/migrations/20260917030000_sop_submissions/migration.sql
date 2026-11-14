-- AlterTable
ALTER TABLE "case_task" ADD COLUMN     "activeSubmissionId" TEXT;

-- CreateTable
CREATE TABLE "sop_submission" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "taskVersion" INTEGER NOT NULL,
    "report" TEXT NOT NULL,
    "nodeSnapshot" JSONB NOT NULL,
    "materialChecklist" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "executorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sop_submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_attachment" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "materialCode" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_review" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "approvalInstanceId" TEXT,
    "reviewerUserId" TEXT,
    "createdBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING_ASSIGNMENT',
    "checklist" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expert_guidance" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "submissionId" TEXT,
    "content" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expert_guidance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sop_submission_submittedBy_idx" ON "sop_submission"("submittedBy");

-- CreateIndex
CREATE UNIQUE INDEX "sop_submission_taskId_number_key" ON "sop_submission"("taskId", "number");

-- CreateIndex
CREATE INDEX "submission_attachment_fileId_idx" ON "submission_attachment"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "submission_attachment_submissionId_materialCode_fileId_key" ON "submission_attachment"("submissionId", "materialCode", "fileId");

-- CreateIndex
CREATE UNIQUE INDEX "quality_review_submissionId_key" ON "quality_review"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "quality_review_approvalInstanceId_key" ON "quality_review"("approvalInstanceId");

-- CreateIndex
CREATE INDEX "quality_review_reviewerUserId_status_idx" ON "quality_review"("reviewerUserId", "status");

-- CreateIndex
CREATE INDEX "expert_guidance_taskId_createdAt_idx" ON "expert_guidance"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "case_task_activeSubmissionId_key" ON "case_task"("activeSubmissionId");

-- AddForeignKey
ALTER TABLE "case_task" ADD CONSTRAINT "case_task_activeSubmissionId_fkey" FOREIGN KEY ("activeSubmissionId") REFERENCES "sop_submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_submission" ADD CONSTRAINT "sop_submission_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "case_task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_submission" ADD CONSTRAINT "sop_submission_submittedBy_fkey" FOREIGN KEY ("submittedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_attachment" ADD CONSTRAINT "submission_attachment_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "sop_submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_attachment" ADD CONSTRAINT "submission_attachment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "case_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_review" ADD CONSTRAINT "quality_review_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "sop_submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_review" ADD CONSTRAINT "quality_review_approvalInstanceId_fkey" FOREIGN KEY ("approvalInstanceId") REFERENCES "approval_instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_review" ADD CONSTRAINT "quality_review_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_review" ADD CONSTRAINT "quality_review_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expert_guidance" ADD CONSTRAINT "expert_guidance_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "case_task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expert_guidance" ADD CONSTRAINT "expert_guidance_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "sop_submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expert_guidance" ADD CONSTRAINT "expert_guidance_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE sop_submission ADD CONSTRAINT sop_submission_number CHECK (number > 0 AND "taskVersion" > 0 AND length("contentHash") = 64);
ALTER TABLE submission_attachment ADD CONSTRAINT submission_attachment_digest CHECK (length(sha256) = 64 AND "fileSize" >= 0);
ALTER TABLE quality_review ADD CONSTRAINT quality_review_state CHECK (status IN ('WAITING_ASSIGNMENT','PENDING','APPROVED','RETURNED','CANCELLED') AND version > 0);
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:sop.report.read','sop.report.read','查看SOP成果','ACTION','sop_task','read','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:sop.report.submit','sop.report.submit','提交SOP成果','ACTION','sop_task','submit','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:sop.guidance.read','sop.guidance.read','查看专家指导','ACTION','sop_task','read','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:sop.guidance.create','sop.guidance.create','记录专家指导','ACTION','sop_task','create','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:quality.review.read','quality.review.read','查看一级审核','ACTION','sop_task','read','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:quality.review.assign','quality.review.assign','分派一级审核','ACTION','sop_task','assign','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:quality.review.decide','quality.review.decide','决定一级审核','ACTION','sop_task','decide','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
