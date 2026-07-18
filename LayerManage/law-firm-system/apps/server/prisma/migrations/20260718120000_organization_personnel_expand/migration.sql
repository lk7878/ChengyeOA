-- Expand organization and personnel master data while retaining legacy employee ownership.
ALTER TABLE "organization"
  ADD COLUMN "code" TEXT,
  ADD COLUMN "path" TEXT,
  ADD COLUMN "level" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "organization" AS o
SET
  "code" = 'ROOT',
  "path" = '/' || o."id",
  "level" = 0
FROM "system_initialization" AS s
WHERE s."id" = 'PRIMARY'
  AND s."rootOrganizationId" = o."id";

WITH RECURSIVE tree AS (
  SELECT o."id", o."parentId", o."path", o."level"
  FROM "organization" AS o
  WHERE o."path" IS NOT NULL

  UNION ALL

  SELECT
    child."id",
    child."parentId",
    tree."path" || '/' || child."id",
    tree."level" + 1
  FROM "organization" AS child
  JOIN tree ON child."parentId" = tree."id"
)
UPDATE "organization" AS o
SET
  "path" = tree."path",
  "level" = tree."level"
FROM tree
WHERE o."id" = tree."id";

UPDATE "organization"
SET "code" = 'LEGACY_' || upper(replace("id", '-', ''))
WHERE "code" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "organization" WHERE "path" IS NULL) THEN
    RAISE EXCEPTION 'SPEC-003 cannot derive every organization path from the initialized root';
  END IF;
END $$;

ALTER TABLE "organization"
  ALTER COLUMN "code" SET NOT NULL,
  ALTER COLUMN "path" SET NOT NULL;

CREATE UNIQUE INDEX "organization_code_key" ON "organization"("code");
CREATE UNIQUE INDEX "organization_path_key" ON "organization"("path");
ALTER TABLE "organization" ADD CONSTRAINT "organization_level_nonnegative"
  CHECK ("level" >= 0);
ALTER TABLE "organization" ADD CONSTRAINT "organization_path_ends_with_id"
  CHECK ("path" LIKE '/%' AND right("path", length("id") + 1) = '/' || "id");
ALTER TABLE "organization" ADD CONSTRAINT "organization_parent_level_shape"
  CHECK (("parentId" IS NULL AND "level" = 0) OR ("parentId" IS NOT NULL AND "level" > 0));

ALTER TABLE "position"
  ADD COLUMN "code" TEXT,
  ADD COLUMN "categoryCode" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "position"
SET
  "code" = 'LEGACY_' || upper(replace("id", '-', '')),
  "categoryCode" = 'LEGACY';

ALTER TABLE "position"
  ALTER COLUMN "code" SET NOT NULL,
  ALTER COLUMN "categoryCode" SET NOT NULL;

CREATE UNIQUE INDEX "position_orgId_code_key" ON "position"("orgId", "code");
CREATE INDEX "position_orgId_status_idx" ON "position"("orgId", "status");
ALTER TABLE "position" ADD CONSTRAINT "position_level_nonnegative"
  CHECK ("level" >= 0);

ALTER TABLE "employee"
  ADD COLUMN "licenseNo" TEXT,
  ADD COLUMN "professionalDirections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "formalDate" TIMESTAMP(3),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "employee_licenseNo_key" ON "employee"("licenseNo");

CREATE TABLE "employee_assignment" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "positionId" TEXT NOT NULL,
  "assignmentType" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_assignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_assignment_type_check"
    CHECK ("assignmentType" IN ('PRIMARY', 'SECONDARY', 'ACTING')),
  CONSTRAINT "employee_assignment_time_check"
    CHECK ("endedAt" IS NULL OR "endedAt" > "startedAt")
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "employee" AS e
    JOIN "position" AS p ON p."id" = e."positionId"
    WHERE p."orgId" <> e."orgId"
  ) THEN
    RAISE EXCEPTION 'SPEC-003 found an employee whose legacy position belongs to another organization';
  END IF;
END $$;

INSERT INTO "employee_assignment" (
  "id",
  "employeeId",
  "organizationId",
  "positionId",
  "assignmentType",
  "startedAt",
  "endedAt",
  "version",
  "createdAt",
  "updatedAt"
)
SELECT
  e."id",
  e."id",
  e."orgId",
  e."positionId",
  'PRIMARY',
  e."entryDate",
  CASE WHEN e."status" = 'LEAVED' THEN COALESCE(e."leaveDate", e."updatedAt") ELSE NULL END,
  1,
  e."createdAt",
  e."updatedAt"
FROM "employee" AS e;

CREATE INDEX "employee_assignment_employeeId_endedAt_idx"
  ON "employee_assignment"("employeeId", "endedAt");
CREATE INDEX "employee_assignment_organizationId_endedAt_idx"
  ON "employee_assignment"("organizationId", "endedAt");
CREATE INDEX "employee_assignment_positionId_endedAt_idx"
  ON "employee_assignment"("positionId", "endedAt");

CREATE UNIQUE INDEX "employee_assignment_one_active_primary"
  ON "employee_assignment"("employeeId")
  WHERE "assignmentType" = 'PRIMARY' AND "endedAt" IS NULL;

CREATE UNIQUE INDEX "employee_assignment_one_active_tuple"
  ON "employee_assignment"("employeeId", "organizationId", "positionId")
  WHERE "endedAt" IS NULL;

ALTER TABLE "employee_assignment" ADD CONSTRAINT "employee_assignment_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_assignment" ADD CONSTRAINT "employee_assignment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_assignment" ADD CONSTRAINT "employee_assignment_positionId_fkey"
  FOREIGN KEY ("positionId") REFERENCES "position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "professional_team" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "categoryCode" TEXT NOT NULL,
  "homeOrganizationId" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ENABLED',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "professional_team_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "professional_team_status_check" CHECK ("status" IN ('ENABLED', 'DISABLED'))
);

CREATE UNIQUE INDEX "professional_team_code_key" ON "professional_team"("code");
CREATE INDEX "professional_team_homeOrganizationId_status_idx"
  ON "professional_team"("homeOrganizationId", "status");
CREATE INDEX "professional_team_categoryCode_status_idx"
  ON "professional_team"("categoryCode", "status");
ALTER TABLE "professional_team" ADD CONSTRAINT "professional_team_homeOrganizationId_fkey"
  FOREIGN KEY ("homeOrganizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "professional_team_member" (
  "id" TEXT NOT NULL,
  "professionalTeamId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "memberRole" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "professional_team_member_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "professional_team_member_role_check"
    CHECK ("memberRole" IN ('LEAD', 'EXPERT', 'LAWYER', 'ASSISTANT', 'OPERATIONS', 'OTHER')),
  CONSTRAINT "professional_team_member_time_check"
    CHECK ("endedAt" IS NULL OR "endedAt" > "startedAt")
);

CREATE INDEX "professional_team_member_professionalTeamId_endedAt_idx"
  ON "professional_team_member"("professionalTeamId", "endedAt");
CREATE INDEX "professional_team_member_employeeId_endedAt_idx"
  ON "professional_team_member"("employeeId", "endedAt");

CREATE UNIQUE INDEX "professional_team_member_one_active_member"
  ON "professional_team_member"("professionalTeamId", "employeeId")
  WHERE "endedAt" IS NULL;

CREATE UNIQUE INDEX "professional_team_member_one_active_lead"
  ON "professional_team_member"("professionalTeamId")
  WHERE "memberRole" = 'LEAD' AND "endedAt" IS NULL;

ALTER TABLE "professional_team_member" ADD CONSTRAINT "professional_team_member_professionalTeamId_fkey"
  FOREIGN KEY ("professionalTeamId") REFERENCES "professional_team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "professional_team_member" ADD CONSTRAINT "professional_team_member_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
