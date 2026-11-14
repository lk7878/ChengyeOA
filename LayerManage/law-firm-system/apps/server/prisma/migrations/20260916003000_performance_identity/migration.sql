ALTER TABLE "performance" ADD COLUMN "createdBy" TEXT, ADD COLUMN "updatedBy" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
WITH creators AS (
 SELECT "targetId", min("userId") AS creator FROM operation_log
 WHERE action = 'PERFORMANCE_CREATE' AND "targetType" = 'PERFORMANCE' AND "userId" IS NOT NULL
 GROUP BY "targetId" HAVING count(DISTINCT "userId") = 1
)
UPDATE performance p SET "createdBy" = c.creator FROM creators c JOIN "user" u ON u.id = c.creator WHERE p.id = c."targetId";
CREATE INDEX "performance_createdBy_idx" ON performance("createdBy");
