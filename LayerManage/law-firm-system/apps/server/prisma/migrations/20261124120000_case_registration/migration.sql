ALTER TABLE "case" ADD COLUMN "registrationRequired" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "case_registration" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "caseId" TEXT NOT NULL REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "tableId" TEXT NOT NULL,
  "caseVersion" INTEGER NOT NULL,
  "recordVersion" INTEGER NOT NULL,
  "submittedBy" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "workflowInstanceId" TEXT REFERENCES "workflow_instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "case_registration_workflowInstanceId_key" ON "case_registration"("workflowInstanceId");
CREATE INDEX "case_registration_caseId_createdAt_idx" ON "case_registration"("caseId", "createdAt");
CREATE UNIQUE INDEX "case_registration_pending_case_key" ON "case_registration"("caseId") WHERE "status" = 'PENDING';
