ALTER TABLE "notification" ADD COLUMN "deduplicationKey" TEXT;
ALTER TABLE "notification" ADD COLUMN "routeUrl" TEXT;

CREATE UNIQUE INDEX "notification_deduplicationKey_key"
  ON "notification"("deduplicationKey");

CREATE TABLE "event_log" (
  "id" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventVersion" INTEGER NOT NULL,
  "sourceModule" TEXT NOT NULL,
  "objectType" TEXT NOT NULL,
  "objectId" TEXT NOT NULL,
  "orderingKey" TEXT NOT NULL,
  "operatorUserId" TEXT,
  "organizationId" TEXT,
  "branchId" TEXT,
  "teamId" TEXT,
  "payload" JSONB NOT NULL,
  "traceId" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "dispatchedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_log_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "event_subscription" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventVersion" INTEGER NOT NULL,
  "handlerCode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ENABLED',
  "filterJson" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "event_subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "event_delivery" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "handlerCode" TEXT NOT NULL,
  "orderingKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "manualRetryCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3),
  "lockedBy" TEXT,
  "lockedUntil" TIMESTAMPTZ(3),
  "lastErrorCode" TEXT,
  "lastErrorReference" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "event_delivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_delivery_event_handler_key" UNIQUE ("eventId", "handlerCode")
);

CREATE TABLE "event_handler_log" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "workerId" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "errorCode" TEXT,
  "errorReference" TEXT,
  "durationMs" INTEGER NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "event_handler_log_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_handler_log_delivery_attempt_key" UNIQUE ("deliveryId", "attemptNumber")
);

CREATE UNIQUE INDEX "event_subscription_code_key" ON "event_subscription"("code");
CREATE INDEX "event_log_dispatchedAt_createdAt_idx" ON "event_log"("dispatchedAt", "createdAt");
CREATE INDEX "event_log_eventType_eventVersion_createdAt_idx" ON "event_log"("eventType", "eventVersion", "createdAt");
CREATE INDEX "event_log_objectType_objectId_occurredAt_idx" ON "event_log"("objectType", "objectId", "occurredAt");
CREATE INDEX "event_log_traceId_idx" ON "event_log"("traceId");
CREATE INDEX "event_subscription_status_eventType_eventVersion_idx" ON "event_subscription"("status", "eventType", "eventVersion");
CREATE INDEX "event_delivery_status_nextAttemptAt_createdAt_idx" ON "event_delivery"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "event_delivery_handlerCode_orderingKey_status_createdAt_idx" ON "event_delivery"("handlerCode", "orderingKey", "status", "createdAt");
CREATE INDEX "event_handler_log_outcome_completedAt_idx" ON "event_handler_log"("outcome", "completedAt");

ALTER TABLE "event_log" ADD CONSTRAINT "event_log_event_version_positive"
  CHECK ("eventVersion" > 0);
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_ordering_key_check"
  CHECK ("orderingKey" ~ '^[0-9a-f]{64}$');
ALTER TABLE "event_subscription" ADD CONSTRAINT "event_subscription_event_version_positive"
  CHECK ("eventVersion" > 0);
ALTER TABLE "event_subscription" ADD CONSTRAINT "event_subscription_status_check"
  CHECK ("status" IN ('ENABLED', 'DISABLED'));
ALTER TABLE "event_delivery" ADD CONSTRAINT "event_delivery_status_check"
  CHECK ("status" IN ('PENDING', 'PROCESSING', 'RETRY_WAIT', 'MANUAL', 'SUCCEEDED'));
ALTER TABLE "event_delivery" ADD CONSTRAINT "event_delivery_counters_non_negative"
  CHECK ("attemptCount" >= 0 AND "manualRetryCount" >= 0 AND "version" >= 0);
ALTER TABLE "event_delivery" ADD CONSTRAINT "event_delivery_lease_fields_check"
  CHECK (
    ("status" = 'PROCESSING' AND "lockedBy" IS NOT NULL AND "lockedUntil" IS NOT NULL)
    OR ("status" <> 'PROCESSING' AND "lockedBy" IS NULL AND "lockedUntil" IS NULL)
  );
ALTER TABLE "event_delivery" ADD CONSTRAINT "event_delivery_retry_wait_next_attempt_check"
  CHECK (
    ("status" = 'RETRY_WAIT' AND "nextAttemptAt" IS NOT NULL)
    OR ("status" <> 'RETRY_WAIT' AND "nextAttemptAt" IS NULL)
  );
ALTER TABLE "event_delivery" ADD CONSTRAINT "event_delivery_succeeded_completion_check"
  CHECK (
    ("status" = 'SUCCEEDED' AND "completedAt" IS NOT NULL)
    OR ("status" <> 'SUCCEEDED' AND "completedAt" IS NULL)
  );
ALTER TABLE "event_handler_log" ADD CONSTRAINT "event_handler_log_attempt_positive"
  CHECK ("attemptNumber" > 0);
ALTER TABLE "event_handler_log" ADD CONSTRAINT "event_handler_log_outcome_check"
  CHECK ("outcome" IN ('SUCCEEDED', 'RETRY_SCHEDULED', 'MANUAL_REQUIRED', 'LEASE_LOST'));
ALTER TABLE "event_handler_log" ADD CONSTRAINT "event_handler_log_duration_non_negative"
  CHECK ("durationMs" >= 0);
ALTER TABLE "event_handler_log" ADD CONSTRAINT "event_handler_log_time_order_check"
  CHECK ("completedAt" >= "startedAt");

ALTER TABLE "event_log" ADD CONSTRAINT "event_log_operatorUserId_fkey"
  FOREIGN KEY ("operatorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "professional_team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_delivery" ADD CONSTRAINT "event_delivery_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "event_log"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_delivery" ADD CONSTRAINT "event_delivery_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "event_subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_handler_log" ADD CONSTRAINT "event_handler_log_deliveryId_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "event_delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permission" (
  "id", "code", "name", "parentId", "type", "resource", "action", "riskLevel", "path", "sort", "status", "version", "createdAt", "updatedAt"
) VALUES
  ('permission:menu.event_operations', 'menu.event_operations', '事件运维', NULL, 'MENU', 'menu', 'view', 'HIGH', '/security/event-operations', 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:event.delivery.read', 'event.delivery.read', '查看事件投递', NULL, 'ACTION', 'event_delivery', 'read', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:event.delivery.retry', 'event.delivery.retry', '重试事件投递', NULL, 'SPECIAL', 'event_delivery', 'retry', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permission" ("id", "roleId", "permissionId")
SELECT
  'role-permission:' || role."id" || ':' || permission."code",
  role."id",
  permission."id"
FROM "role" role
CROSS JOIN "permission" permission
WHERE role."code" = 'SYSTEM_ADMIN'
  AND permission."code" IN ('menu.event_operations', 'event.delivery.read')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "role_permission" ("id", "roleId", "permissionId")
SELECT
  'role-permission:' || role."id" || ':' || permission."code",
  role."id",
  permission."id"
FROM "role" role
CROSS JOIN "permission" permission
WHERE role."code" = 'SYSTEM_SUPER_ADMIN'
  AND permission."code" IN ('menu.event_operations', 'event.delivery.read', 'event.delivery.retry')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "event_subscription" (
  "id", "code", "eventType", "eventVersion", "handlerCode", "status", "filterJson", "createdAt", "updatedAt"
) VALUES (
  'subscription:admin-operation-reviewed-notification-v1',
  'admin-operation-reviewed-notification-v1',
  'admin.operation.reviewed',
  1,
  'ADMIN_OPERATION_REVIEWED_NOTIFICATION',
  'ENABLED',
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;
