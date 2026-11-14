-- U5-B: preserve unknown historical ownership rather than attributing it to an assignee.
ALTER TABLE "case" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "case" ADD COLUMN "branchId" TEXT;
ALTER TABLE "case" ADD COLUMN "updatedBy" TEXT;

-- Only an unambiguous recorded case creation actor can establish ownership.
UPDATE "case" c SET "createdBy" = evidence."userId"
FROM (
  SELECT "targetId", MIN("userId") AS "userId"
  FROM operation_log
  WHERE "targetType" = 'CASE' AND action = 'CASE_CREATE' AND "userId" IS NOT NULL
  GROUP BY "targetId" HAVING COUNT(DISTINCT "userId") = 1
) evidence
WHERE evidence."targetId" = c.id;

-- These are existing explicit organizational facts; no current-assignment inference.
UPDATE "case" c SET "branchId" = contract."branchId"
FROM contract JOIN organization o ON o.id = contract."branchId"
WHERE c."contractId" = contract.id;
UPDATE "case" c SET "branchId" = o.id
FROM organization o
WHERE c."branchId" IS NULL AND c."intakeData" ->> 'departmentId' = o.id;

CREATE INDEX "case_createdBy_idx" ON "case"("createdBy");
CREATE INDEX "case_branchId_idx" ON "case"("branchId");
