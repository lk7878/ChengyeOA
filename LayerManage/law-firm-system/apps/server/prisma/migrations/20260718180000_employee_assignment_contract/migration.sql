-- Make employee assignments the canonical organization and position ownership source.
DO $$
BEGIN
  IF EXISTS (
    SELECT e."id"
    FROM "employee" AS e
    LEFT JOIN "employee_assignment" AS a
      ON a."employeeId" = e."id"
      AND a."assignmentType" = 'PRIMARY'
      AND a."endedAt" IS NULL
    WHERE e."status" <> 'LEAVED'
    GROUP BY e."id"
    HAVING count(a."id") <> 1
  ) THEN
    RAISE EXCEPTION 'SPEC-003 contract requires exactly one active primary assignment';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "employee_assignment" AS a
    JOIN "position" AS p ON p."id" = a."positionId"
    WHERE p."orgId" <> a."organizationId"
  ) THEN
    RAISE EXCEPTION 'SPEC-003 contract found an assignment whose position belongs to another organization';
  END IF;
END $$;

ALTER TABLE "employee" DROP CONSTRAINT "employee_orgId_fkey";
ALTER TABLE "employee" DROP CONSTRAINT "employee_positionId_fkey";
ALTER TABLE "employee" DROP COLUMN "orgId";
ALTER TABLE "employee" DROP COLUMN "positionId";
