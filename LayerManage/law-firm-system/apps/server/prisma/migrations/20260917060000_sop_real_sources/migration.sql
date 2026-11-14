-- AlterTable
ALTER TABLE "case_task" ALTER COLUMN "caseId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "sop_instance" ADD COLUMN     "analysisEngagementId" TEXT,
ADD COLUMN     "leadId" TEXT,
ALTER COLUMN "caseId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "submission_attachment" ADD COLUMN     "sourceFileId" TEXT,
ALTER COLUMN "fileId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "sop_source_file" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sop_source_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sop_continuation" (
    "id" TEXT NOT NULL,
    "sourceInstanceId" TEXT NOT NULL,
    "targetInstanceId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "targetVersion" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sop_continuation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sop_source_file_filePath_key" ON "sop_source_file"("filePath");

-- CreateIndex
CREATE INDEX "sop_source_file_instanceId_createdAt_idx" ON "sop_source_file"("instanceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sop_continuation_sourceInstanceId_targetInstanceId_key" ON "sop_continuation"("sourceInstanceId", "targetInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "sop_instance_leadId_templateVersionId_batchKey_key" ON "sop_instance"("leadId", "templateVersionId", "batchKey");

-- CreateIndex
CREATE UNIQUE INDEX "sop_instance_analysisEngagementId_templateVersionId_batchKe_key" ON "sop_instance"("analysisEngagementId", "templateVersionId", "batchKey");

-- CreateIndex
CREATE UNIQUE INDEX "submission_attachment_submissionId_materialCode_sourceFileI_key" ON "submission_attachment"("submissionId", "materialCode", "sourceFileId");

-- AddForeignKey
ALTER TABLE "sop_instance" ADD CONSTRAINT "sop_instance_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_instance" ADD CONSTRAINT "sop_instance_analysisEngagementId_fkey" FOREIGN KEY ("analysisEngagementId") REFERENCES "analysis_engagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_attachment" ADD CONSTRAINT "submission_attachment_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "sop_source_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_source_file" ADD CONSTRAINT "sop_source_file_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "sop_instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_source_file" ADD CONSTRAINT "sop_source_file_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_continuation" ADD CONSTRAINT "sop_continuation_sourceInstanceId_fkey" FOREIGN KEY ("sourceInstanceId") REFERENCES "sop_instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_continuation" ADD CONSTRAINT "sop_continuation_targetInstanceId_fkey" FOREIGN KEY ("targetInstanceId") REFERENCES "sop_instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_continuation" ADD CONSTRAINT "sop_continuation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE sop_instance ADD CONSTRAINT sop_instance_source_exactly_one CHECK (num_nonnulls("caseId","leadId","analysisEngagementId")=1);
ALTER TABLE case_task ADD CONSTRAINT case_task_requires_source CHECK ("caseId" IS NOT NULL OR "sopInstanceId" IS NOT NULL);
ALTER TABLE submission_attachment ADD CONSTRAINT submission_attachment_source_exactly_one CHECK (num_nonnulls("fileId","sourceFileId")=1);
ALTER TABLE sop_source_file ADD CONSTRAINT sop_source_file_positive_size CHECK ("fileSize">0 AND "fileSize"<=10485760);
ALTER TABLE sop_continuation ADD CONSTRAINT sop_continuation_distinct CHECK ("sourceInstanceId"<>"targetInstanceId");

CREATE FUNCTION check_sop_task_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_case text;
BEGIN
 IF NEW."sopInstanceId" IS NOT NULL THEN
  SELECT "caseId" INTO source_case FROM sop_instance WHERE id=NEW."sopInstanceId";
  IF NOT FOUND OR source_case IS DISTINCT FROM NEW."caseId" THEN RAISE EXCEPTION 'SOP_TASK_SOURCE_MISMATCH' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sop_task_source_consistency BEFORE INSERT OR UPDATE OF "caseId","sopInstanceId" ON case_task FOR EACH ROW EXECUTE FUNCTION check_sop_task_source();

CREATE FUNCTION freeze_sop_instance_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW."caseId",NEW."leadId",NEW."analysisEngagementId") IS DISTINCT FROM (OLD."caseId",OLD."leadId",OLD."analysisEngagementId") THEN RAISE EXCEPTION 'SOP_INSTANCE_SOURCE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sop_instance_source_immutable BEFORE UPDATE OF "caseId","leadId","analysisEngagementId" ON sop_instance FOR EACH ROW EXECUTE FUNCTION freeze_sop_instance_source();

CREATE FUNCTION check_sop_attachment_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task_case text; task_instance text; file_case text; file_instance text;
BEGIN
 SELECT t."caseId",t."sopInstanceId" INTO task_case,task_instance FROM sop_submission s JOIN case_task t ON t.id=s."taskId" WHERE s.id=NEW."submissionId";
 IF NOT FOUND THEN RAISE EXCEPTION 'SOP_MATERIAL_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 IF NEW."fileId" IS NOT NULL THEN
  SELECT "caseId" INTO file_case FROM case_file WHERE id=NEW."fileId";
  IF NOT FOUND OR task_case IS NULL OR file_case IS DISTINCT FROM task_case THEN RAISE EXCEPTION 'SOP_MATERIAL_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT "instanceId" INTO file_instance FROM sop_source_file WHERE id=NEW."sourceFileId";
  IF NOT FOUND OR task_case IS NOT NULL OR file_instance IS DISTINCT FROM task_instance THEN RAISE EXCEPTION 'SOP_MATERIAL_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sop_attachment_source_consistency BEFORE INSERT OR UPDATE OF "submissionId","fileId","sourceFileId" ON submission_attachment FOR EACH ROW EXECUTE FUNCTION check_sop_attachment_source();

INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:sop.material.read','sop.material.read','读取前期材料','ACTION','sop_task','read','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;

INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",status,"updatedAt") VALUES ('permission:sop.material.manage','sop.material.manage','上传前期材料','ACTION','sop_task','manage','MEDIUM','ENABLED',CURRENT_TIMESTAMP) ON CONFLICT (code) DO NOTHING;
