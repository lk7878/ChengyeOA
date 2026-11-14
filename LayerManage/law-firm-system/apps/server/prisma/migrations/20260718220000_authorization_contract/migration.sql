-- Fail closed before applying the final SPEC-004 authorization contract.
DO $contract_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "permission"
    WHERE "status" = 'ENABLED'
      AND (
        NULLIF(btrim("resource"), '') IS NULL
        OR NULLIF(btrim("action"), '') IS NULL
        OR "type" NOT IN ('MENU', 'ACTION', 'SPECIAL')
        OR "riskLevel" NOT IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
      )
  ) THEN
    RAISE EXCEPTION 'SPEC-004 contract: active permission metadata is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "user_role" first_grant
    JOIN "user_role" second_grant
      ON first_grant."id" < second_grant."id"
     AND first_grant."userId" = second_grant."userId"
     AND first_grant."roleId" = second_grant."roleId"
     AND first_grant."revokedAt" IS NULL
     AND second_grant."revokedAt" IS NULL
     AND tstzrange(first_grant."validFrom", COALESCE(first_grant."validUntil", 'infinity'::timestamptz), '[)')
       && tstzrange(second_grant."validFrom", COALESCE(second_grant."validUntil", 'infinity'::timestamptz), '[)')
  ) THEN
    RAISE EXCEPTION 'SPEC-004 contract: overlapping active user role grants exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "data_scope" scope
    LEFT JOIN "organization" organization ON organization."id" = scope."organizationId"
    WHERE scope."scopeType" NOT IN ('ALL', 'HQ_SCOPE', 'ORG', 'BRANCH', 'TEAM', 'SELF_AND_SUBORDINATES', 'SELF', 'CUSTOM')
       OR (scope."scopeType" IN ('ORG', 'BRANCH') AND scope."organizationId" IS NULL)
       OR (scope."scopeType" = 'TEAM' AND scope."professionalTeamId" IS NULL)
       OR (scope."scopeType" NOT IN ('ORG', 'BRANCH') AND scope."organizationId" IS NOT NULL)
       OR (scope."scopeType" <> 'TEAM' AND scope."professionalTeamId" IS NOT NULL)
       OR (scope."scopeType" = 'BRANCH' AND organization."type" IS DISTINCT FROM 'BRANCH')
       OR (scope."scopeType" <> 'CUSTOM' AND EXISTS (
         SELECT 1 FROM "data_scope_target" target WHERE target."dataScopeId" = scope."id"
       ))
  ) THEN
    RAISE EXCEPTION 'SPEC-004 contract: invalid data scope shape exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "data_scope" scope
    WHERE scope."scopeType" = 'CUSTOM'
      AND NOT EXISTS (
        SELECT 1 FROM "data_scope_target" target WHERE target."dataScopeId" = scope."id"
      )
  ) THEN
    RAISE EXCEPTION 'SPEC-004 contract: empty custom data scope exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "user_permission_grant" first_grant
    JOIN "user_permission_grant" second_grant
      ON first_grant."id" < second_grant."id"
     AND first_grant."userId" = second_grant."userId"
     AND first_grant."permissionId" = second_grant."permissionId"
     AND first_grant."dataScopeId" = second_grant."dataScopeId"
     AND first_grant."revokedAt" IS NULL
     AND second_grant."revokedAt" IS NULL
     AND tstzrange(first_grant."validFrom", first_grant."validUntil", '[)')
       && tstzrange(second_grant."validFrom", second_grant."validUntil", '[)')
  ) THEN
    RAISE EXCEPTION 'SPEC-004 contract: overlapping active special grants exist';
  END IF;

  IF EXISTS (
    SELECT "employeeId"
    FROM "employee_reporting_line"
    WHERE "endedAt" IS NULL
    GROUP BY "employeeId"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'SPEC-004 contract: employee has more than one current manager';
  END IF;

  IF EXISTS (
    WITH RECURSIVE reporting_walk AS (
      SELECT
        line."employeeId" AS origin_id,
        line."managerEmployeeId" AS next_id,
        ARRAY[line."employeeId"]::text[] AS visited,
        line."managerEmployeeId" = line."employeeId" AS has_cycle
      FROM "employee_reporting_line" line
      WHERE line."endedAt" IS NULL
      UNION ALL
      SELECT
        walk.origin_id,
        line."managerEmployeeId",
        walk.visited || walk.next_id,
        line."managerEmployeeId" = ANY(walk.visited || walk.next_id)
      FROM reporting_walk walk
      JOIN "employee_reporting_line" line ON line."employeeId" = walk.next_id
      WHERE line."endedAt" IS NULL AND NOT walk.has_cycle
    )
    SELECT 1 FROM reporting_walk WHERE has_cycle
  ) THEN
    RAISE EXCEPTION 'SPEC-004 contract: reporting line cycle exists';
  END IF;

  IF EXISTS (SELECT 1 FROM "system_initialization")
    AND NOT EXISTS (
      SELECT 1
      FROM "system_initialization" initialization
      JOIN "user" root_user ON root_user."id" = initialization."superAdminUserId"
      JOIN "user_role" root_grant ON root_grant."userId" = root_user."id"
      JOIN "role" root_role ON root_role."id" = root_grant."roleId"
      WHERE root_user."status" = 'ENABLED'
        AND root_role."code" = 'SYSTEM_SUPER_ADMIN'
        AND root_role."type" = 'SYSTEM'
        AND root_role."status" = 'ENABLED'
        AND root_grant."revokedAt" IS NULL
        AND root_grant."validFrom" <= CURRENT_TIMESTAMP
        AND (root_grant."validUntil" IS NULL OR root_grant."validUntil" > CURRENT_TIMESTAMP)
    )
  THEN
    RAISE EXCEPTION 'SPEC-004 contract: system super admin trust root is missing or disabled';
  END IF;
END
$contract_preflight$;

CREATE OR REPLACE FUNCTION validate_data_scope_contract(scope_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $data_scope_contract$
DECLARE
  scope_record RECORD;
BEGIN
  SELECT scope."scopeType", scope."organizationId", organization."type" AS organization_type
  INTO scope_record
  FROM "data_scope" scope
  LEFT JOIN "organization" organization ON organization."id" = scope."organizationId"
  WHERE scope."id" = scope_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF scope_record."scopeType" = 'CUSTOM'
    AND NOT EXISTS (SELECT 1 FROM "data_scope_target" target WHERE target."dataScopeId" = scope_id)
  THEN
    RAISE EXCEPTION 'CUSTOM data scope requires at least one target';
  END IF;

  IF scope_record."scopeType" <> 'CUSTOM'
    AND EXISTS (SELECT 1 FROM "data_scope_target" target WHERE target."dataScopeId" = scope_id)
  THEN
    RAISE EXCEPTION 'Only CUSTOM data scope accepts explicit targets';
  END IF;

  IF scope_record."scopeType" = 'BRANCH' AND scope_record.organization_type IS DISTINCT FROM 'BRANCH' THEN
    RAISE EXCEPTION 'BRANCH data scope requires a BRANCH organization';
  END IF;
END
$data_scope_contract$;

CREATE OR REPLACE FUNCTION enforce_data_scope_contract_on_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $data_scope_scope_trigger$
BEGIN
  PERFORM validate_data_scope_contract(NEW."id");
  RETURN NULL;
END
$data_scope_scope_trigger$;

CREATE OR REPLACE FUNCTION enforce_data_scope_contract_on_target()
RETURNS trigger
LANGUAGE plpgsql
AS $data_scope_target_trigger$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."dataScopeId" <> NEW."dataScopeId" THEN
    PERFORM validate_data_scope_contract(OLD."dataScopeId");
  END IF;
  PERFORM validate_data_scope_contract(CASE WHEN TG_OP = 'DELETE' THEN OLD."dataScopeId" ELSE NEW."dataScopeId" END);
  RETURN NULL;
END
$data_scope_target_trigger$;

CREATE OR REPLACE FUNCTION enforce_data_scope_contract_on_organization()
RETURNS trigger
LANGUAGE plpgsql
AS $data_scope_organization_trigger$
DECLARE
  scope_id TEXT;
BEGIN
  FOR scope_id IN SELECT "id" FROM "data_scope" WHERE "organizationId" = NEW."id"
  LOOP
    PERFORM validate_data_scope_contract(scope_id);
  END LOOP;
  RETURN NULL;
END
$data_scope_organization_trigger$;

CREATE CONSTRAINT TRIGGER "data_scope_contract_on_scope"
AFTER INSERT OR UPDATE OF "scopeType", "organizationId", "professionalTeamId" ON "data_scope"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_data_scope_contract_on_scope();

CREATE CONSTRAINT TRIGGER "data_scope_contract_on_target"
AFTER INSERT OR UPDATE OR DELETE ON "data_scope_target"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_data_scope_contract_on_target();

CREATE CONSTRAINT TRIGGER "data_scope_contract_on_organization"
AFTER UPDATE OF "type" ON "organization"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_data_scope_contract_on_organization();

CREATE OR REPLACE FUNCTION enforce_employee_reporting_line_acyclic()
RETURNS trigger
LANGUAGE plpgsql
AS $reporting_line_cycle_trigger$
BEGIN
  IF EXISTS (
    WITH RECURSIVE reporting_walk AS (
      SELECT
        line."employeeId" AS origin_id,
        line."managerEmployeeId" AS next_id,
        ARRAY[line."employeeId"]::text[] AS visited,
        line."managerEmployeeId" = line."employeeId" AS has_cycle
      FROM "employee_reporting_line" line
      WHERE line."endedAt" IS NULL
      UNION ALL
      SELECT
        walk.origin_id,
        line."managerEmployeeId",
        walk.visited || walk.next_id,
        line."managerEmployeeId" = ANY(walk.visited || walk.next_id)
      FROM reporting_walk walk
      JOIN "employee_reporting_line" line ON line."employeeId" = walk.next_id
      WHERE line."endedAt" IS NULL AND NOT walk.has_cycle
    )
    SELECT 1 FROM reporting_walk WHERE has_cycle
  ) THEN
    RAISE EXCEPTION 'REPORTING_LINE_CYCLE';
  END IF;
  RETURN NULL;
END
$reporting_line_cycle_trigger$;

CREATE CONSTRAINT TRIGGER "employee_reporting_line_acyclic"
AFTER INSERT OR UPDATE OF "employeeId", "managerEmployeeId", "endedAt" ON "employee_reporting_line"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_employee_reporting_line_acyclic();

ALTER TABLE "permission" DROP CONSTRAINT "permission_parentId_fkey";
ALTER TABLE "permission" ADD CONSTRAINT "permission_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_roleId_fkey";
ALTER TABLE "role_permission" DROP CONSTRAINT "role_permission_permissionId_fkey";
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permissionId_fkey"
  FOREIGN KEY ("permissionId") REFERENCES "permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
