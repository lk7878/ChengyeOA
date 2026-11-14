CREATE TABLE "admin_operation" (
  "id" TEXT NOT NULL,
  "operationNo" TEXT NOT NULL,
  "operationType" TEXT NOT NULL,
  "riskLevel" TEXT NOT NULL,
  "reviewMode" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "requesterUserId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "payloadSnapshot" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "expectedTargetVersion" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "secondConfirmationAt" TIMESTAMPTZ(3),
  "relatedOperationId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "admin_operation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_operation_review" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "reviewerUserId" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "comment" TEXT,
  "operationVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_operation_review_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_operation_execution" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "attemptNo" INTEGER NOT NULL,
  "executorType" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "beforeSnapshot" JSONB,
  "afterSnapshot" JSONB,
  "resultCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ(3),
  CONSTRAINT "admin_operation_execution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_operation_operationNo_key" ON "admin_operation"("operationNo");
CREATE UNIQUE INDEX "admin_operation_requester_idempotency_key" ON "admin_operation"("requesterUserId", "idempotencyKey");
CREATE INDEX "admin_operation_requesterUserId_createdAt_idx" ON "admin_operation"("requesterUserId", "createdAt");
CREATE INDEX "admin_operation_status_createdAt_idx" ON "admin_operation"("status", "createdAt");
CREATE INDEX "admin_operation_operationType_createdAt_idx" ON "admin_operation"("operationType", "createdAt");
CREATE INDEX "admin_operation_targetType_targetId_idx" ON "admin_operation"("targetType", "targetId");
CREATE INDEX "admin_operation_review_operationId_createdAt_idx" ON "admin_operation_review"("operationId", "createdAt");
CREATE INDEX "admin_operation_review_reviewerUserId_createdAt_idx" ON "admin_operation_review"("reviewerUserId", "createdAt");
CREATE UNIQUE INDEX "admin_operation_execution_operation_attempt_key" ON "admin_operation_execution"("operationId", "attemptNo");
CREATE INDEX "admin_operation_execution_status_startedAt_idx" ON "admin_operation_execution"("status", "startedAt");

ALTER TABLE "admin_operation" ADD CONSTRAINT "admin_operation_risk_level_check"
  CHECK ("riskLevel" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));
ALTER TABLE "admin_operation" ADD CONSTRAINT "admin_operation_review_mode_check"
  CHECK ("reviewMode" IN ('PRE', 'POST'));
ALTER TABLE "admin_operation" ADD CONSTRAINT "admin_operation_status_check"
  CHECK ("status" IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'PENDING_POST_REVIEW', 'CONFIRMED', 'FLAGGED'));
ALTER TABLE "admin_operation" ADD CONSTRAINT "admin_operation_reason_check"
  CHECK (length(btrim("reason")) BETWEEN 10 AND 500);
ALTER TABLE "admin_operation" ADD CONSTRAINT "admin_operation_payload_hash_check"
  CHECK ("payloadHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "admin_operation" ADD CONSTRAINT "admin_operation_expected_target_version_positive"
  CHECK ("expectedTargetVersion" > 0);
ALTER TABLE "admin_operation" ADD CONSTRAINT "admin_operation_version_positive"
  CHECK ("version" > 0);
ALTER TABLE "admin_operation_review" ADD CONSTRAINT "admin_operation_review_decision_check"
  CHECK ("decision" IN ('APPROVE', 'REJECT', 'CONFIRM', 'FLAG'));
ALTER TABLE "admin_operation_review" ADD CONSTRAINT "admin_operation_review_operation_version_positive"
  CHECK ("operationVersion" > 0);
ALTER TABLE "admin_operation_execution" ADD CONSTRAINT "admin_operation_execution_attempt_positive"
  CHECK ("attemptNo" > 0);
ALTER TABLE "admin_operation_execution" ADD CONSTRAINT "admin_operation_execution_executor_type_check"
  CHECK ("executorType" IN ('SYSTEM', 'CLI'));
ALTER TABLE "admin_operation_execution" ADD CONSTRAINT "admin_operation_execution_status_check"
  CHECK ("status" IN ('RUNNING', 'SUCCEEDED', 'FAILED'));

ALTER TABLE "admin_operation" ADD CONSTRAINT "admin_operation_requesterUserId_fkey"
  FOREIGN KEY ("requesterUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_operation" ADD CONSTRAINT "admin_operation_relatedOperationId_fkey"
  FOREIGN KEY ("relatedOperationId") REFERENCES "admin_operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_operation_review" ADD CONSTRAINT "admin_operation_review_operationId_fkey"
  FOREIGN KEY ("operationId") REFERENCES "admin_operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_operation_review" ADD CONSTRAINT "admin_operation_review_reviewerUserId_fkey"
  FOREIGN KEY ("reviewerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_operation_execution" ADD CONSTRAINT "admin_operation_execution_operationId_fkey"
  FOREIGN KEY ("operationId") REFERENCES "admin_operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "user_role" DROP CONSTRAINT "user_role_source_check";
ALTER TABLE "user_role" DROP CONSTRAINT "user_role_validity_check";
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_source_check"
  CHECK ("source" IN ('PERMANENT', 'TEMPORARY', 'RECOVERY'));
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_validity_check" CHECK (
  ("source" = 'PERMANENT' AND "validUntil" IS NULL)
  OR ("source" = 'RECOVERY' AND "validUntil" IS NULL)
  OR ("source" = 'TEMPORARY' AND "validUntil" IS NOT NULL AND "validUntil" > "validFrom")
);

INSERT INTO "permission" (
  "id", "code", "name", "parentId", "type", "resource", "action", "riskLevel", "path", "sort", "status", "version", "createdAt", "updatedAt"
) VALUES
  ('permission:menu.admin_governance', 'menu.admin_governance', '管理治理中心', NULL, 'MENU', 'menu', 'view', 'HIGH', '/security/admin-governance', 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:governance.catalog.read', 'governance.catalog.read', '查看治理目录', NULL, 'ACTION', 'governance', 'catalog.read', 'LOW', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:governance.operation.create', 'governance.operation.create', '创建治理操作', NULL, 'ACTION', 'governance', 'operation.create', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:governance.operation.read_self', 'governance.operation.read_self', '查看本人治理操作', NULL, 'ACTION', 'governance', 'operation.read_self', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:governance.operation.read_all', 'governance.operation.read_all', '查看全部治理操作', NULL, 'SPECIAL', 'governance', 'operation.read_all', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:governance.review', 'governance.review', '复核治理操作', NULL, 'SPECIAL', 'governance', 'review', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:governance.retry', 'governance.retry', '重试治理操作', NULL, 'SPECIAL', 'governance', 'retry', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:governance.audit.read', 'governance.audit.read', '查看治理审计', NULL, 'SPECIAL', 'governance', 'audit.read', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role" (
  "id", "name", "code", "type", "description", "status", "version", "createdAt", "updatedAt"
)
SELECT
  'role:system-admin', '系统管理员', 'SYSTEM_ADMIN', 'SYSTEM', NULL, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "system_initialization" WHERE "id" = 'PRIMARY')
ON CONFLICT ("code") DO NOTHING;
