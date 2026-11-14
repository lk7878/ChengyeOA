-- Do not strand pending legacy requests during an engine cutover.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM approval_instance WHERE status = 'PENDING') THEN
    RAISE EXCEPTION 'Pending legacy approvals must be completed or migrated before the visual approval cutover';
  END IF;
END $$;
ALTER TABLE workflow_definition ADD COLUMN "managedType" TEXT;
ALTER TABLE workflow_instance ADD COLUMN "businessType" TEXT NOT NULL DEFAULT 'CUSTOM', ADD COLUMN "decidedBy" TEXT;
ALTER TABLE quality_review ADD COLUMN "workflowInstanceId" TEXT;
CREATE UNIQUE INDEX "quality_review_workflowInstanceId_key" ON quality_review("workflowInstanceId");
ALTER TABLE quality_review ADD CONSTRAINT "quality_review_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES workflow_instance(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE analysis_close_request ADD COLUMN "workflowInstanceId" TEXT;
CREATE UNIQUE INDEX "analysis_close_request_workflowInstanceId_key" ON analysis_close_request("workflowInstanceId");
ALTER TABLE analysis_close_request ADD CONSTRAINT "analysis_close_request_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES workflow_instance(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE payroll_batch ADD COLUMN "workflowInstanceId" TEXT;
CREATE UNIQUE INDEX "payroll_batch_workflowInstanceId_key" ON payroll_batch("workflowInstanceId");
ALTER TABLE payroll_batch ADD CONSTRAINT "payroll_batch_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES workflow_instance(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve definitions for historical audit, but never offer them for new applications.
UPDATE approval_definition SET status = 'DISABLED' WHERE status = 'ACTIVE';
