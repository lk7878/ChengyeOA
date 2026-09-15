ALTER TABLE channel ADD COLUMN "createdBy" TEXT, ADD COLUMN "updatedBy" TEXT, ADD COLUMN "branchId" TEXT, ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
WITH creators AS (
 SELECT "targetId", min("userId") AS creator FROM operation_log
 WHERE action = 'CHANNEL_CREATE' AND "targetType" = 'CHANNEL' AND "userId" IS NOT NULL
 GROUP BY "targetId" HAVING count(DISTINCT "userId") = 1
)
UPDATE channel c SET "createdBy" = a.creator FROM creators a JOIN "user" u ON u.id = a.creator WHERE c.id = a."targetId";
CREATE INDEX "channel_createdBy_idx" ON channel("createdBy");
CREATE INDEX "channel_branchId_idx" ON channel("branchId");
